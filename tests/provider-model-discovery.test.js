const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');

const {
  MAX_NON_STREAM_RESPONSE_BYTES,
  getProviderTransportLease
} = require('../providers/provider-utils.js');

const {
  modelListRequest,
  parseModelList,
  discoverProviderModels
} = require('../core/provider-model-discovery.js');

function responseHeaders(values = {}) {
  const entries = new Map(Object.entries(values).map(([key, value]) => [
    key.toLowerCase(), String(value)
  ]));
  return {
    get(name) { return entries.get(String(name || '').toLowerCase()) || null; }
  };
}

function exactModelJson(byteLength = MAX_NON_STREAM_RESPONSE_BYTES) {
  const prefix = '{"data":[{"id":"deepseek-v4-pro"}],"padding":"';
  const suffix = '"}';
  return `${prefix}${'x'.repeat(byteLength - prefix.length - suffix.length)}${suffix}`;
}

function createDeferredPromise() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function observePromiseWithin(promise, waitMs = 100) {
  let timeout;
  const outcome = await Promise.race([
    Promise.resolve(promise).then(
      value => ({ kind: 'resolved', value }),
      error => ({ kind: 'rejected', error })
    ),
    new Promise(resolve => {
      timeout = setTimeout(() => resolve({ kind: 'pending' }), waitMs);
    })
  ]);
  clearTimeout(timeout);
  return outcome;
}

function createProviderScriptContext(shared = null) {
  const context = {
    AbortController,
    ArrayBuffer,
    Date,
    Map,
    Promise,
    Set,
    TextDecoder,
    TextEncoder,
    Uint8Array,
    URL,
    WeakMap,
    clearTimeout,
    setTimeout
  };
  if (shared) context.SciLLM = shared;
  context.globalThis = context;
  vm.createContext(context);
  return context;
}

function executeProviderScript(context, relativePath) {
  vm.runInContext(
    readFileSync(join(__dirname, '..', relativePath), 'utf8'),
    context,
    { filename: relativePath }
  );
}

function loadProviderScripts(order, shared = null) {
  const context = createProviderScriptContext(shared);
  for (const relativePath of order) {
    executeProviderScript(context, relativePath);
  }
  return context.SciLLM;
}

async function discoverOneSharedModel(api) {
  const result = await api.discoverProviderModels({
    providerId: 'deepseek',
    config: { apiKey: 'shared-script-secret' },
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: responseHeaders({ 'content-type': 'application/json' }),
      async text() {
        return JSON.stringify({ data: [{ id: 'deepseek-v4-pro' }] });
      }
    })
  });
  return Array.from(result.models, item => String(item.id));
}

test('builds provider-specific authenticated model-list requests without returning keys', () => {
  const openai = modelListRequest('openai', { apiKey: 'openai-secret' });
  assert.equal(openai.url, 'https://api.openai.com/v1/models');
  assert.equal(openai.headers.Authorization, 'Bearer openai-secret');

  const anthropic = modelListRequest('anthropic', { apiKey: 'claude-secret' });
  assert.equal(anthropic.url, 'https://api.anthropic.com/v1/models?limit=1000');
  assert.equal(anthropic.headers['x-api-key'], 'claude-secret');
  assert.equal(anthropic.headers['anthropic-version'], '2023-06-01');

  const gemini = modelListRequest('gemini', { apiKey: 'gemini-secret' });
  assert.match(gemini.url, /v1beta\/models\?pageSize=1000&key=gemini-secret/);

  const compatible = modelListRequest('openai-compatible', {
    apiKey: 'compatible-secret',
    baseUrl: 'https://api.moonshot.cn/v1/',
    authPrefix: 'Bearer'
  });
  assert.equal(compatible.url, 'https://api.moonshot.cn/v1/models');
  assert.equal(compatible.headers.Authorization, 'Bearer compatible-secret');
});

