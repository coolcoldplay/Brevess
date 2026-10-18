(function attach(root, factory) {
  const api = factory(root.SciLLM || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory(shared) {
  const PROVIDER_PROBE_IDS = Object.freeze([
    'connectivity', 'plain_json', 'structured_schema', 'vision_input',
    'json_output', 'reasoning_structured', 'streaming', 'vision', 'cancellation'
  ]);
  const DIAGNOSTIC_GROUPS = Object.freeze([
    'connectivity', 'image_content', 'json_output', 'reasoning_structured'
  ]);
  const PROVIDER_PUBLIC_ERROR_CODES = Object.freeze([
    'AUTH_INVALID', 'CANCELLED', 'INVALID_RESPONSE', 'NETWORK_ERROR',
    'OUTPUT_TRUNCATED', 'PROVIDER_REJECTED', 'PROVIDER_UNAVAILABLE',
    'QUOTA_EXHAUSTED', 'RATE_LIMITED', 'REQUEST_TIMEOUT', 'TOKEN_LIMIT_REJECTED',
    'CODEX_NOT_INSTALLED', 'CODEX_NOT_AUTHENTICATED',
    'CODEX_BRIDGE_UNAVAILABLE', 'CODEX_PROVIDER_REJECTED',
    'HARNESS_NOT_INSTALLED', 'HARNESS_VERSION_UNSUPPORTED', 'HARNESS_BRIDGE_OUTDATED',
    'HARNESS_NOT_AUTHENTICATED', 'HARNESS_START_FAILED', 'HARNESS_PROTOCOL_ERROR',
    'HARNESS_MODEL_REQUIRED', 'HARNESS_MODEL_UNAVAILABLE', 'HARNESS_IMAGE_UNSUPPORTED',
    'HARNESS_TOOL_DISABLED', 'HARNESS_MAX_TOKENS', 'HARNESS_TURN_FAILED', 'HARNESS_PROCESS_EXITED'
  ]);
  const SAFE_DIAGNOSTIC_CODES = new Set(PROVIDER_PUBLIC_ERROR_CODES);
  const SAFE_DIAGNOSTIC_STAGES = new Set([
    'request', 'response-headers', 'response-body', 'parse', 'validate'
  ]);
  const SAFE_DIAGNOSTIC_TYPES = new Set([
    'AbortError', 'DOMException', 'Error', 'HtmlResponse', 'JsonSyntaxError',
    'ProviderRequestError', 'SyntaxError', 'TimeoutError', 'TypeError',
    'JSON_PARSE_FAILED', 'JSON_CONTRACT_MISMATCH'
  ]);
  const WHITE_PIXEL_PNG = 'data:image/png;base64,' +
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC';

  function probeSchema() {
    return {
      type: 'object',
      additionalProperties: false,
      properties: {
        ok: { type: 'boolean', enum: [true] },
        echo: { type: 'string', enum: ['schema'] }
      },
      required: ['ok', 'echo']
    };
  }

  function estimatedInputTokens(request = {}) {
    if (request.questions) {
      return Math.max(1, Math.ceil(JSON.stringify({
        state: request.state, questions: request.questions
      }).length / 4));
    }
    const text = `${request.systemPrompt || ''}\n${request.userPrompt || ''}`;
    const imageCost = (Array.isArray(request.images) ? request.images.length : 0) * 256;
    return Math.max(1, Math.ceil(text.length / 4) + imageCost);
  }

  function reasoningProbeConfiguration(options = {}) {
    const supplied = options.reasoningCapability;
    const capability = supplied && typeof supplied === 'object'
      ? supplied
      : options.supportsReasoning === true
        ? { supported: true, mode: 'toggle', levels: ['enabled'] }
        : { supported: false, mode: 'none', levels: [] };
    if (capability.supported !== true) {
      return {
        skipped: true,
        skipReason: 'provider_profile_does_not_enable_reasoning',
        effort: ''
      };
    }
    const levels = Array.isArray(capability.levels)
      ? capability.levels.map(level => String(level || '').trim()).filter(Boolean)
      : [];
    if (capability.mode === 'toggle' && levels.includes('enabled')) {
      return { skipped: false, skipReason: '', effort: 'enabled' };
    }
    if (capability.mode === 'effort') {
      const configured = String(options.configuredReasoningEffort || '').trim();
      const disabled = new Set(['', 'auto', 'none', 'disabled']);
      const effort = levels.includes(configured) && !disabled.has(configured)
        ? configured
        : levels.includes('medium')
          ? 'medium'
          : levels.find(level => !disabled.has(level));
      if (effort) return { skipped: false, skipReason: '', effort };
    }
    return {
      skipped: true,
      skipReason: 'provider_profile_cannot_explicitly_enable_reasoning',
      effort: ''
    };
  }

  function compileProviderCapabilityProbes(options = {}) {
    const supportsVision = options.supportsVision === true;
    const reasoningProbe = reasoningProbeConfiguration(options);
    // Reasoning models may consume output tokens before emitting their short
    // answer, so a tiny 32-token cap can turn a healthy connection into a
    // truncation failure.
    const common = { timeoutMs: 30000, maxOutputTokens: 1024, ephemeral: true };
    const probes = [
      {
        id: 'connectivity', mode: 'text', required: true,
        diagnosticGroup: 'connectivity',
        request: {
          ...common,
          systemPrompt: 'Minimal connectivity probe. Reply with exactly OK.',
          userPrompt: 'OK'
        },
        expectedText: 'OK'
      },
      {
        id: 'plain_json', mode: 'text', required: false,
        diagnosticGroup: 'json_output',
        request: {
          ...common,
          systemPrompt: 'Return exactly {"ok":true}: one JSON object with only the ok key and boolean true. No extra keys, prose or Markdown.',
          userPrompt: '{"requested":"plain_json"}'
        },
        expectedJson: { ok: true }
      },
      {
        id: 'structured_schema', mode: 'structured', required: false,
        diagnosticGroup: 'json_output',
        request: {
          ...common,
          systemPrompt: 'Return the smallest object allowed by the supplied response Schema.',
          userPrompt: '{"requested":"schema"}',
          schemaName: 'provider_probe',
          responseSchema: probeSchema()
        },
        expectedJson: { ok: true, echo: 'schema' }
      },
      {
        id: 'vision_input', mode: 'vision', required: false,
        diagnosticGroup: 'image_content',
        skipped: !supportsVision,
        skipReason: supportsVision ? '' : 'provider_profile_does_not_enable_vision',
        request: {
          ...common,
          systemPrompt: 'Inspect the attached one-pixel image. Reply with exactly WHITE.',
          userPrompt: 'Name the pixel color.',
          images: [{ mediaType: 'image/png', dataUrl: WHITE_PIXEL_PNG }]
        },
        expectedText: 'WHITE'
      },
      {
        id: 'json_output', mode: 'structured', required: false,
        diagnosticGroup: 'json_output',
        skipped: !supportsVision,
        skipReason: supportsVision ? '' : 'provider_profile_does_not_enable_vision',
        request: {
          ...common,
          reasoningEnabled: false,
          systemPrompt: 'Inspect the attached image and return the smallest object allowed by the schema.',
          userPrompt: '{"requested":"vision_json"}',
          images: [{ mediaType: 'image/png', dataUrl: WHITE_PIXEL_PNG }],
          schemaName: 'provider_vision_json_probe',
          responseSchema: probeSchema()
        },
        expectedJson: { ok: true, echo: 'schema' }
      },
      {
        id: 'reasoning_structured', mode: 'structured', required: false,
        diagnosticGroup: 'reasoning_structured',
        skipped: reasoningProbe.skipped,
        skipReason: reasoningProbe.skipReason,
        request: {
          ...common,
          reasoningEnabled: true,
          reasoningEffort: reasoningProbe.effort,
          systemPrompt: 'Return the smallest object allowed by the supplied schema.',
          userPrompt: '{"requested":"reasoning_structured"}',
          ...(supportsVision
            ? { images: [{ mediaType: 'image/png', dataUrl: WHITE_PIXEL_PNG }] }
            : {}),
          schemaName: 'provider_reasoning_probe',
          responseSchema: probeSchema()
        },
        expectedJson: { ok: true, echo: 'schema' }
      },
      {
        id: 'streaming', mode: 'stream', required: false,
        diagnosticGroup: 'connectivity',
        request: {
          ...common,
          systemPrompt: 'Minimal streaming probe. Reply with exactly STREAM_OK.',
          userPrompt: 'STREAM_OK'
        },
        expectedText: 'STREAM_OK'
      },
      {
        id: 'vision', mode: 'vision', required: false,
        diagnosticGroup: 'image_content', skipped: !supportsVision,
        skipReason: supportsVision ? '' : 'provider_profile_does_not_enable_vision',
        request: {
          ...common,
          systemPrompt: 'Inspect the attached one-pixel image. Reply with exactly WHITE.',
          userPrompt: 'Name the pixel color.',
          images: [{ mediaType: 'image/png', dataUrl: WHITE_PIXEL_PNG }]
        },
        expectedText: 'WHITE'
      },
      {
        id: 'cancellation', mode: 'cancellation', required: false,
        diagnosticGroup: 'connectivity',
        request: {
          ...common,
          timeoutMs: 10000,
          systemPrompt: 'Minimal cancellation probe. Produce a short response.',
          userPrompt: 'Begin.'
        },
        expectedErrorCode: 'CANCELLED'
      }
    ];
    if (options.typedDecisions === true) {
      probes.forEach(probe => {
        if (probe.id === 'connectivity') {
          probe.mode = 'decisions';
          probe.request = { ...common, state: 'The specimen is blue.', questions: {
            blue: { type: 'noul', instructions: 'Does the state explicitly say the specimen is blue?' }
          } };
        } else {
          probe.skipped = true;
          probe.skipReason = 'provider_supports_text_classification_only';
        }
      });
    }
    return probes.map(probe => ({
      ...probe,
      estimatedInputTokens: estimatedInputTokens(probe.request),
      tokenMethod: 'ceil((systemPrompt chars + userPrompt chars)/4) + 256 per probe image'
    }));
  }

  function normalizedText(value) {
    return typeof value === 'string'
      ? value.replace(/```(?:json)?|```/gi, '').trim()
      : '';
  }

  function matchesExpectedText(value, expected, allowMinorFormatting = false) {
    const normalized = normalizedText(value).normalize('NFKC');
    if (normalized.toUpperCase() === String(expected || '').toUpperCase()) return true;
    if (!allowMinorFormatting) return false;
    const unwrapped = normalized
      .replace(/^[\s"'`*_]+|[\s"'`*_.!。！]+$/g, '')
      .trim();
    return unwrapped.toUpperCase() === String(expected || '').toUpperCase();
  }

  function parseJson(value) {
    if (typeof shared.parseJsonText === 'function') return shared.parseJsonText(value);
    return JSON.parse(normalizedText(value));
  }

  async function collectStream(adapter, request) {
    if (!adapter || typeof adapter.generateTextStream !== 'function') {
      const error = new Error('Provider does not expose streaming');
      error.code = 'INVALID_RESPONSE';
      throw error;
    }
    let text = '';
    let deltas = 0;
    for await (const event of adapter.generateTextStream(request)) {
      const eventType = ownDiagnosticValue(event, 'type');
      if (eventType === 'text_delta') {
        const delta = ownDiagnosticValue(event, 'text');
        if (typeof delta !== 'string') {
          const error = new Error('Provider stream returned invalid text');
          error.code = 'INVALID_RESPONSE';
          throw error;
        }
        text += delta;
        deltas += 1;
      } else if (eventType === 'cancelled') {
        const error = new Error('Provider request was cancelled');
        error.code = 'CANCELLED';
        throw error;
      } else if (eventType === 'error') {
        const providerError = ownDiagnosticValue(event, 'error');
        const error = new Error('Provider probe failed');
        error.code = ownDiagnosticValue(providerError, 'code') || 'INVALID_RESPONSE';
        error.diagnosticStage = ownDiagnosticValue(providerError, 'diagnosticStage') || '';
        error.diagnosticType = ownDiagnosticValue(providerError, 'diagnosticType') || '';
        const requestBytes = ownDiagnosticValue(providerError, 'requestBytes');
        if (Number.isFinite(requestBytes)) {
          error.requestBytes = requestBytes;
        }
        throw error;
      }
    }
    return { text: normalizedText(text), deltas };
  }

  function exactExpectedObject(value, expected) {
    if (!value || typeof value !== 'object') return false;
    let isArray;
    let prototype;
    let descriptors;
    let keys;
    try {
      isArray = Array.isArray(value);
      prototype = Object.getPrototypeOf(value);
      descriptors = Object.getOwnPropertyDescriptors(value);
      keys = Reflect.ownKeys(descriptors);
    } catch (_) {
      return false;
    }
    const expectedKeys = Object.keys(expected);
    if (isArray || (prototype !== Object.prototype && prototype !== null) ||
        keys.length !== expectedKeys.length ||
        keys.some(key => typeof key !== 'string' || !expectedKeys.includes(key))) {
      return false;
    }
    return expectedKeys.every(key => {
      const descriptor = descriptors[key];
      return descriptor?.enumerable === true && Object.hasOwn(descriptor, 'value') &&
        descriptor.value === expected[key];
    });
  }

  function validExpectedObject(value, expected) {
    if (!exactExpectedObject(value, expected) ||
        typeof globalThis?.structuredClone !== 'function') return false;
    let clone;
    try {
      clone = globalThis.structuredClone(value);
    } catch (_) {
      return false;
    }
    return exactExpectedObject(clone, expected);
  }

  function ownDiagnosticValue(value, key) {
    if (!value || (typeof value !== 'object' && typeof value !== 'function')) {
      return undefined;
    }
    try {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return descriptor && Object.hasOwn(descriptor, 'value')
        ? descriptor.value : undefined;
    } catch (_) {
      return undefined;
    }
  }

  function safeDiagnosticCode(value) {
    const token = typeof value === 'string' ? value.trim() : '';
    return SAFE_DIAGNOSTIC_CODES.has(token) ? token : 'UNKNOWN_PROVIDER_ERROR';
  }

  function safeDiagnosticStage(value) {
    const token = typeof value === 'string' ? value.trim() : '';
    return SAFE_DIAGNOSTIC_STAGES.has(token) ? token : 'unknown';
  }

  function safeDiagnosticType(value) {
    const token = typeof value === 'string' ? value.trim() : '';
    return SAFE_DIAGNOSTIC_TYPES.has(token) ? token : 'UnknownError';
  }

  async function executeProviderProbe(adapter, probe, options = {}) {
    if (probe.skipped) {
      const status = probe.skipReason ===
        'provider_profile_cannot_explicitly_enable_reasoning'
        ? 'blocked' : 'unsupported';
      return {
        id: probe.id, status, reason: probe.skipReason,
        diagnosticGroup: probe.diagnosticGroup || '',
        estimatedInputTokens: probe.estimatedInputTokens,
        measuredInputTokens: null
      };
    }
    const usage = [];
    let includesEstimatedUsage = false;
    const request = {
      ...probe.request,
      timeoutMs: Number(options.timeoutMs) || probe.request.timeoutMs,
      onProviderTelemetry(event) {
        if (ownDiagnosticValue(event, 'estimated') === true) {
          includesEstimatedUsage = true;
          return;
        }
        const inputTokens = ownDiagnosticValue(event, 'inputTokens');
        usage.push(Number.isSafeInteger(inputTokens) && inputTokens >= 0
          ? inputTokens : 0);
      }
    };
    const startedAt = Date.now();
    try {
      if (probe.mode === 'decisions') {
        const value = await adapter.evaluateDecisions(request);
        if (value?.answers?.blue?.type !== 'noul' ||
            !Number.isFinite(value.answers.blue.noul) || value.answers.blue.noul < 0.5 ||
            value.answers.blue.noul > 1) {
          throw Object.assign(new Error('Typed decision probe response did not match'), {
            code: 'INVALID_RESPONSE'
          });
        }
      } else if (probe.mode === 'structured') {
        const value = await adapter.analyzeChunk(request);
        if (!validExpectedObject(value, probe.expectedJson)) {
          throw Object.assign(new Error('Structured probe response did not match'), {
            code: 'INVALID_RESPONSE'
          });
        }
      } else if (probe.mode === 'cancellation') {
        const controller = new AbortController();
        const iterator = adapter.generateTextStream({
          ...request, signal: controller.signal
        })[Symbol.asyncIterator]();
        const pending = iterator.next();
        controller.abort();
        let cancelled = false;
        try {
          let next = await pending;
          for (let eventCount = 0; !next?.done && eventCount < 16; eventCount += 1) {
            const event = next?.value;
            const eventType = ownDiagnosticValue(event, 'type');
            const eventError = ownDiagnosticValue(event, 'error');
            if (eventType === 'cancelled' ||
                (eventType === 'error' &&
                  ownDiagnosticValue(eventError, 'code') === 'CANCELLED')) {
              cancelled = true;
              break;
            }
            if (eventType === 'text_delta' || eventType === 'completed') break;
            next = await iterator.next();
          }
        } catch (error) {
          cancelled = ownDiagnosticValue(error, 'code') === 'CANCELLED' ||
            ownDiagnosticValue(error, 'name') === 'AbortError';
        } finally {
          try { await iterator.return?.(); } catch (_) {}
        }
        if (!cancelled) {
          throw Object.assign(new Error('Cancellation probe was not cancelled'), {
            code: 'INVALID_RESPONSE'
          });
        }
      } else {
        const streamed = await collectStream(adapter, request);
        if (probe.mode === 'stream' && streamed.deltas < 1) {
          throw Object.assign(new Error('Streaming probe returned no delta'), {
            code: 'INVALID_RESPONSE'
          });
        }
        if (probe.expectedJson) {
          let value;
          try { value = parseJson(streamed.text); }
          catch (_) { throw Object.assign(new Error('Plain JSON parse failed'), { code: 'INVALID_RESPONSE', diagnosticStage: 'parse', diagnosticType: 'JSON_PARSE_FAILED' }); }
          if (!validExpectedObject(value, probe.expectedJson)) {
            throw Object.assign(new Error('Plain JSON probe response did not match'), {
              code: 'INVALID_RESPONSE', diagnosticStage: 'validate', diagnosticType: 'JSON_CONTRACT_MISMATCH'
            });
          }
        } else if (!matchesExpectedText(
          streamed.text, probe.expectedText, probe.id === 'connectivity'
        )) {
          throw Object.assign(new Error(`${probe.id} probe response did not match`), {
            code: 'INVALID_RESPONSE'
          });
        }
      }
    } catch (error) {
      const diagnosticType = ownDiagnosticValue(error, 'diagnosticType');
      const requestBytes = ownDiagnosticValue(error, 'requestBytes');
      return {
        id: probe.id, status: 'failed',
        code: safeDiagnosticCode(ownDiagnosticValue(error, 'code')),
        diagnosticGroup: probe.diagnosticGroup || '',
        diagnosticStage: safeDiagnosticStage(
          ownDiagnosticValue(error, 'diagnosticStage')
        ),
        diagnosticType: safeDiagnosticType(
          diagnosticType || ownDiagnosticValue(error, 'name')
        ),
        requestBytes: Number.isFinite(requestBytes) ? requestBytes : null,
        elapsedMs: Date.now() - startedAt,
        estimatedInputTokens: probe.estimatedInputTokens,
        measuredInputTokens: usage.length && !includesEstimatedUsage
          ? usage.reduce((sum, inputTokens) => sum + inputTokens, 0)
          : null
      };
    }
    return {
      id: probe.id, status: 'passed', elapsedMs: Date.now() - startedAt,
      diagnosticGroup: probe.diagnosticGroup || '',
      estimatedInputTokens: probe.estimatedInputTokens,
      measuredInputTokens: usage.length && !includesEstimatedUsage
        ? usage.reduce((sum, inputTokens) => sum + inputTokens, 0)
        : null
    };
  }

  async function runProviderCapabilityProbes(adapter, options = {}) {
    const explicitSelection = Array.isArray(options.probeIds) && options.probeIds.length > 0;
    const requestedProbeIds = explicitSelection
      ? options.probeIds.map(id => typeof id === 'string' ? id.trim() : '')
      : ['connectivity'];
    const invalidProbeIds = requestedProbeIds.some(id =>
      !PROVIDER_PROBE_IDS.includes(id))
      ? ['UNKNOWN_PROBE_ID'] : [];
    const selected = new Set(explicitSelection
      ? requestedProbeIds.filter(id => PROVIDER_PROBE_IDS.includes(id))
      : requestedProbeIds);
    const probes = compileProviderCapabilityProbes(options)
      .filter(probe => selected.has(probe.id));
    const results = [];
    for (const probe of probes) {
      results.push(await executeProviderProbe(adapter, probe, options));
    }
    const active = results.filter(item =>
      !['skipped', 'unsupported', 'blocked'].includes(item.status));
    const connectivityProbe = results.find(item => item.id === 'connectivity');
    const connectivity = connectivityProbe
      ? connectivityProbe.status === 'passed'
      : null;
    const capabilityProbes = results.filter(item => item.id !== 'connectivity');
    const capabilitiesReady = invalidProbeIds.length
      ? false
      : capabilityProbes.length
        ? capabilityProbes.every(item => item.status === 'passed')
        : null;
    const hardGatePassed = explicitSelection && selected.size === 0
      ? false : connectivityProbe
      ? connectivity === true
      : active.length > 0 && active.every(item => item.status === 'passed');
    const optionalFailures = active.filter(item =>
      item.id !== 'connectivity' && item.status === 'failed');
    return {
      connected: hardGatePassed,
      connectivity,
      capabilitiesReady,
      probes: results,
      warnings: optionalFailures.map(item => ({
        probeId: item.id,
        code: item.code || 'INVALID_RESPONSE',
        diagnosticGroup: item.diagnosticGroup || '',
        diagnosticStage: item.diagnosticStage || '',
        diagnosticType: item.diagnosticType || ''
      })),
      diagnostics: {
        hardGateProbeId: connectivityProbe ? 'connectivity' : '',
        failedProbeIds: active.filter(item => item.status === 'failed')
          .map(item => item.id),
        invalidProbeIds,
        failedByCapability: Object.fromEntries(DIAGNOSTIC_GROUPS.map(group => [
          group,
          active.filter(item => item.status === 'failed' && item.diagnosticGroup === group)
            .map(item => item.id)
        ]))
      },
      estimatedInputTokens: results.reduce(
        (sum, item) => sum + Number(item.estimatedInputTokens || 0), 0
      ),
      measuredInputTokens: active.length && active.every(item => item.measuredInputTokens != null)
        ? active.reduce((sum, item) => sum + Number(item.measuredInputTokens || 0), 0)
        : null
    };
  }

  return {
    PROVIDER_PUBLIC_ERROR_CODES,
    PROVIDER_PROBE_IDS,
    compileProviderCapabilityProbes,
    estimateProviderProbeInputTokens: estimatedInputTokens,
    executeProviderProbe,
    runProviderCapabilityProbes
  };
});
