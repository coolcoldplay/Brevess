(function localReadingLibraryOptions() {
  'use strict';
  const state = { kind: 'articles', query: '', pages: { articles: 1, abbreviations: 1 }, sequence: 0 };
  function element(tag, className, content) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (content !== undefined) node.textContent = String(content);
    return node;
  }

  const text = value => SciLLM.translateInterfaceText?.(value) ?? String(value || '');
  function preserveUserText(node) { node.dataset.i18nIgnore = ''; return node; }
  function userElement(tag, className, content) { return preserveUserText(element(tag, className, content)); }

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
      let sourcePath = parsed.pathname;
      try { sourcePath = decodeURIComponent(sourcePath); } catch (_) {}
      const ordinaryLocalPdf = parsed.protocol === 'file:' && !parsed.host &&
        !parsed.username && !parsed.password && !parsed.search &&
        !/[\u0000-\u001f\u007f]/u.test(sourcePath) && /\.pdf$/iu.test(sourcePath);
      const localReader = localPdfReader || (ordinaryLocalPdf
        ? SciLLM.createPdfReaderUrl?.(chrome.runtime.getURL.bind(chrome.runtime), parsed.href) : '');
      if (!localReader && !['https:', 'http:'].includes(parsed.protocol)) return element('span', '', label);
      const link = element('a', '', label);
      link.href = localReader || (SciLLM.isLikelyPdfUrl?.(parsed.href)
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
    return new Intl.DateTimeFormat(SciLLM.getInterfaceLanguage?.() === 'en' ? 'en' : 'zh-CN', { dateStyle: 'medium' }).format(new Date(value));
  }

  function workbenchLink() {
    const link = element('a', 'button primary compact-button', '打开文献总库 →');
    link.href = globalThis.chrome?.runtime?.getURL?.('workbench/index.html#library') || new URL('workbench/index.html#library', globalThis.location.href).href;
    link.target = '_blank'; link.rel = 'noopener noreferrer'; return link;
  }

  function createShell(root) {
    root.replaceChildren(); root.classList.add('local-library');
    const heading = element('div', 'local-library__heading'), copy = element('div');
    copy.append(element('h3', '', '本机阅读资料与缩略词'), element('p', '', '文献搜索、标签与附件请到文献总库。这里保留本机阅读资料概况与全局缩略词管理。'));
    const actions = element('div', 'local-library__heading-actions');
    const add = button('新增缩略词', 'button secondary compact-button', () => openAbbreviationEditor(root)); add.dataset.libraryAdd = '';
    actions.append(workbenchLink(), add, button('刷新', 'button quiet compact-button', () => load(root))); heading.append(copy, actions);
    const tabs = element('div', 'local-library__tabs'); tabs.setAttribute('role', 'tablist');
    for (const [kind, label] of [['articles', '本机阅读资料'], ['abbreviations', '全局缩略词']]) {
      const tab = button(label, 'local-library__tab', () => selectLibraryKind(root, kind));
      tab.dataset.libraryKind = kind; tab.setAttribute('role', 'tab'); tab.setAttribute('aria-controls', 'localReadingLibraryResults'); tabs.append(tab);
    }
    tabs.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      const kinds = ['articles', 'abbreviations'], current = kinds.indexOf(state.kind);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? 1 : (current + 1) % 2;
      event.preventDefault(); selectLibraryKind(root, kinds[next]); root.querySelector(`[data-library-kind="${kinds[next]}"]`)?.focus();
    });
    const controls = element('div', 'local-library__controls'); controls.dataset.libraryControls = '';
    const searchField = element('label', 'local-library__search-field'); searchField.append(element('span', '', '搜索全局缩略词'));
    const search = element('input'); search.type = 'search'; search.autocomplete = 'off'; search.placeholder = '搜索缩写、全称、中文或文献';
    search.setAttribute('aria-label', '搜索全局缩略词'); search.dataset.librarySearch = ''; let timer;
    search.addEventListener('input', () => { clearTimeout(timer); state.query = search.value; state.pages.abbreviations = 1; timer = setTimeout(() => load(root), 180); });
    searchField.append(search); controls.append(searchField);
    const editor = element('div', 'local-library__editor'); editor.dataset.libraryEditor = ''; editor.hidden = true;
    const status = element('p', 'local-library__status', '正在读取本机资料…'); status.dataset.libraryStatus = ''; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    const results = element('div', 'local-library__results'); results.id = 'localReadingLibraryResults'; results.dataset.libraryResults = ''; results.setAttribute('role', 'tabpanel');
    const pagination = element('div', 'local-library__pagination'); pagination.dataset.libraryPagination = '';
    root.append(heading, tabs, controls, editor, status, results, pagination); updateControls(root);
  }
  function selectLibraryKind(root, nextKind) {
    if (!['articles', 'abbreviations'].includes(nextKind)) return;
    state.kind = nextKind; updateControls(root); load(root);
  }
  function updateControls(root) {
    root.querySelectorAll('[data-library-kind]').forEach(tab => { const selected = tab.dataset.libraryKind === state.kind;
      tab.classList.toggle('is-active', selected); tab.setAttribute('aria-selected', String(selected)); tab.tabIndex = selected ? 0 : -1; });
    root.querySelector('[data-library-controls]').hidden = state.kind !== 'abbreviations';
    root.querySelector('[data-library-add]').hidden = state.kind !== 'abbreviations';
    if (state.kind !== 'abbreviations') root.querySelector('[data-library-editor]').hidden = true;
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
      itemRow.append(userElement('td', 'local-library__abbr', item.abbreviation));
      itemRow.append(userElement('td', 'local-library__full-name', item.fullName));
      itemRow.append(userElement('td', 'local-library__meaning', item.meaningZh || '—'));
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
              line.append(preserveUserText(safeArticleLink(hit.url, hit.title)));
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
        if (!globalThis.confirm(text(`从全局词库删除 ${item.abbreviation}？`))) return;
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

  async function readLocalSummary(sendMessage = message => chrome.runtime.sendMessage(message)) {
    const papers = new Set(), sources = new Map(); let pages = 1, totals;
    for (let page = 1; page <= pages; page++) {
      const response = await sendMessage({ type: 'LOCAL_READING_LIBRARY_QUERY', kind: 'articles', query: '', scope: 'all', page, pageSize: 100 });
      if (response?.success !== true) throw new Error(response?.error?.message || '本机资料读取失败');
      const data = response.data;
      if (!data || !Array.isArray(data.items) || !Number.isSafeInteger(data.pageCount) || data.pageCount < 1 || data.pageCount > 1000 || data.page !== page) throw new Error('本机资料分页无法校验，请刷新。');
      if (totals && (totals.articles !== data.totals?.articles || totals.sources !== data.totals?.sources)) throw new Error('读取期间本机资料已变化，请刷新统计。');
      totals = data.totals || {}; pages = data.pageCount;
      for (const paper of data.items) {
        const identity = paper.paperId || paper.workspaceId;
        if (typeof identity !== 'string' || !identity) throw new Error('文献身份无法校验，请刷新。');
        papers.add(identity);
        for (const source of paper.sourceDocuments?.length ? paper.sourceDocuments : [paper]) {
          if (/^workspace:[a-f0-9]{12,64}$/u.test(source.workspaceId || '') && source.inventoryOnly !== true) sources.set(source.workspaceId, source);
        }
      }
    }
    if (Number.isSafeInteger(totals.articles) && totals.articles !== papers.size || Number.isSafeInteger(totals.sources) && totals.sources !== sources.size) throw new Error('本机资料数量已变化或身份不完整，请刷新统计。');
    const documents = [...sources.values()];
    return { papers: papers.size, sources: sources.size, pdf: documents.filter(source => source.sourceKind === 'pdf').length,
      html: documents.filter(source => source.sourceKind === 'html').length,
      partialHtml: documents.filter(source => source.sourceKind === 'html' && source.offlineSnapshotStatus === 'partial').length,
      unsavedHtml: documents.filter(source => source.sourceKind === 'html' && !source.hasOfflineSnapshot).length,
      abbreviations: Number(totals.abbreviations) || 0, sourceRecords: documents };
  }
  let summaryPending;
  function currentSummary() { if (!summaryPending) summaryPending = readLocalSummary().finally(() => { summaryPending = null; }); return summaryPending; }
  function renderSummary(container, summary) {
    const facts = element('dl', 'local-library__summary'); facts.dataset.librarySummary = '';
    for (const [label, value] of [['本机文献', summary.papers], ['源文档', summary.sources], ['PDF 来源', summary.pdf], ['HTML 来源', summary.html], ['部分离线 HTML', summary.partialHtml], ['未保存离线网页的 HTML', summary.unsavedHtml]]) {
      const stat = element('div', 'local-library__stat');
      stat.append(element('dt', '', label), element('dd', '', value));
      facts.append(stat);
    }
    container.append(facts, element('p', 'local-library__summary-note', '此处统计本机阅读工作区；PDF / HTML 为来源数量，不代表所有原件均完整。文献总库还可包含手工、导入和雷达元数据。'));
  }
  function parseLibraryDirectoryHash(hash) {
    const params = new URLSearchParams(String(hash || '').replace(/^#/, ''));
    if (!params.has('libraryDirectory')) return null;
    const values = params.getAll('libraryDirectory');
    if (values.length !== 1 || !/^workspace:[a-f0-9]{64}$/u.test(values[0])) throw new Error('目录来源身份无效，请从文献总库重新选择。');
    return values[0];
  }
  function createDirectoryConfirmationController({ readSummary, sendMessage, onChange = () => {} }) {
    const state = { source: null, loading: false, opening: false, status: '', error: false }; let sequence = 0;
    const change = () => onChange(state);
    async function load(hash) {
      const current = ++sequence; state.source = null; state.error = false;
      let workspaceId;
      try { workspaceId = parseLibraryDirectoryHash(hash); } catch (error) { state.loading = false; state.error = true; state.status = error.message; change(); return; }
      if (!workspaceId) { state.loading = false; state.status = ''; change(); return; }
      state.loading = true; state.status = '正在核对本机文献来源…'; change();
      try {
        const summary = await readSummary(); if (current !== sequence) return;
        const source = summary.sourceRecords.find(item => item.workspaceId === workspaceId && item.inventoryOnly !== true && Number.isSafeInteger(item.workspaceGeneration) && item.workspaceGeneration >= 1);
        if (!source) throw new Error('未找到可校验的本机文献来源，请刷新文献总库。');
        state.source = { workspaceId, workspaceGeneration: source.workspaceGeneration, title: String(source.title || source.fileName || '未命名来源') };
        state.status = '请核对文献，然后点击“打开文件夹”。目录归属与同步状态将由现有本机助手再次校验。';
      } catch (error) { if (current === sequence) { state.error = true; state.status = error.message || '本机来源读取失败。'; } }
      finally { if (current === sequence) { state.loading = false; change(); } }
    }
    async function open() {
      if (!state.source || state.loading || state.opening) return false;
      const source = { ...state.source }, current = sequence;
      state.opening = true; state.error = false; state.status = `正在核验「${source.title}」的文献目录…`; change();
      try {
        const response = await sendMessage({ type: 'LOCAL_READING_LIBRARY_OPEN_DIRECTORY', workspaceId: source.workspaceId });
        if (response?.success !== true) throw new Error(response?.error?.message || '目录打开未确认，请检查本机助手和目录设置。');
        if (response.data?.opened !== true || response.data.workspaceId !== source.workspaceId) throw new Error('未收到有效的系统打开确认，请先查看文件管理器，避免重复打开。');
        if (current === sequence) state.status = `已请求系统打开「${source.title}」的文件夹，请查看文件管理器。`;
        return true;
      } catch (error) { if (current === sequence) { state.error = true; state.status = error.message || '目录打开未确认，请先查看文件管理器。'; } return false; }
      finally { state.opening = false; change(); }
    }
    return { state, load, open };
  }
  let directoryController, directoryCard;
  function mountDirectoryConfirmation() {
    const raw = new URLSearchParams(String(globalThis.location?.hash || '').replace(/^#/, ''));
    if (!raw.has('libraryDirectory')) { directoryCard?.remove(); directoryCard = null; directoryController?.load(''); return; }
    const host = document.getElementById('localStorageSettings'); if (!host) return;
    if (!directoryCard) { directoryCard = element('section', 'settings-section'); directoryCard.dataset.libraryDirectoryConfirmation = ''; host.append(directoryCard); }
    directoryController ||= createDirectoryConfirmationController({ readSummary: currentSummary, sendMessage: message => chrome.runtime.sendMessage(message), onChange: state => {
      if (!directoryCard) return;
      const title = element('h3', '', '打开文献文件夹'), source = userElement('p', '', state.source?.title || '正在选择来源');
      const identity = element('small', '', state.source ? '已核对本机文献来源' : '');
      const status = element('p', '', state.status); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
      const open = button(state.opening ? '正在打开…' : '打开文件夹', 'button primary compact-button', () => directoryController.open());
      open.disabled = !state.source || state.loading || state.opening; open.dataset.libraryDirectoryConfirm = '';
      const settings = button('目录与本机助手设置', 'button quiet compact-button', () => globalThis.openNativeDirectorySettings?.()); settings.hidden = !state.error;
      directoryCard.replaceChildren(title, source, identity, status, open, settings);
    } });
    directoryController.load(globalThis.location.hash);
  }

  async function load(root) {
    const sequence = ++state.sequence, kind = state.kind;
    const status = root.querySelector('[data-library-status]'), results = root.querySelector('[data-library-results]');
    status.textContent = '正在读取本机资料…';
    try {
      if (kind === 'articles') {
        const summary = await currentSummary(); if (sequence !== state.sequence) return;
        results.replaceChildren(); renderSummary(results, summary); root.querySelector('[data-library-pagination]').replaceChildren();
        status.textContent = `本机共 ${summary.papers} 篇已保存文献、${summary.abbreviations} 个全局缩略词。`;
      } else {
        const response = await chrome.runtime.sendMessage({ type: 'LOCAL_READING_LIBRARY_QUERY', kind: 'abbreviations', query: state.query, page: state.pages.abbreviations, pageSize: 25 });
        if (sequence !== state.sequence) return;
        if (response?.success !== true) throw new Error(response?.error?.message || '缩略词库读取失败');
        const data = response.data; results.replaceChildren(); state.pages.abbreviations = Math.max(1, Number(data.page) || 1);
        renderAbbreviations(results, data.items || []); renderPagination(root, data);
        status.textContent = `本机共 ${Number(data.totals?.abbreviations) || 0} 个全局缩略词。`;
      }
    } catch (error) {
      if (sequence !== state.sequence) return;
      results.replaceChildren(); status.textContent = `本机资料读取失败：${error.message}`; root.querySelector('[data-library-pagination]').replaceChildren();
    }
  }

  function mountLocalReadingLibrary(root = document.getElementById('localReadingLibrary')) {
    if (!root || root.dataset.libraryMounted === 'true') return null;
    root.dataset.libraryMounted = 'true';
    createShell(root);
    load(root);
    return root;
  }

  if (typeof module === 'object' && module.exports) {
    module.exports = { readLocalSummary, parseLibraryDirectoryHash, createDirectoryConfirmationController };
    return;
  }
  globalThis.mountLocalReadingLibrary = mountLocalReadingLibrary;
  SciLLM.onInterfaceLanguageChange?.(() => { const root = document.getElementById('localReadingLibrary'); if (root?.dataset.libraryMounted === 'true') load(root); });
  globalThis.addEventListener('hashchange', mountDirectoryConfirmation);
  const mount = () => { mountLocalReadingLibrary(); mountDirectoryConfirmation(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true }); else mount();
})();
