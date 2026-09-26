const test = require('node:test');
const assert = require('node:assert/strict');

require('../providers/provider-utils.js');
require('../providers/openai-compatible.js');
const { createProviderAdapter } = require('../providers/provider-registry.js');
const {
  PROVIDER_PUBLIC_ERROR_CODES,
  PROVIDER_PROBE_IDS,
  compileProviderCapabilityProbes,
  runProviderCapabilityProbes
} = require('../core/provider-probes.js');

function textEvents(text, signal) {
  return (async function * stream() {
    if (signal) await Promise.resolve();
    if (signal?.aborted) {
      yield { type: 'cancelled' };
      return;
    }
    yield { type: 'text_delta', text };
    yield { type: 'completed' };
  })();
}

function adapterFixture() {
  return {
    generateTextStream(request) {
      const system = String(request.systemPrompt || '');
      if (request.signal) return textEvents('', request.signal);
      if (/JSON object/i.test(system)) return textEvents('{"ok":true}');
      if (/STREAM_OK/.test(system)) return textEvents('STREAM_OK');
      if (/one-pixel image/i.test(system)) return textEvents('WHITE');
      return textEvents('OK');
    },
    async analyzeChunk(request) {
      request.onProviderTelemetry?.({ inputTokens: 11, outputTokens: 3 });
      return { ok: true, echo: 'schema' };
    }
  };
}

test('defines bounded independent minimal provider probes', () => {
  const probes = compileProviderCapabilityProbes({
    supportsVision: true,
    supportsReasoning: true
  });
  assert.deepEqual(probes.map(item => item.id), PROVIDER_PROBE_IDS);
  for (const probe of probes) {
    const serialized = JSON.stringify(probe.request);
    assert.doesNotMatch(serialized,
      /PAPER_BLUEPRINT|STUDY_TYPE_GUIDANCE|necessity_evidence|causal_effect|scientific_annotations/i
    );
    assert.ok(probe.estimatedInputTokens > 0);
    assert.ok(probe.estimatedInputTokens < 400);
  }
  assert.equal(probes.find(item => item.id === 'vision').request.images.length, 1);
});

test('isolates image input, multimodal JSON, and multimodal reasoning for vision profiles', () => {
  const probes = compileProviderCapabilityProbes({
    supportsVision: true,
    supportsReasoning: true
  });
  const selected = ['connectivity', 'vision_input', 'json_output', 'reasoning_structured']
    .map(id => probes.find(item => item.id === id));

  assert.ok(selected.every(Boolean), probes.map(item => item.id).join(', '));
  assert.deepEqual(selected.map(item => item.diagnosticGroup), [
    'connectivity', 'image_content', 'json_output', 'reasoning_structured'
  ]);
  assert.equal(selected[0].request.images, undefined);
  for (const probe of selected.slice(1)) {
    assert.equal(probe.skipped, false);
    assert.equal(probe.request.images.length, 1);
    assert.match(probe.request.images[0].dataUrl,
      /^data:image\/png;base64,[A-Za-z0-9+/=]+$/);
    assert.ok(probe.request.images[0].dataUrl.length < 256);
  }
  assert.equal(selected[1].mode, 'vision');
  assert.equal(selected[2].mode, 'structured');
  assert.equal(selected[2].request.reasoningEnabled, false);
  assert.equal(selected[3].mode, 'structured');
  assert.equal(selected[3].request.reasoningEnabled, true);
  assert.equal(selected[3].request.reasoningEffort, 'enabled');
  assert.doesNotMatch(JSON.stringify(selected),
    /authorization|api[-_]?key|bearer|headers/i);
});

test('vision probe diagnostics identify the failed stage without retaining hostile error data', async () => {
  const adapter = adapterFixture();
  adapter.generateTextStream = request => {
    if (Array.isArray(request.images)) {
      const error = new Error('raw response and article text must not survive');
      error.code = 'INVALID_RESPONSE';
      error.diagnosticStage = 'Authorization: Bearer private-value';
      error.diagnosticType = 'data:image/png;base64,private-bytes';
      throw error;
    }
    return textEvents('OK');
  };
  const result = await runProviderCapabilityProbes(adapter, {
    supportsVision: true,
    supportsReasoning: true,
    probeIds: ['connectivity', 'vision_input', 'json_output', 'reasoning_structured']
  });

  assert.equal(result.connected, true);
  assert.deepEqual(result.diagnostics.failedByCapability, {
    connectivity: [],
    image_content: ['vision_input'],
    json_output: [],
    reasoning_structured: []
  });
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized,
    /authorization|bearer|private-value|data:image|private-bytes|article text|raw response/i);
});

