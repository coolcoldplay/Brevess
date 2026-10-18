(function attach(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.BrevessBilingualTranslation = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory() {
  'use strict';
  const RECOVERABLE = new Set(['RATE_LIMITED', 'EMPTY_TRANSLATION', 'INVALID_TRANSLATION', 'INVALID_RESPONSE',
    'OUTPUT_TRUNCATED', 'TRANSLATION_TIMEOUT', 'TRANSLATION_FAILED', 'TRANSLATION_QUEUE_FULL']);
  const TASK_BLOCKING = new Set(['AUTH_INVALID', 'QUOTA_EXHAUSTED', 'TRANSLATION_CONFIGURATION_CHANGED',
    'TRANSLATION_ROUTE_INVALID', 'NO_USABLE_PROFILE', 'LLM_NOT_READY', 'TOKEN_BUDGET_EXCEEDED',
    'CAPABILITY_MISMATCH', 'TRANSLATION_LEDGER_UNAVAILABLE', 'TRANSLATION_LEDGER_CAPACITY',
    'API_UNAVAILABLE', 'LANGUAGE_UNAVAILABLE']);
  function createController({ provider, autoRecovery = false, now = () => Date.now(), onState = () => {}, onResult = () => {}, onError = () => {}, onProgress = () => {}, onEntryState = () => {}, yieldTask = () => new Promise(resolve => setTimeout(resolve, 0)) } = {}) {
    if (!provider) throw new TypeError('A local Translator provider is required.');
    const entries = new Map();
    let enabled = false, ready = false, paused = false, epoch = 0, sequence = 0, initialization = null;
    const active = new Map();
    const history = new Map(), timers = new Map();
    const policy = { baseDelayMs: 500, maxDelayMs: 8000, maxNoProgress: 4, maxRetries: 256,
      maxRequests: 10000, maxReceiptPolls: 4, maxNoProgressMs: 60000, ...(typeof autoRecovery === 'object' ? autoRecovery : {}) };
    for (const key of Object.keys(policy)) if (!Number.isSafeInteger(policy[key]) || policy[key] < 1) throw new TypeError('Invalid recovery bound.');
    let attempts = 0, retries = 0;
    let documentKey = '';
    const documentCounters = new Map();
    let blockingSignature = null;
    let controller = null;
    function budgetError() { return Object.assign(new Error('Translation recovery budget exhausted.'), { code: 'TRANSLATION_RECOVERY_EXHAUSTED' }); }
    function clearTimer(id) {
      const waiting = timers.get(id);
      if (waiting) { clearTimeout(waiting.timer); waiting.entry.budget.noProgressMs += Math.max(0, now() - waiting.startedAt); }
      timers.delete(id);
    }
    function getState() {
      const values = [...entries.values()];
      const count = status => values.filter(e => e.status === status).length;
      return { enabled, paused, phase: paused ? 'paused' : !enabled ? 'idle' : !ready ? 'initializing' : active.size || timers.size ? 'translating' : 'ready',
        total: values.length, completed: values.filter(e => e.status === 'done').length,
        failed: values.filter(e => ['failed', 'blocked', 'save-failed', 'unknown'].includes(e.status)).length,
        unknown: values.filter(e => e.retryBlocked === true).length,
        retrying: count('retrying'), blocked: count('blocked'), saving: count('saving'), saveFailed: count('save-failed'), attempts, retries,
        pending: values.filter(e => ['pending', 'translating', 'retrying', 'saving'].includes(e.status)).length };
    }
    function publish() { onState(getState()); }
    function publishEntry(entry, status, reason) {
      // Display observers must not interrupt the provider or its cancellation.
      try { onEntryState({ ...entry, status }, { status, reason }); } catch { /* Optional UI observer. */ }
    }
    function setEntries(incoming) {
      const seen = new Set();
      for (const value of incoming || []) {
        if (!value || value.id === undefined || typeof value.text !== 'string' || !value.text.trim()) continue;
        const id = String(value.id); seen.add(id);
        const existing = entries.get(id);
        if (existing && existing.text === value.text) {
          existing.priority = Number(value.priority) || 0; existing.foreground = value.foreground === true;
          if (typeof value.confirmedTranslation === 'string' && (existing.translation !== value.confirmedTranslation || ['done', 'save-failed'].includes(existing.status))) {
            active.get(id)?.abort.abort(); clearTimer(id);
            existing.translation = value.confirmedTranslation; existing.status = 'pending';
            publishEntry(existing, 'pending', 'save-edited-result');
          }
          continue;
        }
        active.get(id)?.abort.abort();
        clearTimer(id);
        if (existing) publishEntry(existing, 'cancelled', 'replaced');
        const entry = { ...value, id, foreground: value.foreground === true, priority: Number(value.priority) || 0, version: ++sequence, status: 'pending', translation: typeof value.confirmedTranslation === 'string' ? value.confirmedTranslation : null };
        const key = JSON.stringify([documentKey, provider.getState?.().engineSignature || '', value.sourceKey || id, value.text]);
        let saved = history.get(key);
        if (!saved) { saved = { seen: new Set(), noProgress: 0, noProgressMs: 0, polls: 0, exhausted: false }; history.set(key, saved); }
        entry.budget = saved;
        entry.retryBlocked = saved.unknown === true;
        if (autoRecovery && entry.translation === null && !(entry.retryBlocked && provider.canQueryReceipt) &&
            (saved.exhausted || attempts >= policy.maxRequests || retries >= policy.maxRetries ||
              blockingSignature === (provider.getState?.().engineSignature || ''))) entry.status = 'blocked';
        entries.set(id, entry);
        publishEntry(entry, entry.status, 'queued');
      }
      for (const id of entries.keys()) if (!seen.has(id)) {
        active.get(id)?.abort.abort();
        clearTimer(id);
        publishEntry(entries.get(id), 'cancelled', 'removed');
        entries.delete(id);
      }
      publish(); void pump();
    }
    function pump() {
      if (!enabled || !ready || paused) return;
      // One page task and one explicitly chosen paragraph may wait on the
      // provider. The provider serializes native calls, so a foreground request
      // can run at the next chunk boundary without parallel session use.
      const pending = [...entries.values()].filter(e => e.status === 'pending').sort((a, b) => Number(b.foreground) - Number(a.foreground) || a.priority - b.priority || a.version - b.version);
      for (const next of pending) {
        if ([...active.values()].some(task => task.entry.foreground === next.foreground)) continue;
        const runEpoch = epoch;
        const run = async () => {
          const abort = new AbortController();
          const cancel = () => abort.abort(); controller.signal.addEventListener('abort', cancel, { once: true });
          const outer = controller;
          const task = { entry: next, abort }; active.set(next.id, task); next.status = 'translating';
          publishEntry(next, 'translating', 'started'); publish();
          const before = next.resumeFrom?.sourceEnd || 0;
          const startedAt = now(), inference = next.translation === null;
          const live = () => enabled && runEpoch === epoch && entries.get(next.id) === next && !abort.signal.aborted;
          let reported = false, saving = false;
          const onAttempt = (value = {}) => {
            if (!live()) throw Object.assign(new Error('Translation cancelled.'), { code: 'ABORTED' });
            const key = JSON.stringify([value.engineSignature || '', value.sourceStart || 0, value.sourceEnd ?? next.text.length]);
            const retry = value.recovery === true || next.budget.seen.has(key);
            if (autoRecovery && (attempts >= policy.maxRequests || (retry && retries >= policy.maxRetries) || next.budget.exhausted)) throw budgetError();
            reported = true; attempts++; if (retry) retries++; next.budget.seen.add(key);
          };
          try {
            if (autoRecovery && inference && (next.budget.exhausted || (provider.accountsAttempts !== true && attempts >= policy.maxRequests && !next.retryBlocked))) throw budgetError();
            let translatedText = next.translation;
            if (translatedText === null) translatedText = await provider.translate(next.text, { signal: abort.signal,
              resumeFrom: next.resumeFrom,
              sourceKey: next.sourceKey,
              foreground: next.foreground === true,
              priority: next.foreground ? 0 : 10 + next.priority,
              getPriority: () => next.foreground ? 0 : 10 + next.priority,
              onAttempt,
              onProgress(value) {
                if (!enabled || runEpoch !== epoch || entries.get(next.id) !== next || abort.signal.aborted) return;
                if (value?.sourceStart === 0 && Number.isInteger(value.sourceEnd) && value.sourceEnd > 0 &&
                    value.sourceEnd <= next.text.length && typeof value.translatedText === 'string' && value.translatedText.trim()) {
                  if (value.sourceEnd >= (next.resumeFrom?.sourceEnd || 0)) next.resumeFrom = { ...value, sourceText: next.text };
                }
                try { onProgress({ ...next }, value); } catch { /* Optional display observer. */ }
              }
            });
            if (!live()) return;
            next.translation = translatedText;
            if (!reported && inference && provider.accountsAttempts !== true) onAttempt();
            saving = true; next.status = 'saving'; publishEntry(next, 'saving', 'persisting'); publish();
            await onResult({ ...next }, translatedText, { signal: abort.signal, isCurrent: live });
            if (!live()) return;
            next.status = 'done'; next.retryBlocked = false; next.budget.unknown = false; next.budget.noProgress = 0; next.budget.noProgressMs = 0;
            publishEntry(next, 'done', 'result');
          } catch (error) {
            if (live()) {
              if (!reported && !saving && inference && provider.accountsAttempts !== true && error?.code !== 'TRANSLATION_OUTCOME_UNKNOWN' && error?.code !== 'TRANSLATION_RECOVERY_EXHAUSTED') {
                try { onAttempt(); } catch { error = budgetError(); }
              }
              next.retryBlocked = error?.code === 'TRANSLATION_OUTCOME_UNKNOWN';
              next.budget.unknown = next.retryBlocked;
              const progressed = (next.resumeFrom?.sourceEnd || 0) > before;
              next.budget.noProgress = progressed ? 0 : next.budget.noProgress + 1;
              next.budget.noProgressMs = progressed ? 0 : next.budget.noProgressMs + Math.max(0, now() - startedAt);
              if (next.retryBlocked) next.budget.polls++;
              const unknownRetry = next.retryBlocked && provider.canQueryReceipt === true && next.budget.polls <= policy.maxReceiptPolls;
              const recover = !saving && RECOVERABLE.has(error?.code) && next.budget.noProgress < policy.maxNoProgress && next.budget.noProgressMs < policy.maxNoProgressMs && attempts < policy.maxRequests && retries < policy.maxRetries;
              const automatic = autoRecovery && next.automaticRecovery !== false;
              const retry = automatic && (recover || unknownRetry);
              next.status = saving ? 'save-failed' : retry ? 'retrying' : next.retryBlocked ? 'unknown' : automatic ? 'blocked' : 'failed';
              if (automatic && !saving && !retry && !next.retryBlocked) next.budget.exhausted = true;
              publishEntry(next, next.status, retry ? 'automatic-recovery' : 'translation-error');
              try { onError({ ...next, recovering: retry }, error); } catch { /* UI errors cannot restart inference. */ }
              if (automatic && !saving && TASK_BLOCKING.has(error?.code)) {
                blockingSignature = provider.getState?.().engineSignature || '';
                for (const entry of entries.values()) if (entry !== next && entry.translation === null && !['done', 'unknown'].includes(entry.status)) {
                  clearTimer(entry.id); active.get(entry.id)?.abort.abort();
                  entry.status = 'blocked'; entry.budget.exhausted = true;
                  publishEntry(entry, 'blocked', 'engine-blocked');
                  try { onError({ ...entry, recovering: false }, error); } catch {}
                }
              }
              if (retry) {
                const delay = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** Math.min(16, next.budget.noProgress || next.budget.polls));
                const waiting = { entry: next, startedAt: now() };
                waiting.timer = setTimeout(() => {
                  clearTimer(next.id);
                  if (!live()) return;
                  if (!next.retryBlocked && next.budget.noProgressMs >= policy.maxNoProgressMs) {
                    next.status = 'blocked'; next.budget.exhausted = true;
                    publishEntry(next, 'blocked', 'no-progress-timeout');
                    try { onError({ ...next, recovering: false }, budgetError()); } catch {}
                    publish(); pump(); return;
                  }
                  next.status = 'pending'; publishEntry(next, 'pending', 'automatic-retry'); publish(); pump();
                }, delay);
                timers.set(next.id, waiting);
              }
            }
          } finally {
            outer.signal.removeEventListener('abort', cancel);
            if (active.get(next.id) === task) active.delete(next.id);
            if (runEpoch === epoch) publish();
            await yieldTask();
            if (runEpoch === epoch) pump();
          }
        };
        void run();
      }
    }
    async function start() {
      if (enabled) return initialization;
      enabled = true; ready = false; paused = false; const runEpoch = ++epoch;
      controller = new AbortController(); publish();
      for (const entry of entries.values()) if (entry.status === 'pending') publishEntry(entry, 'pending', 'started');
      try {
        // Invoke before the first await so a real page click can retain activation.
        initialization = provider.initialize({ signal: controller.signal });
        await initialization;
        if (!enabled || runEpoch !== epoch) return;
        ready = true;
        for (const entry of entries.values()) if (entry.status === 'done') {
          publishEntry(entry, 'done', 'cached');
          try { Promise.resolve(onResult({ ...entry }, entry.translation)).catch(() => {}); } catch { /* Cached display observer. */ }
        }
        publish(); void pump();
      } catch (error) {
        if (runEpoch === epoch) {
          enabled = false; ready = false;
          for (const entry of entries.values()) if (entry.status === 'pending') publishEntry(entry, 'cancelled', 'initialization-error');
          onState({ ...getState(), phase: 'error', error: error.code || error.name });
        }
        throw error;
      } finally { if (runEpoch === epoch) initialization = null; }
    }
    function stop() {
      enabled = false; ready = false; paused = false; epoch += 1; controller?.abort();
      for (const id of timers.keys()) clearTimer(id);
      for (const task of active.values()) task.abort.abort(); active.clear();
      provider.destroy();
      for (const entry of entries.values()) if (entry.status === 'pending' || entry.status === 'translating') publishEntry(entry, 'cancelled', 'stopped');
      for (const entry of entries.values()) if (['translating', 'retrying', 'saving'].includes(entry.status) || (entry.status === 'failed' && !entry.retryBlocked)) entry.status = 'pending';
      publish();
    }
    function pause() {
      if (!enabled || paused) return getState();
      paused = true; epoch += 1; controller?.abort();
      for (const id of timers.keys()) clearTimer(id);
      for (const task of active.values()) task.abort.abort();
      active.clear();
      for (const entry of entries.values()) if (['translating', 'retrying', 'saving'].includes(entry.status)) {
        entry.status = 'pending'; publishEntry(entry, 'cancelled', 'paused');
      }
      publish(); return getState();
    }
    async function resume({ retryFailed = false } = {}) {
      if (retryFailed) for (const entry of entries.values()) if ((entry.status === 'failed' && !entry.retryBlocked) || entry.status === 'save-failed') {
        entry.status = 'pending'; publishEntry(entry, 'pending', 'retry');
      }
      if (!enabled) return start();
      if (paused) {
        paused = false; controller = new AbortController();
        // A cancelled initialization cannot be reused as a successful session.
        if (!ready) { enabled = false; return start(); }
      }
      publish(); pump(); return getState();
    }
    function setDocument(key) {
      if (typeof key !== 'string' || enabled || active.size) throw new TypeError('Retire the current document before changing its budget binding.');
      if (key === documentKey) return;
      documentCounters.set(documentKey, { attempts, retries }); documentKey = key;
      const saved = documentCounters.get(key) || { attempts: 0, retries: 0 };
      attempts = saved.attempts; retries = saved.retries;
    }
    function destroy() { stop(); entries.clear(); history.clear(); documentCounters.clear(); }
    return { start, stop, pause, resume, destroy, setEntries, setDocument, getState };
  }
  return { createController };
});