test('parses OpenAI-compatible and Gemini payloads into generative model choices', () => {
  assert.deepEqual(
    parseModelList('openai', {
      data: [
        { id: 'gpt-5-mini', created: 2 },
        { id: 'text-embedding-3-large', created: 3 },
        { id: 'gpt-5', created: 1 }
      ]
    }).map(item => item.id),
    ['gpt-5-mini', 'gpt-5']
  );

  const gemini = parseModelList('gemini', {
    models: [
      {
        name: 'models/gemini-3.6-flash',
        displayName: 'Gemini 3.6 Flash',
        supportedGenerationMethods: ['generateContent'],
        inputTokenLimit: 1000000
      },
      {
        name: 'models/gemini-embedding-2',
        supportedGenerationMethods: ['embedContent']
      }
    ]
  });
  assert.equal(gemini.length, 1);
  assert.equal(gemini[0].id, 'gemini-3.6-flash');
  assert.equal(gemini[0].inputTokenLimit, 1000000);
});

test('discovers models and maps provider HTTP failures to safe error codes', async () => {
  const calls = [];
  const result = await discoverProviderModels({
    providerId: 'deepseek',
    config: { apiKey: 'deepseek-secret' },
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return {
        ok: true,
        status: 200,
        headers: responseHeaders({ 'content-type': 'application/json' }),
        async text() {
          return JSON.stringify({
            data: [{ id: 'deepseek-v4-pro' }, { id: 'deepseek-v4-flash' }]
          });
        }
      };
    }
  });
  assert.deepEqual(result.models.map(item => item.id), [
    'deepseek-v4-flash',
    'deepseek-v4-pro'
  ]);
  assert.equal(calls[0].url, 'https://api.deepseek.com/models');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer deepseek-secret');

  await assert.rejects(() => discoverProviderModels({
    providerId: 'openai',
    config: { apiKey: 'bad-key' },
    fetchImpl: async () => ({ ok: false, status: 401 })
  }), error => error.code === 'AUTH_INVALID');
});

test('local Codex exposes its automatic model choice without a network request', async () => {
  let called = false;
  const result = await discoverProviderModels({
    providerId: 'codex-local',
    fetchImpl: async () => {
      called = true;
      throw new Error('should not run');
    }
  });
  assert.equal(called, false);
  assert.deepEqual(result.models.map(item => item.id), ['auto']);
});

test('keeps the discovery deadline active while the successful body is pending', async () => {
  const startedAt = Date.now();
  await assert.rejects(() => discoverProviderModels({
    providerId: 'deepseek',
    config: { apiKey: 'timeout-secret' },
    timeoutMs: 1000,
    fetchImpl: async (_url, options) => ({
      ok: true,
      status: 200,
      headers: responseHeaders({ 'content-type': 'application/json' }),
      text() {
        assert.equal(options.signal.aborted, false);
        return new Promise(() => {});
      }
    })
  }), error => error.code === 'REQUEST_TIMEOUT' &&
    !String(error.message).includes('private stalled response'));
  assert.ok(Date.now() - startedAt < 1800);
});

test('times out an uncooperative chunk read and cleans up without awaiting cancel', async () => {
  let cancelled = 0;
  let released = 0;
  const startedAt = Date.now();
  await assert.rejects(() => discoverProviderModels({
    providerId: 'deepseek',
    config: { apiKey: 'reader-timeout-secret' },
    timeoutMs: 1000,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: responseHeaders({ 'content-type': 'application/json' }),
      body: {
        getReader() {
          return {
            read() { return new Promise(() => {}); },
            cancel() {
              cancelled += 1;
              return new Promise(() => {});
            },
            releaseLock() { released += 1; }
          };
        }
      }
    })
  }), error => error.code === 'REQUEST_TIMEOUT');
  assert.equal(cancelled, 1);
  assert.equal(released, 1);
  assert.ok(Date.now() - startedAt < 1800);
});

