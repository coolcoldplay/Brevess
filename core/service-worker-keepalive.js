(function attach(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory() {
  function keepAliveUntil(promise, chromeApi, options = {}) {
    const intervalMs = Number(options.intervalMs) || 25000;
    const setIntervalImpl = options.setIntervalImpl || setInterval;
    const clearIntervalImpl = options.clearIntervalImpl || clearInterval;
    const heartbeat = () => {
      try {
        const result = chromeApi?.runtime?.getPlatformInfo?.();
        return result?.catch ? result.catch(() => {}) : result;
      } catch {
        return undefined;
      }
    };
    const intervalId = setIntervalImpl(heartbeat, intervalMs);
    return Promise.resolve(promise).finally(() => clearIntervalImpl(intervalId));
  }

  return { keepAliveUntil };
});