test('unknown alphanumeric provider diagnostics are replaced by fixed safe enums', async () => {
  const privateToken = 'PRIVATEALPHANUMERICKEY987654321';
  const adapter = adapterFixture();
  adapter.generateTextStream = () => {
    const error = new Error(privateToken);
    error.code = privateToken;
    error.diagnosticStage = privateToken;
    error.diagnosticType = privateToken;
    error.name = privateToken;
    throw error;
  };
  const result = await runProviderCapabilityProbes(adapter, {
    probeIds: ['connectivity']
  });
  assert.equal(result.probes[0].code, 'UNKNOWN_PROVIDER_ERROR');
  assert.equal(result.probes[0].diagnosticStage, 'unknown');
  assert.equal(result.probes[0].diagnosticType, 'UnknownError');
  assert.doesNotMatch(JSON.stringify(result), new RegExp(privateToken, 'i'));
});

test('known public Local Codex errors survive provider probe diagnostics', async () => {
  const publicCodes = [
    'CODEX_NOT_INSTALLED',
    'CODEX_NOT_AUTHENTICATED',
    'CODEX_BRIDGE_UNAVAILABLE',
    'CODEX_PROVIDER_REJECTED'
  ];
  for (const code of publicCodes) {
    assert.equal(PROVIDER_PUBLIC_ERROR_CODES.includes(code), true);
    const adapter = adapterFixture();
    adapter.generateTextStream = () => (async function * codexError() {
      yield { type: 'error', error: { code } };
    })();
    const result = await runProviderCapabilityProbes(adapter, {
      probeIds: ['connectivity']
    });
    assert.equal(result.probes[0].status, 'failed');
    assert.equal(result.probes[0].code, code);
  }
});

test('provider diagnostic accessors are ignored without escaping the fixed result shape', async () => {
  const adapter = adapterFixture();
  let accessorCalls = 0;
  adapter.generateTextStream = () => {
    const error = new Error('private provider failure');
    for (const field of ['code', 'diagnosticStage', 'diagnosticType', 'name', 'requestBytes']) {
      Object.defineProperty(error, field, {
        configurable: true,
        get() {
          accessorCalls += 1;
          throw new Error('PRIVATEALPHANUMERICKEY987654321');
        }
      });
    }
    throw error;
  };
  const result = await runProviderCapabilityProbes(adapter, {
    probeIds: ['connectivity']
  });
  assert.equal(accessorCalls, 0);
  assert.deepEqual({
    code: result.probes[0].code,
    diagnosticStage: result.probes[0].diagnosticStage,
    diagnosticType: result.probes[0].diagnosticType,
    requestBytes: result.probes[0].requestBytes
  }, {
    code: 'UNKNOWN_PROVIDER_ERROR',
    diagnosticStage: 'unknown',
    diagnosticType: 'UnknownError',
    requestBytes: null
  });
  assert.doesNotMatch(JSON.stringify(result), /PRIVATEALPHANUMERIC|private provider failure/i);
});

test('provider telemetry accessors are never retained or executed by diagnostics', async () => {
  const adapter = adapterFixture();
  let accessorCalls = 0;
  adapter.generateTextStream = request => (async function * hostileTelemetry() {
    const telemetry = {};
    Object.defineProperty(telemetry, 'inputTokens', {
      get() {
        accessorCalls += 1;
        throw new Error('PRIVATEALPHANUMERICKEY987654321');
      }
    });
    request.onProviderTelemetry(telemetry);
    yield { type: 'text_delta', text: 'OK' };
    yield { type: 'completed' };
  })();
  const result = await runProviderCapabilityProbes(adapter, {
    probeIds: ['connectivity']
  });
  assert.equal(accessorCalls, 0);
  assert.equal(result.connected, true);
  assert.equal(result.probes[0].measuredInputTokens, 0);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATEALPHANUMERIC/i);
});

