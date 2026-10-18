const test = require('node:test');
const assert = require('node:assert/strict');

const {
  RULES,
  computeOutputTokenBudget,
  computeInputTokenBudget,
  createTokenManagedAdapter
} = require('../core/token-budget.js');

const FIGURE_WALKTHROUGH_TASK_RULE = {
  input: {
    safetyRatio: 0.9,
    reservedTokens: 1024,
    sourceCapTokens: 20000,
    maxUnits: 12
  },
  output: {
    base: 1000,
    perUnit: 500,
    floor: 2048,
    ceiling: 8192,
    truncationRetries: 1,
    retryMultiplier: 1.5
  }
};

test('applies a custom per-task output rule and source input cap', () => {
  assert.deepEqual(computeOutputTokenBudget('figure_walkthrough', {
    taskRule: FIGURE_WALKTHROUGH_TASK_RULE,
    units: 4
  }), { initial: 3072, ceiling: 8192, mode: 'task' });

  assert.equal(computeInputTokenBudget({
    contextWindowTokens: 32000,
    outputTokens: 3072,
    systemTokens: 1000,
    taskRule: FIGURE_WALKTHROUGH_TASK_RULE
  }).available, 20000);
});

test('rejects inherited budget and task names instead of reading Object.prototype', () => {
  for (const name of ['toString', 'constructor', '__proto__']) {
    assert.throws(
      () => computeOutputTokenBudget(name, { units: 1 }),
      new RegExp(`Unknown token budget kind: ${name}`)
    );
  }
});

test('merges partial task rules with catalog budget defaults and bounds units', () => {
  assert.deepEqual(computeOutputTokenBudget('figure_walkthrough', {
    taskRule: {
      input: { maxUnits: 2 },
      output: { perUnit: 500 }
    },
    units: 99
  }), { initial: 6144, ceiling: 24576, mode: 'task' });
});

test('normalizes malformed task-rule numbers and keeps provider caps authoritative', () => {
  assert.deepEqual(computeOutputTokenBudget('figure_walkthrough', {
    taskRule: {
      input: { maxUnits: -5 },
      output: {
        base: 'not-a-number', perUnit: -20, floor: -1, ceiling: 999999999,
        truncationRetries: -3, retryMultiplier: 99
      }
    },
    units: 4,
    adapterCap: 1000
  }), { initial: 1000, ceiling: 1000, mode: 'task' });

  const input = computeInputTokenBudget({
    contextWindowTokens: 8000,
    outputTokens: 1000,
    systemTokens: 500,
    taskRule: {
      input: {
        safetyRatio: 99,
        reservedTokens: -1,
        sourceCapTokens: 'not-a-number'
      }
    }
  });
  assert.equal(input.usableContextWindowTokens, 8000);
  assert.equal(input.reservedTokens, 0);
  assert.equal(input.available, 6500);
});

test('uses task-rule truncation retry count and multiplier', async () => {
  const seen = [];
  const progress = [];
  const truncated = Object.assign(new Error('truncated'), { code: 'OUTPUT_TRUNCATED' });
  const adapter = createTokenManagedAdapter({
    rawAdapter: {
      async generateJson(request) {
        seen.push(request.maxOutputTokens);
        throw truncated;
      }
    },
    kind: 'figure_walkthrough',
    taskRule: FIGURE_WALKTHROUGH_TASK_RULE,
    onProgress: event => progress.push(event)
  });

  await assert.rejects(
    () => adapter.generateJson({ outputUnits: 4 }),
    error => error === truncated
  );
  assert.deepEqual(seen, [3072, 4608]);
  assert.deepEqual(progress, [{
    phase: 'output_token_retry', maxOutputTokens: 4608, retry: 1, maxRetries: 1
  }]);
});

