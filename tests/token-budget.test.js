const test = require('node:test');
const assert = require('node:assert/strict');

const {
  RULES,
  computeOutputTokenBudget,
  computeInputTokenBudget,
  createTokenManagedAdapter
} = require('../core/token-budget.js');

test('defines output budget rules for every request kind', () => {
  assert.deepEqual(RULES.highlight, { base: 2400, perUnit: 320, floor: 4096, ceiling: 16384 });
  assert.deepEqual(RULES.singleSummary, { base: 800, perUnit: 160, floor: 1024, ceiling: 4096 });
  assert.deepEqual(RULES.batchSummary, { base: 1400, perUnit: 420, floor: 2048, ceiling: 12288 });
  assert.deepEqual(RULES.figure, { base: 3200, perUnit: 1400, floor: 6144, ceiling: 24576 });
  assert.deepEqual(RULES.crossFigure, { base: 3200, perUnit: 1200, floor: 6144, ceiling: 32768 });
  assert.deepEqual(RULES.articleChat, { base: 4096, perUnit: 512, floor: 4096, ceiling: 12288 });
  assert.deepEqual(RULES.figurePanel, { base: 2048, perUnit: 0, floor: 2048, ceiling: 4096 });
  assert.deepEqual(RULES.panelChat, { base: 2048, perUnit: 384, floor: 2048, ceiling: 4096 });
});

test('keeps article chat and Panel output budgets within their independent floors and ceilings', () => {
  assert.deepEqual(computeOutputTokenBudget('articleChat', { units: 1 }), {
    initial: 4608, ceiling: 12288, mode: 'auto'
  });
  assert.deepEqual(computeOutputTokenBudget('articleChat', { units: 100 }), {
    initial: 12288, ceiling: 12288, mode: 'auto'
  });
  assert.deepEqual(computeOutputTokenBudget('panelChat', { units: 1 }), {
    initial: 2560, ceiling: 4096, mode: 'auto'
  });
  assert.deepEqual(computeOutputTokenBudget('panelChat', { units: 100 }), {
    initial: 4096, ceiling: 4096, mode: 'auto'
  });
  assert.deepEqual(computeOutputTokenBudget('figurePanel', { units: 1 }), {
    initial: 2048, ceiling: 4096, mode: 'auto'
  });
});

test('subtracts output and fixed reservations from the model context window', () => {
  assert.deepEqual(computeInputTokenBudget({
    contextWindowTokens: 32768,
    outputTokens: 8192,
    reservedTokens: 2048,
    systemTokens: 1024
  }), {
    contextWindowTokens: 32768,
    outputTokens: 8192,
    reservedTokens: 2048,
    systemTokens: 1024,
    available: 21504
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

test('applies auto and adapter caps without dropping below the request floor', () => {
  assert.deepEqual(computeOutputTokenBudget('batchSummary', {
    units: 10, tokenPolicy: { autoCap: 3000 }, adapterCap: 2800
  }), { initial: 2800, ceiling: 2800, mode: 'auto' });
  assert.deepEqual(computeOutputTokenBudget('figure', {
    units: 1, tokenPolicy: { autoCap: 500 }, adapterCap: 1000
  }), { initial: 6144, ceiling: 6144, mode: 'auto' });
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
  }), { initial: 65536, ceiling: 65536, mode: 'manual' });
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
