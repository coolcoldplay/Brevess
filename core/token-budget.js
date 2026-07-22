(function attach(root, factory) {
  const api = factory(root.SciLLM || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory() {
  const MAX_CONFIGURABLE_OUTPUT_TOKENS = 2000000;
  const RULES = Object.freeze({
    highlight: Object.freeze({ base: 2400, perUnit: 320, floor: 4096, ceiling: 16384 }),
    singleSummary: Object.freeze({ base: 800, perUnit: 160, floor: 1024, ceiling: 4096 }),
    batchSummary: Object.freeze({ base: 1400, perUnit: 420, floor: 2048, ceiling: 12288 }),
    figure: Object.freeze({ base: 3200, perUnit: 1400, floor: 6144, ceiling: 24576 }),
    crossFigure: Object.freeze({ base: 3200, perUnit: 1200, floor: 6144, ceiling: 32768 }),
    articleChat: Object.freeze({ base: 4096, perUnit: 512, floor: 4096, ceiling: 32768 }),
    figurePanel: Object.freeze({ base: 3072, perUnit: 0, floor: 2048, ceiling: 8192 }),
    panelChat: Object.freeze({ base: 2048, perUnit: 512, floor: 2048, ceiling: 16384 })
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
        ? boundedNumber(requested, 512, MAX_CONFIGURABLE_OUTPUT_TOKENS)
        : 4096;
      const adapterCap = validCap(options.adapterCap);
      const roundedAdapterCap = adapterCap
        ? Math.max(512, Math.floor(adapterCap / 256) * 256)
        : MAX_CONFIGURABLE_OUTPUT_TOKENS;
      const fixed = Math.min(
        MAX_CONFIGURABLE_OUTPUT_TOKENS,
        roundedAdapterCap,
        roundUp256(manual)
      );
      return { initial: fixed, ceiling: fixed, mode: 'manual' };
    }

    const recoveryCaps = [validCap(tokenPolicy.autoCap), validCap(options.adapterCap)]
      .filter(value => value !== null);
    const ceiling = Math.max(
      rule.floor,
      recoveryCaps.length ? Math.min(...recoveryCaps) : rule.ceiling
    );
    const units = Math.max(1, Number(options.units) || 0);
    const initial = Math.min(
      ceiling,
      rule.ceiling,
      Math.max(rule.floor, roundUp256(rule.base + rule.perUnit * units))
    );
    return { initial, ceiling, mode: 'auto' };
  }

  function computeInputTokenBudget(options = {}) {
    const contextWindowTokens = Math.max(1, Math.floor(Number(options.contextWindowTokens) || 0));
    const outputTokens = Math.max(0, Math.floor(Number(options.outputTokens) || 0));
    const reservedTokens = Math.max(0, Math.floor(Number(options.reservedTokens) || 0));
    const systemTokens = Math.max(0, Math.floor(Number(options.systemTokens) || 0));
    const requestedSafetyRatio = Number(options.safetyRatio);
    const safetyRatio = Number.isFinite(requestedSafetyRatio)
      ? Math.max(0.5, Math.min(1, requestedSafetyRatio)) : 1;
    const usableContextWindowTokens = Math.floor(contextWindowTokens * safetyRatio);
    return {
      contextWindowTokens,
      outputTokens,
      reservedTokens,
      systemTokens,
      usableContextWindowTokens,
      available: Math.max(
        0,
        usableContextWindowTokens - outputTokens - reservedTokens - systemTokens
      )
    };
  }

  function suggestedLimit(error) {
    const suggested = Number(error?.suggestedMaxOutputTokens);
    return Number.isFinite(suggested) && suggested >= 512 &&
      suggested <= MAX_CONFIGURABLE_OUTPUT_TOKENS ? suggested : null;
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

    async function* stream(request = {}) {
      if (typeof rawAdapter.generateTextStream !== 'function') {
        throw new Error('The selected provider does not support text streaming');
      }
      const budget = computeOutputTokenBudget(kind, {
        tokenPolicy,
        adapterCap,
        units: requestUnits(request)
      });
      const suppliedLimit = validCap(request.maxOutputTokens);
      const maxOutputTokens = suppliedLimit
        ? Math.min(suppliedLimit, budget.ceiling)
        : budget.initial;
      const upstreamTelemetry = request.onProviderTelemetry;
      yield* rawAdapter.generateTextStream({
        ...request,
        maxOutputTokens,
        timeoutMs: request.timeoutMs || requestTimeoutMs || undefined,
        onProviderTelemetry: event => {
          try { upstreamTelemetry?.(event); } catch { /* Keep provider stream intact. */ }
          report({ phase: 'provider_telemetry', maxOutputTokens, ...event });
        }
      });
    }

    const managedAdapter = Object.assign({}, rawAdapter, {
      generateJson(request) { return invoke('generateJson', request); },
      analyzeChunk(request) { return invoke('analyzeChunk', request); }
    });
    if (typeof rawAdapter.generateTextStream === 'function') {
      managedAdapter.generateTextStream = request => stream(request);
    }
    return managedAdapter;
  }

  return {
    RULES,
    computeOutputTokenBudget,
    computeInputTokenBudget,
    createTokenManagedAdapter
  };
});