test('never repeats an identical truncation retry for multiplier one or a saturated cap', async () => {
  const truncated = Object.assign(new Error('truncated'), { code: 'OUTPUT_TRUNCATED' });
  const seen = [];
  const adapter = createTokenManagedAdapter({
    rawAdapter: {
      async generateJson(request) {
        seen.push(request.maxOutputTokens);
        throw truncated;
      }
    },
    kind: 'figure_walkthrough',
    taskRule: {
      output: {
        base: 1000, perUnit: 500, floor: 2048, ceiling: 8192,
        truncationRetries: 2, retryMultiplier: 1
      }
    }
  });
  await assert.rejects(() => adapter.generateJson({ outputUnits: 4 }), error => error === truncated);
  assert.equal(new Set(seen).size, seen.length);
  assert.ok(seen.every((value, index) => index === 0 || value > seen[index - 1]));

  const saturatedSeen = [];
  const saturated = createTokenManagedAdapter({
    rawAdapter: {
      async generateJson(request) {
        saturatedSeen.push(request.maxOutputTokens);
        throw truncated;
      }
    },
    kind: 'figure_walkthrough',
    taskRule: {
      output: {
        base: 8192, perUnit: 0, floor: 2048, ceiling: 8192,
        truncationRetries: 10, retryMultiplier: 4
      }
    }
  });
  await assert.rejects(() => saturated.generateJson({}), error => error === truncated);
  assert.deepEqual(saturatedSeen, [8192]);
});

test('normalizes non-finite and extreme budget inputs to finite bounded integers', () => {
  const input = computeInputTokenBudget({
    contextWindowTokens: Infinity,
    outputTokens: Infinity,
    reservedTokens: -Infinity,
    systemTokens: 1e100,
    safetyRatio: NaN,
    taskRule: {
      input: {
        reservedTokens: Infinity,
        sourceCapTokens: Infinity,
        safetyRatio: -Infinity
      }
    }
  });
  for (const [key, value] of Object.entries(input)) {
    assert.equal(Number.isSafeInteger(value), true, key);
    assert.ok(value >= 0 && value <= 2000000, key);
  }
  assert.equal(input.contextWindowTokens, 2000000);
  assert.equal(input.available, 0);

  for (const value of [NaN, Infinity, -Infinity, -1e100, 1e100]) {
    const output = computeOutputTokenBudget('figure_walkthrough', {
      units: value,
      adapterCap: value,
      tokenPolicy: { autoCap: value },
      taskRule: {
        input: { maxUnits: value },
        output: { base: value, perUnit: value, floor: value, ceiling: value }
      }
    });
    assert.equal(Number.isSafeInteger(output.initial), true, String(value));
    assert.equal(Number.isSafeInteger(output.ceiling), true, String(value));
    assert.ok(output.initial >= 0 && output.initial <= 2000000, String(value));
    assert.ok(output.ceiling >= 0 && output.ceiling <= 2000000, String(value));
  }
});

test('defines output budget rules for every request kind', () => {
  assert.deepEqual(RULES.highlight, { base: 2400, perUnit: 320, floor: 4096, ceiling: 16384 });
  assert.deepEqual(RULES.singleSummary, { base: 800, perUnit: 160, floor: 1024, ceiling: 4096 });
  assert.deepEqual(RULES.batchSummary, { base: 1400, perUnit: 420, floor: 2048, ceiling: 12288 });
  assert.deepEqual(RULES.figure, { base: 3200, perUnit: 1400, floor: 6144, ceiling: 24576 });
  assert.deepEqual(RULES.crossFigure, { base: 3200, perUnit: 1200, floor: 6144, ceiling: 32768 });
  assert.deepEqual(RULES.articleChat, { base: 4096, perUnit: 512, floor: 4096, ceiling: 32768 });
  assert.deepEqual(RULES.figurePanel, { base: 3072, perUnit: 0, floor: 2048, ceiling: 8192 });
  assert.deepEqual(RULES.panelChat, { base: 2048, perUnit: 512, floor: 2048, ceiling: 16384 });
});

test('keeps article chat and Panel output budgets within their independent floors and ceilings', () => {
  assert.deepEqual(computeOutputTokenBudget('articleChat', { units: 1 }), {
    initial: 4608, ceiling: 32768, mode: 'auto'
  });
  assert.deepEqual(computeOutputTokenBudget('articleChat', { units: 100 }), {
    initial: 32768, ceiling: 32768, mode: 'auto'
  });
  assert.deepEqual(computeOutputTokenBudget('panelChat', { units: 1 }), {
    initial: 2560, ceiling: 16384, mode: 'auto'
  });
  assert.deepEqual(computeOutputTokenBudget('panelChat', { units: 100 }), {
    initial: 16384, ceiling: 16384, mode: 'auto'
  });
  assert.deepEqual(computeOutputTokenBudget('figurePanel', { units: 1 }), {
    initial: 3072, ceiling: 8192, mode: 'auto'
  });
});

