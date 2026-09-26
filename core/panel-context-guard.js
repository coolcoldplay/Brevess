(function attach(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory() {
  function capturePanelContext(activeContext = {}, taskToken = 0) {
    return Object.freeze({
      tabId: Number(activeContext?.tabId),
      key: String(activeContext?.key || ''),
      tabContextSequence: Number(activeContext?.tabContextSequence) || 0,
      taskToken: Number(taskToken) || 0
    });
  }

  function isCurrentPanelContext(activeContext = {}, capturedContext = {}, taskToken) {
    if (!capturedContext?.key || !Number.isInteger(capturedContext?.tabId)) return false;
    if (activeContext?.activated !== true) return false;
    if (Number(activeContext?.tabId) !== Number(capturedContext.tabId)) return false;
    if (String(activeContext?.key || '') !== String(capturedContext.key || '')) return false;
    if (Number(activeContext?.tabContextSequence) !==
        Number(capturedContext.tabContextSequence)) return false;
    return taskToken === undefined || Number(taskToken) === Number(capturedContext.taskToken);
  }

  function guardPanelMutation(isCurrent, mutation) {
    return value => {
      if (!isCurrent?.()) return false;
      mutation?.(value);
      return true;
    };
  }

  return {
    capturePanelContext,
    isCurrentPanelContext,
    guardPanelMutation
  };
});