test('preserves known safe provider diagnostic types while rejecting arbitrary diagnostic text', async () => {
  const adapter = adapterFixture();
  adapter.generateTextStream = () => {
    const error = new Error('provider body is private');
    error.code = 'INVALID_RESPONSE';
    error.diagnosticStage = 'response-body';
    error.diagnosticType = 'HtmlResponse';
    throw error;
  };
  const result = await runProviderCapabilityProbes(adapter, {
    probeIds: ['connectivity']
  });
  assert.equal(result.probes[0].diagnosticStage, 'response-body');
  assert.equal(result.probes[0].diagnosticType, 'HtmlResponse');
  assert.doesNotMatch(JSON.stringify(result), /provider body is private/);
});

test('reasoning structured probe is optional and explicitly enables reasoning with a schema', () => {
  const probe = compileProviderCapabilityProbes({ supportsReasoning: true })
    .find(item => item.id === 'reasoning_structured');
  assert.equal(probe.required, false);
  assert.equal(probe.skipped, false);
  assert.equal(probe.mode, 'structured');
  assert.equal(probe.request.reasoningEffort, 'enabled');
  assert.equal(probe.request.schemaName, 'provider_reasoning_probe');
  assert.deepEqual(probe.request.responseSchema, {
    type: 'object',
    additionalProperties: false,
    properties: {
      ok: { type: 'boolean', enum: [true] },
      echo: { type: 'string', enum: ['schema'] }
    },
    required: ['ok', 'echo']
  });
});

test('reasoning structured probe is skipped with a bounded reason when unsupported', () => {
  const probe = compileProviderCapabilityProbes({ supportsReasoning: false })
    .find(item => item.id === 'reasoning_structured');
  assert.equal(probe.skipped, true);
  assert.equal(probe.skipReason, 'provider_profile_does_not_enable_reasoning');
});

test('requested unsupported and blocked capability probes return explicit safe statuses', async () => {
  const unsupported = await runProviderCapabilityProbes(adapterFixture(), {
    supportsVision: false,
    supportsReasoning: false,
    probeIds: ['connectivity', 'vision_input', 'json_output', 'reasoning_structured']
  });
  assert.deepEqual(unsupported.probes.map(item => [item.id, item.status]), [
    ['connectivity', 'passed'],
    ['vision_input', 'unsupported'],
    ['json_output', 'unsupported'],
    ['reasoning_structured', 'unsupported']
  ]);
  assert.equal(unsupported.connected, true);
  assert.equal(unsupported.connectivity, true);
  assert.equal(unsupported.capabilitiesReady, false);

  const blocked = await runProviderCapabilityProbes(adapterFixture(), {
    supportsVision: true,
    reasoningCapability: {
      supported: true, mode: 'toggle', levels: ['disabled']
    },
    probeIds: ['reasoning_structured']
  });
  assert.equal(blocked.probes[0].status, 'blocked');
  assert.equal(blocked.probes[0].reason,
    'provider_profile_cannot_explicitly_enable_reasoning');
  assert.equal(blocked.connected, false,
    'an inactive capability-only selection is not vacuously connected');
  assert.equal(blocked.connectivity, null);
  assert.equal(blocked.capabilitiesReady, false);
});

test('reasoning structured probe selects a genuinely enabled bounded effort', () => {
  const configured = compileProviderCapabilityProbes({
    reasoningCapability: {
      supported: true, mode: 'effort', levels: ['auto', 'low', 'high']
    },
    configuredReasoningEffort: 'high'
  }).find(item => item.id === 'reasoning_structured');
  assert.equal(configured.skipped, false);
  assert.equal(configured.request.reasoningEffort, 'high');

  const preferred = compileProviderCapabilityProbes({
    reasoningCapability: {
      supported: true, mode: 'effort', levels: ['auto', 'low', 'medium', 'high']
    },
    configuredReasoningEffort: 'auto'
  }).find(item => item.id === 'reasoning_structured');
  assert.equal(preferred.request.reasoningEffort, 'medium');

  const firstEnabled = compileProviderCapabilityProbes({
    reasoningCapability: {
      supported: true, mode: 'effort', levels: ['auto', 'minimal', 'high']
    },
    configuredReasoningEffort: 'disabled'
  }).find(item => item.id === 'reasoning_structured');
  assert.equal(firstEnabled.request.reasoningEffort, 'minimal');
});

