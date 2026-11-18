(function attach(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory() {
  const INITIAL_FIGURE_CONCURRENCY = 2;
  const MAX_FIGURE_CONCURRENCY = 4;
  const IDLE_RESET_MS = 60000;
  const DEFAULT_ORIGINS = {
    deepseek: 'https://api.deepseek.com', openai: 'https://api.openai.com',
    anthropic: 'https://api.anthropic.com', gemini: 'https://generativelanguage.googleapis.com'
  };

  // Profiles and models on the same HTTP origin can share a provider quota.
  // Store only the origin, without URL paths, credentials or model inputs.
  function figureConnection(route) {
    const provider = route.providerId;
    if (provider === 'codex-local' || provider === 'deepseek-harness') {
      return { key: provider, max: INITIAL_FIGURE_CONCURRENCY };
    }
    let endpoint;
    try { endpoint = new URL(route.config?.baseUrl || DEFAULT_ORIGINS[provider]); } catch { /* Custom endpoint without a usable origin. */ }
    const host = endpoint?.hostname || '';
    const remote = endpoint?.protocol === 'https:' && host !== 'localhost' &&
      !host.endsWith('.localhost') && host !== '[::1]' && !/^127\./u.test(host);
    return { key: endpoint?.origin || provider, max: remote ? MAX_FIGURE_CONCURRENCY : INITIAL_FIGURE_CONCURRENCY };
  }

  function createFigureDispatchScheduler({ now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
    const lanes = new Map();
    function laneFor(route) {
      const time = now();
      for (const [key, entry] of lanes) {
        if (!entry.active && !entry.queue.length && time >= entry.until && time - entry.lastUsed >= IDLE_RESET_MS) lanes.delete(key);
      }
      const { key, max } = figureConnection(route);
      if (!lanes.has(key)) lanes.set(key, { max, limit: INITIAL_FIGURE_CONCURRENCY, active: 0, healthy: 0,
        generation: 0, congestionEpoch: 0, saturationCount: 0, until: 0, lastUsed: time, timer: null, queue: [] });
      return lanes.get(key);
    }

    function drain(lane) {
      if (lane.timer !== null) { clearTimer(lane.timer); lane.timer = null; }
      if (!lane.queue.length) return;
      const delay = lane.until - now();
      if (delay > 0) {
        lane.timer = setTimer(() => { lane.timer = null; drain(lane); }, delay);
        return;
      }
      while (lane.queue.length && lane.active < lane.limit) {
        const entry = lane.queue.shift();
        entry.signal?.removeEventListener('abort', entry.abort);
        lane.active++;
        const startedAtCapacity = lane.active === lane.limit;
        if (startedAtCapacity) lane.saturationCount++;
        const saturationCount = lane.saturationCount;
        const generation = lane.generation;
        const congestionEpoch = lane.congestionEpoch;
        let released = false;
        // Transport settlement frees the slot. Only the caller that validated
        // the completed Figure may use the returned sample to raise the limit.
        entry.resolve((outcome) => {
          if (released) return;
          released = true;
          lane.active--;
          lane.lastUsed = now();
          const status = Number(outcome?.status);
          const pressure = status === 429 || status === 408 || (status >= 500 && status < 600) ||
            ['RATE_LIMITED', 'REQUEST_TIMEOUT', 'NETWORK_ERROR', 'PROVIDER_UNAVAILABLE'].includes(outcome?.code);
          if (pressure) {
            const retryAfter = Number(outcome.retryAfterMs) || 0;
            lane.until = Math.max(lane.until, lane.lastUsed + Math.max(1500, retryAfter));
            // Simultaneous failures at the old width belong to the same burst.
            if (congestionEpoch === lane.congestionEpoch) {
              lane.limit = Math.max(1, Math.floor(lane.limit / 2));
              lane.generation++;
              lane.congestionEpoch++;
              lane.healthy = 0;
            }
          }
          const overlapped = startedAtCapacity || saturationCount !== lane.saturationCount;
          drain(lane);
          if (!overlapped || pressure || !outcome ||
              (outcome !== true && !['INVALID_RESPONSE', 'OUTPUT_TRUNCATED'].includes(outcome.code))) return;
          let credited = false;
          return () => {
            if (credited || generation !== lane.generation || lane.limit >= lane.max || now() < lane.until) return;
            credited = true;
            if (++lane.healthy >= Math.max(2, lane.limit)) {
              lane.limit++;
              lane.generation++;
              lane.healthy = 0;
              drain(lane);
            }
          };
        });
      }
    }

    return {
      limit(route) { return laneFor(route).limit; },
      acquire(route, signal) {
        const lane = laneFor(route);
        return new Promise((resolve, reject) => {
          const entry = { resolve, signal, abort() {
            const index = lane.queue.indexOf(entry);
            if (index >= 0) lane.queue.splice(index, 1);
            reject(Object.assign(new Error('Figure request cancelled'), { code: 'CANCELLED' }));
            drain(lane);
          } };
          if (signal?.aborted) { entry.abort(); return; }
          signal?.addEventListener('abort', entry.abort, { once: true });
          lane.queue.push(entry);
          drain(lane);
        });
      }
    };
  }

  // Admit more images for preparation only after a completed Figure reports
  // the background's current limit. Join started work before releasing ownership.
  async function runFigureBatchQueue(count, max, run, initialStaggerMs = 250) {
    if (count === 0) return;
    if (!Number.isSafeInteger(count) || count < 0 || !Number.isSafeInteger(max) || max < 1) throw new RangeError('Invalid Figure queue bounds');
    const capacity = Math.min(count, max, MAX_FIGURE_CONCURRENCY);
    let width = Math.min(capacity, INITIAL_FIGURE_CONCURRENCY);
    let next = 0, failure = null;
    const active = new Set();
    while ((!failure && next < count) || active.size) {
      while (!failure && next < count && active.size < width) {
        const index = next++;
        const task = Promise.resolve().then(async () => {
          if (index === 1 && capacity > 1 && initialStaggerMs) await new Promise(resolve => setTimeout(resolve, initialStaggerMs));
          if (failure) return;
          const feedback = await run(index);
          if (Number.isInteger(feedback) && feedback > 0) width = Math.min(capacity, feedback);
        }).catch(error => { failure ||= { error }; }).finally(() => active.delete(task));
        active.add(task);
      }
      if (active.size) await Promise.race(active);
    }
    if (failure) throw failure.error;
  }

  return { MAX_FIGURE_CONCURRENCY, createFigureDispatchScheduler, runFigureBatchQueue };
});
