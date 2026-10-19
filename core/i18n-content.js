(function (root) {
  'use strict';
  const api = root.SciLLM;
  if (!api || !root.document || root.__brevessInterfaceObserver) return;
  // Observe only extension-owned controls. Never translate the host article.
  const selector = '#sci-highlight-tooltip, #sci-reading-panel, #sci-side-panel-restore, #sci-manual-status, #sci-manual-toolbar, #sci-highlight-context-popover, #sci-figure-image-viewer, #sci-article-navigator-host, #sci-review-outline-host, #sci-semantic-find-host, #sci-semantic-find-panel, #sci-bilingual-status, [data-brevess-interface]';
  const tracked = new Map();
  function inspect(node) {
    if (node.nodeType !== 1) return;
    const candidates = [...(node.matches(selector) ? [node] : []), ...node.querySelectorAll(selector)];
    for (const candidate of candidates) {
      const scope = candidate.shadowRoot || candidate;
      if (!tracked.has(candidate)) tracked.set(candidate, api.observeInterfaceRoot(scope));
    }
  }
  const observer = new MutationObserver(records => {
    for (const record of records) for (const node of record.addedNodes) inspect(node);
    for (const [node, dispose] of tracked) if (!node.isConnected) { dispose(); tracked.delete(node); }
  });
  root.__brevessInterfaceObserver = observer;
  // null selects no page-wide root. Shadow dialogs register their own roots.
  void api.bootstrapInterfaceLanguage(root.chrome?.runtime, null).then(() => inspect(document.documentElement));
  observer.observe(document.documentElement, { subtree: true, childList: true });
})(globalThis);