test('reasoning structured probe skips malformed capabilities instead of assuming reasoning', () => {
  for (const reasoningCapability of [
    { supported: true, mode: 'toggle', levels: ['disabled'] },
    { supported: true, mode: 'effort', levels: ['auto', 'none', 'disabled'] },
    { supported: true, mode: 'unknown', levels: ['medium'] }
  ]) {
    const probe = compileProviderCapabilityProbes({ reasoningCapability })
      .find(item => item.id === 'reasoning_structured');
    assert.equal(probe.skipped, true);
    assert.equal(probe.skipReason, 'provider_profile_cannot_explicitly_enable_reasoning');
  }
});

test('skips optional profile-gated probes when their capabilities are disabled', () => {
  const probes = compileProviderCapabilityProbes({ supportsVision: false });
  assert.equal(probes.find(item => item.id === 'vision').skipped, true);
  assert.equal(probes.find(item => item.id === 'reasoning_structured').skipped, true);
  assert.deepEqual(probes.filter(item => item.required).map(item => item.id), [
    'connectivity'
  ]);
  assert.ok(probes.every(item => item.request.maxOutputTokens >= 512));
  assert.ok(probes.every(item => item.request.maxOutputTokens <= 1024));
});

test('runs text, JSON, Schema, reasoning, streaming, vision, and cancellation independently', async () => {
  const result = await runProviderCapabilityProbes(adapterFixture(), {
    supportsVision: true,
    supportsReasoning: true,
    probeIds: PROVIDER_PROBE_IDS
  });
  assert.equal(result.connected, true, JSON.stringify(result));
  assert.equal(result.connectivity, true);
  assert.equal(result.capabilitiesReady, true);
  assert.equal(result.probes.length, PROVIDER_PROBE_IDS.length);
  assert.ok(result.probes.every(item => item.status === 'passed'));
  assert.equal(result.probes.find(item => item.id === 'structured_schema')
    .measuredInputTokens, 11);
  assert.ok(result.estimatedInputTokens > 0);
});