test('HTTP 400 stalled bodies preserve timeout leases through late settlement', async () => {
  for (const mode of ['text', 'reader']) {
    const raw = createDeferredPromise();
    let cancelCalls = 0;
    let releaseCalls = 0;
    let readCalls = 0;
    let textCalls = 0;
    const response = {
      ok: false,
      status: 400,
      headers: responseHeaders(),
      body: mode === 'reader'
        ? {
            getReader() {
              return {
                read() { readCalls += 1; return raw.promise; },
                cancel() {
                  cancelCalls += 1;
                  return new Promise(() => {});
                },
                releaseLock() { releaseCalls += 1; }
              };
            }
          }
        : {
            cancel() {
              cancelCalls += 1;
              return new Promise(() => {});
            }
          },
      text() { textCalls += 1; return raw.promise; }
    };
    const unhandled = [];
    const onUnhandled = reason => { unhandled.push(reason); };
    process.on('unhandledRejection', onUnhandled);
    try {
      const outcome = await discoverProviderModels({
        providerId: 'deepseek',
        config: { apiKey: `http-400-${mode}-secret` },
        timeoutMs: 1000,
        fetchImpl: async () => response
      }).then(
        value => ({ kind: 'resolved', value }),
        error => ({ kind: 'rejected', error })
      );
      const lease = getProviderTransportLease(outcome.error);
      const beforeLateSettlement = lease?.isSettled();
      if (mode === 'reader') raw.resolve({ done: true });
      else raw.reject(new Error('private late HTTP 400 body failure'));
      if (lease) await lease.settlement;
      await new Promise(resolve => setImmediate(resolve));

      assert.equal(outcome.kind, 'rejected', mode);
      assert.equal(outcome.error.code, 'REQUEST_TIMEOUT', mode);
      assert.equal(outcome.error.status, 400, mode);
      assert.equal(outcome.error.retryable, true, mode);
      assert.equal(outcome.error.diagnosticStage, 'response-body', mode);
      assert.ok(lease, mode);
      assert.equal(Object.isFrozen(lease), true, mode);
      assert.equal(beforeLateSettlement, false, mode);
      assert.equal(lease.isSettled(), true, mode);
      assert.equal(cancelCalls, 1, mode);
      assert.equal(releaseCalls, mode === 'reader' ? 1 : 0, mode);
      assert.equal(readCalls, mode === 'reader' ? 1 : 0, mode);
      assert.equal(textCalls, mode === 'text' ? 1 : 0, mode);
      assert.deepEqual(unhandled, [], mode);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  }
});

test('external cancellation stays authoritative for stalled HTTP 400 bodies', async () => {
  for (const mode of ['text', 'reader']) {
    const raw = createDeferredPromise();
    const bodyStarted = createDeferredPromise();
    const controller = new AbortController();
    let rawSettled = false;
    let cancelCalls = 0;
    let releaseCalls = 0;
    let readCalls = 0;
    let textCalls = 0;
    const settleRaw = () => {
      if (rawSettled) return;
      rawSettled = true;
      if (mode === 'reader') raw.resolve({ done: true });
      else raw.reject(new Error('private late cancelled HTTP 400 body failure'));
    };
    const response = {
      ok: false,
      status: 400,
      headers: responseHeaders(),
      body: mode === 'reader'
        ? {
            getReader() {
              return {
                read() {
                  readCalls += 1;
                  bodyStarted.resolve();
                  return raw.promise;
                },
                cancel() {
                  cancelCalls += 1;
                  return new Promise(() => {});
                },
                releaseLock() { releaseCalls += 1; }
              };
            }
          }
        : {
            cancel() {
              cancelCalls += 1;
              return new Promise(() => {});
            }
          },
      text() {
        textCalls += 1;
        bodyStarted.resolve();
        return raw.promise;
      }
    };
    const unhandled = [];
    const onUnhandled = reason => { unhandled.push(reason); };
    process.on('unhandledRejection', onUnhandled);
    try {
      const discovery = discoverProviderModels({
        providerId: 'deepseek',
        config: { apiKey: `external-cancel-${mode}-secret` },
        signal: controller.signal,
        timeoutMs: 1000,
        fetchImpl: async () => response
      });
      await bodyStarted.promise;
      controller.abort();

      let outcome = await observePromiseWithin(discovery);
      if (outcome.kind === 'pending') {
        settleRaw();
        outcome = await observePromiseWithin(discovery, 1500);
      }
      const lease = getProviderTransportLease(outcome.error);
      const beforeLateSettlement = lease?.isSettled();
      settleRaw();
      if (lease) await lease.settlement;
      await new Promise(resolve => setImmediate(resolve));

      assert.equal(outcome.kind, 'rejected', mode);
      assert.equal(outcome.error.code, 'CANCELLED', mode);
      assert.equal(outcome.error.status, 400, mode);
      assert.equal(outcome.error.retryable, false, mode);
      assert.equal(outcome.error.diagnosticStage, 'response-body', mode);
      assert.ok(lease, mode);
      assert.equal(Object.isFrozen(lease), true, mode);
      assert.equal(beforeLateSettlement, false, mode);
      assert.equal(lease.isSettled(), true, mode);
      assert.equal(cancelCalls, 1, mode);
      assert.equal(releaseCalls, mode === 'reader' ? 1 : 0, mode);
      assert.equal(readCalls, mode === 'reader' ? 1 : 0, mode);
      assert.equal(textCalls, mode === 'text' ? 1 : 0, mode);
      assert.deepEqual(unhandled, [], mode);
    } finally {
      settleRaw();
      process.off('unhandledRejection', onUnhandled);
    }
  }
});

test('shared terminal cancellation precedes HTTP status remapping', async () => {
  const cancelled = Object.assign(new Error('shared terminal cancellation'), {
    code: 'CANCELLED',
    status: 400,
    retryable: false
  });
  const shared = {
    async requestJson() { throw cancelled; }
  };
  const api = loadProviderScripts(
    ['core/provider-model-discovery.js'],
    shared
  );

  await assert.rejects(() => api.discoverProviderModels({
    providerId: 'deepseek',
    config: { apiKey: 'cancelled-secret' },
    fetchImpl: async () => { throw new Error('must not reach fetch'); }
  }), error => error === cancelled);
});

async function assertLeaseReplacementIgnored(order, timing) {
  const label = `${order.join(' -> ')} / ${timing}`;
  const sentinel = Object.freeze({ label });
  const shared = { sentinel };
  const api = loadProviderScripts(order, shared);
  const fetchStarted = createDeferredPromise();
  const responsePending = createDeferredPromise();
  const response = {
    ok: false,
    status: 408,
    headers: responseHeaders()
  };
  let forgedCalls = 0;
  const replaceLeaseAccessor = () => {
    api.getProviderTransportLease = () => {
      forgedCalls += 1;
      return Object.freeze({
        settlement: new Promise(() => {}),
        isSettled: () => false
      });
    };
  };
  const fetchImpl = timing === 'while-fetch-pending'
    ? async () => {
        fetchStarted.resolve();
        return responsePending.promise;
      }
    : async () => response;

  if (timing === 'before-first-discovery') replaceLeaseAccessor();
  const discovery = api.discoverProviderModels({
    providerId: 'deepseek',
    config: { apiKey: 'http-408-secret' },
    timeoutMs: 1000,
    fetchImpl
  });
  if (timing === 'while-fetch-pending') {
    await fetchStarted.promise;
    replaceLeaseAccessor();
    responsePending.resolve(response);
  }

  await assert.rejects(discovery, error =>
    error.code === 'PROVIDER_REJECTED', label);
  assert.equal(forgedCalls, 0, label);
  assert.equal(api, shared, label);
  assert.equal(api.sentinel, sentinel, label);
}

test('latches the first real lease export before the first discovery', async () => {
  for (const order of [
    ['providers/provider-utils.js', 'core/provider-model-discovery.js'],
    ['core/provider-model-discovery.js', 'providers/provider-utils.js']
  ]) {
    await assertLeaseReplacementIgnored(order, 'before-first-discovery');
  }
});

test('keeps the first real lease export while the first fetch is pending', async () => {
  for (const order of [
    ['providers/provider-utils.js', 'core/provider-model-discovery.js'],
    ['core/provider-model-discovery.js', 'providers/provider-utils.js']
  ]) {
    await assertLeaseReplacementIgnored(order, 'while-fetch-pending');
  }
});

test('lease lookup rejects accessor properties and contains trusted function failures', async () => {
  const requestTimeout = () => Object.assign(new Error('shared HTTP timeout'), {
    code: 'REQUEST_TIMEOUT',
    status: 408,
    retryable: true
  });

  let getterCalls = 0;
  const accessorShared = {
    async requestJson() { throw requestTimeout(); }
  };
  Object.defineProperty(accessorShared, 'getProviderTransportLease', {
    configurable: true,
    get() {
      getterCalls += 1;
      return () => Object.freeze({
        settlement: new Promise(() => {}),
        isSettled: () => false
      });
    }
  });
  const accessorApi = loadProviderScripts(
    ['core/provider-model-discovery.js'], accessorShared
  );
  await assert.rejects(() => accessorApi.discoverProviderModels({
    providerId: 'deepseek',
    config: { apiKey: 'accessor-secret' },
    fetchImpl: async () => { throw new Error('must not reach fetch'); }
  }), error => error.code === 'PROVIDER_REJECTED');
  assert.equal(getterCalls, 0);

  let throwingCalls = 0;
  const throwingShared = {
    async requestJson() { throw requestTimeout(); },
    getProviderTransportLease() {
      throwingCalls += 1;
      throw new Error('private lease lookup failure');
    }
  };
  const throwingApi = loadProviderScripts(
    ['core/provider-model-discovery.js'], throwingShared
  );
  await assert.rejects(() => throwingApi.discoverProviderModels({
    providerId: 'deepseek',
    config: { apiKey: 'throwing-secret' },
    fetchImpl: async () => { throw new Error('must not reach fetch'); }
  }), error => error.code === 'PROVIDER_REJECTED');
  assert.equal(throwingCalls, 1);
});

test('accepts an exact 4 MiB chunked discovery response', async () => {
  const json = exactModelJson();
  assert.equal(Buffer.byteLength(json), MAX_NON_STREAM_RESPONSE_BYTES);
  let released = 0;
  let offset = 0;
  const bytes = new TextEncoder().encode(json);
  const result = await discoverProviderModels({
    providerId: 'deepseek',
    config: { apiKey: 'boundary-secret' },
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: responseHeaders({
        'content-type': 'application/json',
        'content-length': MAX_NON_STREAM_RESPONSE_BYTES
      }),
      body: {
        getReader() {
          return {
            async read() {
              if (offset) return { done: true };
              offset = bytes.length;
              return { done: false, value: bytes };
            },
            releaseLock() { released += 1; }
          };
        }
      }
    })
  });
  assert.deepEqual(result.models.map(item => item.id), ['deepseek-v4-pro']);
  assert.equal(released, 1);
});

