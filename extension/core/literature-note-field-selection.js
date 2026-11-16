(function attach(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory() {
  const MIN_ACTIVATION_DELAY_MS = 250;
  const MAX_ACTIVATION_DELAY_MS = 300;
  const DEFAULT_ACTIVATION_DELAY_MS = 280;

  function createLiteratureNoteFieldSelectionStore() {
    const selections = new Map();
    const keyFor = (scopeKey, fieldId) =>
      `${String(scopeKey || '').slice(0, 1200)}\u0000${String(fieldId || '').slice(0, 160)}`;

    function isSelected(scopeKey, fieldId) {
      return !selections.has(keyFor(scopeKey, fieldId));
    }

    function setSelected(scopeKey, fieldId, selected) {
      const key = keyFor(scopeKey, fieldId);
      if (selected === true) selections.delete(key);
      else selections.set(key, false);
      return isSelected(scopeKey, fieldId);
    }

    function toggle(scopeKey, fieldId) {
      return setSelected(scopeKey, fieldId, !isSelected(scopeKey, fieldId));
    }

    function selectedFieldIds(scopeKey, fields) {
      return (Array.isArray(fields) ? fields : [])
        .map(field => String(field?.id || ''))
        .filter(fieldId => fieldId && isSelected(scopeKey, fieldId));
    }

    return Object.freeze({ isSelected, setSelected, toggle, selectedFieldIds });
  }

  function createDelayedActivationController({
    target,
    delay = DEFAULT_ACTIVATION_DELAY_MS,
    onSingle,
    onDouble,
    schedule = setTimeout,
    cancelSchedule = clearTimeout
  } = {}) {
    if (!target?.addEventListener || typeof onSingle !== 'function' ||
        typeof onDouble !== 'function') {
      throw new TypeError('createDelayedActivationController requires a target and handlers');
    }
    const requestedDelay = Number(delay);
    const activationDelay = Math.min(MAX_ACTIVATION_DELAY_MS, Math.max(
      MIN_ACTIVATION_DELAY_MS,
      Number.isFinite(requestedDelay) ? requestedDelay : DEFAULT_ACTIVATION_DELAY_MS
    ));
    let timer = null;
    let destroyed = false;

    function cancel() {
      if (timer === null) return;
      cancelSchedule(timer);
      timer = null;
    }

    function runSingle(event = null) {
      cancel();
      if (!destroyed) onSingle(event);
    }

    function queueSingle() {
      cancel();
      timer = schedule(() => {
        timer = null;
        if (!destroyed) onSingle();
      }, activationDelay);
    }

    function runDouble(event) {
      event?.preventDefault?.();
      event?.stopPropagation?.();
      cancel();
      if (!destroyed) onDouble(event);
    }

    function handleClick(event) {
      if (destroyed || target.disabled) return;
      // Keyboard/programmatic activation has no pointer click count and should
      // retain the immediate navigation behavior expected by tab controls.
      if (event.detail === 0) {
        event.preventDefault?.();
        runSingle();
        return;
      }
      if (event.detail > 1) {
        cancel();
        return;
      }
      queueSingle();
    }

    function handleDoubleClick(event) {
      if (target.disabled) return;
      runDouble(event);
    }

    function handleKeyDown(event) {
      if (destroyed || target.disabled || event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.repeat) {
        event.preventDefault?.();
        return;
      }
      if (event.key === 'Enter' && event.shiftKey) {
        runDouble(event);
        return;
      }
      if ((event.key === 'Enter' || event.key === ' ') && !event.shiftKey) {
        event.preventDefault?.();
        event.stopPropagation?.();
        runSingle();
      }
    }

    target.addEventListener('click', handleClick);
    target.addEventListener('dblclick', handleDoubleClick);
    target.addEventListener('keydown', handleKeyDown);

    return Object.freeze({
      cancel,
      destroy() {
        if (destroyed) return;
        destroyed = true;
        cancel();
        target.removeEventListener?.('click', handleClick);
        target.removeEventListener?.('dblclick', handleDoubleClick);
        target.removeEventListener?.('keydown', handleKeyDown);
      },
      get pending() {
        return timer !== null;
      },
      delay: activationDelay
    });
  }

  return Object.freeze({
    MIN_ACTIVATION_DELAY_MS,
    MAX_ACTIVATION_DELAY_MS,
    DEFAULT_ACTIVATION_DELAY_MS,
    createLiteratureNoteFieldSelectionStore,
    createDelayedActivationController
  });
});