test('uses the model cap as the recovery ceiling without inflating the first request', () => {
  assert.deepEqual(computeOutputTokenBudget('articleChat', {
    units: 100, adapterCap: 384000
  }), { initial: 32768, ceiling: 384000, mode: 'auto' });
  assert.deepEqual(computeOutputTokenBudget('panelChat', {
    units: 1, adapterCap: 384000
  }), { initial: 2560, ceiling: 384000, mode: 'auto' });
  assert.deepEqual(computeOutputTokenBudget('figurePanel', {
    units: 1, adapterCap: 384000
  }), { initial: 3072, ceiling: 384000, mode: 'auto' });
});

test('subtracts output and fixed reservations from the model context window', () => {
  assert.deepEqual(computeInputTokenBudget({
    contextWindowTokens: 32768,
    outputTokens: 8192,
    reservedTokens: 2048,
    systemTokens: 1024,
    safetyRatio: 0.9
  }), {
    contextWindowTokens: 32768,
    outputTokens: 8192,
    reservedTokens: 2048,
    systemTokens: 1024,
    usableContextWindowTokens: 29491,
    available: 18227
  });
});

test('computes rounded auto budgets with request floors and ceilings', () => {
  assert.deepEqual(computeOutputTokenBudget('highlight', { units: 1 }), {
    initial: 4096, ceiling: 16384, mode: 'auto'
  });
  assert.deepEqual(computeOutputTokenBudget('highlight', { units: 7 }), {
    initial: 4864, ceiling: 16384, mode: 'auto'
  });
  assert.deepEqual(computeOutputTokenBudget('figure', { units: 20 }), {
    initial: 24576, ceiling: 24576, mode: 'auto'
  });
});

test('applies auto caps and lets a provider hard cap override the request floor', () => {
  assert.deepEqual(computeOutputTokenBudget('batchSummary', {
    units: 10, tokenPolicy: { autoCap: 3000 }, adapterCap: 2800
  }), { initial: 2800, ceiling: 2800, mode: 'auto' });
  assert.deepEqual(computeOutputTokenBudget('figure', {
    units: 1, tokenPolicy: { autoCap: 500 }, adapterCap: 1000
  }), { initial: 1000, ceiling: 1000, mode: 'auto' });
});

test('uses a bounded rounded manual budget', () => {
  assert.deepEqual(computeOutputTokenBudget('highlight', {
    tokenPolicy: { mode: 'manual', manualMax: 6677 }
  }), { initial: 6912, ceiling: 6912, mode: 'manual' });
  assert.deepEqual(computeOutputTokenBudget('highlight', {
    tokenPolicy: { mode: 'manual', manualMax: 12 }
  }), { initial: 512, ceiling: 512, mode: 'manual' });
  assert.deepEqual(computeOutputTokenBudget('highlight', {
    tokenPolicy: { mode: 'manual', manualMax: 999999 }
  }), { initial: 1000192, ceiling: 1000192, mode: 'manual' });
  assert.deepEqual(computeOutputTokenBudget('articleChat', {
    tokenPolicy: { mode: 'manual', manualMax: 999999 }, adapterCap: 384000
  }), { initial: 384000, ceiling: 384000, mode: 'manual' });
  assert.deepEqual(computeOutputTokenBudget('highlight', {
    tokenPolicy: { mode: 'manual', manualMax: 4096 }, adapterCap: 300
  }), { initial: 300, ceiling: 300, mode: 'manual' });
  for (const manualMax of ['not-a-number', '', 0, -1]) {
    assert.deepEqual(computeOutputTokenBudget('highlight', {
      tokenPolicy: { mode: 'manual', manualMax }
    }), { initial: 4096, ceiling: 4096, mode: 'manual' });
  }
  assert.throws(() => computeOutputTokenBudget('unknown', {}), /Unknown token budget kind/);
});

test('retries one provider token-limit rejection at a lower request budget', async () => {
  const seen = [];
  const progress = [];
  const rawAdapter = {
    async generateJson(request) {
      seen.push(request.maxOutputTokens);
      if (seen.length === 1) {
        const error = new Error('limit');
        error.code = 'TOKEN_LIMIT_REJECTED';
        error.suggestedMaxOutputTokens = 3000;
        throw error;
      }
      return { ok: true };
    }
  };
  const adapter = createTokenManagedAdapter({ rawAdapter, kind: 'highlight', onProgress: item => progress.push(item) });
  assert.deepEqual(await adapter.generateJson({ outputUnits: 30 }), { ok: true });
  assert.deepEqual(seen, [12032, 2816]);
  assert.deepEqual(progress, [{ phase: 'token_limit_retry', maxOutputTokens: 2816 }]);
});

