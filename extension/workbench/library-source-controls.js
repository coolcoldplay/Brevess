(function attach(root, factory) {
  const common = typeof module === 'object' && module.exports;
  const api = factory(common ? require('../core/local-library-tags.js') : root.SciLLM);
  if (common) module.exports = api;
  root.BrevessLibrarySourceControls = Object.assign(root.BrevessLibrarySourceControls || {}, api);
  if (!common && root.document) {
    let controls;
    root.addEventListener('brevess-catalog-detail', event => {
      controls ||= api.createLibrarySourceControls({ document: root.document, window: root,
        sendMessage: message => root.chrome?.runtime?.sendMessage ? root.chrome.runtime.sendMessage(message)
          : Promise.reject(Object.assign(new Error('扩展未连接，仅可预览。'), { code: 'LIBRARY_SOURCE_RUNTIME_UNAVAILABLE' })),
        getURL: path => root.chrome?.runtime?.getURL?.(path) || new URL('../' + path, root.location.href).href,
        runtimeAvailable: typeof root.chrome?.runtime?.sendMessage === 'function',
        onSaved: () => root.__workbenchRuntime?.loadGlobalLibrary?.() });
      controls.mount(event.detail?.entry, root.document.querySelector('.catalog-detail-actions'));
    });
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory(tagsApi) {
  'use strict';
  const fail = code => { throw Object.assign(new Error(code), { code }); };
  function eligibleLibrarySource(source) {
    return !!source && source.inventoryOnly !== true && source.tagState !== 'aggregate' &&
      /^workspace:[a-f0-9]{64}$/u.test(source.workspaceId || '') && Number.isSafeInteger(source.workspaceGeneration) && source.workspaceGeneration >= 1;
  }
  function requireSource(source) { if (!eligibleLibrarySource(source)) fail('LIBRARY_SOURCE_IDENTITY_INVALID'); return source; }
  function librarySourceDirectoryUrl(source, getURL) {
    requireSource(source);
    return getURL(`options.html#page=storage&libraryDirectory=${encodeURIComponent(source.workspaceId)}`);
  }
  function createLibrarySourceService({ sendMessage } = {}) {
    if (typeof sendMessage !== 'function' || !tagsApi?.normalizeLocalLibraryTagsAsset) fail('LIBRARY_SOURCE_SERVICE_UNAVAILABLE');
    const path = tagsApi.LOCAL_LIBRARY_TAGS_ASSET_PATH;
    async function response(message) {
      const result = await sendMessage(message);
      if (result?.success !== true) throw Object.assign(new Error(result?.error?.message || '工作区请求未确认'), { code: result?.error?.code || 'LIBRARY_SOURCE_REQUEST_UNCONFIRMED' });
      return result.data;
    }
    async function readTags(source) {
      requireSource(source);
      const data = await response({ type: 'ARTICLE_WORKSPACE_GET_ASSET', workspaceId: source.workspaceId, relativePath: path });
      if (data?.workspaceGeneration !== source.workspaceGeneration) fail('WORKSPACE_GENERATION_CONFLICT');
      if (data.found === false && data.asset === null) return { generation: source.workspaceGeneration, revision: 0, contentHash: '', tags: [] };
      const asset = data.asset;
      if (data.found !== true || !asset || asset.relativePath !== path || !Number.isSafeInteger(asset.revision) || asset.revision < 1 ||
          typeof asset.contentHash !== 'string' || !asset.contentHash || asset.contentHash.length > 200) fail('LIBRARY_SOURCE_TAG_BASE_INVALID');
      const content = tagsApi.normalizeLocalLibraryTagsAsset(asset.content, { workspaceId: source.workspaceId });
      return { generation: source.workspaceGeneration, revision: asset.revision, contentHash: asset.contentHash, tags: [...content.tags] };
    }
    async function saveTags(source, base, tags) {
      requireSource(source);
      if (!base || base.generation !== source.workspaceGeneration || !Number.isSafeInteger(base.revision) || base.revision < 0 ||
          typeof base.contentHash !== 'string' || base.contentHash.length > 200 || (base.revision > 0 ? !base.contentHash : base.contentHash !== '')) fail('LIBRARY_SOURCE_TAG_BASE_INVALID');
      const content = tagsApi.normalizeLocalLibraryTagsAsset({ schemaVersion: 1, workspaceId: source.workspaceId, tags }, { workspaceId: source.workspaceId });
      const data = await response({ type: 'ARTICLE_WORKSPACE_SAVE_ASSET', workspaceId: source.workspaceId,
        workspaceGeneration: base.generation, relativePath: path, content, expectedRevision: base.revision,
        expectedContentHash: base.contentHash, createOnly: base.revision === 0 });
      if (data?.saved !== true || !Number.isSafeInteger(data.asset?.revision) || data.asset.revision <= base.revision ||
          typeof data.asset.contentHash !== 'string' || !data.asset.contentHash || data.asset.contentHash.length > 200 ||
          data.asset.relativePath !== undefined && data.asset.relativePath !== path) fail('TAG_SAVE_UNVERIFIED');
      return data;
    }
    return { readTags, saveTags };
  }
  function createLibrarySourceTagDraft(source, { service, onChange = () => {}, onSaved = () => {} } = {}) {
    requireSource(source);
    const owner = { workspaceId: source.workspaceId, workspaceGeneration: source.workspaceGeneration, title: String(source.title || source.fileName || '原文版本') };
    const state = { source: owner, base: null, tags: [], input: '', backups: [], latest: null, busy: false, blocked: true, closed: false, status: '' };
    const changed = () => onChange(state);
    const editable = () => { if (state.closed || state.busy) fail('LIBRARY_SOURCE_EDITOR_BUSY'); };
    const dirty = () => !!state.input || JSON.stringify(state.tags) !== JSON.stringify(state.base?.tags || []);
    function setInput(value) { editable(); state.input = String(value); }
    function addInput() {
      editable(); if (!state.input) return;
      const tags = tagsApi.normalizeLocalLibraryTags([...state.tags, state.input]);
      state.tags = [...tags]; state.input = ''; state.status = '有未保存的旧标签修改。'; changed();
    }
    function removeTag(tag) { editable(); state.tags = state.tags.filter(value => value !== tag); state.status = '有未保存的旧标签修改。'; changed(); }
    async function readLatest(initial = false) {
      editable(); state.busy = true; state.latest = null; state.status = '正在校验已保存旧标签…'; changed();
      try {
        const base = await service.readTags(owner);
        if (initial && !state.base && !dirty()) { state.base = base; state.tags = [...base.tags]; state.blocked = false; state.status = base.revision ? '已读取本机旧标签。' : '本来源尚无旧标签。'; }
        else { state.latest = base; state.blocked = true; state.status = '草稿仍保留；请核对最新旧标签，再明确选择是否重新编辑。'; }
        return base;
      } catch (error) { state.blocked = true; state.status = `旧标签无法校验（${error.code || '读取未确认'}），禁止覆盖，草稿保留。`; throw error; }
      finally { state.busy = false; changed(); }
    }
    function adoptLatest() {
      editable(); if (!state.latest) fail('LIBRARY_SOURCE_TAG_BASE_INVALID');
      if (dirty()) state.backups.push({ tags: [...state.tags], input: state.input });
      state.base = state.latest; state.tags = [...state.latest.tags]; state.input = ''; state.latest = null; state.blocked = false;
      state.status = '已采用最新旧标签；可重新增删后保存。'; changed();
    }
    async function save() {
      editable(); if (state.blocked || !state.base) fail('LIBRARY_SOURCE_TAG_BASE_INVALID'); addInput();
      const pendingTags = [...state.tags]; state.busy = true; state.status = '正在保存旧标签…'; changed();
      let result;
      try {
        result = await service.saveTags(owner, state.base, pendingTags);
        state.base = { ...state.base, revision: result.asset.revision, contentHash: result.asset.contentHash, tags: pendingTags };
        state.status = result.directoryPersisted ? '旧标签已保存到本机并同步到目录。' : '旧标签已保存到本机；目录同步尚未完成。';
      } catch (error) {
        state.blocked = true; state.latest = null;
        state.status = /CONFLICT/u.test(error.code || '') ? '保存冲突：另一页面或工作区版本已改变。草稿保留，请读取最新标签后重新编辑。'
          : '保存未确认。草稿保留，请读取最新标签确认后重新编辑；不会自动重试覆盖。';
        throw error;
      } finally { state.busy = false; changed(); }
      // A view refresh failure must not turn a confirmed successful save into an ambiguous write.
      try { await onSaved(result, owner); } catch (_) { state.status += ' 列表刷新未完成，请稍后刷新。'; changed(); }
      return result;
    }
    function close(confirmDiscard = () => false) {
      if (state.busy || dirty() && !confirmDiscard()) return false;
      state.closed = true; changed(); return true;
    }
    return { state, dirty, setInput, addInput, removeTag, readLatest, adoptLatest, save, close };
  }
  function createLibrarySourceControls({ document, window = globalThis, sendMessage, getURL, onSaved, runtimeAvailable = true } = {}) {
    const service = createLibrarySourceService({ sendMessage });
    let current = null, editorPanel = null, root = null;
    const element = (tag, content) => { const node = document.createElement(tag); if (content !== undefined) node.textContent = content; return node; };
    const button = (label, action) => { const node = element('button', label); node.type = 'button'; node.addEventListener('click', action); return node; };
    function attachEditor() { const mount = root?.querySelector('[data-library-source-editor]'); if (mount && editorPanel) mount.append(editorPanel); }
    function openTags(source) {
      if (!runtimeAvailable) fail('LIBRARY_SOURCE_RUNTIME_UNAVAILABLE');
      requireSource(source);
      if (current && !current.state.closed) {
        if (current.state.source.workspaceId === source.workspaceId && current.state.source.workspaceGeneration === source.workspaceGeneration || current.state.busy || current.dirty()) {
          if (current.state.source.workspaceId !== source.workspaceId) current.state.status = '请先保存或关闭当前来源的旧标签草稿，再编辑其他来源。';
          attachEditor(); render(); input?.focus(); return current;
        }
      }
      editorPanel = element('section'); editorPanel.className = 'catalog-source-tag-editor'; editorPanel.dataset.i18nIgnore = '';
      current = createLibrarySourceTagDraft(source, { service, onChange: () => render(), onSaved });
      buildEditor(); attachEditor(); current.readLatest(true).catch(() => {}); return current;
    }
    let input, status, chips, save, refresh, close, add, latest, adopt, backup;
    function buildEditor() {
      const source = current.state.source;
      const heading = element('h4', `来源旧标签 · ${source.title}`), identity = element('small', '已绑定此本机文献来源');
      const help = element('p', '旧标签只属于这个来源工作区，与总库标签组分别保存。Enter 添加，最多 32 个，每个最多 80 字。');
      chips = element('div'); chips.className = 'actions';
      input = element('input'); input.autocomplete = 'off'; input.setAttribute('aria-label', '新旧标签'); input.dataset.sourceTagInput = '';
      input.addEventListener('input', () => { current.setInput(input.value); });
      const addInput = () => { try { current.setInput(input.value); current.addInput(); } catch (_) { status.textContent = '标签无效：最多 32 个，每个 1–80 字；输入已保留。'; } };
      input.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); addInput(); } });
      add = button('添加', addInput);
      status = element('p'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); status.dataset.sourceTagStatus = '';
      save = button('保存旧标签', () => { try { current.setInput(input.value); current.save().catch(error => {
        if (error.code === 'LOCAL_LIBRARY_TAGS_INVALID') status.textContent = '标签无效：最多 32 个，每个 1–80 字；输入已保留。';
      }); } catch (_) {} });
      refresh = button('读取最新标签', () => current.readLatest(false).catch(() => {}));
      close = button('关闭', () => { if (current.close(() => window.confirm('放弃当前来源未保存的旧标签草稿？'))) { editorPanel.remove(); editorPanel = null; current = null; } });
      const actions = element('div'); actions.className = 'actions'; actions.append(save, refresh, close);
      latest = element('p'); adopt = button('采用最新标签，重新编辑', () => current.adoptLatest());
      const backupLabel = element('label', '未保存草稿备份（供复制，不自动覆盖新版本）');
      backup = element('textarea'); backup.readOnly = true; backup.setAttribute('aria-label', '旧标签草稿备份'); backup.dataset.sourceTagBackup = ''; backupLabel.append(backup);
      editorPanel.append(heading, identity, help, chips, input, add, status, actions, latest, adopt, backupLabel);
      render();
    }
    function render() {
      if (!current || !editorPanel || !status) return;
      const state = current.state;
      input.value = state.input; status.textContent = state.status;
      [input, add, close, refresh].forEach(node => { node.disabled = state.busy; }); save.disabled = state.busy || state.blocked;
      chips.replaceChildren(...state.tags.map(tag => { const control = button(`${tag} ×`, () => current.removeTag(tag)); control.disabled = state.busy; return control; }));
      latest.hidden = adopt.hidden = !state.latest; latest.textContent = state.latest ? `最新旧标签：${state.latest.tags.join('、') || '无'}` : '';
      adopt.disabled = state.busy; backup.parentNode.hidden = !state.backups.length; backup.value = state.backups.map(value => JSON.stringify(value)).join('\n\n');
    }
    function mount(entry, container) {
      root = container; if (!root || !entry) return;
      const nodes = root.querySelectorAll('[data-catalog-source-index]');
      nodes.forEach(node => {
        const index = Number(node.dataset.catalogSourceIndex), source = entry.sourceDocuments?.[index], target = node.querySelector('[data-library-source-controls]');
        if (!target) return; target.replaceChildren();
        if (!Number.isSafeInteger(index) || index < 0 || !eligibleLibrarySource(source)) {
          target.append(element('small', '此来源没有可校验的本机工作区；旧标签与目录操作不可用。')); return;
        }
        const edit = button(source.tagState === 'invalid' ? '旧标签异常 · 查看' : '编辑来源旧标签', () => openTags(source));
        edit.disabled = !runtimeAvailable;
        edit.dataset.librarySourceEditTags = ''; edit.setAttribute('aria-label', `编辑 ${source.title || '本来源'} 的旧标签`);
        const directory = element('a', '打开文件夹…'); directory.className = 'btn';
        if (runtimeAvailable) directory.href = librarySourceDirectoryUrl(source, getURL); else directory.setAttribute('aria-disabled', 'true');
        directory.target = '_blank'; directory.rel = 'noopener noreferrer'; directory.title = '到本地保存设置核对来源并确认打开文件夹'; directory.dataset.librarySourceDirectory = '';
        target.append(edit, directory);
        if (!runtimeAvailable) target.append(element('small', '扩展未连接，仅可预览；旧标签与目录操作不可用。'));
      });
      attachEditor();
    }
    const beforeUnload = event => { if (current && (current.dirty() || current.state.busy)) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener?.('beforeunload', beforeUnload);
    return { mount, openTags, getDraft: () => current,
      destroy() { if (current && (current.dirty() || current.state.busy)) return false; window.removeEventListener?.('beforeunload', beforeUnload); editorPanel?.remove(); current = null; return true; } };
  }
  return { eligibleLibrarySource, librarySourceDirectoryUrl, createLibrarySourceService, createLibrarySourceTagDraft, createLibrarySourceControls };
});
