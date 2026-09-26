(function localReadingLibraryOptions() {
  'use strict';

  const SCOPE_LABELS = Object.freeze({
    all: '全部范围', title: '标题', notes: '笔记', fulltext: '全文',
    abstract: '摘要', method: '方法', caption: '图注'
  });
  const state = {
    kind: 'articles',
    query: '',
    scope: 'all',
    tags: [],
    tagMode: 'any',
    tagEditor: null,
    directoryOpening: '',
    pages: { articles: 1, abbreviations: 1 },
    sequence: 0
  };

  function element(tag, className, content) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (content !== undefined) node.textContent = String(content);
    return node;
  }

  function button(label, className, onClick) {
    const node = element('button', className, label);
    node.type = 'button';
    node.addEventListener('click', onClick);
    return node;
  }

  function safeArticleLink(url, label) {
    try {
      const parsed = new URL(String(url || ''));
      const localPdfReader = SciLLM.withLocalPdfWorkspaceSource?.(
        chrome.runtime.getURL('pdf-reader.html'), parsed.href
      );
      if (!localPdfReader && !['https:', 'http:'].includes(parsed.protocol)) return element('span', '', label);
      const link = element('a', '', label);
      link.href = localPdfReader || (SciLLM.isLikelyPdfUrl?.(parsed.href)
        ? SciLLM.createPdfReaderUrl(chrome.runtime.getURL.bind(chrome.runtime), parsed.href)
        : parsed.href);
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      return link;
    } catch (_) {
      return element('span', '', label);
    }
  }

  function date(value) {
    if (!value || Number.isNaN(Date.parse(value))) return '未知';
    return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium' }).format(new Date(value));
  }

  function createShell(root) {
    root.replaceChildren();
    root.classList.add('local-library');
    const heading = element('div', 'local-library__heading');
    const headingCopy = element('div');
    headingCopy.append(element('h3', '', '本地文献与缩略词库'));
    headingCopy.append(element('p', '',
      '直接检索已保存工作区。所有统计和搜索均在本机完成，不调用模型，也不上传正文。'));
    const headingActions = element('div', 'local-library__heading-actions');
    const add = button('新增缩略词', 'button secondary compact-button', () =>
      openAbbreviationEditor(root));
    add.dataset.libraryAdd = '';
    headingActions.append(add,
      button('刷新', 'button quiet compact-button', () => load(root)));
    heading.append(headingCopy, headingActions);

    const tabs = element('div', 'local-library__tabs');
    tabs.setAttribute('role', 'tablist');
    [['articles', '本地文献'], ['abbreviations', '全局缩略词']].forEach(([kind, label]) => {
      const tab = button(label, 'local-library__tab', () => {
        selectLibraryKind(root, kind);
      });
      tab.dataset.libraryKind = kind;
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-controls', 'localReadingLibraryResults');
      tabs.append(tab);
    });
    tabs.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      const kinds = ['articles', 'abbreviations'];
      const current = Math.max(0, kinds.indexOf(state.kind));
      const nextIndex = event.key === 'Home' ? 0
        : event.key === 'End' ? kinds.length - 1
          : (current + (event.key === 'ArrowRight' ? 1 : -1) + kinds.length) % kinds.length;
      const nextKind = kinds[nextIndex];
      event.preventDefault();
      state.kind = nextKind;
      updateControls(root);
      load(root);
      root.querySelector(`[data-library-kind="${nextKind}"]`)?.focus();
    });

    const controls = element('div', 'local-library__controls');
    const searchField = element('label', 'local-library__search-field');
    searchField.append(element('span', '', '检索已保存内容'));
    const search = element('input');
    search.type = 'search';
    search.autocomplete = 'off';
    search.placeholder = '搜索已保存文献';
    search.setAttribute('aria-label', '搜索本地库');
    let timer = null;
    search.addEventListener('input', () => {
      clearTimeout(timer);
      state.query = search.value;
      state.pages[state.kind] = 1;
      timer = setTimeout(() => load(root), 180);
    });
    search.dataset.librarySearch = '';
    searchField.append(search);
    const scopeField = element('label', 'local-library__scope-field');
    scopeField.dataset.libraryScopeField = '';
    scopeField.append(element('span', '', '搜索范围'));
    const scope = element('select');
    scope.setAttribute('aria-label', '文献搜索范围');
    Object.entries(SCOPE_LABELS).forEach(([value, label]) => {
      const option = element('option', '', label);
      option.value = value;
      scope.append(option);
    });
    scope.addEventListener('change', () => {
      state.scope = scope.value;
      state.pages.articles = 1;
      updateControls(root);
      load(root);
    });
    scope.dataset.libraryScope = '';
    scopeField.append(scope);
    controls.append(searchField, scopeField);
    const scopeSummary = element('p', 'local-library__scope-summary');
    scopeSummary.dataset.libraryScopeSummary = '';

    const editor = element('div', 'local-library__editor');
    editor.dataset.libraryEditor = '';
    editor.hidden = true;

    const tagFilter = createTagFilter(root);
    const tagEditor = element('section', 'local-library__tag-editor');
    tagEditor.dataset.libraryTagEditor = '';
    tagEditor.setAttribute('aria-label', '编辑文献标签');
    tagEditor.hidden = true;
    const directoryNotice = element('div', 'local-library__directory-notice');
    directoryNotice.dataset.libraryDirectoryNotice = '';
    directoryNotice.hidden = true;
    const directoryStatus = element('p');
    directoryStatus.dataset.libraryDirectoryStatus = '';
    directoryStatus.setAttribute('role', 'status');
    directoryStatus.setAttribute('aria-live', 'polite');
    const directorySettings = button('目录与本机助手设置', 'button quiet compact-button', () => {
      globalThis.openNativeDirectorySettings();
    });
    directorySettings.dataset.libraryDirectorySettings = '';
    directorySettings.hidden = true;
    directoryNotice.append(directoryStatus, directorySettings);

    const status = element('p', 'local-library__status', '正在读取本地库…');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.dataset.libraryStatus = '';
    const results = element('div', 'local-library__results');
    results.id = 'localReadingLibraryResults';
    results.setAttribute('role', 'tabpanel');
    results.dataset.libraryResults = '';
    const pagination = element('div', 'local-library__pagination');
    pagination.dataset.libraryPagination = '';
    root.append(heading, tabs, controls, scopeSummary, tagFilter, directoryNotice, tagEditor, editor, status, results, pagination);
    updateControls(root);
  }

  function selectLibraryKind(root, nextKind) {
    if (!['articles', 'abbreviations'].includes(nextKind)) return;
    state.kind = nextKind;
    state.pages[nextKind] = Math.max(1, Number(state.pages[nextKind]) || 1);
    updateControls(root);
    load(root);
  }

  function updateControls(root) {
    root.querySelectorAll('[data-library-kind]').forEach(tab => {
      const selected = tab.dataset.libraryKind === state.kind;
      tab.classList.toggle('is-active', selected);
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
    });
    const search = root.querySelector('[data-library-search]');
    if (search) search.placeholder = state.kind === 'articles'
      ? '搜索标题、笔记或已保存正文' : '搜索缩写、全称、中文或文献';
    const scope = root.querySelector('[data-library-scope]');
    const scopeField = root.querySelector('[data-library-scope-field]');
    if (scopeField) scopeField.hidden = state.kind !== 'articles';
    if (scope) scope.value = state.scope;
    const scopeSummary = root.querySelector('[data-library-scope-summary]');
    if (scopeSummary) scopeSummary.textContent = state.kind === 'articles'
      ? `当前范围：${SCOPE_LABELS[state.scope]} · 文献行会标明已保存内容与未覆盖字段。`
      : '当前范围：全局缩略词 · 可检索缩写、全称、中文释义与出现文献。';
    const add = root.querySelector('[data-library-add]');
    if (add) add.hidden = state.kind !== 'abbreviations';
    const editor = root.querySelector('[data-library-editor]');
    if (editor && state.kind !== 'abbreviations') editor.hidden = true;
    const tagFilter = root.querySelector('[data-library-tag-filter]');
    if (tagFilter) tagFilter.hidden = state.kind !== 'articles';
  }

  function createTagFilter(root) {
    const group = element('div', 'local-library__tag-filter');
    group.dataset.libraryTagFilter = '';
    const label = element('label');
    label.append(element('span', '', '按标签筛选'));
    const choice = element('select');
    choice.dataset.libraryTagChoice = '';
    choice.setAttribute('aria-label', '添加标签筛选');
    const placeholder = element('option', '', '选择标签…');
    placeholder.value = '';
    choice.append(placeholder);
    choice.addEventListener('change', () => {
      if (choice.value && !state.tags.includes(choice.value)) state.tags.push(choice.value);
      choice.value = '';
      changeTagFilter(root);
    });
    label.append(choice);
    const modeLabel = element('label');
    modeLabel.append(element('span', '', '匹配方式'));
    const mode = element('select');
    mode.dataset.libraryTagMode = '';
    mode.setAttribute('aria-label', '标签匹配方式');
    [['any', '任一标签'], ['all', '全部标签']].forEach(([value, text]) => {
      const option = element('option', '', text); option.value = value; mode.append(option);
    });
    mode.addEventListener('change', () => { state.tagMode = mode.value; changeTagFilter(root); });
    modeLabel.append(mode);
    const clear = button('清除标签筛选', 'button quiet compact-button', () => {
      state.tags = []; changeTagFilter(root);
    });
    clear.dataset.libraryTagClear = '';
    clear.disabled = true;
    const selected = element('div', 'local-library__tag-chips');
    selected.dataset.librarySelectedTags = '';
    selected.setAttribute('aria-label', '当前标签筛选');
    group.append(label, modeLabel, clear, selected);
    return group;
  }

  function changeTagFilter(root) {
    state.pages.articles = 1;
    const selected = root.querySelector('[data-library-selected-tags]');
    selected.replaceChildren();
    state.tags.forEach(tag => {
      const remove = button(`${tag} ×`, 'local-library__tag-chip', () => {
        state.tags = state.tags.filter(value => value !== tag); changeTagFilter(root);
        root.querySelector('[data-library-tag-choice]').focus();
      });
      remove.setAttribute('aria-label', `移除筛选标签 ${tag}`);
      selected.append(remove);
    });
    root.querySelector('[data-library-tag-clear]').disabled = state.tags.length === 0;
    load(root);
  }

  function updateTagChoices(root, tags) {
    const choice = root.querySelector('[data-library-tag-choice]');
    const valid = Array.isArray(tags) ? tags.filter(tag => typeof tag === 'string' && tag) : [];
    const signature = JSON.stringify(valid);
    if (choice.dataset.options === signature) return;
    choice.dataset.options = signature;
    const placeholder = element('option', '', valid.length ? '选择标签…' : '暂无标签，可在文献行添加');
    placeholder.value = '';
    choice.replaceChildren(placeholder);
    valid.forEach(tag => { const option = element('option', '', tag); option.value = tag; choice.append(option); });
  }

  async function readTagBase(workspaceId, generation) {
    if (!Number.isSafeInteger(generation) || generation < 1) throw new Error('工作区身份无效，请刷新文献列表。');
    const response = await chrome.runtime.sendMessage({ type: 'ARTICLE_WORKSPACE_GET_ASSET',
      workspaceId, relativePath: SciLLM.LOCAL_LIBRARY_TAGS_ASSET_PATH });
    if (!response?.success) throw Object.assign(new Error(response?.error?.message || '读取失败'), { code: response?.error?.code });
    const data = response.data;
    if (data?.workspaceGeneration !== generation) throw new Error('工作区版本已改变，请关闭编辑区并刷新文献列表。');
    if (data.found === false && data.asset === null) return { generation, revision: 0, contentHash: '', tags: [] };
    const asset = data.asset;
    if (data.found !== true || !asset || asset.relativePath !== SciLLM.LOCAL_LIBRARY_TAGS_ASSET_PATH ||
        !Number.isSafeInteger(asset.revision) || asset.revision < 1 ||
        typeof asset.contentHash !== 'string' || !asset.contentHash || asset.contentHash.length > 200) {
      throw new Error('标签资产版本信息无效');
    }
    const content = SciLLM.normalizeLocalLibraryTagsAsset(asset.content, { workspaceId });
    return { generation, revision: asset.revision, contentHash: asset.contentHash, tags: [...content.tags] };
  }

  async function saveTagDraft(workspaceId, base, tags) {
    if (!base || !Number.isSafeInteger(base.generation) || base.generation < 1 ||
        !Number.isSafeInteger(base.revision) || base.revision < 0 ||
        typeof base.contentHash !== 'string' || (base.revision > 0 && !base.contentHash)) {
      throw new Error('没有可校验的标签保存基线');
    }
    const content = SciLLM.normalizeLocalLibraryTagsAsset({ schemaVersion: 1, workspaceId, tags }, { workspaceId });
    const response = await chrome.runtime.sendMessage({ type: 'ARTICLE_WORKSPACE_SAVE_ASSET', workspaceId,
      workspaceGeneration: base.generation, relativePath: SciLLM.LOCAL_LIBRARY_TAGS_ASSET_PATH, content,
      expectedRevision: base.revision, expectedContentHash: base.contentHash, createOnly: base.revision === 0 });
    if (!response?.success || response.data?.saved !== true) {
      throw Object.assign(new Error(response?.error?.message || '标签未能保存'), { code: response?.error?.code });
    }
    const asset = response.data.asset;
    if (!Number.isSafeInteger(asset?.revision) || asset.revision < 1 || typeof asset.contentHash !== 'string' || !asset.contentHash) {
      throw Object.assign(new Error('保存回执无法校验，请读取最新标签确认。'), { code: 'TAG_SAVE_UNVERIFIED' });
    }
    return response.data;
  }

  function tagEditorDirty(session = state.tagEditor) {
    return !!session && (session.input.value.length > 0 ||
      JSON.stringify(session.tags) !== JSON.stringify(session.base?.tags || session.initialTags));
  }

  function openTagEditor(root, item) {
    const previous = state.tagEditor;
    if (previous && (previous.workspaceId === item.workspaceId || previous.busy || tagEditorDirty(previous))) {
      if (previous.workspaceId !== item.workspaceId) previous.status.textContent = '请先保存或关闭当前文献的标签草稿，再编辑另一篇。';
      previous.input.focus(); return;
    }
    const panel = root.querySelector('[data-library-tag-editor]');
    panel.replaceChildren(); panel.hidden = false;
    const heading = element('h4', '', `文献标签 · ${item.title || '未命名文献'}`);
    const help = element('p', '', 'Enter 添加标签；移除只影响本篇文献。最多 32 个，每个最多 80 字。');
    const chips = element('div', 'local-library__tag-chips');
    const inputRow = element('div', 'local-library__tag-input-row');
    const input = element('input'); input.dataset.tagInput = ''; input.autocomplete = 'off';
    input.setAttribute('aria-label', '新文献标签'); input.placeholder = '输入标签，按 Enter 添加';
    const status = element('p', 'local-library__tag-status'); status.dataset.tagStatus = '';
    status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    const session = { workspaceId: item.workspaceId, generation: item.workspaceGeneration, base: null,
      initialTags: [...(item.tags || [])], tags: [...(item.tags || [])], input, status, busy: false, blocked: true };
    state.tagEditor = session;
    const addTag = () => {
      if (!input.value) return true;
      try {
        session.tags = [...SciLLM.normalizeLocalLibraryTags([...session.tags, input.value])];
        input.value = ''; status.textContent = '有未保存的标签修改。'; renderChips(); return true;
      } catch (_) { status.textContent = '标签无效：最多 32 个，每个 1–80 字，不能包含换行或控制字符。输入已保留。'; return false; }
    };
    const add = button('添加', 'button secondary compact-button', () => { addTag(); input.focus(); });
    inputRow.append(input, add);
    input.addEventListener('keydown', event => {
      if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); addTag(); }
    });
    const actions = element('div', 'local-library__tag-actions');
    const save = button('保存标签', 'button primary compact-button', async () => {
      if (session.busy || session.blocked || !addTag()) return;
      setBusy(true); status.textContent = '正在保存标签…';
      try {
        const result = await saveTagDraft(session.workspaceId, session.base, session.tags);
        session.base = { ...session.base, revision: result.asset.revision, contentHash: result.asset.contentHash, tags: [...session.tags] };
        status.textContent = result.directoryPersisted ? '标签已保存到本机并已同步到目录。'
          : `标签已保存到本机；${result.directoryErrorCode ? `目录同步未完成（${result.directoryErrorCode}）` : result.queued ? '目录同步排队中' : '目录尚未同步'}。`;
        load(root);
      } catch (error) {
        // A transport failure can also follow a committed write: require a fresh
        // read, not an automatic retry with a now-ambiguous baseline.
        session.blocked = true;
        status.textContent = /CONFLICT/.test(error.code || '')
          ? '标签保存冲突：另一页面已更新。草稿保留，请读取最新标签后明确选择重新编辑。'
          : `保存未确认：${error.message}。草稿保留，请读取最新标签后重新编辑。`;
      } finally { setBusy(false); }
    });
    const close = button('关闭', 'button quiet compact-button', () => {
      if (session.busy || (tagEditorDirty(session) && !globalThis.confirm('放弃当前文献未保存的标签草稿？'))) return;
      state.tagEditor = null; panel.hidden = true; panel.replaceChildren();
    });
    const refresh = button('读取最新标签', 'button quiet compact-button', () => readLatest(false));
    actions.append(save, refresh, close);
    const latest = element('div', 'local-library__tag-latest'); latest.hidden = true;
    const backup = element('label', 'local-library__tag-backup'); backup.hidden = true;
    backup.append(element('span', '', '上次未保存草稿（保留供复制，不会自动覆盖新版本）'));
    const backupText = element('textarea'); backupText.dataset.tagBackup = ''; backupText.readOnly = true;
    backupText.setAttribute('aria-label', '上次未保存标签草稿'); backup.append(backupText);
    panel.append(heading, help, chips, inputRow, status, actions, latest, backup);
    function renderChips() {
      chips.replaceChildren();
      session.tags.forEach(tag => {
        const remove = button(`${tag} ×`, 'local-library__tag-chip', () => {
          session.tags = session.tags.filter(value => value !== tag); renderChips();
          status.textContent = '有未保存的标签修改。'; input.focus();
        });
        remove.dataset.tagRemove = tag; remove.setAttribute('aria-label', `移除文献标签 ${tag}`);
        remove.disabled = session.busy; chips.append(remove);
      });
    }
    function setBusy(busy) {
      session.busy = busy; input.disabled = busy; add.disabled = busy; close.disabled = busy;
      refresh.disabled = busy; save.disabled = busy || session.blocked;
      chips.querySelectorAll('button').forEach(node => { node.disabled = busy; });
      latest.querySelectorAll('button').forEach(node => { node.disabled = busy; });
    }
    async function readLatest(initial) {
      const requestingControl = document.activeElement;
      setBusy(true); latest.hidden = true; latest.replaceChildren();
      status.textContent = '正在校验已保存标签…';
      try {
        const base = await readTagBase(session.workspaceId, session.generation);
        if (initial) {
          session.base = base; session.tags = [...base.tags]; session.blocked = false; renderChips();
          status.textContent = base.revision ? '已读取本机标签。' : '本篇尚无标签。';
        } else {
          session.blocked = true;
          latest.append(element('p', '', `最新标签：${base.tags.join('、') || '无'}`));
          latest.append(button('采用最新标签，重新编辑', 'button secondary compact-button', () => {
            if (tagEditorDirty(session)) {
              backupText.value += (backupText.value ? '\n\n' : '') + JSON.stringify({ tags: session.tags, input: input.value });
              backup.hidden = false;
            }
            session.base = base; session.tags = [...base.tags]; input.value = ''; session.blocked = false;
            latest.hidden = true; renderChips(); setBusy(false); status.textContent = '已采用最新标签；可重新增删后保存。'; input.focus();
          }));
          latest.hidden = false; status.textContent = '当前草稿仍保留。请核对最新标签，再选择是否重新编辑。';
        }
      } catch (error) {
        session.blocked = true; status.textContent = `标签无法校验：${error.message}。禁止覆盖，已有草稿保留。`;
      } finally {
        setBusy(false);
        if (initial && document.activeElement === requestingControl) input.focus();
      }
    }
    renderChips(); readLatest(true);
  }

  async function mutateAbbreviation(mutation) {
    const response = await chrome.runtime.sendMessage({
      type: 'ABBREVIATION_MEMORY_MUTATE', mutation
    });
    if (!response?.success) {
      const code = String(response?.error?.code || '');
      const messages = {
        ABBREVIATION_ENTRY_EXISTS: '词库中已经有相同的缩写与全称。',
        ABBREVIATION_ENTRY_NOT_FOUND: '该缩略词已被删除，请刷新后重试。',
        INVALID_ABBREVIATION_ENTRY: '请检查缩写、全称和中文释义。'
      };
      throw new Error(messages[code] || response?.error?.message || '缩略词保存失败');
    }
    return response.data;
  }

  function openAbbreviationEditor(root, item = null) {
    const editor = root.querySelector('[data-library-editor]');
    editor.replaceChildren();
    editor.hidden = false;
    const form = element('form', 'local-library__editor-form');
    const title = element('h4', '', item ? `编辑 ${item.abbreviation}` : '新增缩略词');
    const abbreviationLabel = element('label');
    abbreviationLabel.append(element('span', '', '缩写'));
    const abbreviation = element('input');
    abbreviation.name = 'abbreviation';
    abbreviation.required = true;
    abbreviation.maxLength = 30;
    abbreviation.value = item?.abbreviation || '';
    abbreviation.disabled = Boolean(item);
    abbreviationLabel.append(abbreviation);
    const fullNameLabel = element('label');
    fullNameLabel.append(element('span', '', '英文全称'));
    const fullName = element('input');
    fullName.name = 'fullName';
    fullName.required = true;
    fullName.maxLength = 240;
    fullName.value = item?.fullName || '';
    fullNameLabel.append(fullName);
    const meaningLabel = element('label');
    meaningLabel.append(element('span', '', '中文释义（可选）'));
    const meaning = element('input');
    meaning.name = 'meaningZh';
    meaning.maxLength = 240;
    meaning.value = item?.meaningZh || '';
    meaningLabel.append(meaning);
    const hiddenLabel = element('label', 'local-library__visibility-choice');
    const hidden = element('input');
    hidden.type = 'checkbox';
    hidden.checked = item?.hiddenFromReading === true;
    hiddenLabel.append(hidden, document.createTextNode('在阅读文献时隐藏（仍保留在词库中）'));
    const error = element('p', 'local-library__editor-error');
    error.setAttribute('role', 'alert');
    const actions = element('div', 'local-library__editor-actions');
    actions.append(button('取消', 'button quiet compact-button', () => {
      editor.hidden = true;
      editor.replaceChildren();
    }));
    const save = element('button', 'button primary compact-button', item ? '保存修改' : '添加');
    save.type = 'submit';
    actions.append(save);
    form.append(title, abbreviationLabel, fullNameLabel, meaningLabel, hiddenLabel, error, actions);
    form.addEventListener('submit', async event => {
      event.preventDefault();
      save.disabled = true;
      error.textContent = '';
      try {
        await mutateAbbreviation(item ? {
          action: 'update', entryId: item.id,
          fullName: fullName.value, meaningZh: meaning.value,
          hiddenFromReading: hidden.checked
        } : {
          action: 'create', abbreviation: abbreviation.value,
          fullName: fullName.value, meaningZh: meaning.value,
          hiddenFromReading: hidden.checked
        });
        editor.hidden = true;
        editor.replaceChildren();
        state.pages.abbreviations = 1;
        await load(root);
      } catch (mutationError) {
        error.textContent = mutationError.message;
        save.disabled = false;
      }
    });
    editor.append(form);
    (item ? fullName : abbreviation).focus();
  }

  async function openArticleDirectory(root, item) {
    if (state.directoryOpening) return;
    state.directoryOpening = item.workspaceId;
    const notice = root.querySelector('[data-library-directory-notice]');
    const status = root.querySelector('[data-library-directory-status]');
    const settings = root.querySelector('[data-library-directory-settings]');
    notice.hidden = false; settings.hidden = true;
    status.dataset.state = 'pending';
    status.textContent = `正在核验「${item.title || '未命名文献'}」的文献目录…`;
    syncDirectoryOpenButtons(root);
    try {
      const response = await chrome.runtime.sendMessage({ type: 'LOCAL_READING_LIBRARY_OPEN_DIRECTORY', workspaceId: item.workspaceId });
      if (!response?.success) throw Object.assign(new Error(response?.error?.message || '未能确认目录打开结果，请检查本机助手和目录设置。'), { code: response?.error?.code });
      if (response.data?.opened !== true) throw new Error('未收到有效的系统打开确认，请先查看文件管理器，避免重复打开。');
      status.dataset.state = 'success';
      status.textContent = `已请求系统打开「${item.title || '未命名文献'}」的文件夹，请查看文件管理器。`;
    } catch (error) {
      status.dataset.state = 'error'; settings.hidden = false;
      status.textContent = `「${item.title || '未命名文献'}」：${error.message || '目录打开未确认，请先查看文件管理器。'}${error.code ? `（${error.code}）` : ''}`;
    } finally {
      state.directoryOpening = '';
      syncDirectoryOpenButtons(root);
    }
  }

  function syncDirectoryOpenButtons(root) {
    root.querySelectorAll('[data-library-open-directory]').forEach(control => {
      control.disabled = Boolean(state.directoryOpening);
      control.setAttribute('aria-busy', String(control.dataset.workspaceId === state.directoryOpening));
      control.textContent = control.dataset.workspaceId === state.directoryOpening ? '正在打开…' : '打开文件夹';
    });
  }

  function coverageText(coverage) {
    const available = ['notes', 'fulltext', 'abstract', 'method', 'caption']
      .filter(scope => coverage?.[scope]).map(scope => SCOPE_LABELS[scope]);
    const missing = ['fulltext', 'abstract', 'method', 'caption']
      .filter(scope => !coverage?.[scope]).map(scope => SCOPE_LABELS[scope]);
    return `已保存：${available.join('、') || '仅标题'}` +
      (missing.length ? ` · 未覆盖：${missing.join('、')}` : '');
  }

  function renderArticles(container, items, data = {}) {
    if (!items.length) {
      const filtered = (state.tags || []).length > 0;
      container.append(element('p', 'local-library__empty', data.totals?.articles === 0
        ? '尚未保存文献。打开论文并开始研读后，会自动出现在这里。'
        : filtered ? (state.query.trim()
          ? '没有同时匹配关键词、范围与标签的文献。可分别调整这些条件。'
          : '没有符合当前标签条件的文献。可切换任一/全部标签，或清除标签筛选。') : state.query.trim()
        ? '没有匹配的已保存文献。试试其他关键词或搜索范围。'
        : '尚未保存文献。打开论文并开始研读后，会自动出现在这里。'));
      return;
    }
    const tableWrap = element('div', 'local-library__table-wrap local-library__article-table-wrap');
    tableWrap.tabIndex = 0;
    tableWrap.setAttribute('role', 'region');
    tableWrap.setAttribute('aria-label', '已保存文献列表，窄屏可左右滚动查看四列');
    const table = element('table', 'local-library__table local-library__article-table');
    const caption = element('caption', 'sr-only', '已保存文献：论文标题、发表日期、杂志名称和保存时间');
    const head = element('thead');
    const headRow = element('tr');
    ['论文标题', '发表日期', '杂志名称', '保存时间'].forEach(label => {
      const cell = element('th', '', label);
      cell.setAttribute('scope', 'col');
      if (label === '保存时间') cell.title = '最近一次点击保存且完整存入本机的时间；不代表目录同步完成。未记录时不以页面更新时间替代';
      headRow.append(cell);
    });
    head.append(headRow);
    const body = element('tbody');
    const recordedText = value => typeof value === 'string' && value.trim() ? value.trim() : '未记录';
    items.forEach(item => {
      const card = element('tr', 'local-library__article');
      card.dataset.workspaceId = String(item.workspaceId || '');
      const information = element('td', 'local-library__article-information');
      const heading = element('div', 'local-library__article-heading');
      const title = element('h4');
      title.append(safeArticleLink(item.url, item.title));
      const open = safeArticleLink(item.url, '打开原文');
      open.className = 'button quiet compact-button local-library__article-open';
      heading.append(title, open);
      information.append(heading);
      information.append(element('p', 'local-library__article-url', String(item.url || '来源未记录')));
      const tags = Array.isArray(item.tags) ? item.tags.filter(tag => typeof tag === 'string' && tag.trim()) : [];
      if (tags.length) {
        const list = element('ul', 'local-library__article-tags');
        list.setAttribute('aria-label', '文献标签');
        tags.forEach(tag => list.append(element('li', '', tag)));
        information.append(list);
      }
      const editTags = button(item.tagState === 'invalid' ? '标签异常 · 查看' : '编辑标签',
        'button quiet compact-button local-library__edit-tags', () => openTagEditor(container.closest('.local-library'), item));
      editTags.dataset.libraryEditTags = '';
      editTags.setAttribute('aria-label', `编辑 ${item.title || '未命名文献'} 的标签`);
      const folder = button('打开文件夹', 'button quiet compact-button local-library__open-directory',
        () => openArticleDirectory(container.closest('.local-library'), item));
      folder.dataset.libraryOpenDirectory = '';
      folder.dataset.workspaceId = String(item.workspaceId || '');
      folder.setAttribute('aria-label', `打开 ${item.title || '未命名文献'} 的文件夹`);
      folder.title = '通过本机助手打开已同步且归属验证通过的文献目录';
      folder.disabled = Boolean(state.directoryOpening);
      const actions = element('div', 'local-library__article-actions');
      actions.append(editTags, folder);
      information.append(actions);
      const details = element('details', 'local-library__article-details');
      details.open = Boolean(state.query.trim() && (item.hitScopes?.length || item.snippets?.length));
      details.append(element('summary', '', '本地内容与命中片段'));
      details.append(element('p', 'local-library__meta', coverageText(item.coverage)));
      if (item.hitScopes?.length) {
        details.append(element('p', 'local-library__hits',
          `命中范围：${item.hitScopes.map(scope => SCOPE_LABELS[scope]).join('、')}`));
      }
      (item.snippets || []).forEach(hit => {
        const snippet = element('p', 'local-library__snippet');
        snippet.append(element('strong', '', `${SCOPE_LABELS[hit.scope]} · ${hit.label || '命中'}`));
        snippet.append(document.createTextNode(` ${hit.text}`));
        details.append(snippet);
      });
      information.append(details);
      card.append(information,
        element('td', 'local-library__article-publication', recordedText(item.publicationDate)),
        element('td', 'local-library__article-journal', recordedText(item.journal)),
        element('td', 'local-library__article-saved', recordedText(item.savedAt)));
      body.append(card);
    });
    table.append(caption, head, body);
    tableWrap.append(table);
    container.append(tableWrap);
  }

  function renderAbbreviations(container, items) {
    if (!items.length) {
      container.append(element('p', 'local-library__empty', '没有匹配的全局缩略词。'));
      return;
    }
    const tableWrap = element('div', 'local-library__table-wrap');
    const table = element('table', 'local-library__table');
    const head = element('thead');
    const row = element('tr');
    const root = container.closest('.local-library');
    ['缩写', '全称', '中文', '导入日期', '文献', '次数', '阅读显示', '详情', '管理'].forEach(label =>
      row.append(element('th', '', label)));
    head.append(row);
    const body = element('tbody');
    items.forEach(item => {
      const itemRow = element('tr');
      itemRow.append(element('td', 'local-library__abbr', item.abbreviation));
      itemRow.append(element('td', 'local-library__full-name', item.fullName));
      itemRow.append(element('td', 'local-library__meaning', item.meaningZh || '—'));
      itemRow.append(element('td', 'local-library__date', date(item.firstImportedAt)));
      itemRow.append(element('td', 'local-library__number', item.documentCount));
      itemRow.append(element('td', 'local-library__number', item.totalCount));
      const visibilityCell = element('td', 'local-library__visibility');
      const visibility = element('input');
      visibility.type = 'checkbox';
      visibility.checked = item.hiddenFromReading !== true;
      visibility.setAttribute('aria-label', `${item.abbreviation} 在阅读文献时显示`);
      visibility.addEventListener('change', async () => {
        visibility.disabled = true;
        try {
          await mutateAbbreviation({
            action: 'set-visibility', entryId: item.id,
            hiddenFromReading: !visibility.checked
          });
          await load(root);
        } catch (error) {
          visibility.checked = !visibility.checked;
          visibility.disabled = false;
          root.querySelector('[data-library-status]').textContent = error.message;
        }
      });
      const visibilityStatus = element(
        'span', 'local-library__visibility-status',
        item.hiddenFromReading === true ? '隐藏' : '显示'
      );
      visibilityCell.append(visibility, visibilityStatus);
      itemRow.append(visibilityCell);
      const action = element('td');
      const detailsRow = element('tr', 'local-library__details-row');
      detailsRow.hidden = true;
      const detailCell = element('td');
      detailCell.colSpan = 9;
      let detailPage = 1;
      let loaded = false;
      const loadDetails = async () => {
        detailCell.replaceChildren(element('span', '', '正在读取文献关联…'));
        try {
          const response = await chrome.runtime.sendMessage({
            type: 'LOCAL_READING_LIBRARY_QUERY',
            kind: 'occurrences',
            abbreviationId: item.id,
            page: detailPage,
            pageSize: 25
          });
          if (!response?.success) throw new Error(response?.error?.message || '关联读取失败');
          const data = response.data;
          detailCell.replaceChildren();
          if (data.items?.length) {
            const list = element('ul');
            data.items.forEach(hit => {
              const line = element('li');
              line.append(safeArticleLink(hit.url, hit.title));
              line.append(document.createTextNode(`：${hit.count} 次`));
              list.append(line);
            });
            detailCell.append(list);
            if (data.pageCount > 1) {
              const pager = element('div', 'local-library__detail-pagination');
              const previous = button('上一页', 'button quiet compact-button', () => {
                detailPage -= 1;
                loadDetails();
              });
              previous.disabled = data.page <= 1;
              const next = button('下一页', 'button quiet compact-button', () => {
                detailPage += 1;
                loadDetails();
              });
              next.disabled = data.page >= data.pageCount;
              pager.append(previous, element('span', '',
                `${data.page} / ${data.pageCount} · ${data.total} 篇`), next);
              detailCell.append(pager);
            }
          } else {
            detailCell.append(element('span', '', '尚未在已保存正文或图注中出现。'));
          }
          loaded = true;
        } catch (error) {
          detailCell.replaceChildren(element('span', '', `关联读取失败：${error.message}`));
        }
      };
      const toggle = button('查看出现文献', 'button quiet compact-button local-library__detail-toggle', () => {
        detailsRow.hidden = !detailsRow.hidden;
        toggle.textContent = detailsRow.hidden ? '查看出现文献' : '收起出现文献';
        toggle.setAttribute('aria-expanded', String(!detailsRow.hidden));
        if (!detailsRow.hidden && !loaded) loadDetails();
      });
      toggle.setAttribute('aria-expanded', 'false');
      action.append(toggle);
      itemRow.append(action);
      const manage = element('td', 'local-library__manage');
      manage.append(button('编辑', 'button quiet compact-button', () =>
        openAbbreviationEditor(root, item)));
      manage.append(button('删除', 'button quiet compact-button', async () => {
        if (!globalThis.confirm(`从全局词库删除 ${item.abbreviation}？`)) return;
        try {
          await mutateAbbreviation({ action: 'delete', entryId: item.id });
          await load(root);
        } catch (error) {
          root.querySelector('[data-library-status]').textContent = error.message;
        }
      }));
      itemRow.append(manage);
      detailsRow.append(detailCell);
      body.append(itemRow, detailsRow);
    });
    table.append(head, body);
    tableWrap.append(table);
    container.append(tableWrap);
  }

  function renderPagination(root, data) {
    const pagination = root.querySelector('[data-library-pagination]');
    pagination.replaceChildren();
    const previous = button('上一页', 'button quiet compact-button', () => {
      state.pages[state.kind] -= 1;
      load(root);
    });
    previous.disabled = data.page <= 1;
    const next = button('下一页', 'button quiet compact-button', () => {
      state.pages[state.kind] += 1;
      load(root);
    });
    next.disabled = data.page >= data.pageCount;
    pagination.append(previous,
      element('span', '', `第 ${data.page} / ${data.pageCount} 页 · 共 ${data.total} 项`), next);
  }

  async function load(root) {
    const sequence = ++state.sequence;
    const status = root.querySelector('[data-library-status]');
    const results = root.querySelector('[data-library-results]');
    status.textContent = '正在读取本地库…';
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'LOCAL_READING_LIBRARY_QUERY',
        kind: state.kind,
        query: state.query,
        scope: state.scope,
        page: state.pages[state.kind],
        pageSize: state.kind === 'articles' ? 12 : 25,
        ...(state.kind === 'articles' ? { tags: [...state.tags], tagMode: state.tagMode } : {})
      });
      if (sequence !== state.sequence) return;
      if (!response?.success) throw new Error(response?.error?.message || '本地库读取失败');
      const data = response.data;
      results.replaceChildren();
      state.pages[state.kind] = Math.max(1, Number(data.page) || 1);
      if (state.kind === 'articles') {
        renderArticles(results, data.items || [], data);
        updateTagChoices(root, data.availableTags);
      }
      else renderAbbreviations(results, data.items || []);
      const totalArticles = Number(data.totals?.articles) || 0;
      const totalAbbreviations = Number(data.totals?.abbreviations) || 0;
      if (state.kind === 'articles' && state.scope !== 'all' && state.scope !== 'title') {
        const hasMatched = Number.isSafeInteger(data.matchedCount) && data.matchedCoverage;
        const covered = Number(data.totals?.coverage?.[state.scope]) || 0;
        const matched = hasMatched && (state.tags.length || state.query.trim())
          ? `当前匹配覆盖 ${Number(data.matchedCoverage[state.scope]) || 0} / ${data.matchedCount} 篇；` : '';
        status.textContent = matched + `全库${SCOPE_LABELS[state.scope]}可检索覆盖 ${covered} / ${totalArticles} 篇；` +
          `未保存该部分的文献不会产生该范围命中。`;
      } else if (state.kind === 'articles' && (state.tags.length || state.query.trim())) {
        status.textContent = `匹配 ${data.matchedCount ?? data.total} 篇文献 · 全库 ${totalArticles} 篇。`;
      } else {
        status.textContent = `本机共 ${totalArticles} 篇已保存文献、${totalAbbreviations} 个全局缩略词。`;
      }
      renderPagination(root, data);
    } catch (error) {
      if (sequence !== state.sequence) return;
      results.replaceChildren();
      status.textContent = `本地库读取失败：${error.message}`;
      root.querySelector('[data-library-pagination]').replaceChildren();
    }
  }

  function mountLocalReadingLibrary(root = document.getElementById('localReadingLibrary')) {
    if (!root || root.dataset.libraryMounted === 'true') return null;
    root.dataset.libraryMounted = 'true';
    createShell(root);
    load(root);
    return root;
  }

  globalThis.mountLocalReadingLibrary = mountLocalReadingLibrary;
  globalThis.addEventListener('beforeunload', event => {
    if (!tagEditorDirty() && !state.tagEditor?.busy) return;
    event.preventDefault(); event.returnValue = '';
  });
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => mountLocalReadingLibrary(), { once: true });
  } else {
    mountLocalReadingLibrary();
  }
})();
