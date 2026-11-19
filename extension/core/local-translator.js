(function attach(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.BrevessLocalTranslator = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory() {
  'use strict';
  const PAIR = Object.freeze({ sourceLanguage: 'en', targetLanguage: 'zh' });
  const scientificApi = typeof module === 'object' && module.exports
    ? require('./translation-checkpoint.js') : globalThis.BrevessTranslationCheckpoint;
  function scientificChunks(source, context, start = 0) {
    const parts = [];
    while (start < source.length) {
      let end = start + splitText(source.slice(start))[0].length;
      const crossing = context.find(item => item.sourceStart < end && item.sourceEnd > end);
      if (crossing) end = crossing.sourceStart > start ? crossing.sourceStart : crossing.sourceEnd;
      if (end - start > 1800) throw failure('TOKEN_BUDGET_EXCEEDED', 'A complete scientific expression exceeds the translation input bound.');
      const scientificContext = scientificApi.sliceScientificContext(source, context, start, end);
      const text = source.slice(start, end);
      if (scientificContext.length && JSON.stringify({sourceText:text, scientificContext}).length > 6000) {
        throw failure('TOKEN_BUDGET_EXCEEDED', 'Scientific translation context exceeds the input bound.');
      }
      parts.push({text, scientificContext}); start = end;
    }
    return parts;
  }
  function nativeScientificText(source, context, start, end) {
    let text = '', cursor = start;
    const spans = [];
    for (const item of context) {
      if (item.sourceEnd <= start || item.sourceStart >= end) continue;
      if (item.sourceStart < start || item.sourceEnd > end) throw failure('TRANSLATION_INVALID_REQUEST', 'A scientific expression cannot be split.');
      text += source.slice(cursor, item.sourceStart);
      spans.push({ ...item, modelStart: text.length, modelEnd: text.length + item.displayText.length });
      text += item.displayText; cursor = item.sourceEnd;
    }
    return { text: text + source.slice(cursor, end), spans };
  }
  function nativeScientificChunks(source, context, start, end, limit) {
    const chunks = [];
    while (start < end) {
      let next = start + splitText(source.slice(start, end), limit)[0].length;
      const crossing = context.find(item => item.sourceStart < next && item.sourceEnd > next);
      if (crossing) next = crossing.sourceStart > start ? crossing.sourceStart : crossing.sourceEnd;
      const projected = nativeScientificText(source, context, start, next);
      if (projected.text.length > limit) {
        let cut = splitText(projected.text, limit)[0].length;
        const formula = projected.spans.find(item => item.modelStart < cut && item.modelEnd > cut);
        if (formula) cut = formula.modelStart || formula.modelEnd;
        // Convert the chosen model boundary back to the original UTF-16 source.
        next = start + cut + projected.spans.filter(item => item.modelEnd <= cut)
          .reduce((delta, item) => delta + item.text.length - item.displayText.length, 0);
      }
      chunks.push(source.slice(start, next)); start = next;
    }
    return chunks;
  }
  function failure(code, message, cause) {
    const error = new Error(message);
    error.code = code;
    if (cause) error.cause = cause;
    return error;
  }
  function abortError() { return failure('ABORTED', 'Local translation cancelled.'); }
  function abortable(promise, signal) {
    if (!signal) return promise;
    return new Promise((resolve, reject) => {
      const cancel = () => reject(abortError());
      if (signal.aborted) cancel();
      else signal.addEventListener('abort', cancel, { once: true });
      Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener('abort', cancel));
    });
  }
  function nativeEnvironmentFailure() {
    if (globalThis.isSecureContext === false) return failure('TRANSLATION_CONTEXT_UNAVAILABLE', 'The Translator API requires a secure context.');
    const policy = globalThis.document?.permissionsPolicy || globalThis.document?.featurePolicy;
    try {
      if (policy?.features?.().includes('translator') && policy.allowsFeature('translator') === false) {
        return failure('TRANSLATION_POLICY_BLOCKED', 'The page permissions policy blocks the Translator API.');
      }
    } catch { /* Older browsers need not expose policy inspection. */ }
    return null;
  }
  function nativeDiagnostic(error, stage) {
    const native = error?.cause || error;
    return { stage, code: error?.code || '', name: String(native?.name || 'Error').slice(0, 80),
      // Capability/create receive no article text. Keep those actionable native
      // messages, but do not copy arbitrary translation-input text into status.
      message: stage === 'translate' ? '' : String(native?.message || '').slice(0, 500),
      sourceLanguage: 'en', targetLanguage: 'zh' };
  }
  function classify(error, stage) {
    if (error?.code === 'ABORTED' || error?.name === 'AbortError') return abortError();
    if (error?.code && typeof error.code === 'string') return error;
    if (error?.name === 'NotAllowedError') return nativeEnvironmentFailure() || failure('USER_ACTIVATION_REQUIRED', 'The browser requires an active page interaction or permission before creating a Translator.', error);
    if (stage === 'initialize' && /(?:model download hasn.t started|awaiting device capability check|model.*(?:not ready|not available yet))/iu.test(String(error?.message || ''))) {
      return failure('MODEL_NOT_READY', 'The browser is still checking device capability or preparing its local translation model.', error);
    }
    if (error?.name === 'NotSupportedError') return failure(stage === 'initialize' ? 'NATIVE_UNAVAILABLE' : 'TRANSLATION_FAILED',
      'The browser could not currently provide its native translation session.', error);
    return failure(stage === 'initialize' ? 'INITIALIZATION_FAILED' : 'TRANSLATION_FAILED',
      stage === 'initialize' ? 'The browser could not initialize or download its local translation model.' : 'The browser could not translate this text.', error);
  }
  function splitText(value, limit = 1800) {
    let text = String(value || '');
    const parts = [];
    while (text.length > limit) {
      const prefix = text.slice(0, limit);
      let cut = 0;
      for (const match of prefix.matchAll(/[.!?](?=\s)/gu)) {
        const end = match.index + 1;
        // Figure references and scientific abbreviations are not sentence
        // endings. In particular, recovery must not translate "Fig." alone.
        if (match[0] === '.' && /\b(?:Figs?|Eqs?|Refs?|Nos?|Dr|Prof|vs|al|e\.g|i\.e|s\.e\.m|s\.d)\.$/iu.test(prefix.slice(0, end))) continue;
        cut = end;
      }
      if (cut < limit / 3) {
        cut = prefix.lastIndexOf(' ') + 1;
        if (cut < limit / 3) cut = limit - (/[\uD800-\uDBFF]/.test(text[limit - 1]) ? 1 : 0);
      }
      // Move a boundary ahead of a compact reference/statistic in parentheses
      // instead of detaching a Figure label, sample count or comparison value.
      // Oversized groups remain splittable so the native input stays bounded.
      for (const match of text.matchAll(/\([^()\r\n]{1,158}\)|\[[^\[\]\r\n]{1,158}\]/gu)) {
        if (match.index >= cut) break;
        const end = match.index + match[0].length;
        if (match[0].length <= limit && end > cut) {
          if (text.slice(0, match.index).trim()) cut = match.index;
          else if (end <= limit) cut = end;
        }
      }
      const abbreviation = /\b(?:Figs?|Eqs?|Refs?|Nos?|e\.g|i\.e)\.\s*$/iu.exec(text.slice(0, cut));
      if (abbreviation?.index > 0) cut = abbreviation.index;
      parts.push(text.slice(0, cut)); text = text.slice(cut);
    }
    if (text) parts.push(text);
    return parts;
  }
  function validateTranslation(source, translated) {
    if (typeof translated !== 'string' || !translated.trim()) {
      throw failure('EMPTY_TRANSLATION', 'The local model returned no translation.');
    }
    // Edge's native model can leak its internal number/markup placeholders,
    // even for plain-text input. Reject damaged output; stripping the tags
    // would conceal missing or reordered scientific values. Source literals
    // and mathematical comparisons are not themselves malformed output.
    const markers = translated.match(/(?:<|&lt;)\/?(?:b\d+|\d+(?:>|&gt;)|(?:b|i|p|a|span|div|sup|sub|strong|em|br|li|ul|ol|table|tr|td|h[1-6])(?:\s+[a-z_:][\w:.-]*\s*=\s*(?:"[^"<>]*"|'[^'<>]*'|[^\s"'=<>]+))*\s*\/?(?:>|&gt;))/giu) || [];
    if (markers.some(marker => !source.includes(marker))) {
      throw failure('INVALID_TRANSLATION', 'The local model returned damaged translation markers.');
    }
    return translated.trim();
  }
  function expressCountRanges(value) {
    // A damaged terminal piece can hit the native number placeholder bug even
    // at 21 characters ("3–10 ROIs per mouse"). Keep both endpoints verbatim;
    // exclude signs, decimals, exponents, identifiers and reference syntax.
    return value.replace(/(^|[^\p{L}\p{N}\p{Pc}\p{Pd}\p{Sm}.^])(\d+)–(\d+)(?=$|[^\p{L}\p{N}\p{Pc}\p{Pd}\p{Sm}.^])/gu,
      (match, prefix, lower, upper, index) => {
        const before = value.slice(0, index + prefix.length), after = value.slice(index + match.length);
        const beforeOperator = /[\p{Sm}\p{Pd}*/^]\s*$/u.exec(before);
        if (/\b(?:Figs?|Figures?|Eqs?|Equations?|Refs?|References?|Tables?|Nos?)\.?[\s\p{Ps}]*$/iu.test(before) || (beforeOperator && beforeOperator[0].trim() !== '=') || /^\s*(?:[\p{Sm}\p{Pd}*/^]|x\s*10)/u.test(after)) return match;
        if (!/\bn\s*=\s*$/iu.test(before) && !/^\s+(?:ROIs?|mice|mouse|samples?|cells?|animals?|participants?|patients?|replicates?|sections?|fields?|experiments?|neurons?)\b/iu.test(after)) return match;
        return `${prefix}${lower} to ${upper}`;
      });
  }
  function navigationTitleBatchItems(targets) {
    return targets.map(target => ({ sourceKey: `${target.sourceKind}\u0000${target.sectionId}`,
      sourceTitle: target.sourceTitle, parentTitle: target.parentTitle || '' }));
  }
  function parseNavigationTitleBatch(text) {
    const invalid = () => { throw failure('TRANSLATION_INVALID_REQUEST', 'Invalid navigation title batch.'); };
    if (typeof text !== 'string' || text.length > 6000) invalid();
    let items; try { items = JSON.parse(text); } catch { invalid(); }
    if (!Array.isArray(items) || !items.length || items.length > 12) invalid();
    const seen = new Set();
    for (const item of items) {
      if (!item || Object.keys(item).sort().join(',') !== 'parentTitle,sourceKey,sourceTitle' ||
          typeof item.sourceKey !== 'string' || !/^(?:html|pdf)\u0000[^\u0000-\u001f]+$/u.test(item.sourceKey) ||
          item.sourceKey.length > 4096 || seen.has(item.sourceKey) ||
          typeof item.sourceTitle !== 'string' || !item.sourceTitle.trim() || item.sourceTitle.length > 1800 ||
          typeof item.parentTitle !== 'string' || item.parentTitle.length > 1800) invalid();
      seen.add(item.sourceKey);
    }
    return items;
  }
  function validateNavigationTitleTranslations(items, result) {
    const invalid = () => { throw failure('INVALID_TRANSLATION', 'Navigation title results do not match their source IDs.'); };
    if (!result || Object.keys(result).length !== 1 || !Array.isArray(result.translations) ||
        result.translations.length !== items.length) invalid();
    const sources = new Map(items.map(item => [item.sourceKey, item])), translated = new Map();
    for (const row of result.translations) {
      if (!row || Object.keys(row).sort().join(',') !== 'sourceKey,translatedText' ||
          !sources.has(row.sourceKey) || translated.has(row.sourceKey) ||
          typeof row.translatedText !== 'string' || row.translatedText.length > 6000) invalid();
      translated.set(row.sourceKey, validateTranslation(sources.get(row.sourceKey).sourceTitle, row.translatedText));
    }
    return items.map(item => ({ sourceKey: item.sourceKey, translatedText: translated.get(item.sourceKey) }));
  }
  function createNavigationTitleBatches(targets) {
    // Translate specific Results headings first; retain hierarchy/document order
    // within each priority, without changing request sizes or source identities.
    const priority = target => target.resultsPriority === true ? 0 : 1;
    const ordered = [...targets].sort((a, b) => priority(a) - priority(b) ||
      (a.depth || 1) - (b.depth || 1)), batches = [];
    for (const target of ordered) {
      const previous = batches.at(-1), next = [...(previous || []), target];
      if (previous && priority(previous[0]) === priority(target) &&
          previous[0].depth === target.depth && next.length <= 12 &&
          next.every(item => item.sourceTitle.length <= 1800 && (item.parentTitle || '').length <= 1800) &&
          JSON.stringify(navigationTitleBatchItems(next)).length <= 6000) previous.push(target);
      else batches.push([target]);
    }
    return batches;
  }
  function createProvider(options = {}) {
    const pair = options.sourceLanguage === 'zh' && options.targetLanguage === 'en'
      ? Object.freeze({ sourceLanguage: 'zh', targetLanguage: 'en' }) : PAIR;
    const api = options.Translator ?? (typeof globalThis !== 'undefined' ? globalThis.Translator : undefined);
    const notify = typeof options.onState === 'function' ? options.onState : () => {};
    let session = null, initialization = null, lifecycle = null, generation = 0;
    const availabilityTasks = new Set();
    const cache = new Map(), nativeQueue = [];
    const clock = typeof options.now === 'function' ? options.now : () => Date.now();
    const bounded = (value, fallback, maximum) => Number.isFinite(value) && value >= 0 ? Math.min(Math.floor(value), maximum) : fallback;
    const cacheEntries = bounded(options.cacheEntries, 64, 128), cacheCharacters = bounded(options.cacheCharacters, 200000, 500000);
    const recoveryLimit = bounded(options.recoveryCalls, 12, 12);
    const recoveryTimeoutMs = bounded(options.recoveryTimeoutMs, 8000, 15000);
    const nativeTimeoutMs = bounded(options.nativeTimeoutMs, 15000, 30000);
    const queueTimeoutMs = bounded(options.queueTimeoutMs, 15000, 30000);
    const capabilityTimeoutMs = bounded(options.capabilityTimeoutMs, 10000, 30000);
    // Allow slow first downloads: two minutes without advancing progress and
    // ten minutes overall. Progress cannot extend the absolute bound forever.
    const initializationTimeoutMs = bounded(options.initializationTimeoutMs, 120000, 300000);
    const initializationMaxMs = bounded(options.initializationMaxMs, 600000, 900000);
    const initializationRetryDelays = Array.isArray(options.initializationRetryDelays)
      ? options.initializationRetryDelays.slice(0, 2).map(value => bounded(value, 1000, 10000)) : [1000, 3000];
    let sessionFault = null, capabilitySequence = 0;
    let cacheSize = 0, nativeRunning = null, nativeSequence = 0, lastTranslation = null;
    let state = { phase: 'idle', availability: null, progress: null, error: null, diagnostic: null };
    function publish(update) { state = { ...state, ...update }; notify({ ...state }); }
    function createNativeSession(createOptions) {
      let retries = 0;
      const attempt = () => {
        if (createOptions.signal.aborted) return Promise.reject(abortError());
        let result;
        // The first call must remain synchronous inside the real user gesture.
        try { result = api.create(createOptions); } catch (error) { result = Promise.reject(error); }
        return Promise.resolve(result).catch(async error => {
          const classified = classify(error, 'initialize');
          // A real click still gets one create() attempt after a negative probe.
          // Retrying the same unsupported pair cannot start a model download.
          if (error?.name === 'NotSupportedError' && state.availability === 'unavailable') throw classified;
          const recoverable = ['MODEL_NOT_READY', 'NATIVE_UNAVAILABLE'].includes(classified.code) ||
            (classified.code === 'INITIALIZATION_FAILED' && ['InvalidStateError', 'NotReadableError', 'OperationError', 'UnknownError'].includes(error?.name));
          if (!recoverable || retries >= initializationRetryDelays.length || createOptions.signal.aborted) throw classified;
          const delay = initializationRetryDelays[retries++];
          publish({ phase: 'initializing', error: null, diagnostic: nativeDiagnostic(classified, 'initialize') });
          await new Promise((resolve, reject) => {
            const signal = createOptions.signal;
            const done = () => { signal.removeEventListener('abort', cancel); resolve(); };
            const timer = setTimeout(done, delay);
            const cancel = () => { clearTimeout(timer); signal.removeEventListener('abort', cancel); reject(abortError()); };
            signal.addEventListener('abort', cancel, { once: true }); if (signal.aborted) cancel();
          });
          return attempt();
        });
      };
      return attempt();
    }
    async function availability({ signal, fromInitialization = false } = {}) {
      if (signal?.aborted) throw abortError();
      const environment = nativeEnvironmentFailure();
      if (environment) {
        publish({ phase: 'unavailable', availability: 'unavailable', error: environment.code, diagnostic: nativeDiagnostic(environment, 'capability') });
        return 'unavailable';
      }
      if (session && !sessionFault && !nativeRunning?.signal.aborted) {
        publish({ phase: 'ready', availability: 'available', error: null, diagnostic: null }); return 'available';
      }
      if (!api || typeof api.availability !== 'function' || typeof api.create !== 'function') {
        publish({ phase: 'unavailable', availability: 'unavailable', error: 'API_UNAVAILABLE', diagnostic: nativeDiagnostic(failure('API_UNAVAILABLE', 'The Translator API is not exposed in this page context.'), 'capability') });
        return 'unavailable';
      }
      const epoch = generation, controller = new AbortController(), sequence = ++capabilitySequence;
      let capabilityTimer;
      const cancel = () => controller.abort();
      availabilityTasks.add(controller);
      signal?.addEventListener('abort', cancel, { once: true });
      try {
        const readySession = !fromInitialization && initialization && ['initializing', 'downloading'].includes(state.phase)
          ? [initialization.promise.then(() => 'available')] : [];
        const value = await abortable(Promise.race([api.availability(pair), ...readySession, new Promise((_, reject) => {
          capabilityTimer = setTimeout(() => reject(failure('CAPABILITY_TIMEOUT', 'The browser capability check did not finish within its time limit.')), capabilityTimeoutMs);
        })]), controller.signal);
        if (epoch !== generation || controller.signal.aborted) throw abortError();
        if (!['available', 'downloadable', 'downloading', 'unavailable'].includes(value)) throw failure('API_UNAVAILABLE', 'Unexpected browser translation availability.');
        if (session && !sessionFault && !nativeRunning?.signal.aborted) {
          publish({ phase: 'ready', availability: 'available', error: null, diagnostic: null }); return 'available';
        }
        if (value === 'unavailable' && !fromInitialization && initialization && ['initializing', 'downloading'].includes(state.phase)) {
          clearTimeout(capabilityTimer);
          await waitForInitialization(initialization, signal);
          return 'available';
        }
        if (sequence !== capabilitySequence && state.availability !== null) return state.availability;
        const recentFailure = value === 'unavailable' && state.diagnostic?.stage === 'initialize' ? state.diagnostic : null;
        publish({ availability: value, error: value === 'unavailable' ? recentFailure?.code || 'NATIVE_UNAVAILABLE' : null,
          diagnostic: value === 'unavailable' ? recentFailure || nativeDiagnostic(failure('NATIVE_UNAVAILABLE', 'The browser reports its local translation capability unavailable; this does not identify a language-support failure.'), 'capability') : null });
        return value;
      } catch (error) {
        const classified = classify(error, 'initialize');
        if (epoch === generation && !controller.signal.aborted && session && !sessionFault && !nativeRunning?.signal.aborted) {
          publish({ phase: 'ready', availability: 'available', error: null, diagnostic: null }); return 'available';
        }
        if (epoch === generation && sequence === capabilitySequence && classified.code !== 'ABORTED') publish({ phase: 'error', error: classified.code, diagnostic: state.diagnostic?.code === classified.code ? state.diagnostic : nativeDiagnostic(classified, 'capability') });
        throw classified;
      } finally {
        clearTimeout(capabilityTimer);
        signal?.removeEventListener('abort', cancel);
        availabilityTasks.delete(controller);
      }
    }
    function waitForInitialization(task, signal) {
      return new Promise((resolve, reject) => {
        const waiter = {};
        let finished = false;
        task.waiters.add(waiter);
        const finish = (error, value) => {
          if (finished) return;
          finished = true;
          signal?.removeEventListener('abort', cancel);
          task.controller.signal.removeEventListener('abort', cancelShared);
          task.waiters.delete(waiter);
          if (error) reject(error); else resolve(value);
        };
        const cancel = () => {
          finish(abortError());
          // The native session belongs to all current consumers, not the
          // selection that happened to request it first.
          if (!task.settled && task.waiters.size === 0) {
            if (initialization === task) initialization = null;
            task.controller.abort();
          }
        };
        const cancelShared = () => finish(task.failure || abortError());
        signal?.addEventListener('abort', cancel, { once: true });
        task.controller.signal.addEventListener('abort', cancelShared, { once: true });
        if (task.controller.signal.aborted) cancelShared();
        else if (signal?.aborted) cancel();
        task.promise.then(value => finish(null, value), error => finish(error));
      });
    }
    function initialize({ signal } = {}) {
      if (signal?.aborted) return Promise.reject(abortError());
      // Cancellation or a timeout may leave abort-ignoring native work busy forever.
      // Retire that session on the next demand; preserve validated exact-text cache.
      const environment = nativeEnvironmentFailure();
      if (environment) { publish({ phase: 'unavailable', availability: 'unavailable', error: environment.code, diagnostic: nativeDiagnostic(environment, 'initialize') }); return Promise.reject(environment); }
      if (session && (nativeRunning?.signal.aborted || sessionFault)) {
        const previous = session; session = null; sessionFault = null;
        nativeRunning = null;
        for (const entry of nativeQueue.splice(0)) {
          entry.signal.removeEventListener('abort', entry.cancel);
          entry.reject(failure('TRANSLATION_FAILED', 'The stalled local session was retired; retry the unfinished text.'));
        }
        try { previous.destroy?.(); } catch { /* The browser may already have retired it. */ }
      }
      if (session) return Promise.resolve(session);
      if (initialization) return waitForInitialization(initialization, signal);
      const epoch = ++generation;
      const controller = new AbortController(); lifecycle = controller;
      let resolveTask, rejectTask;
      const task = { controller, waiters: new Set(), settled: false,
        promise: new Promise((resolve, reject) => { resolveTask = resolve; rejectTask = reject; }) };
      initialization = task;
      // Register the first consumer before invoking create(), while retaining
      // the original synchronous call stack required for user activation.
      const waiting = waitForInitialization(task, signal);
      const run = async () => {
        let monitoring = true, preparationTimer, preparationReject, preparationEnd = 0, observedProgress = -1;
        const armPreparationDeadline = () => {
          clearTimeout(preparationTimer);
          preparationTimer = setTimeout(() => preparationReject(failure('INITIALIZATION_TIMEOUT', 'The browser model preparation stopped making progress or exceeded its total time limit.')),
            Math.max(1, Math.min(initializationTimeoutMs, preparationEnd - clock())));
        };
        try {
          if (!api || typeof api.create !== 'function') throw failure('API_UNAVAILABLE', 'The official Translator API is not available in this context.');
          // A negative probe can change after browser resources or policy recover.
          // Recheck on explicit use; retain positive capability so create() still
          // runs synchronously inside the user's click when it was prewarmed.
          const ready = state.availability && state.availability !== 'unavailable'
            ? state.availability : globalThis.navigator?.userActivation?.isActive === true
              ? 'downloadable' : await availability({ signal: controller.signal, fromInitialization: true });
          if (ready === 'unavailable') throw failure(state.error || 'LANGUAGE_UNAVAILABLE', 'English to Chinese translation is not available.');
          if (controller.signal.aborted || epoch !== generation) throw abortError();
          // Availability can be masked as downloadable for a new site even
          // when the browser already has the language model cached.
          publish({ phase: 'initializing', progress: null, error: null, diagnostic: null });
          preparationEnd = clock() + initializationMaxMs;
          const preparationDeadline = new Promise((_, reject) => { preparationReject = reject; });
          armPreparationDeadline();
          const creation = createNativeSession({ ...pair, signal: controller.signal, monitor(monitor) {
            monitor.addEventListener('downloadprogress', event => {
              if (!monitoring || epoch !== generation || controller.signal.aborted) return;
              const loaded = Number(event.loaded), total = Number(event.total);
              const ratio = total > 0 ? loaded / total : loaded >= 0 && loaded <= 1 ? loaded : null;
              if (ratio === null || !Number.isFinite(ratio) || ratio < 0 || ratio > 1) return;
              // The API emits 0 and 1 even without a download. Intermediate
              // progress is browser-reported resource preparation, not proof
              // of network traffic; only create() resolving makes it ready.
              if (ratio > observedProgress) { observedProgress = ratio; armPreparationDeadline(); }
              publish({ phase: ratio > 0 && ratio < 1 ? 'downloading' : 'initializing', progress: ratio });
            });
          } });
          const created = await abortable(Promise.race([Promise.resolve(creation).then(value => {
            if (epoch !== generation || controller.signal.aborted) { value?.destroy?.(); throw abortError(); }
            return value;
          }), preparationDeadline]), controller.signal);
          if (epoch !== generation || controller.signal.aborted) { created?.destroy?.(); throw abortError(); }
          if (typeof created?.translate !== 'function') { created?.destroy?.(); throw failure('API_UNAVAILABLE', 'The browser did not return a Translator session.'); }
          session = created;
          task.settled = true;
          publish({ phase: 'ready', availability: 'available', progress: 1, error: null, diagnostic: null });
          return created;
        } catch (error) {
          const classified = classify(error, 'initialize');
          if (classified.code === 'INITIALIZATION_TIMEOUT') { task.failure = classified; controller.abort(); }
          if (epoch === generation) publish({ phase: classified.code === 'ABORTED' ? 'idle' : 'error', error: classified.code, diagnostic: nativeDiagnostic(classified, 'initialize') });
          throw classified;
        } finally {
          clearTimeout(preparationTimer);
          monitoring = false;
          task.settled = true;
        }
      };
      const clear = () => { if (initialization === task) initialization = null; };
      task.promise.then(clear, clear);
      run().then(resolveTask, rejectTask);
      return waiting;
    }
    function cached(text) {
      const value = cache.get(text);
      if (value === undefined) return null;
      cache.delete(text); cache.set(text, value);
      return value;
    }
    function remember(text, translatedText, sourceEnd = text.length, totalLength = text.length) {
      const size = text.length + translatedText.length;
      if (!cacheEntries || size > cacheCharacters) return;
      const previous = cache.get(text);
      if (previous && previous.sourceEnd > sourceEnd) return;
      if (previous) { cacheSize -= text.length + previous.translatedText.length; cache.delete(text); }
      cache.set(text, { translatedText, sourceEnd, complete: sourceEnd === totalLength }); cacheSize += size;
      while (cache.size > cacheEntries || cacheSize > cacheCharacters) {
        const oldest = cache.keys().next().value;
        cacheSize -= oldest.length + cache.get(oldest).translatedText.length; cache.delete(oldest);
      }
    }
    function drainNative() {
      if (nativeRunning || !nativeQueue.length) return;
      const rank = entry => {
        try { const value = entry.context.getPriority?.() ?? entry.context.priority; return Number.isFinite(value) ? value : 0; }
        catch { return 0; }
      };
      nativeQueue.sort((a, b) => rank(a) - rank(b) || a.sequence - b.sequence);
      const entry = nativeQueue.shift();
      entry.signal.removeEventListener('abort', entry.cancel);
      if (entry.signal.aborted || entry.context.epoch !== generation) { entry.reject(abortError()); drainNative(); return; }
      nativeRunning = entry;
      entry.context.stats.queueWaitMs += Math.max(0, clock() - entry.queuedAt);
      if (!entry.started()) { nativeRunning = null; drainNative(); return; }
      try { entry.context.onAttempt?.(entry.attemptInfo); }
      catch (error) { entry.reject(error); nativeRunning = null; drainNative(); return; }
      entry.context.stats.nativeCalls++;
      const startedAt = clock();
      let operation;
      try { operation = entry.context.current.translate(entry.text, { signal: entry.signal }); }
      catch (error) { operation = Promise.reject(error); }
      // Cancellation can finish the caller before a native implementation honors
      // its signal. Hold this session's gate until the actual promise settles.
      Promise.resolve(operation).then(value => {
        entry.context.stats.nativeMs += Math.max(0, clock() - startedAt); entry.resolve(value);
      }, error => {
        entry.context.stats.nativeMs += Math.max(0, clock() - startedAt);
        if (!entry.signal.aborted && entry.context.current === session &&
            ['InvalidStateError', 'NotReadableError', 'OperationError', 'UnknownError', 'NotSupportedError', 'AbortError'].includes(error?.name)) {
          sessionFault = nativeDiagnostic(classify(error, 'translate'), 'translate');
          if (error.name === 'AbortError') error = failure('TRANSLATION_FAILED', 'The native session aborted without a caller cancellation.', error);
        }
        entry.reject(error);
      }).finally(() => {
        if (nativeRunning === entry) { nativeRunning = null; drainNative(); }
      });
    }
    function nativeCall(text, context, timeout, reason, deadline = null, attemptInfo = {}) {
      return new Promise((resolve, reject) => {
        const controller = new AbortController();
        let timer, settled = false;
        const finish = (error, value) => {
          if (settled) return; settled = true;
          clearTimeout(timer); context.signal.removeEventListener('abort', cancel);
          if (error) reject(error); else resolve(value);
        };
        const cancel = () => { finish(abortError()); controller.abort(); };
        context.signal.addEventListener('abort', cancel, { once: true });
        if (context.signal.aborted) { cancel(); return; }
        const timedOut = (phase, timeoutReason) => {
          const error = failure('TRANSLATION_TIMEOUT', 'The browser translation exceeded its time limit.');
          error.translationDetails = { reason: timeoutReason, phase, attempt: reason === 'recovery-timeout' ? 'recovery' : 'initial' };
          if (phase === 'translating' && nativeRunning === entry) entry.timedOut = true;
          finish(error); controller.abort();
        };
        const entry = { text, context, attemptInfo, signal: controller.signal, sequence: ++nativeSequence,
          queuedAt: clock(), resolve: value => finish(null, value), reject: error => finish(error) };
        entry.started = () => {
          clearTimeout(timer);
          const remaining = deadline === null ? timeout : Math.min(timeout, deadline - clock());
          if (remaining <= 0) { timedOut('translating', reason); return false; }
          context.onStage?.('translating');
          timer = setTimeout(() => timedOut('translating', reason), Math.max(1, remaining));
          return true;
        };
        entry.cancel = () => {
          const index = nativeQueue.indexOf(entry);
          if (index !== -1) { nativeQueue.splice(index, 1); context.stats.queueWaitMs += Math.max(0, clock() - entry.queuedAt); }
          entry.reject(abortError());
        };
        controller.signal.addEventListener('abort', entry.cancel, { once: true });
        context.onStage?.('queued');
        const waiting = deadline === null ? queueTimeoutMs : Math.min(queueTimeoutMs, deadline - clock());
        timer = setTimeout(() => timedOut('queued', deadline !== null && deadline - clock() <= 0 ? 'recovery-timeout' : 'queue-timeout'), Math.max(1, waiting));
        nativeQueue.push(entry); drainNative();
      });
    }
    async function translate(text, { signal, priority = 0, getPriority, onProgress, onAttempt, foreground = false, resumeFrom, scientificContext: suppliedContext } = {}) {
      if (signal?.aborted) throw abortError();
      if (sessionFault || nativeRunning?.signal.aborted || (!session && initialization)) await initialize({ signal });
      const current = session, epoch = generation;
      if (!current) throw failure('NOT_INITIALIZED', 'Initialize the browser translation model first.');
      const source = String(text || ''), startedAt = clock();
      const scientificContext = scientificApi.normalizeScientificContext(source, suppliedContext);
      if (scientificContext.some(item => item.text.length > 1800 || item.displayText.length > 1800)) {
        throw failure('TOKEN_BUDGET_EXCEEDED', 'A complete scientific expression exceeds the native input bound.');
      }
      // Namespace both identities so a plain source containing literal JSON can
      // never collide with a scientific source. The cache remains memory-only.
      const cacheKey = scientificContext.length ? JSON.stringify([source, scientificContext]) : source;
      const cacheNamespace = scientificContext.length ? 'scientific\u0000' : 'plain\u0000';
      const key = cacheNamespace + cacheKey;
      let saved = cached(key);
      if ((!resumeFrom?.engineSignature || resumeFrom.engineSignature === `browser-translator:${pair.sourceLanguage}:${pair.targetLanguage}:validated-prefix-v2`) &&
          !resumeFrom?.manuallyEdited && JSON.stringify(resumeFrom?.scientificContext || []) === JSON.stringify(scientificContext) &&
          !scientificContext.some(item => item.sourceStart < resumeFrom?.sourceEnd && item.sourceEnd > resumeFrom?.sourceEnd) &&
          resumeFrom?.sourceText === source && resumeFrom.sourceStart === 0 &&
          Number.isInteger(resumeFrom.sourceEnd) && resumeFrom.sourceEnd > 0 && resumeFrom.sourceEnd <= source.length) {
        try {
          const translatedText = validateTranslation(source.slice(0, resumeFrom.sourceEnd), resumeFrom.translatedText);
          if (!saved || saved.sourceEnd < resumeFrom.sourceEnd) saved = { translatedText,
            sourceEnd: resumeFrom.sourceEnd, complete: resumeFrom.sourceEnd === source.length };
        } catch { /* Never reuse a damaged checkpoint. */ }
      }
      const job = new AbortController(), lifetime = lifecycle?.signal;
      const cancel = () => job.abort();
      signal?.addEventListener('abort', cancel, { once: true }); lifetime?.addEventListener('abort', cancel, { once: true });
      const stats = { nativeCalls: 0, recoveryCalls: 0, queueWaitMs: 0, nativeMs: 0, cacheHit: saved?.complete === true,
        reusedSourceCharacters: saved?.sourceEnd || 0, failures: [] };
      const context = { current, epoch, signal: job.signal, priority, getPriority, stats, onAttempt };
      const result = [], accepted = [];
      let sourceEnd = 0, recoveryStarted = null, outcome = 'complete', errorCode = '', errorDetails = null;
      const valid = () => { if (job.signal.aborted || epoch !== generation) throw abortError(); };
      function progress(extra = {}) {
        const value = { translatedText: accepted.join(' '), sourceStart: 0, sourceEnd, totalLength: source.length, complete: sourceEnd === source.length,
          ...(scientificContext.length ? {scientificContext, sourceText:source, engineSignature:`browser-translator:${pair.sourceLanguage}:${pair.targetLanguage}:validated-prefix-v2`} : {}), ...extra };
        try { onProgress?.({ ...value }); } catch { /* Display observers cannot break translation. */ }
        return value;
      }
      if (foreground) context.onStage = phase => {
        try { onProgress?.({ phase, translatedText: accepted.join(' '), sourceStart: 0, sourceEnd,
          totalLength: source.length, complete: false,
          ...(scientificContext.length ? {scientificContext, sourceText:source, engineSignature:`browser-translator:${pair.sourceLanguage}:${pair.targetLanguage}:validated-prefix-v2`} : {}) }); } catch { /* Optional observer. */ }
      };
      function details(error, chunk, start, index, attempt, translated) {
        error.translationDetails = { reason: error.code === 'EMPTY_TRANSLATION' ? 'empty-output' : 'damaged-markers',
          attempt, chunkIndex: index, sourceStart: start, sourceEnd: start + chunk.length,
          outputLength: typeof translated === 'string' ? translated.length : 0 };
        if (stats.failures.length < 16) stats.failures.push({ ...error.translationDetails });
        return error;
      }
      async function call(chunk, recovery, start, index, attempt, modelText = chunk) {
        valid();
        if (recovery && stats.recoveryCalls >= recoveryLimit) {
          const error = failure('INVALID_TRANSLATION', 'The local model could not recover this text within the bounded retry budget.');
          error.translationDetails = { reason: 'recovery-budget', attempt, chunkIndex: index, sourceStart: start, sourceEnd: start + chunk.length, outputLength: 0 };
          throw error;
        }
        const remaining = recovery ? recoveryTimeoutMs - (clock() - recoveryStarted) : nativeTimeoutMs;
        if (remaining <= 0) {
          const error = failure('TRANSLATION_TIMEOUT', 'The browser translation exceeded its time limit.');
          error.translationDetails = { reason: recovery ? 'recovery-timeout' : 'native-timeout', attempt, chunkIndex: index,
            sourceStart: start, sourceEnd: start + chunk.length, outputLength: 0 };
          throw error;
        }
        if (recovery) stats.recoveryCalls++;
        try { return await nativeCall(modelText, context, Math.min(nativeTimeoutMs, remaining), recovery ? 'recovery-timeout' : 'native-timeout',
          recovery ? recoveryStarted + recoveryTimeoutMs : null, { sourceStart: start, sourceEnd: start + chunk.length,
            recovery, engineSignature: `browser-translator:${pair.sourceLanguage}:${pair.targetLanguage}:validated-prefix-v2` }); }
        catch (error) {
          error.translationDetails = { reason: 'native-error', ...error.translationDetails, attempt,
            chunkIndex: index, sourceStart: start, sourceEnd: start + chunk.length, outputLength: 0 };
          throw error;
        }
      }
      async function runChunk(chunk, level, start, index) {
        const attempt = ['initial', 'recovery', 'fine-recovery', 'fine-recovery'][level];
        const projected = nativeScientificText(source, scientificContext, start, start + chunk.length);
        const translated = await call(chunk, level > 0, start, index, attempt, projected.text);
        valid();
        try {
          const value = validateTranslation(projected.text, translated);
          if (start === sourceEnd) { accepted.push(value); sourceEnd = start + chunk.length; progress(); }
          return value;
        } catch (error) {
          details(error, chunk, start, index, attempt, translated);
          if (recoveryStarted === null) recoveryStarted = clock();
          if (level >= 2 || chunk.length <= 80) {
            const numberMarkers = typeof translated === 'string' ? translated.match(/(?:<|&lt;)\/?(?:b\d{3,}|\d{3,}(?:>|&gt;))/giu) || [] : [];
            const leakedNumbers = error.code === 'INVALID_TRANSLATION' && numberMarkers.some(marker => !chunk.includes(marker));
            const replacement = leakedNumbers && !projected.spans.length ? expressCountRanges(chunk) : chunk;
            if (replacement !== chunk) {
              const retried = await call(chunk, true, start, index, 'numeric-range-recovery', replacement); valid();
              try {
                const value = validateTranslation(chunk, retried);
                if (start === sourceEnd) { accepted.push(value); sourceEnd = start + chunk.length; progress(); }
                return value;
              }
              catch (retryError) {
                throw details(retryError, chunk, start, index, 'numeric-range-recovery', retried);
              }
            }
            if (level !== 2 || !leakedNumbers || chunk.length <= 80 || chunk.length > 160) throw error;
          }
          // Try sentence-sized blocks first. Only the damaged block becomes
          // smaller; all levels share one call and time budget for this entry.
          const limit = level === 0 ? (chunk.length > 600 ? 600 : 160) : level === 1 ? 160 : 80;
          const pieceLimit = level === 0 && chunk.length > 600 ? limit : Math.min(limit, Math.ceil(chunk.length / 2));
          const pieces = scientificContext.length ? nativeScientificChunks(source, scientificContext, start, start + chunk.length, pieceLimit) : splitText(chunk, pieceLimit);
          if (pieces.length < 2) throw error;
          const recovered = [];
          let pieceStart = start;
          for (const piece of pieces) {
            recovered.push(await runChunk(piece, level === 0 && chunk.length <= 600 ? 2 : level + 1, pieceStart, index));
            pieceStart += piece.length;
          }
          return recovered.join(' ');
        }
      }
      try {
        valid();
        if (saved !== null) {
          accepted.push(saved.translatedText); result.push(saved.translatedText); sourceEnd = saved.sourceEnd;
          progress(saved.complete ? {} : { resumed: true });
          if (saved.complete) return saved.translatedText;
        }
        let sourceStart = sourceEnd;
        const chunks = scientificContext.length ? nativeScientificChunks(source, scientificContext, sourceStart, source.length, foreground ? 600 : 1800) : splitText(source.slice(sourceStart), foreground ? 600 : 1800);
        for (let index = 0; index < chunks.length; index += 1) {
          const chunk = chunks[index];
          result.push(await runChunk(chunk, 0, sourceStart, index));
          sourceStart += chunk.length;
        }
        const output = result.join(' '); valid(); remember(key, output, source.length, source.length); return output;
      } catch (error) {
        const classified = classify(error, 'translate');
        outcome = classified.code === 'ABORTED' ? 'cancelled' : 'failed'; errorCode = classified.code;
        if (epoch === generation && classified.code !== 'ABORTED') publish({ diagnostic: nativeDiagnostic(classified, 'translate') });
        if (classified.code !== 'ABORTED') {
          classified.translationDetails = { ...classified.translationDetails, nativeCalls: stats.nativeCalls, recoveryCalls: stats.recoveryCalls,
            elapsedMs: Math.max(0, clock() - startedAt), queueWaitMs: stats.queueWaitMs, failures: stats.failures.map(value => ({ ...value })) };
          if (sourceEnd > 0) classified.partialTranslation = { translatedText: accepted.join(' '), sourceStart: 0, sourceEnd, totalLength: source.length, complete: false,
            ...(scientificContext.length ? {scientificContext, sourceText:source, engineSignature:`browser-translator:${pair.sourceLanguage}:${pair.targetLanguage}:validated-prefix-v2`} : {}) };
          if (sourceEnd > 0 && sourceEnd < source.length && epoch === generation && !job.signal.aborted) remember(key, accepted.join(' '), sourceEnd, source.length);
          errorDetails = { ...classified.translationDetails, failures: classified.translationDetails.failures.map(value => ({ ...value })) };
        }
        throw classified;
      } finally {
        signal?.removeEventListener('abort', cancel); lifetime?.removeEventListener('abort', cancel);
        if (epoch === generation) lastTranslation = { ...stats, failures: stats.failures.map(value => ({ ...value })), sourceLength: source.length,
          translatedSourceEnd: sourceEnd, elapsedMs: Math.max(0, clock() - startedAt), outcome, errorCode, errorDetails };
      }
    }
    function destroy() {
      generation += 1; lifecycle?.abort(); lifecycle = null;
      for (const controller of availabilityTasks) controller.abort();
      availabilityTasks.clear();
      const previous = session; session = null; initialization = null;
      for (const entry of nativeQueue.splice(0)) { entry.signal.removeEventListener('abort', entry.cancel); entry.reject(abortError()); }
      nativeRunning = null; sessionFault = null; cache.clear(); cacheSize = 0; lastTranslation = null;
      try { previous?.destroy?.(); } catch { /* Already invalidated by the browser. */ }
      publish({ phase: 'idle', progress: null, error: null });
    }
    return { availability, initialize, translate, destroy, accountsAttempts: true, getState: () => ({ ...state, queued: nativeQueue.length,
      busy: Boolean(nativeRunning), cachedEntries: cache.size, lastTranslation: lastTranslation ? { ...lastTranslation,
        failures: lastTranslation.failures.map(value => ({ ...value })) } : null }) };
  }
  function createTaskProvider({ taskId, localProvider, bridge, captureIdentity = () => ({}),
    isCurrent = () => true, onState = () => {} } = {}) {
    if (!['full_text_translation', 'navigation_title_translation'].includes(taskId) ||
        !bridge?.getRoute || !bridge?.translate) throw new TypeError('A translation task bridge is required.');
    const LOCAL_SIGNATURE = 'browser-translator:en:zh:validated-prefix-v2';
    let route = null, generation = 0, initialized = false, nativeTail = Promise.resolve();
    let state = { phase: 'idle', availability: null, engineSignature: '', taskId };
    const tasks = new Set();
    const cancellations = new Map();
    const queryReceipts = typeof bridge.getReceipt === 'function';
    // Retained across stop/reinitialize: a lost reply never grants a fresh inference.
    const unresolved = new Set();
    const publish = patch => { state = { ...state, ...patch }; try { onState({ ...state, ...(route?.mode === 'local' ? localProvider?.getState?.() : {}), ...stopState() }); } catch {} };
    function valid(epoch, identity, signal) {
      if (epoch !== generation || signal?.aborted || !isCurrent(identity)) throw abortError();
    }
    async function availability({ signal } = {}) {
      const epoch = generation, identity = captureIdentity();
      valid(epoch, identity, signal);
      const saved = await abortable(bridge.getRoute(taskId, identity), signal);
      valid(epoch, identity, signal);
      if (saved?.taskId !== taskId || !['local', 'global', 'profile'].includes(saved.mode) ||
          (saved.mode === 'local' ? saved.engineSignature !== LOCAL_SIGNATURE : !/^sha256:[a-f0-9]{64}$/u.test(saved.engineSignature || ''))) {
        throw failure('TRANSLATION_ROUTE_INVALID', 'Translation route identity is unavailable.');
      }
      if (route?.engineSignature !== saved.engineSignature) initialized = false;
      route = { ...saved };
      const value = saved.mode === 'local' ? await localProvider?.availability({ signal }) : 'available';
      valid(epoch, identity, signal);
      publish({ phase: 'available', availability: value || 'unavailable', mode: route.mode, engineSignature: route.engineSignature });
      return value || 'unavailable';
    }
    function initialize({ signal } = {}) {
      if (!route) return availability({ signal }).then(() => initialize({ signal }));
      if (signal?.aborted) return Promise.reject(abortError());
      const epoch = generation, identity = captureIdentity();
      // A primed local route invokes native initialize synchronously in the click.
      const operation = route.mode === 'local' ? localProvider?.initialize({ signal }) : Promise.resolve();
      return Promise.resolve(operation).then(() => {
        valid(epoch, identity, signal); initialized = true;
        publish({ phase: 'ready', error: null });
      });
    }
    async function translate(text, { signal, onProgress, resumeFrom, sourceKey, navigationBatch, scientificContext: suppliedContext, ...options } = {}) {
      if (!initialized || !route) throw failure('NOT_INITIALIZED', 'Initialize the selected translation engine first.');
      const source = String(text || ''), epoch = generation, identity = captureIdentity(), signature = route.engineSignature;
      const scientificContext = scientificApi.normalizeScientificContext(source, suppliedContext);
      if (scientificContext.length && taskId !== 'full_text_translation') throw failure('TRANSLATION_INVALID_REQUEST', 'Scientific spans require a paragraph source.');
      if (route.mode === 'local') return localProvider.translate(text, { signal, onProgress, resumeFrom, scientificContext, ...options });
      if (typeof sourceKey !== 'string' || !sourceKey) throw failure('TRANSLATION_SOURCE_KEY_REQUIRED', 'A stable paragraph or section anchor is required.');
      if (navigationBatch !== undefined && (navigationBatch !== true || taskId !== 'navigation_title_translation')) {
        throw failure('TRANSLATION_INVALID_REQUEST', 'Only navigation titles support batches.');
      }
      if (navigationBatch) parseNavigationTitleBatch(source);
      const job = new AbortController(), cancel = () => job.abort();
      signal?.addEventListener('abort', cancel, { once: true }); tasks.add(job);
      let sourceEnd = 0, accepted = [], requests = 0, usage = [];
      const progress = () => {
        const value = { translatedText: accepted.join(' '), sourceText: source, sourceStart: 0, sourceEnd,
          totalLength: source.length, complete: sourceEnd === source.length, engineSignature: signature, requests, usage: [...usage],
          ...(scientificContext.length ? {scientificContext} : {}) };
        try { onProgress?.(value); } catch {} return value;
      };
      try {
        valid(epoch, identity, signal);
        if (!source.trim()) throw failure('EMPTY_TRANSLATION', 'Source text is empty.');
        if (resumeFrom?.sourceText === source && JSON.stringify(resumeFrom.scientificContext || []) === JSON.stringify(scientificContext) &&
            !scientificContext.some(item => item.sourceStart < resumeFrom.sourceEnd && item.sourceEnd > resumeFrom.sourceEnd) &&
            resumeFrom.engineSignature === signature && resumeFrom.sourceStart === 0 &&
            Number.isInteger(resumeFrom.sourceEnd) && resumeFrom.sourceEnd > 0 && resumeFrom.sourceEnd <= source.length && !resumeFrom.manuallyEdited) {
          accepted.push(validateTranslation(source.slice(0, resumeFrom.sourceEnd), resumeFrom.translatedText));
          sourceEnd = resumeFrom.sourceEnd; progress();
        }
        for (const block of navigationBatch ? [{text:source, scientificContext:[]}] : scientificChunks(source, scientificContext, sourceEnd)) {
          const chunk = block.text;
          valid(epoch, identity, job.signal);
          const operationId = 'translation-' + (globalThis.crypto?.randomUUID?.() || Date.now().toString(36) + '-' + Math.random().toString(36).slice(2));
          const request = { type: 'LLM_TRANSLATE_TEXT', taskId, operationId, documentBinding: identity,
            expectedEngineSignature: signature, sourceKey, sourceText: chunk, sourceStart: sourceEnd,
            sourceEnd: sourceEnd + chunk.length, sourceLanguage: 'en', targetLanguage: 'zh',
            ...(navigationBatch ? { navigationBatch: true } : {}),
            ...(block.scientificContext.length ? {scientificContext:block.scientificContext} : {}) };
          const blockKey = JSON.stringify([identity.pageUrl, identity.documentHash || '', signature, sourceKey, sourceEnd, chunk,
            ...(block.scientificContext.length ? [block.scientificContext] : [])]);
          let dispatched = false;
          const run = async () => {
            valid(epoch, identity, job.signal);
            if (queryReceipts) {
              const { operationId: ignored, ...query } = request;
              const receipt = await abortable(bridge.getReceipt({ ...query, type: 'TRANSLATION_RECEIPT_GET' }), job.signal);
              valid(epoch, identity, job.signal);
              if (receipt?.status === 'success') return receipt.result;
              if (['pending', 'unknown'].includes(receipt?.status)) {
                unresolved.add(blockKey); throw failure('TRANSLATION_OUTCOME_UNKNOWN', 'Translation receipt is pending.');
              }
              if (!['missing', 'failed'].includes(receipt?.status) || (receipt.status === 'missing' && unresolved.has(blockKey))) {
                throw failure('TRANSLATION_OUTCOME_UNKNOWN', 'Translation receipt is unavailable.');
              }
              if (receipt.status === 'failed') unresolved.delete(blockKey);
            } else if (unresolved.has(blockKey)) throw failure('TRANSLATION_OUTCOME_UNKNOWN', 'Translation receipt is unavailable.');
            valid(epoch, identity, job.signal);
            options.onAttempt?.({ sourceStart: request.sourceStart, sourceEnd: request.sourceEnd, engineSignature: signature });
            requests++; dispatched = true;
            try { return await bridge.translate(request, { signal: job.signal }); }
            catch (error) {
              if (job.signal.aborted || error?.code === 'TRANSLATION_OUTCOME_UNKNOWN') unresolved.add(blockKey);
              throw error;
            }
          };
          const operation = nativeTail.then(run, run); nativeTail = operation.catch(() => {});
          const cancelled = () => {
            if (!dispatched) {
              if (unresolved.has(blockKey)) cancellations.set(operationId, { status: 'unknown', blockKey, request });
              publish({}); return;
            }
            unresolved.add(blockKey);
            const pending = { status: 'pending', blockKey, request };
            cancellations.set(operationId, pending);
            const stopped = status => { if (cancellations.get(operationId) === pending) pending.status = status; publish({}); };
            publish({});
            try {
              Promise.resolve(bridge.cancel?.(operationId, identity, taskId)).then(result => {
                stopped(result?.cancelled === true && result.code !== 'TRANSLATION_OUTCOME_UNKNOWN' ? 'confirmed' : 'unknown');
              }, () => stopped('unknown'));
            } catch { stopped('unknown'); }
          };
          job.signal.addEventListener('abort', cancelled, { once: true });
          let result;
          try { result = await abortable(operation, job.signal); }
          finally { job.signal.removeEventListener('abort', cancelled); }
          valid(epoch, identity, job.signal);
          if (route?.engineSignature !== signature || result?.engineSignature !== signature || result.confirmed !== true ||
              result.sourceStart !== request.sourceStart || result.sourceEnd !== request.sourceEnd) {
            unresolved.add(blockKey);
            throw failure('TRANSLATION_RESPONSE_IDENTITY_MISMATCH', 'The translation response no longer matches this source or configuration.');
          }
          const translated = navigationBatch ? JSON.stringify({ translations: validateNavigationTitleTranslations(
            parseNavigationTitleBatch(chunk), JSON.parse(result.translatedText)) }) : validateTranslation(chunk, result.translatedText);
          unresolved.delete(blockKey);
          for (const [id, value] of cancellations) if (value.blockKey === blockKey) cancellations.delete(id);
          accepted.push(translated); sourceEnd = request.sourceEnd;
          if (result.usage) usage.push(result.usage);
          progress();
        }
        return accepted.join(' ');
      } catch (error) {
        if (sourceEnd > 0 && error?.code !== 'ABORTED' && epoch === generation && !job.signal.aborted && isCurrent(identity)) {
          error.partialTranslation = { ...progress(), complete: false };
        }
        throw error;
      } finally { signal?.removeEventListener('abort', cancel); tasks.delete(job); }
    }
    async function translateTitles(targets, { signal } = {}) {
      const items = navigationTitleBatchItems(targets), sourceText = JSON.stringify(items);
      parseNavigationTitleBatch(sourceText);
      if (route?.mode === 'local') {
        const translations = [];
        for (const item of items) translations.push({ sourceKey: item.sourceKey,
          translatedText: await translate(item.sourceTitle, { signal, sourceKey: item.sourceKey }) });
        return translations;
      }
      const result = await translate(sourceText, { signal, sourceKey: items[0].sourceKey, navigationBatch: true });
      return validateNavigationTitleTranslations(items, JSON.parse(result));
    }
    function destroy() {
      generation++; initialized = false; route = null;
      for (const job of tasks) job.abort(); tasks.clear(); localProvider?.destroy?.();
      publish({ phase: 'idle', engineSignature: '', availability: null });
    }
    function stopState() {
      const current = [...cancellations.values()].filter(value => isCurrent(value.request.documentBinding));
      return { stopPending: current.filter(value => value.status === 'pending').length,
        stopUnknown: current.filter(value => value.status === 'unknown').length };
    }
    let confirmation = null;
    function confirmStopped() {
      if (confirmation) return confirmation;
      const run = async () => {
        if (!queryReceipts) return stopState();
        for (const [id, value] of [...cancellations]) {
          if (!['pending', 'unknown'].includes(value.status) || !isCurrent(value.request.documentBinding)) continue;
          const { operationId: ignored, ...request } = value.request;
          try {
            const receipt = await bridge.getReceipt({ ...request, type: 'TRANSLATION_RECEIPT_GET' });
            if (!isCurrent(request.documentBinding) || cancellations.get(id) !== value) continue;
            if (receipt?.status === 'success') {
              const result = receipt.result;
              if (result?.confirmed !== true || result.engineSignature !== request.expectedEngineSignature ||
                  result.sourceStart !== request.sourceStart || result.sourceEnd !== request.sourceEnd) continue;
              validateTranslation(request.sourceText, result.translatedText);
              cancellations.delete(id);
            } else if (receipt?.status === 'failed') cancellations.delete(id);
          } catch { /* No receipt acknowledgment is not a confirmed stop. */ }
        }
        publish({}); return stopState();
      };
      confirmation = run().finally(() => { confirmation = null; });
      return confirmation;
    }
    // getState supplies current cancellation acknowledgments even after route retirement.
    return { availability, initialize, translate, translateTitles, destroy, invalidate: destroy, confirmStopped, accountsAttempts: true, canQueryReceipt: queryReceipts,
      getState: () => ({ ...state, ...(route?.mode === 'local' ? localProvider?.getState?.() : {}), ...stopState() }) };
  }
  function createRuntimeBridge({ runtime, taskId = 'full_text_translation' } = {}) {
    if (!runtime?.sendMessage) return null;
    if (!['full_text_translation', 'navigation_title_translation'].includes(taskId)) throw new TypeError('A valid translation task is required.');
    async function request(message) {
      const response = await runtime.sendMessage(message);
      if (response?.success !== true) throw failure(response?.error?.code || 'TRANSLATION_BRIDGE_UNAVAILABLE',
        response?.error?.message || 'The translation background service is unavailable.');
      return response.data;
    }
    return {
      getRoute: (taskId, documentBinding) => request({ type: 'TRANSLATION_TASK_ROUTE_GET', taskId, documentBinding }),
      translate: message => request(message),
      getReceipt: message => request({ ...message, type: 'TRANSLATION_RECEIPT_GET' }),
      cancel: (operationId, documentBinding, cancelTaskId = taskId) => {
        if (!['full_text_translation', 'navigation_title_translation'].includes(cancelTaskId)) return Promise.reject(failure('TRANSLATION_ROUTE_INVALID', 'Invalid translation cancellation task.'));
        return request({ type: 'LLM_CONTROL_OPERATION', taskId: cancelTaskId, operationId, command: 'cancel', documentBinding });
      },
      readCheckpoint: (documentBinding, engineSignature) => request({ type: 'TRANSLATION_CHECKPOINT_READ', taskId, documentBinding, engineSignature }),
      writeCheckpoint: (documentBinding, engineSignature, translations, options) => request({ type: 'TRANSLATION_CHECKPOINT_WRITE', taskId,
        documentBinding, engineSignature, translations, expectedRevision: options?.expectedRevision })
    };
  }
  return { createProvider, createTaskProvider, createRuntimeBridge, splitText, validateTranslation,
    navigationTitleBatchItems, parseNavigationTitleBatch, validateNavigationTitleTranslations, createNavigationTitleBatches };
});