test('structured schema probes require an exact plain own-data response', async () => {
  let accessorCalls = 0;
  let transparentShapeTraps = 0;
  let transparentGetTraps = 0;
  let sideEffectGetTraps = 0;
  let sideEffectConversions = 0;
  const privateProxyToken = 'PRIVATEPROXYDIAGNOSTIC987654321';
  const accessorValue = { echo: 'schema' };
  Object.defineProperty(accessorValue, 'ok', {
    enumerable: true,
    get() {
      accessorCalls += 1;
      return true;
    }
  });
  const symbolValue = { ok: true, echo: 'schema' };
  symbolValue[Symbol('extra')] = true;
  const arrayValue = [];
  arrayValue.ok = true;
  arrayValue.echo = 'schema';
  class StructuredResult {
    constructor() {
      this.ok = true;
      this.echo = 'schema';
    }
  }
  const proxiedValue = new Proxy({ ok: true, echo: 'schema' }, {
    ownKeys() { throw new Error('hostile ownKeys trap'); }
  });
  const transparentProxy = new Proxy({ ok: true, echo: 'schema' }, {
    getPrototypeOf(target) {
      transparentShapeTraps += 1;
      return Reflect.getPrototypeOf(target);
    },
    ownKeys(target) {
      transparentShapeTraps += 1;
      return Reflect.ownKeys(target);
    },
    getOwnPropertyDescriptor(target, key) {
      transparentShapeTraps += 1;
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
    get(target, key, receiver) {
      transparentGetTraps += 1;
      return Reflect.get(target, key, receiver);
    }
  });
  const sideEffectProxy = new Proxy({ ok: true, echo: 'schema' }, {
    get(target, key, receiver) {
      sideEffectGetTraps += 1;
      if (key === 'diagnostic') {
        return {
          toString() {
            sideEffectConversions += 1;
            return privateProxyToken;
          }
        };
      }
      return Reflect.get(target, key, receiver);
    }
  });
  const revokedProxy = Proxy.revocable({ ok: true, echo: 'schema' }, {});
  revokedProxy.revoke();
  const inheritedValue = Object.assign(Object.create({ ok: true }), {
    echo: 'schema'
  });
  const customPrototypeValue = Object.assign(Object.create({}), {
    ok: true, echo: 'schema'
  });
  const nonEnumerableValue = { ok: true };
  Object.defineProperty(nonEnumerableValue, 'echo', {
    value: 'schema', enumerable: false
  });
  const invalidValues = [
    { ok: true, echo: 'schema', extra: true },
    inheritedValue,
    customPrototypeValue,
    arrayValue,
    new StructuredResult(),
    symbolValue,
    accessorValue,
    nonEnumerableValue,
    proxiedValue,
    transparentProxy,
    sideEffectProxy,
    revokedProxy.proxy
  ];

  for (const [index, value] of invalidValues.entries()) {
    const adapter = adapterFixture();
    adapter.analyzeChunk = async () => value;
    const result = await runProviderCapabilityProbes(adapter, {
      probeIds: ['structured_schema']
    });
    assert.equal(result.probes[0].status, 'failed', `invalid value ${index}`);
    const expectedCode = index === invalidValues.length - 1
      ? 'UNKNOWN_PROVIDER_ERROR' : 'INVALID_RESPONSE';
    assert.equal(result.probes[0].code, expectedCode, `invalid value ${index}`);
    if (value === sideEffectProxy) {
      assert.doesNotMatch(JSON.stringify(result), new RegExp(privateProxyToken));
    }
  }
  assert.equal(accessorCalls, 0, 'structured accessors are never invoked');
  assert.ok(transparentShapeTraps > 0,
    'shape inspection may invoke transparent Proxy descriptor traps');
  assert.ok(transparentGetTraps + sideEffectGetTraps > 0,
    'Promise resolution may legitimately invoke Proxy then-property traps');
  assert.equal(sideEffectConversions, 0);

  const nullPrototype = Object.assign(Object.create(null), {
    ok: true, echo: 'schema'
  });
  const adapter = adapterFixture();
  adapter.analyzeChunk = async () => nullPrototype;
  const accepted = await runProviderCapabilityProbes(adapter, {
    probeIds: ['structured_schema']
  });
  assert.equal(accepted.probes[0].status, 'passed');
});

test('structured schema probes fail closed when structuredClone is unavailable', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'structuredClone');
  try {
    Object.defineProperty(globalThis, 'structuredClone', {
      configurable: true,
      writable: true,
      value: undefined
    });
    const result = await runProviderCapabilityProbes(adapterFixture(), {
      probeIds: ['structured_schema']
    });
    assert.equal(result.probes[0].status, 'failed');
    assert.equal(result.probes[0].code, 'INVALID_RESPONSE');
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'structuredClone', descriptor);
    else delete globalThis.structuredClone;
  }
});

test('stream probes accept only primitive own-data text deltas', async () => {
  let conversions = 0;
  let getterCalls = 0;
  const hostileTexts = [
    { toString() { conversions += 1; return 'OK'; } },
    new String('OK')
  ];
  for (const text of hostileTexts) {
    const adapter = adapterFixture();
    adapter.generateTextStream = () => (async function * hostileText() {
      yield { type: 'text_delta', text };
      yield { type: 'completed' };
    })();
    const result = await runProviderCapabilityProbes(adapter, {
      probeIds: ['connectivity']
    });
    assert.equal(result.probes[0].status, 'failed');
    assert.equal(result.probes[0].code, 'INVALID_RESPONSE');
  }

  const accessorAdapter = adapterFixture();
  accessorAdapter.generateTextStream = () => (async function * accessorText() {
    const event = { type: 'text_delta' };
    Object.defineProperty(event, 'text', {
      get() {
        getterCalls += 1;
        return 'OK';
      }
    });
    yield event;
  })();
  const accessorResult = await runProviderCapabilityProbes(accessorAdapter, {
    probeIds: ['connectivity']
  });
  assert.equal(accessorResult.probes[0].status, 'failed');
  assert.equal(accessorResult.probes[0].code, 'INVALID_RESPONSE');
  assert.equal(conversions, 0);
  assert.equal(getterCalls, 0);
});

test('a normal connection test performs only the low-cost connectivity probe', async () => {
  const result = await runProviderCapabilityProbes(adapterFixture(), {
    supportsVision: true
  });
  assert.equal(result.connected, true);
  assert.equal(result.connectivity, true);
  assert.equal(result.capabilitiesReady, null);
  assert.deepEqual(result.probes.map(item => item.id), ['connectivity']);
});