test('keeps a token-limit retry below a sub-floor provider hard cap', async () => {
  const seen = [];
  const adapter = createTokenManagedAdapter({
    rawAdapter: {
      async generateJson(request) {
        seen.push(request.maxOutputTokens);
        if (seen.length === 1) {
          throw Object.assign(new Error('limit'), { code: 'TOKEN_LIMIT_REJECTED' });
        }
        return { ok: true };
      }
    },
    kind: 'highlight',
    adapterCap: 300
  });

  assert.deepEqual(await adapter.generateJson({ outputUnits: 1 }), { ok: true });
  assert.deepEqual(seen, [300, 256]);
});

test('can delegate every Panel capacity retry to a strictly smaller input plan', async () => {
  let attempts = 0;
  const error = Object.assign(new Error('limit'), { code: 'TOKEN_LIMIT_REJECTED' });
  const adapter = createTokenManagedAdapter({
    rawAdapter: { async generateJson() { attempts += 1; throw error; } },
    kind: 'figurePanel', maxTokenLimitRetries: 0, maxTruncationRetries: 0
  });
  await assert.rejects(() => adapter.generateJson({ outputUnits: 1 }), failure => failure === error);
  assert.equal(attempts, 1);
});

test('retries one auto output truncation at a larger budget', async () => {
  const seen = [];
  const progress = [];
  const rawAdapter = {
    async analyzeChunk(request) {
      seen.push(request.maxOutputTokens);
      if (seen.length === 1) {
        const error = new Error('truncated');
        error.code = 'OUTPUT_TRUNCATED';
        throw error;
      }
      return { ok: true };
    }
  };
  const adapter = createTokenManagedAdapter({ rawAdapter, kind: 'highlight', onProgress: item => progress.push(item) });
  assert.deepEqual(await adapter.analyzeChunk({ paragraphs: Array.from({ length: 5 }, () => ({})) }), { ok: true });
  assert.deepEqual(seen, [4096, 7168]);
  assert.deepEqual(progress, [{
    phase: 'output_token_retry', maxOutputTokens: 7168, retry: 1, maxRetries: 2
  }]);
});

test('keeps token-limit retries single and manual output budgets fixed', async () => {
  let attempts = 0;
  const error = new Error('limit');
  error.code = 'TOKEN_LIMIT_REJECTED';
  const adapter = createTokenManagedAdapter({
    rawAdapter: { async generateJson() { attempts += 1; throw error; } }, kind: 'singleSummary'
  });
  await assert.rejects(() => adapter.generateJson({ outputUnits: 1 }), failure => failure === error);
  assert.equal(attempts, 2);

  attempts = 0;
  const truncated = new Error('truncated');
  truncated.code = 'OUTPUT_TRUNCATED';
  const manual = createTokenManagedAdapter({
    rawAdapter: { async generateJson() { attempts += 1; throw truncated; } },
    kind: 'singleSummary', tokenPolicy: { mode: 'manual', manualMax: 1024 }
  });
  await assert.rejects(() => manual.generateJson({}), failure => failure === truncated);
  assert.equal(attempts, 1);
});

test('returns the third repeated auto truncation after two bounded upward retries', async () => {
  let attempts = 0;
  const progress = [];
  const error = new Error('truncated twice');
  error.code = 'OUTPUT_TRUNCATED';
  const adapter = createTokenManagedAdapter({
    rawAdapter: { async generateJson() { attempts += 1; throw error; } },
    kind: 'highlight', onProgress: item => progress.push(item)
  });
  await assert.rejects(() => adapter.generateJson({ outputUnits: 5 }), failure => failure === error);
  assert.equal(attempts, 3);
  assert.deepEqual(progress, [
    { phase: 'output_token_retry', maxOutputTokens: 7168, retry: 1, maxRetries: 2 },
    { phase: 'output_token_retry', maxOutputTokens: 12544, retry: 2, maxRetries: 2 }
  ]);
});

test('returns the second repeated token-limit rejection after exactly one downward retry', async () => {
  let attempts = 0;
  const progress = [];
  const error = new Error('limit twice');
  error.code = 'TOKEN_LIMIT_REJECTED';
  error.suggestedMaxOutputTokens = 3000;
  const adapter = createTokenManagedAdapter({
    rawAdapter: { async generateJson() { attempts += 1; throw error; } },
    kind: 'highlight', onProgress: item => progress.push(item)
  });
  await assert.rejects(() => adapter.generateJson({ outputUnits: 30 }), failure => failure === error);
  assert.equal(attempts, 2);
  assert.deepEqual(progress, [{ phase: 'token_limit_retry', maxOutputTokens: 2816 }]);
});

