(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const clean = (value, limit = 160) => String(value || '').normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f]+/gu, ' ').replace(/\s+/gu, ' ').trim().slice(0, limit);
  const count = value => typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.min(Number.MAX_SAFE_INTEGER, Math.round(value)) : null;
  const add = (a, b) => Math.min(Number.MAX_SAFE_INTEGER, a + b);

  // Only metadata is accepted here. Prompts, responses and document content are
  // deliberately absent from the public task summary.
  function createTaskTelemetry(options = {}) {
    const rows = Array.isArray(options.events) ? options.events : [];
    const models = new Map();
    let input = 0, output = 0, inputKnown = 0, outputKnown = 0, known = 0;
    for (const row of rows) {
      const providerId = clean(row?.providerId, 60);
      const model = clean(row?.model);
      const key = `${providerId}\u0000${model}`;
      if (model && !models.has(key) && models.size < 16) {
        models.set(key, { providerId, model, requests: 0 });
      }
      if (models.has(key)) models.get(key).requests += 1;
      const inCount = count(row?.inputTokens), outCount = count(row?.outputTokens);
      const explicit = row?.usageProvided !== false;
      const hasInput = explicit && row?.inputTokensProvided !== false && inCount !== null;
      const hasOutput = explicit && row?.outputTokensProvided !== false && outCount !== null;
      if (hasInput) { input = add(input, inCount); inputKnown += 1; }
      if (hasOutput) { output = add(output, outCount); outputKnown += 1; }
      if (hasInput && hasOutput) known += 1;
    }
    const requests = rows.length;
    const complete = requests > 0 && known === requests;
    const some = inputKnown > 0 || outputKnown > 0;
    const started = count(options.startedAt), finished = count(options.finishedAt);
    return {
      taskId: clean(options.taskId, 80), label: clean(options.label, 80),
      operationId: clean(options.operationId, 160),
      status: ['success', 'failed', 'cancelled'].includes(options.status) ? options.status : 'success',
      engine: clean(options.engine), models: [...models.values()], requests,
      elapsedMs: started !== null && finished !== null ? Math.max(0, finished - started) : 0,
      inputTokens: inputKnown ? input : null, outputTokens: outputKnown ? output : null,
      totalTokens: inputKnown && outputKnown ? add(input, output) : null,
      usageState: complete ? 'complete' : some ? 'partial' : 'unavailable',
      missingUsageRequests: requests - known, estimated: rows.some(row => row?.estimated === true)
    };
  }

  function formatTaskTelemetry(value = {}) {
    const status = { success: '完成', failed: '失败', cancelled: '取消' }[value.status] || '完成';
    const modelList = Array.isArray(value.models) ? value.models.slice(0, 16)
      .map(row => clean(row?.model)).filter(Boolean) : [];
    const model = [...new Set(modelList)].join('、') || clean(value.engine) || '模型未确认';
    const ms = count(value.elapsedMs) || 0;
    const duration = ms < 60000 ? `${(ms / 1000).toFixed(1)} 秒`
      : `${Math.floor(ms / 60000)} 分 ${Math.round((ms % 60000) / 1000)} 秒`;
    const number = n => count(n) === null ? '未提供' : count(n).toLocaleString('en-US');
    const tokens = value.usageState === 'unavailable' ? 'Token：未提供'
      : `Token${value.estimated ? '（估算）' : ''}：输入 ${number(value.inputTokens)} · ` +
        `输出 ${number(value.outputTokens)} · 总计 ${number(value.totalTokens)}` +
        (value.usageState === 'partial' ? '（部分用量）' : '');
    return `${clean(value.label, 80) || '任务'}${status} · 模型：${model} · 耗时 ${duration} · ${tokens}` +
      (count(value.requests) > 0 ? ` · ${count(value.requests)} 次调用` : '');
  }
  function mergeTaskTelemetry(values, options = {}) {
    const rows = (Array.isArray(values) ? values : [values]).filter(v => v && typeof v === 'object');
    if (!rows.length) return null;
    const models = new Map();
    let requests = 0, missing = 0, input = 0, output = 0, hasInput = false, hasOutput = false;
    let elapsed = 0, estimated = false, complete = true;
    for (const row of rows) {
      const n = count(row.requests) ?? 1;
      requests = add(requests, n);
      elapsed = add(elapsed, count(row.elapsedMs) || 0);
      if (n === 0) continue;
      estimated ||= row.estimated === true;
      const unavailable = row.usageState === 'unavailable';
      const i = unavailable ? null : count(row.inputTokens), o = unavailable ? null : count(row.outputTokens);
      if (i !== null) { input = add(input, i); hasInput = true; }
      if (o !== null) { output = add(output, o); hasOutput = true; }
      const isComplete = row.usageState ? row.usageState === 'complete' : i !== null && o !== null;
      complete &&= isComplete;
      missing = add(missing, Math.min(n, count(row.missingUsageRequests) ?? (isComplete ? 0 : n)));
      for (const item of Array.isArray(row.models) ? row.models : []) {
        const model = clean(item?.model), providerId = clean(item?.providerId, 60);
        const key = `${providerId}\u0000${model}`;
        if (!model || (!models.has(key) && models.size >= 16)) continue;
        if (!models.has(key)) models.set(key, { model, providerId, requests: 0 });
        models.get(key).requests = add(models.get(key).requests, count(item.requests) || 0);
      }
    }
    const started = count(options.startedAt), finished = count(options.finishedAt);
    return {
      taskId: clean(options.taskId || rows[0].taskId, 80), label: clean(options.label || rows[0].label, 80),
      operationId: clean(options.operationId || rows[0].operationId, 160),
      status: ['success', 'failed', 'cancelled'].includes(options.status) ? options.status : rows.at(-1).status || 'success',
      engine: clean(options.engine || rows[0].engine), models: [...models.values()], requests,
      elapsedMs: started !== null && finished !== null ? Math.max(0, finished - started) : elapsed,
      inputTokens: hasInput ? input : null, outputTokens: hasOutput ? output : null,
      totalTokens: hasInput && hasOutput ? add(input, output) : null,
      usageState: complete && requests > 0 ? 'complete' : hasInput || hasOutput ? 'partial' : 'unavailable',
      missingUsageRequests: missing, estimated
    };
  }
  return { createTaskTelemetry, mergeTaskTelemetry, formatTaskTelemetry };
});
