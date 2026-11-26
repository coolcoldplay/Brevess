/* Sidebar is a separate extension document. Bind every action to the same
 * active tab before and after the asynchronous reader response. */
(() => {
  const open = document.getElementById('pdfPanelWorkspaceOpen');
  let target, timer, closeTimer, selection, gallery;
  const sizeKey = 'brevessFigurePreviewSize';
  let previewSize;
  chrome.storage.local.get(sizeKey).then(values=>{if(previewSize===undefined)previewSize=values[sizeKey];}).catch(()=>{});
  chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local' && sizeKey in changes)previewSize=changes[sizeKey].newValue;});
  function validSize(value) {
    return value && [value.width, value.height].every(n => Number.isInteger(n) && n > 0 && n <= 16384);
  }
  function dismiss(item, soft = false) {
    if (!item) return;
    void sendTabMessage(item.scope.tabId, {
      action: 'hideArticleFigurePreview',
      token: item.token,
      soft,
      expectedDocumentIdentity: item.scope.panelDocumentIdentity || '',
      pageUrl: item.scope.url
    }).catch(() => {});
  }
  function hide() {
    clearTimeout(timer);
    clearTimeout(closeTimer);
    dismiss(selection);
    selection = null;
    target = null;
  }
  const view = document.getElementById('workspace-figures');
  const isWeb = (scope) => !scope.pdfMode && !scope.offlineMode && /^(?:https?|file):/.test(scope.url || '');
  function scopeValid(scope) {
    if (!isWeb(scope)) return isCurrentPanelContext(scope);
    const now = capturePanelContext();
    return now.tabId === scope.tabId && now.key === scope.key && isCurrentPanelContext(now);
  }
  let scan, scanTimer;
  function stopScan() {
    clearTimeout(scanTimer);
    scan = null;
  }
  async function scanNext(state) {
    if (scan !== state || view.hidden || !scopeValid(state.scope)) return;
    try {
      if (!state.items) state.items = await request(state.scope, 'listWebPanelFigures');
      if (scan !== state || view.hidden) return;
      if (!state.items.length) {
        stopScan();
        return;
      }
      const item = state.items.shift();
      await request(state.scope, 'warmWebPanelFigure', { figureId: item.figureId, index: item.index });
    } catch (_) {
      /* Individual Figures can be retried in the gallery. */
    }
    if (scan === state && state.items?.length) scanTimer = setTimeout(() => scanNext(state), 400);
  }
  function sync() {
    const scope = capturePanelContext();
    const web = isWeb(scope) && isCurrentPanelContext(scope);
    open.hidden = !scope.pdfMode && !web;
    if (!web || view.hidden || (scan && !scopeValid(scan.scope))) stopScan();
    if (web && !view.hidden && !scan) {
      const state = (scan = { scope, items: null });
      scanTimer = setTimeout(() => scanNext(state), 350);
    }
    if (gallery && !scopeValid(gallery.scope)) gallery = null;
    if ((view.hidden && !target?.closest('#figureQuickNav')) || (selection && !scopeValid(selection.scope))) hide();
  }
  function locate(el) {
    const badge = el.closest?.(
      '[data-figure-badge],.figure-quick-nav-marker,.workspace-panel-id,.workspace-panel-description,.figure-quick-nav-panel-button'
    );
    const row = badge?.closest('[data-figure-id]');
    if (!row) return null;
    return { badge, figureId: row.dataset.figureId, label: row.dataset.panelId || '' };
  }
  function replacement(info) {
    if (info.badge.isConnected) return info.badge;
    const id = CSS.escape(info.figureId);
    if (info.badge.hasAttribute('data-figure-badge'))
      return view.querySelector('[data-figure-badge="' + id + '"]');
    const kind = [
      'figure-quick-nav-marker',
      'figure-quick-nav-panel-button',
      'workspace-panel-id',
      'workspace-panel-description'
    ].find((cls) => info.badge.classList.contains(cls));
    const row =
      '[data-figure-id="' +
      id +
      '"]' +
      (info.label ? '[data-panel-id="' + CSS.escape(info.label) + '"]' : '');
    return (
      kind && document.querySelector(row + (kind === 'figure-quick-nav-panel-button' ? '' : ' ') + '.' + kind)
    );
  }
  async function request(scope, action, extra = {}) {
    if (!scopeValid(scope)) throw Error('当前文献已切换');
    const response = await sendTabMessage(scope.tabId, {
      action,
      ...extra,
      ...(isWeb(scope)
        ? { pageUrl: scope.url, expectedDocumentIdentity: scope.panelDocumentIdentity || '' }
        : {})
    });
    if (!scopeValid(scope)) throw Error('当前文献已切换');
    if (!response?.success) throw Error(response?.error?.message || '无法读取 Panel');
    if (isWeb(scope)) {
      if (
        !response.documentIdentity ||
        (scope.panelDocumentIdentity && response.documentIdentity !== scope.panelDocumentIdentity)
      )
        throw Error('当前网页已重新加载');
      scope.panelDocumentIdentity = response.documentIdentity;
    }
    return response.data;
  }
  globalThis.BrevessNotePanels = {
    list: scope => request(scope,'listNoteFigures'),
    labels: (scope,item) => request(scope,'listNotePanels',{figureId:item.figureId,index:item.index}),
    crop: (scope,item,label) => request(scope,scope.pdfMode ? 'readPdfPanelCrop' : 'readWebPanelCrop',
      {figureId:item.figureId,index:item.index,label,edge:1600})
  };
  async function show(info) {
    const badge = replacement(info),
      scope = capturePanelContext();
    if (!badge || (view.hidden && !badge.closest('#figureQuickNav')) || !scopeValid(scope)) return;
    const rect = badge.getBoundingClientRect(),
      selected = { scope, figureId: info.figureId, label: info.label, token: crypto.randomUUID() };
    target = badge;
    selection = selected;
    try {
      const size = previewSize;
      if (selection !== selected || !scopeValid(scope)) return;
      await request(scope, 'showArticleFigurePreview', {
        size: validSize(size) ? size : null,
        figureId: info.figureId,
        label: info.label,
        token: selected.token,
        anchor: Math.max(0, Math.min(1, (rect.top + rect.height / 2) / innerHeight))
      });
      if (selection !== selected) dismiss(selected);
    } catch (e) {
      if (selection === selected && scopeValid(scope)) showStatus(e.message, 'error');
    }
  }
  function enter(e) {
    const info = locate(e.target);
    if (!info || e.pointerType === 'touch') return;
    clearTimeout(closeTimer);
    if (target === info.badge) return;
    hide();
    target = info.badge;
    timer = setTimeout(() => show(info), 75);
  }
  function leave(e) {
    if (!target?.contains(e.target) || (e.relatedTarget instanceof Node && target.contains(e.relatedTarget)))
      return;
    clearTimeout(timer);
    target = null;
    const item = selection;
    if (item) closeTimer = setTimeout(() => dismiss(item, true), 240);
  }
  for (const key of ['pointerover', 'focusin']) document.addEventListener(key, enter);
  for (const key of ['pointerout', 'focusout']) document.addEventListener(key, leave);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hide();
  });
  view.addEventListener('scroll', hide, { passive: true });
  addEventListener('pagehide', hide);
  function attach(p) {
    const name = p.name + ' ' + p.label;
    const file = {
      attachmentId: p.attachmentId || crypto.randomUUID(),
      kind: 'image',
      name: name + (/jpeg/.test(p.mediaType) ? '.jpg' : '.png'),
      mediaType: p.mediaType,
      dataUrl: p.dataUrl
    };
    articleChatAttachments = SciLLM.normalizeArticleChatAttachments([
      ...articleChatAttachments.filter((f) => f.attachmentId !== file.attachmentId),
      file
    ]);
    renderArticleChatAttachmentChips();
    switchWorkspaceView('chat');
    const input = document.getElementById('articleChatQuestion');
    const lines = [
      name + (p.page ? '（PDF 第 ' + p.page + ' 页）' : '（网页原图裁片）'),
      p.caption,
      p.ambiguous ? '此裁图的自动定位待核对。' : '',
      '我的问题：'
    ].filter(Boolean);
    input.value = [input.value.trim(), lines.join('\n')].filter(Boolean).join('\n\n');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    hide();
    input.focus();
  }
  async function editor(scope, figureId, label) {
    const token = crypto.randomUUID();
    gallery = { scope, token };
    await request(scope, 'openArticleFigureGallery', { figureId, label, token });
  }
  open.onclick = () => editor(capturePanelContext()).catch((e) => showStatus(e.message, 'error'));
  chrome.runtime.onMessage.addListener((m, sender) => {
    if (m?.type !== 'BREVESS_FIGURE_SURFACE_ACTION' || sender.id !== chrome.runtime.id) return;
    const item = [selection, gallery].find(
      (x) => x && x.token === m.token && x.scope.tabId === sender.tab?.id
    );
    if (
      !item ||
      !scopeValid(item.scope) ||
      (item.scope.panelDocumentIdentity && m.documentIdentity !== item.scope.panelDocumentIdentity)
    )
      return;
    if (m.kind === 'resize' && item === selection && validSize(m.size)) {
      void chrome.storage.local.set({ [sizeKey]: { width: m.size.width, height: m.size.height } })
        .catch(() => showStatus('预览尺寸未保存', 'error'));
      return;
    }
    if (m.kind === 'review')
      void editor(item.scope, m.figureId, m.label).catch((e) => showStatus(e.message, 'error'));
    if (m.kind === 'ask')
      void request(item.scope, item.scope.pdfMode ? 'readPdfPanelCrop' : 'readWebPanelCrop', {
        figureId: m.figureId,
        label: m.label,
        index: m.index,
        edge: 1400
      })
        .then((p) => {
          if (scopeValid(item.scope)) attach(p);
        })
        .catch((e) => showStatus(e.message, 'error'));
  });
  new MutationObserver(sync).observe(document.getElementById('workspace-figures'), {
    attributes: true,
    attributeFilter: ['hidden']
  });
  new MutationObserver(sync).observe(document.getElementById('sidePanelPaperTitle'), {
    childList: true,
    subtree: true,
    characterData: true
  });
  sync();
})();