test('rejects a chunked discovery body at 4 MiB plus one and cleans up', async () => {
  let cancelled = 0;
  let released = 0;
  let reads = 0;
  const outcome = await discoverProviderModels({
    providerId: 'deepseek',
    config: { apiKey: 'overflow-secret' },
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: responseHeaders({ 'content-type': 'application/json' }),
      body: {
        getReader() {
          return {
            async read() {
              reads += 1;
              return { done: false, value: new Uint8Array(
                MAX_NON_STREAM_RESPONSE_BYTES + 1
              ) };
            },
            cancel() {
              cancelled += 1;
              return new Promise(() => {});
            },
            releaseLock() { released += 1; }
          };
        }
      }
    })
  }).then(() => ({ code: 'UNEXPECTED_SUCCESS' }), error => error);

  assert.equal(outcome.code, 'INVALID_RESPONSE');
  assert.equal(outcome.message, 'Provider response body exceeded the 4 MiB limit');
  assert.equal(outcome.retryable, false);
  assert.equal(reads, 1);
  assert.equal(cancelled, 1);
  assert.equal(released, 1);
});

test('rejects an oversized text-fallback discovery body with fixed limit semantics', async () => {
  const overflow = 'x'.repeat(MAX_NON_STREAM_RESPONSE_BYTES + 1);
  await assert.rejects(() => discoverProviderModels({
    providerId: 'deepseek',
    config: { apiKey: 'fallback-secret' },
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: responseHeaders({ 'content-type': 'application/json' }),
      async text() { return overflow; }
    })
  }), error => error.code === 'INVALID_RESPONSE' &&
    error.message === 'Provider response body exceeded the 4 MiB limit' &&
    error.retryable === false);
});