test('does not raise above an accepted lower token limit after output truncation', async () => {
  const seen = [];
  const limit = new Error('provider limit');
  limit.code = 'TOKEN_LIMIT_REJECTED';
  limit.suggestedMaxOutputTokens = 3000;
  const truncated = new Error('truncated');
  truncated.code = 'OUTPUT_TRUNCATED';
  const adapter = createTokenManagedAdapter({
    rawAdapter: {
      async generateJson(request) {
        seen.push(request.maxOutputTokens);
        throw seen.length === 1 ? limit : truncated;
      }
    },
    kind: 'highlight'
  });
  await assert.rejects(() => adapter.generateJson({ outputUnits: 30 }), error => error === truncated);
  assert.deepEqual(seen, [12032, 2816]);
});

test('keeps a combined truncation and token-limit retry bounded and one-time each', async () => {
  const seen = [];
  const truncated = new Error('truncated');
  truncated.code = 'OUTPUT_TRUNCATED';
  const limit = new Error('provider limit');
  limit.code = 'TOKEN_LIMIT_REJECTED';
  limit.suggestedMaxOutputTokens = 2800;
  const adapter = createTokenManagedAdapter({
    rawAdapter: {
      async generateJson(request) {
        seen.push(request.maxOutputTokens);
        if (seen.length === 1) throw truncated;
        throw limit;
      }
    },
    kind: 'highlight'
  });
  await assert.rejects(() => adapter.generateJson({ outputUnits: 5 }), error => error === limit);
  assert.deepEqual(seen, [4096, 7168, 2560]);
});

test('ignores missing or throwing progress callbacks while retaining retry behavior and errors', async () => {
  const truncated = new Error('truncated');
  truncated.code = 'OUTPUT_TRUNCATED';
  let attempts = 0;
  const adapter = createTokenManagedAdapter({
    rawAdapter: {
      async generateJson() {
        attempts += 1;
        if (attempts === 1) throw truncated;
        return { ok: true };
      }
    },
    kind: 'highlight', onProgress: () => { throw new Error('progress failure'); }
  });
  assert.deepEqual(await adapter.generateJson({ outputUnits: 5 }), { ok: true });
  assert.equal(attempts, 2);

  const limit = new Error('limit');
  limit.code = 'TOKEN_LIMIT_REJECTED';
  const noCallback = createTokenManagedAdapter({
    rawAdapter: { async generateJson() { throw limit; } }, kind: 'highlight', onProgress: null
  });
  await assert.rejects(() => noCallback.generateJson({ outputUnits: 5 }), error => error === limit);
});

test('reports a bounded provider heartbeat and clears it when the request settles', async () => {
  const progress = [];
  let heartbeat;
  let cleared = 0;
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const adapter = createTokenManagedAdapter({
    rawAdapter: { generateJson: () => pending },
    kind: 'singleSummary', requestTimeoutMs: 180000,
    progressHeartbeatMs: 15000,
    setIntervalImpl(callback, intervalMs) {
      assert.equal(intervalMs, 15000);
      heartbeat = callback;
      return 41;
    },
    clearIntervalImpl(intervalId) {
      assert.equal(intervalId, 41);
      cleared += 1;
    },
    nowImpl: (() => {
      let now = 100000;
      return () => (now += 15000);
    })(),
    onProgress: item => progress.push(item)
  });
  const resultPromise = adapter.generateJson({ outputUnits: 1 });
  heartbeat();
  release({ ok: true });
  assert.deepEqual(await resultPromise, { ok: true });
  assert.equal(cleared, 1);
  assert.deepEqual(progress.map(item => item.phase), [
    'provider_request_started', 'provider_waiting'
  ]);
  assert.equal(progress[0].timeoutMs, 180000);
  assert.equal(progress[1].elapsedSeconds, 15);
});

test('does not advertise streaming when the raw provider has no streaming capability', () => {
  const adapter = createTokenManagedAdapter({
    rawAdapter: {
      async generateJson() { return { ok: true }; },
      async analyzeChunk() { return { annotations: [] }; }
    },
    kind: 'highlight'
  });
  assert.equal(adapter.generateTextStream, undefined);
  assert.equal(adapter.generateWebSearchTextStream, undefined);
});