// Keep the edge itself available to the scrollbar and the article view.
(() => {
  const nav = document.getElementById('figureQuickNav');
  let anchor = null;
  let renderedSnapshot = null;

  function close() {
    delete nav.dataset.edgeOpen;
    anchor = null;
  }

  function place(y) {
    const count = nav.querySelectorAll('.figure-quick-nav-marker').length;
    if (!count || nav.hidden || document.querySelector('dialog:modal')) return close();
    const margin = 8;
    const available = Math.max(1, innerHeight - 2 * margin - 8);
    const columnWidth = parseFloat(nav.style.getPropertyValue('--figure-nav-width')) || 34;
    const maxColumns = Math.max(1, Math.floor((innerWidth - margin - 2) / columnWidth));
    const rowHeight = Math.max(16, Math.min(25, Math.floor(available / Math.ceil(count / maxColumns))));
    const maxRows = Math.max(1, Math.floor(available / rowHeight));
    const columns = Math.ceil(count / maxRows);
    const rows = Math.ceil(count / columns);
    const height = rows * rowHeight + 8;
    nav.style.setProperty('--edge-rows', rows);
    nav.style.setProperty('--edge-row-height', rowHeight + 'px');
    nav.style.top = Math.max(margin, Math.min(innerHeight - margin - height, y - height / 2)) + 'px';
    nav.dataset.edgeOpen = 'true';
    anchor = y;
  }

  function openAt(y) {
    if (anchor === null) {
      const data = currentWorkspaceSnapshot?.figures;
      if (!data?.figures?.length) return close();
      if (renderedSnapshot !== currentWorkspaceSnapshot || nav.hidden || !nav.firstElementChild) {
        const draft = data.draft || currentWorkspaceSnapshot.figureWorkspaceDraft;
        renderFigureQuickNav(SciLLM.orderFigureWorkspaceItems(data.figures,
          draft?.supplementalPlacements, draft?.figureDisplayOrder));
        renderedSnapshot = currentWorkspaceSnapshot;
      }
    }
    place(y);
  }

  document.addEventListener('pointermove', event => {
    if (event.pointerType === 'touch' || event.buttons) return;
    if (anchor !== null && nav.contains(event.target)) return;
    if (event.clientX >= innerWidth - 8) openAt(event.clientY);
    else if (anchor !== null) close();
  }, { passive: true });
  document.addEventListener('pointerout', event => { if (!event.relatedTarget) close(); });
  nav.addEventListener('focusin', () => { if (anchor === null) openAt(innerHeight / 2); });
  nav.addEventListener('focusout', event => {
    if (!nav.contains(event.relatedTarget) && !nav.matches(':hover')) close();
  });
  nav.addEventListener('keydown', event => {
    if (event.key === 'Escape') { close(); event.target.blur(); }
    if (event.key === 'Enter' && event.target === nav) {
      openAt(innerHeight / 2);
      nav.querySelector('button')?.focus();
    }
  });
  window.addEventListener('resize', () => { if (anchor !== null) place(Math.min(innerHeight, anchor)); });
  new MutationObserver(() => {
    if (nav.hidden) close();
    else if (anchor !== null) place(anchor);
  }).observe(nav, { attributes: true, attributeFilter: ['hidden'], childList: true });
})();