test('supports selecting one probe without compiling a scientific analysis request', async () => {
  const result = await runProviderCapabilityProbes(adapterFixture(), {
    supportsVision: false,
    probeIds: ['structured_schema']
  });
  assert.equal(result.connected, true);
  assert.equal(result.connectivity, null);
  assert.equal(result.capabilitiesReady, true);
  assert.deepEqual(result.probes.map(item => item.id), ['structured_schema']);
});

test('accepts harmless connectivity formatting differences', async () => {
  const adapter = {
    generateTextStream(request) {
      return textEvents(' **OK.**\n', request.signal);
    }
  };
  const result = await runProviderCapabilityProbes(adapter, {
    probeIds: ['connectivity']
  });
  assert.equal(result.connected, true, JSON.stringify(result));
  assert.equal(result.connectivity, true);
  assert.equal(result.capabilitiesReady, null);
});

test('cancellation ignores an adapter started event and waits for cancellation', async () => {
  const adapter = createProviderAdapter({
    providerId: 'openai-compatible',
    config: {
      apiKey: 'test-key', model: 'test-model', baseUrl: 'https://gateway.example/v1'
    },
    fetchImpl: (url, options) => new Promise((resolve, reject) => {
      const rejectAbort = () => reject(Object.assign(new Error('aborted'), {
        name: 'AbortError'
      }));
      if (options.signal.aborted) rejectAbort();
      else options.signal.addEventListener('abort', rejectAbort, { once: true });
    })
  });
  const result = await runProviderCapabilityProbes(adapter, {
    probeIds: ['cancellation']
  });
  assert.equal(result.connected, true, JSON.stringify(result));
  assert.equal(result.connectivity, null);
  assert.equal(result.capabilitiesReady, true);
  assert.equal(result.probes[0].status, 'passed');
});

test('only connectivity is a hard gate while optional capability failures become warnings', async () => {
  const adapter = adapterFixture();
  adapter.analyzeChunk = async () => ({ ok: false });
  const result = await runProviderCapabilityProbes(adapter, {
    probeIds: ['connectivity', 'structured_schema']
  });
  assert.equal(result.connected, true, JSON.stringify(result));
  assert.equal(result.connectivity, true);
  assert.equal(result.capabilitiesReady, false);
  assert.equal(result.probes[0].status, 'passed');
  assert.equal(result.probes[1].status, 'failed');
  assert.deepEqual(result.warnings.map(item => item.probeId), ['structured_schema']);
  assert.deepEqual(result.diagnostics.failedProbeIds, ['structured_schema']);
});

test('structured reasoning failure remains optional and never exposes request contents', async () => {
  const adapter = adapterFixture();
  adapter.analyzeChunk = async request => {
    if (request.reasoningEffort === 'enabled') return { ok: false };
    return { ok: true, echo: 'schema' };
  };
  const result = await runProviderCapabilityProbes(adapter, {
    supportsReasoning: true,
    probeIds: ['connectivity', 'reasoning_structured']
  });
  assert.equal(result.connected, true, JSON.stringify(result));
  assert.equal(result.probes.find(item => item.id === 'reasoning_structured').status, 'failed');
  assert.deepEqual(result.warnings.map(item => item.probeId), ['reasoning_structured']);
  assert.doesNotMatch(JSON.stringify(result), /requested|systemPrompt|userPrompt|responseSchema/);
});

test('explicit capability-only probe selection retains strict pass semantics', async () => {
  const adapter = adapterFixture();
  adapter.analyzeChunk = async () => ({ ok: false });
  const result = await runProviderCapabilityProbes(adapter, {
    probeIds: ['structured_schema']
  });
  assert.equal(result.connected, false);
});

test('rejects an explicit probe selection containing no known probe ids', async () => {
  const privateToken = 'PRIVATEALPHANUMERICKEY987654321';
  let stringConversions = 0;
  const result = await runProviderCapabilityProbes(adapterFixture(), {
    probeIds: [
      'connectivty-typo',
      privateToken,
      { toString() { stringConversions += 1; return privateToken; } }
    ]
  });
  assert.equal(result.connected, false);
  assert.deepEqual(result.probes, []);
  assert.deepEqual(result.diagnostics.invalidProbeIds, ['UNKNOWN_PROBE_ID']);
  assert.equal(stringConversions, 0);
  assert.doesNotMatch(JSON.stringify(result), new RegExp(privateToken, 'i'));
});