test('reserves separate final-JSON capacity for high-effort DeepSeek Figure reasoning', () => {
  const base = {
    adapterCap: 384000,
    contextWindowTokens: 1000000,
    reasoningProviderId: 'deepseek'
  };
  assert.deepEqual(computeOutputTokenBudget('figure_walkthrough', {
    ...base, units: 6, reasoningEnabled: false, reasoningEffort: 'high'
  }), { initial: 11776, ceiling: 384000, mode: 'auto' });
  assert.deepEqual(computeOutputTokenBudget('figure_walkthrough', {
    ...base, units: 6, reasoningEnabled: true, reasoningEffort: 'high'
  }), { initial: 28160, ceiling: 384000, mode: 'auto' });
  assert.deepEqual(computeOutputTokenBudget('figure_walkthrough', {
    ...base, units: 26, reasoningEnabled: true, reasoningEffort: 'high'
  }), { initial: 49152, ceiling: 384000, mode: 'auto' });
});

test('bounds DeepSeek Figure reasoning reserve by user and model capacity', () => {
  assert.deepEqual(computeOutputTokenBudget('figure_walkthrough', {
    units: 26,
    adapterCap: 384000,
    contextWindowTokens: 8192,
    reasoningProviderId: 'deepseek',
    reasoningEnabled: true,
    reasoningEffort: 'high'
  }), { initial: 4096, ceiling: 384000, mode: 'auto' });
  assert.deepEqual(computeOutputTokenBudget('figure_walkthrough', {
    units: 6,
    adapterCap: 384000,
    contextWindowTokens: 32768,
    reasoningProviderId: 'deepseek',
    reasoningEnabled: true,
    reasoningEffort: 'high'
  }), { initial: 16384, ceiling: 384000, mode: 'auto' });
  assert.deepEqual(computeOutputTokenBudget('figure_walkthrough', {
    units: 6,
    adapterCap: 384000,
    contextWindowTokens: 1000000,
    reasoningProviderId: 'deepseek',
    reasoningEnabled: true,
    reasoningEffort: 'high',
    tokenPolicy: { autoCap: 20000 }
  }), { initial: 20000, ceiling: 20000, mode: 'auto' });
  assert.deepEqual(computeOutputTokenBudget('figure_walkthrough', {
    units: 6,
    adapterCap: 384000,
    contextWindowTokens: 1000000,
    reasoningProviderId: 'deepseek',
    reasoningEnabled: true,
    reasoningEffort: 'high',
    tokenPolicy: { mode: 'manual', manualMax: 11776 }
  }), { initial: 11776, ceiling: 11776, mode: 'manual' });
});

test('passes the DeepSeek Figure reasoning reserve into the managed provider request', async () => {
  const seen = [];
  const adapter = createTokenManagedAdapter({
    rawAdapter: {
      async generateJson(request) {
        seen.push(request.maxOutputTokens);
        return { ok: true };
      }
    },
    kind: 'figure_walkthrough',
    adapterCap: 384000,
    contextWindowTokens: 1000000,
    reasoningProviderId: 'deepseek',
    reasoningEnabled: true,
    reasoningEffort: 'high'
  });
  assert.deepEqual(await adapter.generateJson({ outputUnits: 6 }), { ok: true });
  assert.deepEqual(seen, [28160]);
});

test('conditionally proxies one web-search stream with the same token telemetry and cancellation contract', async () => {
  const controller = new AbortController();
  const requests = [];
  const progress = [];
  const rawAdapter = {
    generateWebSearchTextStream(request) {
      requests.push(request);
      return (async function* stream() {
        request.onProviderTelemetry({ providerRequestId: 'web-request-1' });
        yield { type: 'started' };
        yield { type: 'completed', finishReason: 'stop' };
      })();
    }
  };
  const adapter = createTokenManagedAdapter({
    rawAdapter,
    kind: 'article_chat',
    requestTimeoutMs: 54321,
    onProgress: event => progress.push(event)
  });

  const events = [];
  for await (const event of adapter.generateWebSearchTextStream({
    outputUnits: 4,
    signal: controller.signal
  })) events.push(event);

  assert.deepEqual(events.map(event => event.type), ['started', 'completed']);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].maxOutputTokens, 6144);
  assert.equal(requests[0].timeoutMs, 54321);
  assert.equal(requests[0].signal, controller.signal);
  assert.deepEqual(progress, [{
    phase: 'provider_telemetry',
    maxOutputTokens: 6144,
    providerRequestId: 'web-request-1'
  }]);
});
