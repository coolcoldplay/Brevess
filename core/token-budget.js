(function attach(root, factory) {
  const isCommonJs = typeof module === 'object' && module.exports;
  const shared = root.SciLLM || {};
  if (isCommonJs) Object.assign(shared, require('./llm-task-catalog.js'));
  const api = factory(shared);
  if (isCommonJs) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory(shared) {
  const MAX_CONFIGURABLE_OUTPUT_TOKENS = 2000000;
  const MAX_TASK_UNITS = 1000000;
  const MAX_TRUNCATION_RETRIES = 10;
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
    return Number.isFinite(numeric) && numeric > 0
      ? Math.floor(Math.min(numeric, MAX_CONFIGURABLE_OUTPUT_TOKENS)) : null;
  }

  function own(object, key) {
    return Object.prototype.hasOwnProperty.call(object, key);
  }

  function isSafeRuleObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    try {
      const prototype = Object.getPrototypeOf(value);
      if (prototype !== Object.prototype && prototype !== null) return false;
      return !Object.keys(value).some(key =>
        key === '__proto__' || key === 'prototype' || key === 'constructor'
      );
    } catch {
      return false;
    }
  }

  function clampedOrFallback(value, fallback, minimum, maximum) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.max(minimum, Math.min(maximum, numeric));
  }

  function boundedInteger(value, fallback, minimum, maximum, infinityMode = 'fallback') {
    const numeric = Number(value);
    if (numeric === Infinity && infinityMode === 'maximum') return Math.floor(maximum);
    if (numeric === -Infinity && infinityMode === 'minimum') return Math.floor(minimum);
    if (!Number.isFinite(numeric)) return Math.floor(fallback);
    return Math.floor(Math.max(minimum, Math.min(maximum, numeric)));
  }

  function normalizedSourceCap(value) {
    if (value === null || value === undefined || value === '') return null;
    const numeric = Number(value);
    if (numeric === Infinity) return MAX_CONFIGURABLE_OUTPUT_TOKENS;
    if (!Number.isFinite(numeric) || numeric <= 0) return null;
    return Math.floor(Math.min(numeric, MAX_CONFIGURABLE_OUTPUT_TOKENS));
  }

  function resolveBudgetDefinition(kindOrTaskId) {
    if (own(RULES, kindOrTaskId)) {
      return { budgetKind: kindOrTaskId, catalogTokenRule: 'auto' };
    }
    try {
      const definition = shared.getLlmTaskDefinition(kindOrTaskId);
      if (!own(RULES, definition.budgetKind)) throw new Error('missing rule');
      return {
        budgetKind: definition.budgetKind,
        catalogTokenRule: definition.defaultTokenRule
      };
    } catch {
      throw new Error(`Unknown token budget kind: ${kindOrTaskId}`);
    }
  }

  function normalizeTaskRule(kindOrTaskId, taskRule) {
    const { budgetKind, catalogTokenRule } = resolveBudgetDefinition(kindOrTaskId);
    const baseOutput = RULES[budgetKind];
    const catalogRule = isSafeRuleObject(catalogTokenRule)
      ? catalogTokenRule : {};
    const requestedOverride = isSafeRuleObject(taskRule) ? taskRule : null;
    const override = requestedOverride &&
      (!own(requestedOverride, 'input') || isSafeRuleObject(requestedOverride.input)) &&
      (!own(requestedOverride, 'output') || isSafeRuleObject(requestedOverride.output))
      ? requestedOverride : null;
    const catalogInput = isSafeRuleObject(catalogRule.input)
      ? catalogRule.input : {};
    const catalogOutput = isSafeRuleObject(catalogRule.output)
      ? catalogRule.output : {};
    const overrideInput = isSafeRuleObject(override?.input)
      ? override.input : {};
    const overrideOutput = isSafeRuleObject(override?.output)
      ? override.output : {};
    const inputSource = { ...catalogInput, ...overrideInput };
    const outputSource = { ...catalogOutput, ...overrideOutput };
    const sourceCap = normalizedSourceCap(inputSource.sourceCapTokens);

    const floor = Math.floor(clampedOrFallback(
      outputSource.floor, baseOutput.floor, 512, MAX_CONFIGURABLE_OUTPUT_TOKENS
    ));
    const ceiling = Math.floor(clampedOrFallback(
      outputSource.ceiling, baseOutput.ceiling, floor, MAX_CONFIGURABLE_OUTPUT_TOKENS
    ));
    return {
      budgetKind,
      mode: override ? 'task' : 'auto',
      input: {
        safetyRatio: clampedOrFallback(inputSource.safetyRatio, 1, 0.5, 1),
        reservedTokens: boundedInteger(
          inputSource.reservedTokens, 0, 0, MAX_CONFIGURABLE_OUTPUT_TOKENS, 'maximum'
        ),
        sourceCapTokens: sourceCap,
        maxUnits: boundedInteger(
          inputSource.maxUnits, MAX_TASK_UNITS, 1, MAX_TASK_UNITS, 'maximum'
        )
      },
      output: {
        base: clampedOrFallback(
          outputSource.base, baseOutput.base, 0, MAX_CONFIGURABLE_OUTPUT_TOKENS
        ),
        perUnit: clampedOrFallback(
          outputSource.perUnit, baseOutput.perUnit, 0, MAX_CONFIGURABLE_OUTPUT_TOKENS
        ),
        floor,
        ceiling,
        truncationRetries: boundedInteger(
          outputSource.truncationRetries, 2, 0, MAX_TRUNCATION_RETRIES
        ),
        retryMultiplier: Number(outputSource.retryMultiplier) > 1 &&
          Number.isFinite(Number(outputSource.retryMultiplier))
          ? Math.min(4, Number(outputSource.retryMultiplier)) : 1.75
      }
    };
  }

  function normalizeTaskTokenRule(taskId, value) {
    if (value === 'auto') return 'auto';
    if (!isSafeRuleObject(value)) return 'auto';
    if (!own(value, 'input') && !own(value, 'output')) return 'auto';
    const normalized = normalizeTaskRule(taskId, value);
    if (normalized.mode !== 'task') return 'auto';
    return {
      input: { ...normalized.input },
      output: { ...normalized.output }
    };
  }

  function computeOutputTokenBudget(kind, options = {}) {
    const normalized = normalizeTaskRule(kind, options.taskRule);
    const rule = normalized.output;
    const tokenPolicy = options.tokenPolicy || {};
    if (tokenPolicy.mode === 'manual') {
      const requested = Number(tokenPolicy.manualMax);
      const manual = Number.isFinite(requested) && requested > 0
        ? boundedNumber(requested, 512, MAX_CONFIGURABLE_OUTPUT_TOKENS)
        : 4096;
      const adapterCap = validCap(options.adapterCap);
      const roundedAdapterCap = adapterCap
        ? Math.max(1, Math.floor(adapterCap))
        : MAX_CONFIGURABLE_OUTPUT_TOKENS;
      const fixed = Math.min(
        MAX_CONFIGURABLE_OUTPUT_TOKENS,
        roundedAdapterCap,
        roundUp256(manual)
      );
      return { initial: fixed, ceiling: fixed, mode: 'manual' };
    }

    const autoCap = validCap(tokenPolicy.autoCap);
    const adapterCap = validCap(options.adapterCap);
    let ceiling;
    if (normalized.mode === 'task') {
      ceiling = rule.ceiling;
      if (autoCap !== null) ceiling = Math.min(ceiling, Math.max(rule.floor, autoCap));
    } else {
      ceiling = autoCap !== null
        ? Math.max(rule.floor, autoCap)
        : (adapterCap !== null ? adapterCap : rule.ceiling);
    }
    if (adapterCap !== null) ceiling = Math.min(ceiling, adapterCap);
    ceiling = Math.max(1, Math.min(MAX_CONFIGURABLE_OUTPUT_TOKENS, ceiling));
    const units = Math.min(
      normalized.input.maxUnits,
      Math.max(1, Number(options.units) || 0)
    );
    const initial = Math.min(
      ceiling,
      rule.ceiling,
      Math.max(rule.floor, roundUp256(rule.base + rule.perUnit * units))
    );
    const budget = { initial, ceiling, mode: normalized.mode };
    if (normalized.budgetKind !== 'figure' ||
        String(options.reasoningProviderId || '') !== 'deepseek' ||
        options.reasoningEnabled !== true ||
        !['high', 'max'].includes(String(options.reasoningEffort || ''))) {
      return budget;
    }
    // DeepSeek counts hidden reasoning and the final structured JSON against
    // the same output limit. Preserve the normal Figure budget for the JSON,
    // then add a bounded reasoning reserve for high-effort automatic runs.
    // Manual limits remain exact user choices and return above this branch.
    const effort = String(options.reasoningEffort);
    const reserve = effort === 'max'
      ? Math.max(24576, roundUp256(initial * 1.5))
      : Math.max(16384, initial);
    const contextCap = validCap(options.contextWindowTokens);
    const contextCeiling = contextCap === null
      ? ceiling
      : Math.max(1, Math.floor(contextCap * 0.5 / 256) * 256);
    return {
      initial: Math.min(ceiling, contextCeiling, roundUp256(initial + reserve)),
      ceiling,
      mode: normalized.mode
    };
  }

  function computeInputTokenBudget(options = {}) {
    const taskRule = isSafeRuleObject(options.taskRule) ? options.taskRule : null;
    const taskInput = isSafeRuleObject(taskRule?.input) ? taskRule.input : {};
    const contextWindowTokens = boundedInteger(
      options.contextWindowTokens, 1, 1, MAX_CONFIGURABLE_OUTPUT_TOKENS, 'maximum'
    );
    const outputTokens = boundedInteger(
      options.outputTokens, 0, 0, MAX_CONFIGURABLE_OUTPUT_TOKENS, 'maximum'
    );
    const requestedReservedTokens = own(taskInput, 'reservedTokens')
      ? taskInput.reservedTokens : options.reservedTokens;
    const reservedTokens = boundedInteger(
      requestedReservedTokens, 0, 0, MAX_CONFIGURABLE_OUTPUT_TOKENS, 'maximum'
    );
    const systemTokens = boundedInteger(
      options.systemTokens, 0, 0, MAX_CONFIGURABLE_OUTPUT_TOKENS, 'maximum'
    );
    const requestedSafetyRatio = own(taskInput, 'safetyRatio')
      ? taskInput.safetyRatio : options.safetyRatio;
    const safetyRatio = clampedOrFallback(requestedSafetyRatio, 1, 0.5, 1);
    const usableContextWindowTokens = Math.floor(contextWindowTokens * safetyRatio);
    const contextAvailable = Math.max(
      0,
      usableContextWindowTokens - outputTokens - reservedTokens - systemTokens
    );
    const sourceCap = normalizedSourceCap(taskInput.sourceCapTokens);
    return {
      contextWindowTokens,
      outputTokens,
      reservedTokens,
      systemTokens,
      usableContextWindowTokens,
      available: sourceCap === null
        ? contextAvailable
        : Math.min(contextAvailable, Math.floor(sourceCap))
    };
  }

  function suggestedLimit(error) {
    const suggested = Number(error?.suggestedMaxOutputTokens);
    return Number.isFinite(suggested) && suggested >= 512 &&
      suggested <= MAX_CONFIGURABLE_OUTPUT_TOKENS ? suggested : null;
  }

  function lowerRetryLimit(value, current) {
    const rounded = Math.max(256, Math.floor(Number(value) / 256) * 256);
    return Math.max(1, Math.min(Math.floor(current) - 1, rounded));
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
    taskRule = null,
    adapterCap = null,
    contextWindowTokens = null,
    reasoningProviderId = '',
    reasoningEnabled = false,
    reasoningEffort = 'auto',
    requestTimeoutMs = null,
    progressHeartbeatMs = 0,
    setIntervalImpl = setInterval,
    clearIntervalImpl = clearInterval,
    nowImpl = Date.now,
    maxTokenLimitRetries = 1,
    maxTruncationRetries = null,
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
        taskRule,
        adapterCap,
        contextWindowTokens,
        reasoningProviderId,
        reasoningEnabled,
        reasoningEffort,
        units: requestUnits(request)
      });
      const normalizedRule = normalizeTaskRule(kind, taskRule);
      const effectiveMaxTruncationRetries = maxTruncationRetries === null
        ? normalizedRule.output.truncationRetries
        : Math.floor(clampedOrFallback(
          maxTruncationRetries, normalizedRule.output.truncationRetries, 0, MAX_TRUNCATION_RETRIES
        ));
      const retryMultiplier = normalizedRule.output.retryMultiplier;
      let current = budget.initial;
      let effectiveCeiling = budget.ceiling;
      let limitedRetried = false;
      let truncationRetries = 0;
      while (true) {
        const timeoutMs = request.timeoutMs || requestTimeoutMs || undefined;
        const heartbeatMs = Math.max(0, Number(progressHeartbeatMs) || 0);
        const startedAt = nowImpl();
        let heartbeatId = null;
        if (heartbeatMs > 0) {
          report({ phase: 'provider_request_started', timeoutMs: Number(timeoutMs) || 0 });
          heartbeatId = setIntervalImpl(() => {
            report({
              phase: 'provider_waiting',
              elapsedSeconds: Math.max(0, Math.floor((nowImpl() - startedAt) / 1000)),
              timeoutMs: Number(timeoutMs) || 0
            });
          }, heartbeatMs);
        }
        try {
          const upstreamTelemetry = request.onProviderTelemetry;
          return await rawAdapter[method]({
            ...request,
            maxOutputTokens: current,
            timeoutMs,
            onProviderTelemetry: event => {
              try { upstreamTelemetry?.(event); } catch { /* Keep provider result intact. */ }
              report({ phase: 'provider_telemetry', maxOutputTokens: current, ...event });
            }
          });
        } catch (error) {
          if (error?.code === 'TOKEN_LIMIT_REJECTED' && !limitedRetried && current > 1 &&
              Math.max(0, Number(maxTokenLimitRetries) || 0) > 0) {
            limitedRetried = true;
            const suggested = suggestedLimit(error);
            current = suggested && suggested < current
              ? lowerRetryLimit(suggested, current)
              : lowerRetryLimit(current * 0.75, current);
            effectiveCeiling = Math.min(effectiveCeiling, current);
            report({ phase: 'token_limit_retry', maxOutputTokens: current });
            continue;
          }
          if (
            error?.code === 'OUTPUT_TRUNCATED' && budget.mode !== 'manual' &&
            truncationRetries < effectiveMaxTruncationRetries &&
            current < effectiveCeiling
          ) {
            const next = Math.min(effectiveCeiling, roundUp256(current * retryMultiplier));
            if (!Number.isFinite(next) || next <= current) throw error;
            truncationRetries += 1;
            current = next;
            report({
              phase: 'output_token_retry',
              maxOutputTokens: current,
              retry: truncationRetries,
              maxRetries: effectiveMaxTruncationRetries
            });
            continue;
          }
          throw error;
        } finally {
          if (heartbeatId !== null) clearIntervalImpl(heartbeatId);
        }
      }
    }

    async function* stream(method, request = {}) {
      if (typeof rawAdapter[method] !== 'function') {
        throw new Error('The selected provider does not support text streaming');
      }
      const budget = computeOutputTokenBudget(kind, {
        tokenPolicy,
        taskRule,
        adapterCap,
        contextWindowTokens,
        reasoningProviderId,
        reasoningEnabled,
        reasoningEffort,
        units: requestUnits(request)
      });
      const suppliedLimit = validCap(request.maxOutputTokens);
      const maxOutputTokens = suppliedLimit
        ? Math.min(suppliedLimit, budget.ceiling)
        : budget.initial;
      const upstreamTelemetry = request.onProviderTelemetry;
      yield* rawAdapter[method]({
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
      managedAdapter.generateTextStream = request => stream('generateTextStream', request);
    }
    if (typeof rawAdapter.generateWebSearchTextStream === 'function') {
      managedAdapter.generateWebSearchTextStream = request =>
        stream('generateWebSearchTextStream', request);
    }
    return managedAdapter;
  }

  return {
    RULES,
    normalizeTaskTokenRule,
    computeOutputTokenBudget,
    computeInputTokenBudget,
    createTokenManagedAdapter
  };
});
