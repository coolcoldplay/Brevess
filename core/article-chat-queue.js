/*
 * Adapted from llm-for-zotero 3.8.27 at commit
 * f8dbbd863b021368c07efe0f61c67f3503d79bc9 (AGPL-3.0-or-later).
 * See THIRD_PARTY_NOTICES.md for provenance and modifications.
 */
(function attach(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory() {
  function createArticleChatQueue(options = {}) {
    const createAbortController = options.createAbortController || (() => new AbortController());
    let sequence = 0;
    let pending = [];
    let activeState = null;

    function enqueue(input = {}) {
      const question = String(input.question || '').trim();
      const profileId = String(input.profileId || '').trim();
      if (!question) throw new TypeError('A non-empty question is required');
      if (!profileId) throw new TypeError('A model profile is required');
      const entry = Object.freeze({
        id: ++sequence,
        question,
        profileId,
        metadata: input.metadata == null
          ? null
          : Object.freeze({ ...input.metadata })
      });
      pending = [...pending, entry];
      return entry;
    }

    function remove(id) {
      const next = pending.filter(entry => entry.id !== id);
      if (next.length === pending.length) return false;
      pending = next;
      return true;
    }

    function startNext() {
      if (activeState || !pending.length) return null;
      const [entry, ...rest] = pending;
      pending = rest;
      const controller = createAbortController();
      const active = Object.freeze({ ...entry, signal: controller.signal });
      activeState = { active, controller };
      return active;
    }

    function completeActive(id) {
      if (!activeState || (id != null && activeState.active.id !== id)) return false;
      activeState = null;
      return true;
    }

    function cancelActive(reason = 'cancelled') {
      if (!activeState) return false;
      const current = activeState;
      activeState = null;
      current.controller.abort(reason);
      return true;
    }

    function getPending() {
      return pending.slice();
    }

    function getActive() {
      return activeState?.active || null;
    }

    function clearPending() {
      const count = pending.length;
      pending = [];
      return count;
    }

    return {
      enqueue,
      remove,
      startNext,
      completeActive,
      cancelActive,
      getPending,
      getActive,
      clearPending
    };
  }

  return { createArticleChatQueue };
});
