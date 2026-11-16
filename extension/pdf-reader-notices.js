(() => {
  'use strict';

  const byId = id => document.getElementById(id);
  const readerInstanceId = crypto.randomUUID();
  let sourceEpoch = 0;
  let revision = 0;
  let lastSignature = '';
  let scheduled = false;
  const notices = new Map();
  const sourceChangeBaseline = new Map();
  const channels = [
    ['reader', 'pdfReaderStatus'],
    ['quota', 'pdfMineruQuotaStatus'],
    ['figure', 'pdfFigureEngineStatus'],
    ['save', 'pdfReaderSaveStatus'],
    ['remote-source', 'pdfRemoteUrlStatus']
  ];
  const actionIds = ['pdfReaderRetry', 'pdfReaderOpenSettings'];

  function binding() {
    const native = globalThis.__brevessNativePdfDocument;
    return {
      readerUrl: location.href,
      readerInstanceId,
      sourceEpoch,
      sourceUrl: String(globalThis.__brevessPdfReaderBridge?.sourceUrl ||
        document.documentElement.dataset.pdfSourceUrl || ''),
      documentHash: String(native?.structure?.documentHash || native?.documentHash || ''),
      documentGeneration: Number(native?.documentGeneration ?? native?.generation) || 0
    };
  }

  function readChannel(id, elementId) {
    const node = byId(elementId);
    if (!node || node.hidden) return null;
    const control = id === 'reader' ? byId('pdfReaderControl') : node;
    const state = String(control?.dataset.state || '');
    const message = String(node.textContent || '').replace(/\s+/gu, ' ').trim().slice(0, 600);
    if (!message) return null;
    const type = /error|fail|blocked|source_changed/u.test(state) || id === 'remote-source'
      ? 'error' : /ready|success|saved|complete|verified/u.test(state) ? 'success' : 'info';
    return { id, message, type };
  }

  function refresh() {
    scheduled = false;
    for (const [id, elementId] of channels) {
      const next = readChannel(id, elementId);
      const signature = JSON.stringify(next);
      if (sourceChangeBaseline.get(id) === signature) continue;
      sourceChangeBaseline.delete(id);
      if (!next) continue; // Keep the latest status when its producer hides the node.
      const previous = notices.get(id);
      if (previous?.message !== next.message || previous?.type !== next.type) {
        notices.set(id, { ...next, timestamp: Date.now() });
      }
    }
    const frame = byId('pdfOriginalFrame');
    if (frame && !frame.hidden) {
      const message = document.querySelector('.pdf-original-embed-hint')?.textContent?.trim();
      if (message && notices.get('embed')?.message !== message) {
        notices.set('embed', { id: 'embed', message, type: 'info', timestamp: Date.now() });
      }
    } else notices.delete('embed');
    const snapshot = currentSnapshot();
    const signature = JSON.stringify({ ...snapshot, revision: 0 });
    if (signature === lastSignature) return;
    lastSignature = signature;
    revision += 1;
    const pending = globalThis.chrome?.runtime?.sendMessage?.({
      type: 'PDF_READER_NOTICES_CHANGED', readerInstanceId, sourceEpoch, revision
    });
    pending?.catch?.(() => undefined);
  }

  function currentSnapshot() {
    return {
      success: true,
      ...binding(),
      revision,
      notices: [...notices.values()].sort((a, b) => a.timestamp - b.timestamp),
      actions: actionIds.map(id => byId(id)).filter(node => node && !node.hidden)
        .map(node => ({ id: node.id, label: node.textContent.trim() }))
    };
  }

  function scheduleRefresh() {
    if (scheduled) return;
    scheduled = true;
    // Do not rely on animation frames: state must remain available in background tabs.
    setTimeout(refresh, 80);
  }

  function trustedPanel(sender) {
    if (!chrome.runtime.id || sender?.id !== chrome.runtime.id) return false;
    try {
      const url = new URL(sender.url);
      return url.origin === new URL(chrome.runtime.getURL('popup.html')).origin &&
        url.pathname === '/popup.html';
    } catch (_) { return false; }
  }

  chrome.runtime.onMessage.addListener((request, sender, respond) => {
    if (!['getPdfReaderNotices', 'runPdfReaderNoticeAction'].includes(request?.action) ||
        !trustedPanel(sender)) return;
    refresh();
    const snapshot = currentSnapshot();
    if (request.action === 'getPdfReaderNotices') {
      respond(snapshot);
      return;
    }
    const expected = request.scope;
    const scopeMatches = expected && ['readerUrl', 'readerInstanceId', 'sourceEpoch', 'revision',
      'sourceUrl', 'documentHash', 'documentGeneration'].every(key => expected[key] === snapshot[key]);
    const button = actionIds.includes(request.id) ? byId(request.id) : null;
    if (!scopeMatches || !button || button.hidden || button.disabled) {
      respond({ success: false, error: { message: 'PDF 已切换，请查看当前阅读状态后重试。' } });
      return;
    }
    button.click();
    respond({ success: true });
  });

  const observer = new MutationObserver(scheduleRefresh);
  for (const node of [byId('pdfReaderControl'), byId('pdfOriginalFrame'),
    ...channels.map(([, id]) => byId(id)), ...actionIds.map(byId)].filter(Boolean)) {
    observer.observe(node, { childList: true, subtree: true, attributes: true,
      attributeFilter: ['hidden', 'data-state', 'disabled'] });
  }
  observer.observe(document.documentElement, { attributes: true,
    attributeFilter: ['data-pdf-source-url'] });
  document.addEventListener('brevess:pdf-source-changing', () => {
    sourceEpoch += 1;
    notices.clear();
    for (const [id, elementId] of channels) {
      sourceChangeBaseline.set(id, JSON.stringify(readChannel(id, elementId)));
    }
    scheduleRefresh();
  });
  document.addEventListener('brevess:native-pdf-ready', scheduleRefresh);
  document.addEventListener('brevess:native-pdf-error', scheduleRefresh);
  globalThis.BrevessPdfReaderNotices = Object.freeze({
    snapshot() { refresh(); return currentSnapshot(); }
  });
  refresh();
})();
