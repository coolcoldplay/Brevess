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
  const DEFAULT_MIN_BOUNDARY_CHARS = 180;
  const DEFAULT_TARGET_CHARS = 360;
  const DEFAULT_HARD_CAP_CHARS = 800;
  const DEFAULT_MAX_WAIT_MS = 450;

  function scanMarkdown(text) {
    let lineStart = 0;
    let fenceMarker = '';
    let lastBoundary = 0;
    for (let index = 0; index < text.length; index += 1) {
      if (text[index] !== '\n') continue;
      const line = text.slice(lineStart, index).replace(/\r$/, '');
      const fence = line.match(/^\s{0,3}(```+|~~~+)/);
      if (fence) {
        const marker = fence[1][0];
        if (!fenceMarker) fenceMarker = marker;
        else if (fenceMarker === marker) fenceMarker = '';
      } else if (!fenceMarker && /^\s*$/.test(line)) {
        lastBoundary = index + 1;
      }
      lineStart = index + 1;
    }
    return { lastBoundary, fenceOpen: Boolean(fenceMarker) };
  }

  function hasIncompleteTable(text) {
    const lines = text.trimEnd().split(/\r?\n/);
    if (lines.length < 2) return false;
    const last = lines.at(-1).trim();
    const previous = lines.at(-2).trim();
    const tableLike = line => line.startsWith('|') || line.endsWith('|');
    const delimiterLike = line => /^\|?\s*:?-{2,}/.test(line);
    return tableLike(previous) && (delimiterLike(last) ? !/\|\s*$/.test(last) : false);
  }

  function canFinalizeMarkdown(text) {
    if (!text) return false;
    const scanned = scanMarkdown(text.endsWith('\n') ? text : `${text}\n`);
    return !scanned.fenceOpen && !hasIncompleteTable(text);
  }

  function createMarkdownBlockStreamCoalescer(options) {
    if (!options || typeof options.onBlock !== 'function') {
      throw new TypeError('onBlock callback is required');
    }
    const minBoundaryChars = options.minBoundaryChars ?? DEFAULT_MIN_BOUNDARY_CHARS;
    const targetChars = options.targetChars ?? DEFAULT_TARGET_CHARS;
    const hardCapChars = options.hardCapChars ?? DEFAULT_HARD_CAP_CHARS;
    const maxWaitMs = options.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
    const setTimerFn = options.setTimer || ((callback, delayMs) => setTimeout(callback, delayMs));
    const clearTimerFn = options.clearTimer || (timer => clearTimeout(timer));
    let pendingText = '';
    let fullText = '';
    let timer = null;
    let cancelled = false;

    function clearPendingTimer() {
      if (timer === null) return;
      clearTimerFn(timer);
      timer = null;
    }

    function emitPrefix(end, reason) {
      if (end <= 0) return false;
      const block = pendingText.slice(0, end);
      pendingText = pendingText.slice(end);
      clearPendingTimer();
      options.onBlock(block, reason);
      return true;
    }

    function flushComplete(reason) {
      if (!pendingText || cancelled) {
        clearPendingTimer();
        return false;
      }
      const { lastBoundary } = scanMarkdown(pendingText);
      const thresholdReached = lastBoundary >= minBoundaryChars ||
        pendingText.length >= targetChars || pendingText.length >= hardCapChars;
      return lastBoundary > 0 && thresholdReached
        ? emitPrefix(lastBoundary, reason)
        : false;
    }

    function scheduleTimer() {
      if (timer !== null || !pendingText || maxWaitMs <= 0) return;
      timer = setTimerFn(() => {
        timer = null;
        flushComplete('timer');
      }, maxWaitMs);
    }

    return {
      pushText(delta) {
        if (cancelled || !delta) return;
        pendingText += String(delta);
        fullText += String(delta);
        if (!flushComplete('boundary')) scheduleTimer();
      },

      flushNow(reason = 'event') {
        return flushComplete(reason);
      },

      finish() {
        if (cancelled || !pendingText) {
          clearPendingTimer();
          return false;
        }
        flushComplete('boundary');
        if (!pendingText || !canFinalizeMarkdown(pendingText)) {
          clearPendingTimer();
          return false;
        }
        return emitPrefix(pendingText.length, 'final');
      },

      cancel() {
        cancelled = true;
        pendingText = '';
        clearPendingTimer();
      },

      getFullText() {
        return fullText;
      },

      hasPending() {
        return Boolean(pendingText);
      }
    };
  }

  return {
    createMarkdownBlockStreamCoalescer,
    createBlockStreamCoalescer: createMarkdownBlockStreamCoalescer
  };
});
