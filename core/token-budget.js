(function attach(root, factory) {
  const api = factory(root.SciLLM || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory() {
  const RULES = Object.freeze({
    highlight: Object.freeze({ base: 2400, perUnit: 320, floor: 4096, ceiling: 16384 }),
    singleSummary: Object.freeze({ base: 800, perUnit: 160, floor: 1024, ceiling: 4096 }),
    batchSummary: Object.freeze({ base: 1400, perUnit: 420, floor: 2048, ceiling: 12288 }),
    figure: Object.freeze({ base: 3200, perUnit: 1400, floor: 6144, ceiling: 24576 }),
    crossFigure: Object.freeze({ base: 3200, perUnit: 1200, floor: 6144, ceiling: 32768 }),
    articleChat: Object.freeze({ base: 4096, perUnit: 512, floor: 4096, ceiling: 12288 }),
    figurePanel: Object.freeze({ base: 2048, perUnit: 0, floor: 2048, ceiling: 4096 }),
    panelChat: Object.freeze({ base: 2048, perUnit: 384, floor: 2048, ceiling: 4096 })
  });

  function roundUp256(value) {
    return Math.ceil(Number(value) / 256) * 256;
  }

  function boundedNumber(value, minimum, maximum) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return null;
    return Math.max(minimum, Math.min(maximum, numeric));
  }

  function validCap(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
  }

  function computeOutputTokenBudget(kind, options = {}) {
    const rule = RULES[kind];
    if (!rule) throw new Error(`Unknown token budget kind: ${kind}`);
    const tokenPolicy = options.tokenPolicy || {};
    if (tokenPolicy.mode === 'manual') {
      const requested = Number(tokenPolicy.manualMax);
      const manual = Number.isFinite(requested) && requested > 0
        ? boundedNumber(requested, 512, 65536)
        : 4096;
      const fixed = roundUp256(manual);
      return { initial: fixed, ceiling: fixed, mode: 'manual' };
    }

    const caps = [rule.ceiling, validCap(tokenPolicy.autoCap), validCap(options.adapterCap)]
      .filter(value => value !== null);
    const ceiling = Math.max(rule.floor, Math.min(...caps));
    const units = Math.max(1, Number(options.units) || 0);
    const initial = Math.min(ceiling, Math.max(rule.floor, roundUp256(rule.base + rule.perUnit * units)));
    return { initial, ceiling, mode: 'auto' };
  }

  function computeInputTokenBudget(options = {}) {
    const contextWindowTokens = Math.max(1, Math.floor(Number(options.contextWindowTokens) || 0));
    const outputTokens = Math.max(0, Math.floor(Number(options.outputTokens) || 0));
    const reservedTokens = Math.max(0, Math.floor(Number(options.reservedTokens) || 0));
    const systemTokens = Math.max(0, Math.floor(Number(options.systemTokens) || 0));
    return {
      contextWindowTokens,
      outputTokens,
      reservedTokens,
      systemTokens,
      available: Math.max(0, contextWindowTokens - outputTokens - reservedTokens - systemTokens)
    };
  }

  function suggestedLimit(error) {
    const suggested = Number(error?.suggestedMaxOutputTokens);
    return Number.isFinite(suggested) && suggested >= 512 && suggested <= 65536 ? suggested : null;
  }

  function requestUnits(request) {
    const supplied = Number(request?.outputUnits);
    if (Number.isFinite(supplied) && supplied > 0) return supplied;
    return Array.isArray(request?.paragraphs) ? request.paragraphs.length : 1;
  }

  function createTokenManagedAdapter({
    rawAdapter,
    kind,
    tokenPolicy = {},
    adapterCap = null,
    requestTimeoutMs = null,
    maxTokenLimitRetries = 1,
    maxTruncationRetries = 2,
    onProgress = () => {}
  }) {
    if (!rawAdapter || typeof rawAdapter !== 'object') throw new Error('A raw adapter is required');

    function report(progress) {
      if (typeof onProgress !== 'function') return;
      try { onProgress(progress); } catch { /* Progress reporting must not alter request handling. */ }
    }

    async function invoke(method, request = {}) {
      const budget = computeOutputTokenBudget(kind, {
        tokenPolicy,
        adapterCap,
        units: requestUnits(request)
      });
      let current = budget.initial;
      let effectiveCeiling = budget.ceiling;
      let limitedRetried = false;
      let truncationRetries = 0;
      while (true) {
        try {
          const upstreamTelemetry = request.onProviderTelemetry;
          return await rawAdapter[method]({
            ...request,
            maxOutputTokens: current,
            timeoutMs: request.timeoutMs || requestTimeoutMs || undefined,
            onProviderTelemetry: event => {
              try { upstreamTelemetry?.(event); } catch { /* Keep provider result intact. */ }
              report({ phase: 'provider_telemetry', maxOutputTokens: current, ...event });
            }
          });
        } catch (error) {
          if (error?.code === 'TOKEN_LIMIT_REJECTED' && !limitedRetried &&
              Math.max(0, Number(maxTokenLimitRetries) || 0) > 0) {
            limitedRetried = true;
            const suggested = suggestedLimit(error);
            current = suggested && suggested < current
              ? Math.max(512, Math.floor(suggested / 256) * 256)
              : Math.max(512, Math.floor((current * 0.75) / 256) * 256);
            effectiveCeiling = Math.min(effectiveCeiling, current);
            report({ phase: 'token_limit_retry', maxOutputTokens: current });
            continue;
          }
          if (
            error?.code === 'OUTPUT_TRUNCATED' && budget.mode === 'auto' &&
            truncationRetries < Math.max(0, Number(maxTruncationRetries) || 0) &&
            current < effectiveCeiling
          ) {
            truncationRetries += 1;
            current = Math.min(effectiveCeiling, roundUp256(current * 1.75));
            report({
              phase: 'output_token_retry',
              maxOutputTokens: current,
              retry: truncationRetries,
              maxRetries: Math.max(0, Number(maxTruncationRetries) || 0)
            });
            continue;
          }
          throw error;
        }
      }
    }

    return Object.assign({}, rawAdapter, {
      generateJson(request) { return invoke('generateJson', request); },
      analyzeChunk(request) { return invoke('analyzeChunk', request); }
    });
  }

  return {
    RULES,
    computeOutputTokenBudget,
    computeInputTokenBudget,
    createTokenManagedAdapter
  };
});
