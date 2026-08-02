(function attach(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory() {
  const CONTENT_SCRIPT_FILES = [
    'core/category-store.js',
    'core/confidence-policy.js',
    'core/result-validator.js',
    'core/sentence-boundary.js',
    'core/publisher-adapters.js',
    'core/article-structure.js',
    'core/article-extractor.js',
    'core/article-chat-citations.js',
    'core/publisher-diagnostics.js',
    'core/highlight-distribution.js',
    'core/figure-extractor.js',
    'core/figure-viewer.js',
    'core/figure-analysis.js',
    'core/manual-annotations.js',
    'core/cache-planner.js',
    'core/review-outline.js',
    'core/privacy-sanitizer.js',
    'core/article-workspace.js',
    'core/article-archive.js',
    'core/export-bundle.js',
    'content.js'
  ];
  const CONTENT_STYLE_FILES = ['content.css'];
  const CONTENT_SCRIPT_REVISION =
    '1.0.0-build1-store-release';
  const FIGURE_EXTRACTOR_REVISION =
    '1.0.0-build1-store-release';
  const recoveryByTab = new Map();
  const CONTENT_INJECTION_CLAIM = 'sciLlmContentInjectionClaim';
  const CONTENT_INJECTION_READY = 'sciLlmContentInjectionReady';

  function isMissingReceiverError(error) {
    const message = String(error?.message || error || '');
    return /Could not establish connection|Receiving end does not exist/i.test(message);
  }

  async function inspectContentInjection(chromeApi, target, claim, forceClaim = false) {
    const results = await chromeApi.scripting.executeScript({
      target,
      func: (shouldClaim, claimKey, readyKey, expectedRevision, shouldForceClaim) => {
        const root = document.documentElement;
        if (!root) return 'waiting';
        if (!shouldClaim) {
          return root.dataset[readyKey] === expectedRevision ? 'ready' : 'waiting';
        }
        // ensureContentScript is reached only after a real message-receiver
        // failure. A DOM revision marker can outlive an invalidated extension
        // world after reload/update, so it must never suppress reinjection.
        delete root.dataset[readyKey];
        if (!shouldForceClaim && root.dataset[claimKey] === expectedRevision) {
          return 'waiting';
        }
        root.dataset[claimKey] = expectedRevision;
        return 'claimed';
      },
      args: [
        claim === true,
        CONTENT_INJECTION_CLAIM,
        CONTENT_INJECTION_READY,
        CONTENT_SCRIPT_REVISION,
        forceClaim === true
      ]
    });
    return results?.[0]?.result || (claim ? 'claimed' : 'waiting');
  }

  async function waitForContentInjection(chromeApi, target) {
    for (const delayMs of [0, 10, 25, 50, 100, 200, 400, 800]) {
      if (delayMs) await new Promise(resolve => setTimeout(resolve, delayMs));
      if (await inspectContentInjection(chromeApi, target, false) === 'ready') return;
    }
    throw new Error('CONTENT_SCRIPT_INJECTION_TIMEOUT');
  }

  async function setContentInjectionState(chromeApi, target, ready) {
    await chromeApi.scripting.executeScript({
      target,
      func: (isReady, claimKey, readyKey, expectedRevision) => {
        const root = document.documentElement;
        if (!root) return;
        if (isReady) {
          root.dataset[readyKey] = expectedRevision;
          delete root.dataset[claimKey];
        } else {
          delete root.dataset[claimKey];
          delete root.dataset[readyKey];
        }
      },
      args: [
        ready === true,
        CONTENT_INJECTION_CLAIM,
        CONTENT_INJECTION_READY,
        CONTENT_SCRIPT_REVISION
      ]
    });
  }

  function ensureContentScript(chromeApi, tabId) {
    const existing = recoveryByTab.get(tabId);
    if (existing) return existing;
    const target = { tabId };
    const recovery = (async () => {
      const state = await inspectContentInjection(chromeApi, target, true);
      if (state === 'ready') return;
      if (state === 'waiting') {
        try {
          await waitForContentInjection(chromeApi, target);
          return;
        } catch (error) {
          if (error?.message !== 'CONTENT_SCRIPT_INJECTION_TIMEOUT') throw error;
          const takeover = await inspectContentInjection(chromeApi, target, true, true);
          if (takeover !== 'claimed') throw error;
        }
      }
      try {
        await chromeApi.scripting.insertCSS({ target, files: CONTENT_STYLE_FILES });
        await chromeApi.scripting.executeScript({ target, files: CONTENT_SCRIPT_FILES });
        await setContentInjectionState(chromeApi, target, true);
      } catch (error) {
        await setContentInjectionState(chromeApi, target, false).catch(() => {});
        throw error;
      }
    })();
    recoveryByTab.set(tabId, recovery);
    recovery.finally(() => {
      if (recoveryByTab.get(tabId) === recovery) recoveryByTab.delete(tabId);
    }).catch(() => undefined);
    return recovery;
  }

  async function sendTabMessageWithRecovery(chromeApi, tabId, message) {
    try {
      return await chromeApi.tabs.sendMessage(tabId, message);
    } catch (error) {
      if (!isMissingReceiverError(error)) throw error;
      await ensureContentScript(chromeApi, tabId);
      let lastError = error;
      for (const delayMs of [0, 25, 75, 150]) {
        if (delayMs) await new Promise(resolve => setTimeout(resolve, delayMs));
        try {
          return await chromeApi.tabs.sendMessage(tabId, message);
        } catch (retryError) {
          if (!isMissingReceiverError(retryError)) throw retryError;
          lastError = retryError;
        }
      }
      throw lastError;
    }
  }

  async function sendTabMessageIfPresent(chromeApi, tabId, message) {
    try {
      return await chromeApi.tabs.sendMessage(tabId, message);
    } catch (error) {
      if (isMissingReceiverError(error)) return null;
      throw error;
    }
  }

  async function refreshFigureExtractorInTab(chromeApi, tabId) {
    const numericTabId = Number(tabId);
    if (!Number.isInteger(numericTabId) || numericTabId < 0) {
      throw new Error('INVALID_TAB_ID');
    }
    await chromeApi.scripting.executeScript({
      target: { tabId: numericTabId },
      files: ['core/figure-extractor.js']
    });
    const results = await chromeApi.scripting.executeScript({
      target: { tabId: numericTabId },
      func: expectedRevision => {
        const root = document.documentElement;
        if (root) root.dataset.sciLlmFigureExtractorRevision = expectedRevision;
        const api = globalThis.SciLLM || {};
        if (typeof api.extractArticleFigures !== 'function') {
          return {
            revision: expectedRevision,
            available: false,
            probeFigureId: '',
            figures: []
          };
        }
        const figures = api.extractArticleFigures(document, []).map(figure => {
          const caption = String(figure?.caption || '').normalize('NFKC')
            .replace(/\s+/g, ' ').trim().slice(0, 12000);
          const captionBlocks =
            typeof api.splitFigureCaptionByPanelGroups === 'function'
              ? api.splitFigureCaptionByPanelGroups(caption).slice(0, 60)
                .map(block => ({
                  kind: block?.kind === 'panels' ? 'panels' : 'overview',
                  panels: Array.isArray(block?.panels)
                    ? block.panels.map(String).slice(0, 26) : [],
                  text: String(block?.text || '').normalize('NFKC')
                    .replace(/\s+/g, ' ').trim().slice(0, 6000)
                }))
                .filter(block => block.text)
              : [];
          return {
            figureId: String(figure?.figureId || ''),
            figureLabel: String(figure?.figureLabel || ''),
            hasImage: typeof api.selectFigureImageSource === 'function'
              ? Boolean(api.selectFigureImageSource(figure, document.baseURI))
              : Boolean(figure?.imageElements?.length),
            caption,
            captionBlocks,
            isSupplemental: figure?.isSupplemental === true,
            panelHints: Array.isArray(figure?.panelHints)
              ? figure.panelHints.map(String).slice(0, 30) : []
          };
        }).filter(figure => figure.figureId);
        return {
          revision: expectedRevision,
          available: true,
          probeFigureId: String(api.parseFigureLabel?.(
            'For a Figure360 author presentation of Figure 1'
          )?.figureId || ''),
          figures
        };
      },
      args: [FIGURE_EXTRACTOR_REVISION]
    });
    const diagnostic = results?.[0]?.result || null;
    if (!diagnostic?.available ||
        diagnostic.probeFigureId !== 'figure-1') {
      throw new Error('FIGURE_EXTRACTOR_HOTLOAD_FAILED');
    }
    return diagnostic;
  }

  return {
    CONTENT_SCRIPT_FILES,
    CONTENT_STYLE_FILES,
    CONTENT_SCRIPT_REVISION,
    FIGURE_EXTRACTOR_REVISION,
    CONTENT_INJECTION_CLAIM,
    CONTENT_INJECTION_READY,
    isMissingReceiverError,
    ensureContentScript,
    sendTabMessageIfPresent,
    sendTabMessageWithRecovery,
    refreshFigureExtractorInTab
  };
});