test('preserves model-discovery status mappings while using the shared reader', async () => {
  for (const [status, expected] of [
    [401, 'AUTH_INVALID'],
    [403, 'AUTH_INVALID'],
    [429, 'RATE_LIMITED'],
    [503, 'PROVIDER_REJECTED'],
    [408, 'PROVIDER_REJECTED']
  ]) {
    await assert.rejects(() => discoverProviderModels({
      providerId: 'deepseek',
      config: { apiKey: 'status-secret' },
      fetchImpl: async () => ({
        ok: false,
        status,
        headers: responseHeaders()
      })
    }), error => error.code === expected, `HTTP ${status}`);
  }

  await assert.rejects(() => discoverProviderModels({
    providerId: 'deepseek',
    config: { apiKey: 'network-secret' },
    fetchImpl: async () => { throw new Error('private socket failure'); }
  }), error => error.code === 'NETWORK_ERROR' &&
    !String(error.message).includes('private socket failure'));
});

test('maps malformed model JSON to the fixed discovery INVALID_RESPONSE', async () => {
  await assert.rejects(() => discoverProviderModels({
    providerId: 'deepseek',
    config: { apiKey: 'malformed-secret' },
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: responseHeaders({ 'content-type': 'application/json' }),
      async text() { return '{"data":['; }
    })
  }), error => error.code === 'INVALID_RESPONSE' &&
    error.message === 'Provider returned invalid JSON' &&
    error.retryable === false);
});

