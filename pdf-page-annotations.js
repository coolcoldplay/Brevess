(function () {
  'use strict';
  const api = globalThis.SciLLM = globalThis.SciLLM || {};
  api.createPdfPageAnnotationController = function ({ viewer, trigger, capture, current, repository }) {
    const doc = viewer.ownerDocument, win = doc.defaultView, controls = doc.createElement('div');
    controls.id = 'pdfPageAnnotationControls'; controls.dataset.sciPluginUi = ''; controls.hidden = true; doc.body.append(controls);
    let context = null, repo = null, enabled = false, generation = 0, editor = null, activePage = null, preferences = null, timer = 0, syncing = false;
    const layers = new Map();
    const valid = () => !!context && current(context);
    const display = page => ({ source: 'pdf-page', width: Number(page.dataset.pdfAnnotationWidth), height: Number(page.dataset.pdfAnnotationHeight), fit: 'fill', position: '50% 50%' });
    function stopEditor() { if (editor) { preferences = editor.getPreferences(); editor.destroy(); editor = null; } activePage = null; }
    function close() { generation++; enabled = false; stopEditor(); controls.hidden = true; trigger.setAttribute('aria-pressed', 'false'); layers.forEach(layer => layer.overlay.refresh()); }
    function reset() { close(); for (const layer of layers.values()) { layer.unsubscribe(); layer.overlay.destroy(); } layers.clear(); context = repo = null; preferences = null; }
    function report(error) { controls.hidden = false; controls.textContent = error?.message || '标注尚未就绪，请重试。'; }
    async function activate(page, token) {
      if (!enabled || token !== generation || !valid() || !page || activePage === page) return;
      const layer = layers.get(page); if (!layer) return;
      stopEditor(); controls.replaceChildren(); activePage = page;
      const label = doc.createElement('strong'); label.textContent = 'p. ' + page.dataset.pdfPageNumber; controls.append(label);
      editor = api.createFigureAnnotationEditor({ image: page, canvas: viewer, controls, session: layer.session,
        getDisplaySource: () => ({ display: display(page) }), isVisible: () => enabled && valid() && activePage === page });
      editor.setPreferences(preferences); layers.forEach(item => item.overlay.refresh());
    }
    async function sync() {
      if (syncing || !repo || !valid()) return;
      syncing = true; const token = generation;
      try {
        for (const [page, layer] of layers) if (!page.isConnected) { if (activePage === page) stopEditor(); layer.unsubscribe(); layer.overlay.destroy(); layers.delete(page); }
        for (const page of viewer.querySelectorAll('.pdf-native-page.is-rendered[data-pdf-annotation-width]')) {
          if (layers.has(page)) continue;
          const binding = api.figureAnnotationBinding({ documentKey: context.documentKey, figureId: 'pdf-page-' + page.dataset.pdfPageNumber,
            imageIndex: 0, sha256: context.documentHash, width: Number(page.dataset.pdfAnnotationWidth), height: Number(page.dataset.pdfAnnotationHeight) });
          const session = await repo.open(binding); if (token !== generation || !valid()) return;
          const overlay = api.createFigureAnnotationOverlay({ image: page, parent: viewer, clipElement: viewer, binding,
            getDisplaySource: () => ({ display: display(page) }), isVisible: () => valid() && activePage !== page && page.classList.contains('is-rendered') });
          const unsubscribe = session.subscribe(state => overlay.render(state.objects)); layers.set(page, { session, overlay, unsubscribe });
        }
        if (enabled && token === generation) {
          const box = viewer.getBoundingClientRect();
          const page = [...layers.keys()].filter(p => { const b=p.getBoundingClientRect(); return b.bottom>box.top && b.top<box.bottom; })
            .sort((a,b) => Math.abs(a.getBoundingClientRect().top-box.top)-Math.abs(b.getBoundingClientRect().top-box.top))[0];
          await activate(page, token);
        }
      } catch (error) { if (token === generation && enabled) report(error); }
      finally { syncing = false; }
    }
    const schedule = () => { win.clearTimeout(timer); timer = win.setTimeout(() => void sync(), 80); };
    async function open() {
      if (enabled) { close(); return; } const token = ++generation; enabled = true; controls.hidden = false; trigger.setAttribute('aria-pressed', 'true'); controls.textContent = '正在读取标注…';
      doc.dispatchEvent(new Event('brevess:pdf-annotations-start'));
      try { const captured = await capture(); if (token !== generation) return;
        if (context && (context.documentKey !== captured.documentKey || !valid())) { for (const layer of layers.values()) { layer.unsubscribe(); layer.overlay.destroy(); } layers.clear(); }
        context = captured; if (!valid()) throw new Error('文献已变化，请重新打开标注。');
        const loaded = await repository(context); if (token !== generation || !valid()) return; repo = loaded; await sync();
        if (!editor && enabled) controls.textContent = '当前页尚未渲染，请翻阅已加载的原页。';
      } catch (error) { if (token === generation) { enabled = false; trigger.setAttribute('aria-pressed', 'false'); report(error); } }
    }
    const pickPage = event => { if (!enabled || !valid()) return; const page = event.target.closest('.pdf-native-page'); if (page && page !== activePage) void activate(page, generation); };
    const mutation = new MutationObserver(records => { if (records.some(r => r.type === 'attributes' ? r.target.matches?.('.pdf-native-page') : [...r.addedNodes, ...r.removedNodes].some(n => n.matches?.('.pdf-native-page,.pdf-native-page-canvas')))) schedule(); });
    mutation.observe(viewer, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    viewer.addEventListener('scroll', schedule, { passive: true }); viewer.addEventListener('pointerdown', pickPage, true); trigger.addEventListener('click', open);
    doc.addEventListener('brevess:pdf-review-start', close); doc.addEventListener('brevess:pdf-source-changing', reset);
    return { open, close, reset, destroy() { reset(); mutation.disconnect(); win.clearTimeout(timer); viewer.removeEventListener('scroll', schedule); viewer.removeEventListener('pointerdown', pickPage, true); trigger.removeEventListener('click', open); doc.removeEventListener('brevess:pdf-review-start', close); doc.removeEventListener('brevess:pdf-source-changing', reset); controls.remove(); } };
  };
  function initialize() {
    const viewer = document.getElementById('pdfNativeViewer'), trigger = document.getElementById('pdfReaderAnnotations');
    if (!viewer || !trigger) return;
    const controller = api.createPdfPageAnnotationController({ viewer, trigger,
      capture: async () => { const native = globalThis.__brevessNativePdfDocument;
        if (!native?.structure || !native.pageCount) throw new Error('PDF 原页尚未就绪。');
        return { native, lifecycle: articleWorkspaceLifecycleGeneration, documentKey: figureAnnotationDocumentKey(), documentHash: native.documentHash || native.structure.documentHash }; },
      current: context => context.native === globalThis.__brevessNativePdfDocument && context.lifecycle === articleWorkspaceLifecycleGeneration && context.documentKey === figureAnnotationDocumentKey(),
      repository: () => figureAnnotationRepository() });
    window.addEventListener('pagehide', () => controller.destroy(), { once: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true }); else initialize();
})();
