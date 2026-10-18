(() => {
  'use strict';

  const byId = id => document.getElementById(id);
  const body = document.body;
  const documentRoot = document.documentElement;
  const focusToggle = byId('pdfReaderFocusToggle');
  const moreToggle = byId('pdfReaderMoreToggle');
  const moreMenu = byId('pdfReaderMoreMenu');
  const noticeStack = byId('pdfReaderNoticeStack');
  const noticesToggle = byId('pdfReaderNoticesToggle');
  const noticesSummary = byId('pdfReaderNoticesSummary');
  const readerControl = byId('pdfReaderControl');
  const readerStatusTitle = byId('pdfReaderStatusTitle');
  const readerStatus = byId('pdfReaderStatus');
  const readerProgress = readerControl?.querySelector('.pdf-reader-progress');
  const readerProgressBar = byId('pdfReaderProgressBar');
  const originalViewer = byId('pdfOriginalViewer');
  const nativeViewer = byId('pdfNativeViewer');
  const originalFrame = byId('pdfOriginalFrame');
  const noticeNodes = [
    byId('pdfMineruQuotaStatus'),
    byId('pdfFigureEngineStatus'),
    byId('pdfReaderSaveStatus')
  ].filter(Boolean);

  let scheduled = false;
  let lastSevereSignature = '';

  function visible(node) {
    return Boolean(node && !node.hidden);
  }

  function menuItems() {
    return [...moreMenu.querySelectorAll('[role="menuitem"]')]
      .filter(item => !item.hidden && item.getAttribute('aria-disabled') !== 'true' &&
        getComputedStyle(item).display !== 'none');
  }

  function setMoreMenu(open, { restoreFocus = false } = {}) {
    const next = Boolean(open);
    moreMenu.hidden = !next;
    moreToggle.setAttribute('aria-expanded', String(next));
    body.toggleAttribute('data-pdf-more-open', next);
    if (next) menuItems()[0]?.focus();
    else if (restoreFocus) moreToggle.focus();
  }

  function setFocusMode(active, { restoreFocus = false } = {}) {
    const next = Boolean(active);
    body.toggleAttribute('data-reading-focus', next);
    focusToggle?.setAttribute('aria-pressed', String(next));
    if (focusToggle) focusToggle.textContent = next ? '退出专注' : '专注阅读';
    focusToggle?.setAttribute('aria-label', next ? '退出专注阅读' : '进入专注阅读');
    if (next) setMoreMenu(false);
    if (restoreFocus) (focusToggle || moreToggle).focus();
  }

  function setNoticesExpanded(expanded) {
    const next = Boolean(expanded);
    noticeStack.toggleAttribute('data-collapsed', !next);
    noticesToggle.setAttribute('aria-expanded', String(next));
    noticesToggle.textContent = next ? '收起' : '展开';
  }

  function isReaderControlVisible() {
    if (!readerControl || readerControl.hidden) return false;
    return !['idle', 'ready'].includes(String(readerControl.dataset.state || ''));
  }

  function currentSevereSignature() {
    const enhancement = String(documentRoot.dataset.pdfEnhancementState || '');
    const controlState = String(readerControl?.dataset.state || '');
    const workspaceError = String(documentRoot.dataset.pdfWorkspaceIndexError || '');
    const enhancementError = String(documentRoot.dataset.pdfEnhancementError || '');
    if (controlState !== 'error' && !['blocked', 'error'].includes(enhancement) &&
        !workspaceError && !enhancementError) return '';
    return [controlState, enhancement, workspaceError, enhancementError].join('|');
  }

  function syncSurfacePresentation() {
    const originalVisible = visible(originalViewer);
    const nativeState = String(nativeViewer?.dataset.state || '');
    const frameVisible = visible(originalFrame);
    const nativeReadable = originalVisible && nativeState === 'ready';
    body.toggleAttribute('data-pdf-surface-readable', nativeReadable);

    if (originalViewer) {
      const renderer = frameVisible ? 'iframe' : (nativeState ? 'native' : 'none');
      originalViewer.dataset.renderer = renderer;
    }
  }

  function syncNotices() {
    const visibleMessages = noticeNodes.filter(node => visible(node) && node.textContent.trim());
    const controlVisible = isReaderControlVisible();
    const count = visibleMessages.length + (controlVisible ? 1 : 0);
    const severeSignature = currentSevereSignature();
    const severeTitle = severeSignature && controlVisible
      ? String(readerStatusTitle?.textContent || '').trim() : '';
    // Producers retain these DOM nodes; messages are displayed by the side panel.
    noticeStack.hidden = true;
    noticesSummary.textContent = count
      ? (severeTitle ? `${severeTitle} · 共 ${count} 条阅读状态` : `${count} 条阅读状态`)
      : '';

    if (severeSignature && severeSignature !== lastSevereSignature) setNoticesExpanded(true);
    lastSevereSignature = severeSignature;
  }

  function measuredPageProgress() {
    const message = String(readerStatus?.textContent || '');
    const match = message.match(/(?:已检查\s*)?(\d+)\s*\/\s*(\d+)\s*页/u);
    if (!match) return null;
    const current = Number(match[1]);
    const total = Number(match[2]);
    if (!Number.isFinite(current) || !Number.isFinite(total) || total <= 0 ||
        current < 0 || current > total) return null;
    return { current, total, percent: Math.max(0, Math.min(100, current / total * 100)) };
  }

  function syncProgressPresentation() {
    if (!readerProgress || !readerControl) return;
    const state = String(readerControl.dataset.state || '');
    const active = state === 'loading' || state === 'indexing';
    const measured = active ? measuredPageProgress() : null;
    readerControl.dataset.progressKind = measured ? 'measured' : (active ? 'stage' : 'settled');
    readerProgress.hidden = !measured;
    readerProgress.setAttribute('aria-hidden', String(!measured));
    if (!measured) {
      readerProgress.removeAttribute('aria-valuemin');
      readerProgress.removeAttribute('aria-valuemax');
      readerProgress.removeAttribute('aria-valuenow');
      readerProgress.removeAttribute('aria-valuetext');
      return;
    }
    readerProgress.setAttribute('aria-valuemin', '0');
    readerProgress.setAttribute('aria-valuemax', String(measured.total));
    readerProgress.setAttribute('aria-valuenow', String(measured.current));
    readerProgress.setAttribute('aria-valuetext', `${measured.current}/${measured.total} 页`);
    if (readerProgressBar) readerProgressBar.style.width = `${measured.percent}%`;
  }

  function sync() {
    scheduled = false;
    syncSurfacePresentation();
    syncProgressPresentation();
    syncNotices();
    if (!moreMenu.hidden && menuItems().length === 0) setMoreMenu(false, { restoreFocus: true });
  }

  function scheduleSync() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(sync);
  }

  moreToggle.addEventListener('click', () => setMoreMenu(moreMenu.hidden));
  moreMenu.addEventListener('click', event => {
    if (event.target.closest('[role="menuitem"]')) setMoreMenu(false);
  });
  noticesToggle.addEventListener('click', () => {
    setNoticesExpanded(noticesToggle.getAttribute('aria-expanded') !== 'true');
  });
  focusToggle?.addEventListener('click', () => {
    setFocusMode(!body.hasAttribute('data-reading-focus'), { restoreFocus: true });
  });

  document.addEventListener('pointerdown', event => {
    if (!moreMenu.hidden && !event.target.closest('.pdf-reader-more')) setMoreMenu(false);
  });

  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || event.defaultPrevented || event.repeat) return;
    if (!moreMenu.hidden) {
      event.preventDefault();
      setMoreMenu(false, { restoreFocus: true });
      return;
    }
    if (!body.hasAttribute('data-reading-focus')) return;
    if (event.target.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]')) return;
    event.preventDefault();
    setFocusMode(false, { restoreFocus: true });
  });

  const observer = new MutationObserver(scheduleSync);
  const observed = [
    documentRoot, readerControl, originalViewer, nativeViewer, originalFrame, ...noticeNodes,
    ...moreMenu.querySelectorAll('[role="menuitem"]')
  ].filter(Boolean);
  for (const node of observed) {
    observer.observe(node, {
      attributes: true,
      attributeFilter: node === documentRoot
        ? ['data-pdf-enhancement-state', 'data-pdf-enhancement-error',
          'data-pdf-workspace-index-error']
        : ['hidden', 'data-state', 'aria-disabled'],
      childList: noticeNodes.includes(node) || node === readerControl,
      subtree: node === readerControl
    });
  }

  globalThis.BrevessPdfReaderUI = Object.freeze({
    setFocusMode,
    setMoreMenu,
    setNoticesExpanded,
    syncProgressPresentation,
    sync
  });
  sync();
})();