test('background and reverse provider orders execute real scripts in seeded namespaces', async () => {
  const providerPaths = [
    'providers/provider-utils.js',
    'core/provider-model-discovery.js'
  ];
  const forwardSentinel = Object.freeze({ order: 'background' });
  const forwardShared = { sentinel: forwardSentinel };
  const context = createProviderScriptContext(forwardShared);
  let imported = [];
  const stopBeforeInitialization = new Error('BACKGROUND_IMPORT_CAPTURED');
  context.importScripts = (...paths) => {
    imported = paths.map(String);
    for (const relativePath of imported) {
      if (providerPaths.includes(relativePath)) {
        executeProviderScript(context, relativePath);
      }
    }
    throw stopBeforeInitialization;
  };

  assert.throws(
    () => executeProviderScript(context, 'background.js'),
    error => error === stopBeforeInitialization
  );
  assert.deepEqual(
    imported.filter(relativePath => providerPaths.includes(relativePath)),
    providerPaths
  );
  assert.equal(context.SciLLM, forwardShared);
  assert.equal(context.SciLLM.sentinel, forwardSentinel);
  assert.deepEqual(await discoverOneSharedModel(context.SciLLM), ['deepseek-v4-pro']);

  const reverseSentinel = Object.freeze({ order: 'reverse' });
  const reverseShared = { sentinel: reverseSentinel };
  const reverseApi = loadProviderScripts([...providerPaths].reverse(), reverseShared);
  assert.equal(reverseApi, reverseShared);
  assert.equal(reverseApi.sentinel, reverseSentinel);
  assert.deepEqual(await discoverOneSharedModel(reverseApi), ['deepseek-v4-pro']);
});
