/* Settings B: presentation only. Existing controls, stores and save handlers remain authoritative. */
(function (root) {
  'use strict';
  root.SciLLM?.registerInterfaceTranslations?.(Object.fromEntries(`
BREVESS 设置	BREVESS settings
搜索设置	Search settings
设置分类	Settings categories
阅读与高亮	Reading & highlights
语音朗读	Read aloud
问答与笔记	Q&A & notes
网页滤镜	Page filters
隐私与权限	Privacy & permissions
通用	General
关于 BREVESS	About BREVESS
设置检查	Setup check
接好一次，让不同的阅读任务各得其所。	Connect once, then choose the right model for each task.
选择阅读场景，调整识别规则与 PDF 解析。	Choose reading modes, highlighting rules and PDF parsing.
用适合自己的声音，听懂论文。	Listen to papers in a voice that suits you.
让常用问题和笔记结构更合你意。	Personalize common questions and note templates.
管理已经验证的显示规则，专注论文内容。	Manage validated display rules for focused reading.
管理本地资料、保存目录与备份。	Manage local content, storage folders and backups.
你决定哪些内容可以交给模型。	You decide which content can be sent to a model.
界面语言与快捷操作。	Interface language and keyboard shortcuts.
开源许可与问题反馈。	Open-source licenses and feedback.
选择本次阅读需要关注的证据。	Choose the evidence to focus on while reading.
管理 AI 提示词与离线正则规则。	Manage AI prompts and offline matching rules.
查看阅读、保存与模型的当前状态。	Check reading, storage and model setup.
已连接的服务	Connected services
添加连接	Add connection
编辑连接	Edit connection
保存正文发送许可	Save content-sharing permission
正文发送许可已保存	Content-sharing permission saved
设置尚未保存	Settings have not been saved
模型使用	Model preferences
默认连接与模型	Default connection and model
新任务使用已保存的模型配置。	New tasks use your saved model configuration.
按功能分配模型	Models by task
问答、解图、笔记等任务可分别指定。	Choose separate models for Q&A, figures, notes and more.
模型与 Token	Models & tokens
连接与权限	Connections & permissions
连接你的 Agent	Connect your Agent
选择你在用的客户端，让它帮你完成接入。	Choose your client and let it set up the connection.
选择 Agent 客户端	Choose an Agent client
插件内调用与 MCP	Model access and MCP
国内 Agent · MCP	Chinese agents · MCP
其他 Agent · MCP	Other agents · MCP
复制接入提示词	Copy setup prompt
连接状态与权限	Connection status and permissions
配置完成后自动配对，检查读取与写入权限。	Pair after setup and check read/write permissions.
支持插件内调用与 Agent 操作文献、课题；接通后分别测试。	Supports model access and Agent operations on literature and projects. Test each direction after connecting.
通过 MCP 读取与操作 BREVESS。插件内调用此 Agent 尚未适配。	Read and operate BREVESS through MCP. Model calls from BREVESS are not yet supported for this client.
已复制，粘贴到所选客户端即可开始。	Copied. Paste into the selected client to begin.
请复制已选中的提示词。	Copy the selected prompt.
复制未完成，请重试。	Copy failed. Please try again.
外部 Agent	External agents
管理已配对客户端与连接。	Manage paired clients and connections.
决定模型能否读取论文正文、图注与图片。	Control whether models can read article text, captions and images.
查看隐私与权限	View privacy & permissions
Panel 追问提示词	Panel follow-up prompts
保存问答与笔记设置	Save Q&A and note settings
选择需要关注的证据类别。	Choose the evidence categories to focus on.
编辑 AI 提示词、正则与类别颜色。	Edit AI prompts, matching rules and category colors.
保存阅读偏好	Save reading preferences
保存失败，请重试	Could not save. Try again.
论文网址白名单	Article website allowlist
PDF 解析与增强识别	PDF parsing & enhanced recognition
保存目录与加密备份	Storage folder & encrypted backup
论文工作区与占用	Article workspaces & storage usage
旧版数据迁移	Legacy data migration
反馈语料与离线规则	Feedback corpus & offline rules
已配置	Configured
未配置	Not configured
已允许	Allowed
未允许	Not allowed
还没有连接，点击右上角添加。	No connections yet. Add one using the button above.
配置模型前，请先在隐私与权限中确认数据隐私风险。	Review the data privacy notice in Privacy & permissions before configuring a model.
功能模型与 Token	Task models & tokens
PDF 解析	PDF parsing
Panel 追问	Panel follow-ups
保存目录与备份	Storage folder & backup
没有找到相关设置	No matching settings
`.trim().split('\n').map(line => line.split('\t'))));
  const $ = id => document.getElementById(id);
  const icons = {
    model: '<rect x="6" y="6" width="12" height="12" rx="3"/><path d="M9 2v4m6-4v4M9 18v4m6-4v4M2 9h4m-4 6h4m12-6h4m-4 6h4"/><rect x="9" y="9" width="6" height="6" rx="1"/>',
    book: '<path d="M12 5v16M3 4h5a4 4 0 0 1 4 2 4 4 0 0 1 4-2h5v15h-5a4 4 0 0 0-4 2 4 4 0 0 0-4-2H3z"/>',
    voice: '<path d="M4 10v4m4-8v12m4-16v20m4-16v12m4-8v4"/>',
    note: '<path d="M14 3H5v18h14V8zM14 3v5h5M8 12h8m-8 4h6"/>',
    filter: '<path d="M3 6h8m4 0h6M3 12h2m4 0h12M3 18h12m4 0h2"/><circle cx="13" cy="6" r="2"/><circle cx="7" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
    folder: '<path d="M3 7V4h6l3 3h9v13H3z"/>',
    shield: '<path d="m12 3 8 4v5c0 5-8 9-8 9s-8-4-8-9V7zM8 12l3 3 5-6"/>',
    gear: '<path d="m9 3-1 3-3 1-1 3 2 2-1 3 2 3 3-1 2 3 3-1 1-3 3-1 1-3-2-2 1-3-2-3-3 1-2-2z"/><circle cx="12" cy="12" r="3"/>',
    search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/>',
    arrow: '<path d="m9 5 7 7-7 7"/>',
    plus: '<path d="M12 4v16M4 12h16"/>',
    edit: '<path d="m15 4 5 5M4 20l1-5L16 4a2 2 0 0 1 4 4L9 19z"/>',
    external: '<path d="M14 3h7v7m0-7L10 14M10 4H3v17h17v-7"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v1"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>'
  };
  function icon(name) { return '<svg viewBox="0 0 24 24" aria-hidden="true">' + (icons[name] || icons.arrow) + '</svg>'; }
  function providerGlyph(profile) {
    const glyph = element('span', 'focus-service-icon');
    const brand = root.SciLLM?.getProviderBrand?.(profile);
    if (!brand) { glyph.innerHTML = icon('model'); return glyph; }
    const image = element('img', 'focus-provider-logo');
    image.src = brand.src; image.alt = ''; image.title = brand.label;
    image.width = 28; image.height = 28;
    image.addEventListener('error', () => { glyph.replaceChildren(); glyph.innerHTML = icon('model'); }, { once: true });
    glyph.append(image); return glyph;
  }
  function element(tag, cls, text) {
    const node = document.createElement(tag); if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text; return node;
  }
  function button(text, handler, cls) {
    const b = element('button', cls || 'focus-row', text); b.type = 'button'; b.addEventListener('click', handler); return b;
  }
  function move(id, parent) { const node = $(id); if (node) parent.append(node); return node; }
  let api, mounted = false, connectionDialog, routingDialog, observer, activePage;
  const dialogs = new Map();
  const navigation = [
    ['models', '模型与连接', 'model'], ['reading', '阅读与高亮', 'book'],
    ['voice', '语音朗读', 'voice'], ['notes', '问答与笔记', 'note'],
    ['reading-preferences', '网页滤镜', 'filter'], ['data', '数据与备份', 'folder'],
    ['privacy', '隐私与权限', 'shield'], ['shortcuts', '通用', 'gear']
  ];
  const pageCopy = {
    models: ['模型与连接', '接好一次，让不同的阅读任务各得其所。'],
    reading: ['阅读与高亮', '选择阅读场景，调整识别规则与 PDF 解析。'],
    voice: ['语音朗读', '用适合自己的声音，听懂论文。'],
    notes: ['问答与笔记', '让常用问题和笔记结构更合你意。'],
    'reading-preferences': ['网页滤镜', '管理已经验证的显示规则，专注论文内容。'],
    data: ['数据与备份', '管理本地资料、保存目录与备份。'],
    privacy: ['隐私与权限', '你决定哪些内容可以交给模型。'],
    shortcuts: ['通用', '界面语言与快捷操作。'],
    about: ['关于 BREVESS', '开源许可与问题反馈。'],
    modes: ['阅读场景', '选择本次阅读需要关注的证据。'],
    categories: ['高亮类别', '管理 AI 提示词与离线正则规则。'],
    overview: ['设置检查', '查看阅读、保存与模型的当前状态。']
  };
  function page(id) {
    const node = element('section', 'focus-page settings-panel'); node.id = 'focus-' + id;
    node.dataset.settingsPage = id; node.hidden = true; document.querySelector('.settings-shell').append(node); return node;
  }
  function row(title, description, action, value = '') {
    const b = button('', action); const copy = element('span', 'focus-row-copy');
    copy.append(element('strong', '', title)); if (description) copy.append(element('small', '', description));
    b.append(copy, element('span', 'focus-row-value', value));
    const arrow = element('span', 'focus-row-arrow'); arrow.innerHTML = icon('arrow'); b.append(arrow); return b;
  }
  function group(title, parent) { const g = element('section', 'focus-group'); g.append(element('h2', 'focus-group-title', title)); parent.append(g); return g; }
  function disclosure(node, title, open = false) {
    if (!node) return null;
    const details = element('details', 'focus-disclosure'); const summary = element('summary', '', title);
    details.append(summary); node.before(details); details.append(node); details.open = open; return details;
  }
  function modal(title, node, id) {
    const d = element('dialog', 'focus-dialog'); d.id = id; d.setAttribute('aria-label', title);
    const head = element('header', 'focus-dialog-head'); head.append(element('h2', '', title));
    const close = button('', () => d.close(), 'focus-icon-button'); close.innerHTML = icon('close'); close.setAttribute('aria-label', '关闭');
    head.append(close); const body = element('div', 'focus-dialog-body'); if (node) body.append(node);
    d.append(head, body); document.body.append(d);
    d.addEventListener('close', () => { updateChrome(); });
    dialogs.set(id, d); return d;
  }
  function open(d) { if (d === connectionDialog) updateProviderIdentity(); if (!d.open) d.showModal(); }
  function updateProviderIdentity() {
    if (!connectionDialog) return;
    const select = $('providerId'); const selection = select?.value || '';
    const profile = selection.startsWith('compatible:')
      ? { providerId: 'openai-compatible', config: { presetId: selection.slice(11) } }
      : { providerId: selection, config: { presetId: $('compatiblePreset')?.value, baseUrl: $('baseUrl')?.value } };
    const heading = connectionDialog.querySelector('h2');
    heading.replaceChildren(providerGlyph(profile), element('span', '', select?.selectedOptions?.[0]?.textContent || '编辑连接'));
  }
  function reveal(node) {
    if (!node) return;
    const d = node.closest('dialog'); if (d) open(d);
    for (let p = node.parentElement; p; p = p.parentElement) if (p.tagName === 'DETAILS') p.open = true;
  }
  function openSection(node) { reveal(node); node?.scrollIntoView({ block: 'start', behavior: 'smooth' }); }
  function mount(callbacks) {
    if (mounted) return; mounted = true; api = callbacks;
    document.body.classList.add('settings-focus');
    const app = element('div', 'focus-app'); const header = document.querySelector('.topbar'); header.before(app);
    app.append(header, document.querySelector('.settings-frame'));
    const brand = header.querySelector('.brand'); brand.href = '#page=models'; brand.setAttribute('aria-label', 'BREVESS 设置'); brand.querySelector('strong').textContent = 'BREVESS';
    const headerTitle = header.querySelector('.settings-center-title'); headerTitle.textContent = '设置';
    const oldRail = document.querySelector('.settings-sidebar');
    const helpers = element('div'); helpers.hidden = true;
    ['settingsNavStorageState', 'settingsNavModelState'].forEach(id => move(id, helpers));
    oldRail.replaceChildren(helpers);
    const searchBox = element('div', 'focus-search'); searchBox.innerHTML = icon('search');
    const input = element('input'); input.id = 'focus-search'; input.type = 'search'; input.placeholder = '搜索设置'; input.setAttribute('aria-label', '搜索设置');
    input.setAttribute('aria-controls', 'focus-search-results'); searchBox.append(input); oldRail.append(searchBox);
    const results = element('div', 'focus-search-results'); results.id = 'focus-search-results'; results.hidden = true; oldRail.append(results);
    const nav = element('nav', 'focus-nav'); nav.setAttribute('aria-label', '设置分类');
    const quickSetup = button('', () => { void globalThis.BrevessQuickSetup?.open().catch(() => {}); });
    quickSetup.innerHTML = icon('gear'); quickSetup.append(element('span', '', '快速配置'));
    quickSetup.id = 'openQuickSetup'; nav.append(quickSetup);
    for (const [id, label, name] of navigation) {
      const b = button('', () => {}); b.dataset.settingsNav = id; b.innerHTML = icon(name);
      b.append(element('span', 'settings-nav-title', label)); if (id === 'data') b.classList.add('focus-nav-divider'); nav.append(b);
    }
    oldRail.append(nav);
    const foot = element('div', 'focus-nav-footer'); const wb = element('a', 'focus-nav-link'); wb.href = 'workbench/index.html#library'; wb.target = '_blank'; wb.rel = 'noopener';
    wb.innerHTML = icon('grid'); wb.append(element('span', '', '课题工作台')); const arrow = element('span'); arrow.innerHTML = icon('external'); wb.append(arrow); foot.append(wb);
    for (const [id, label, name] of [['about', '关于 BREVESS', 'info'], ['overview', '设置检查', 'shield']]) {
      const b = button('', () => {}); b.dataset.settingsNav = id; b.innerHTML = icon(name); b.append(element('span', '', label)); foot.append(b);
    }
    oldRail.append(foot);
    // Keep legacy deep links and all original control IDs, while exposing one clear navigation.
    const select = $('settingsMobilePage'); for (const [id, label] of navigation) if (![...select.options].some(o => o.value === id)) select.add(new Option(label, id));
    const title = document.querySelector('.page-header'); title.classList.add('focus-page-heading');
    const content = document.querySelector('.settings-content'); content.prepend(title);
    const language = element('section', 'focus-language-row'); language.append(element('strong', '', '界面语言'), header.querySelector('.language-switcher'));
    $('keyboardShortcutSettings')?.prepend(language);
    if (!language.isConnected) $('keyboardShortcuts')?.prepend(language);
    // Models: keep the full original editor in a modal. It still owns save, validation and risk gating.
    const provider = $('providerSettings'); const summary = element('div', 'focus-model-summary'); provider.prepend(summary);
    const services = group('已连接的服务', summary); const list = element('div', 'focus-connections'); list.id = 'focus-connections'; services.append(list);
    const add = button('', () => { open(connectionDialog); $('addApiProfile').click(); }, 'focus-add-connection'); add.innerHTML = icon('plus'); add.append(element('span', '', '添加连接')); title.append(add);
    connectionDialog = modal('编辑连接', $('apiProfilesSettings'), 'focus-connection-dialog');
    connectionDialog.querySelector('h2').classList.add('focus-provider-heading');
    for (const id of ['providerId', 'compatiblePreset']) $(id)?.addEventListener('change', () => queueMicrotask(updateProviderIdentity));
    $('baseUrl')?.addEventListener('input', updateProviderIdentity);
    const addOriginal = $('addApiProfile'); addOriginal.hidden = true;
    $('apiProfileList').closest('.api-profile-rail').hidden = true;
    const consent = document.querySelector('.connection-consent');
    const privacy = page('privacy'); move('aiPrivacyModelWarning', privacy); if (consent) privacy.append(consent);
    const privacyActions = element('div', 'settings-actions'); const privacyStatus = element('p', 'status'); privacyStatus.id = 'focus-privacy-status'; privacyStatus.setAttribute('role', 'status');
    privacyActions.append(button('保存正文发送许可', async () => {
      try { const saved = await api.savePreferences(); if (!saved) throw new Error($('status')?.textContent || '设置尚未保存'); privacyStatus.textContent = '正文发送许可已保存'; privacyStatus.dataset.state = 'success'; }
      catch (error) { privacyStatus.textContent = '保存失败：' + error.message; privacyStatus.dataset.state = 'error'; }
    }, 'button primary')); privacy.append(privacyActions, privacyStatus);
    routingDialog = modal('按功能分配模型', $('taskRoutingSettings'), 'focus-routing-dialog'); routingDialog.classList.add('focus-dialog-wide');
    const usage = group('模型使用', summary);
    const defaults = row('默认连接与模型', '新任务使用已保存的模型配置。', () => open(routingDialog)); defaults.id = 'focus-default-model'; usage.append(defaults);
    usage.append(row('按功能分配模型', '问答、解图、笔记等任务可分别指定。', () => open(routingDialog), '模型与 Token'));
    const permission = group('连接与权限', summary);
    const agent = document.querySelector('.external-agent-settings');
    agent.hidden = true; summary.append(agent);
    const agentGroup = group('Agent', summary);
    const agentEntry = row('连接你的 Agent', '选择客户端、复制配置提示词、连接测试。', () => $('externalAgentManage').click());
    agentEntry.id = 'focus-agent-entry'; agentGroup.append(agentEntry);
    usage.before(agentGroup);
    const consentRow = row('正文发送许可', '决定模型能否读取论文正文、图注与图片。', () => api.navigate('privacy')); consentRow.id = 'focus-consent-row'; permission.append(consentRow);
    const riskLink = button('查看隐私与权限', () => api.navigate('privacy'), 'focus-text-button'); riskLink.id = 'focus-risk-link'; summary.append(riskLink);
    const warning = element('p', 'focus-risk-status'); warning.setAttribute('role', 'status'); warning.id = 'focus-risk-status'; summary.append(warning);
    // Voice and prompts no longer share a very long PDF settings page.
    const voice = page('voice'); move('ttsSettings', voice);
    const notes = page('notes');
    for (const [id, label] of [['articleChatPromptSettings', '问答快捷提示词'], ['literatureNoteTemplateSettings', '文献笔记模板'], ['selectionLlmActionSettings', '选区动作'], ['panelFollowupSettings', 'Panel 追问提示词']]) {
      const section = move(id, notes); disclosure(section, label, id === 'literatureNoteTemplateSettings');
    }
    const noteActions = element('div', 'focus-sticky-actions'); move('saveReadingSettings', noteActions); move('readingSettingsStatus', noteActions); notes.append(noteActions);
    $('saveReadingSettings').textContent = '保存问答与笔记设置';
    const reading = $('readingSettingsBody'); const readingLinks = element('section', 'focus-group'); reading.prepend(readingLinks);
    readingLinks.append(row('阅读场景', '选择需要关注的证据类别。', () => api.navigate('modes')), row('高亮类别', '编辑 AI 提示词、正则与类别颜色。', () => api.navigate('categories')));
    move('modelBehaviorAdvanced', reading);
    const readingSave = button('保存阅读偏好', async () => {
      try { const saved = await api.savePreferences(); if (!saved) throw new Error($('status')?.textContent || '设置尚未保存'); readingSave.textContent = '已保存'; }
      catch (error) { readingSave.textContent = '保存失败，请重试'; readingSave.title = error.message; }
    }, 'button primary'); $('analysisBehaviorSettings').append(readingSave);
    disclosure($('literatureUrlSettings'), '论文网址白名单'); disclosure($('pdfMineruSettings'), 'PDF 解析与增强识别');
    // Consolidate directory controls and data maintenance without changing their persistence.
    const storage = $('localStorageSettings'); if (storage) storage.dataset.settingsPage = 'data';
    disclosure($('directorySyncSettings'), '保存目录与加密备份');
    for (const [id, label] of [['articleWorkspaceOverview', '论文工作区与占用'], ['migrationSettings', '旧版数据迁移'], ['corpusSettings', '反馈语料与离线规则']]) disclosure($(id), label);
    disclosure(document.querySelector('.migration-section'), '旧版数据迁移');
    disclosure($('corpusHeading')?.closest('section'), '反馈语料与离线规则');
    setupSearch(input, results);
    window.addEventListener('brevess-settings-pagechange', updateChrome);
    document.addEventListener('keydown', event => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k' && !document.querySelector('dialog[open]')) { event.preventDefault(); input.focus(); input.select(); }
      if (event.key === 'Escape' && document.activeElement === input) { input.value = ''; results.hidden = true; }
    });
    document.addEventListener('input', event => {
      const d = event.target.closest('.focus-editor-details'); if (!d) return;
      const label = d.querySelector('input[type="text"]'); if (label && d.firstElementChild.textContent !== (label.value || '未命名')) d.firstElementChild.textContent = label.value || '未命名';
    });
    $('aiPrivacyAcknowledged')?.addEventListener('change', updatePrivacyHint);
    observer = new MutationObserver(compactEditors);
    for (const id of ['articleChatQuickPromptList', 'literatureNoteTemplateList', 'selectionLlmActionList', 'panelFollowupPresetList']) if ($(id)) observer.observe($(id), { childList: true, subtree: true });
    compactEditors(); updateChrome();
  }
  function compactEditors() {
    const selectors = '.literature-note-field-row, #articleChatQuickPromptList .named-prompt-row, #selectionLlmActionList .named-prompt-row, #panelFollowupPresetList .named-prompt-row';
    document.querySelectorAll(selectors).forEach(row => {
      if (row.querySelector(':scope > .focus-editor-details')) return;
      const name = row.querySelector('input[type="text"]');
      const details = element('details', 'focus-editor-details'); const summary = element('summary', '', name?.value || '未命名');
      details.open = row.contains(document.activeElement) || !name?.value;
      const body = element('div', 'focus-editor-body'); body.append(...row.childNodes); details.append(summary, body); row.append(details);
    });
  }
  function updateChrome() {
    const current = document.body.dataset.activeSettingsPage || 'models'; const copy = pageCopy[current];
    if (copy) { $('settingsPageTitle').textContent = copy[0]; $('settingsPageSubtitle').textContent = copy[1]; }
    document.querySelector('.focus-add-connection')?.toggleAttribute('hidden', current !== 'models');
    const active = ['modes', 'categories'].includes(current) ? 'reading' : current;
    document.querySelectorAll('.focus-nav [data-settings-nav]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.settingsNav === active)));
    if (activePage !== current) {
      activePage = current;
      const main = document.querySelector('.settings-content'); if (main) main.scrollTop = 0;
      for (const d of dialogs.values()) if (d.open) d.close();
    }
  }
  function updatePrivacyHint() {
    const risk = $('focus-risk-status');
    if (risk) risk.textContent = $('aiPrivacyAcknowledged')?.checked ? '' : '配置模型前，请先在隐私与权限中确认数据隐私风险。';
  }
  function sync(data) {
    if (!mounted || !data?.settings) return;
    const settings = data.settings; const list = $('focus-connections'); list.replaceChildren();
    const order = settings.profileOrder || Object.keys(settings.profiles || {});
    for (const id of order) {
      const profile = settings.profiles?.[id]; if (!profile) continue;
      const b = button('', () => {
        $('apiProfileList').querySelector('[data-profile-id="' + CSS.escape(id) + '"]')?.click(); open(connectionDialog);
      }, 'focus-connection');
      const glyph = providerGlyph(profile); const text = element('span', 'focus-row-copy');
      const provider = root.SciLLM?.getProviderBrand?.(profile)?.label || data.providers?.[profile.providerId]?.label || profile.providerId;
      const name = element('strong', '', profile.name || provider); name.dataset.i18nIgnore = '';
      text.append(name, element('small', '', provider + (profile.config?.hasApiKey ? ' · 密钥已设置' : '')));
      const state = element('span', 'focus-connection-state', profile.config?.hasApiKey ? '已配置' : '编辑');
      const pencil = element('span'); pencil.innerHTML = icon('edit'); b.append(glyph, text, state, pencil); list.append(b);
    }
    if (!list.childNodes.length) list.append(element('p', 'focus-empty', '还没有连接，点击右上角添加。'));
    const profile = settings.profiles?.[settings.globalProfileId];
    $('focus-default-model').querySelector('.focus-row-value').textContent = profile ? (profile.config?.model || profile.name) : '未配置';
    $('focus-consent-row').querySelector('.focus-row-value').textContent = settings.consentGranted ? '已允许' : '未允许';
    updatePrivacyHint();
    updateProviderIdentity();
    compactEditors();
  }
  function setupSearch(input, results) {
    const entries = [
      ['模型与连接', 'API Key 密钥 DeepSeek 服务商', 'models'],
      ['功能模型与 Token', '任务 推理 联网 上下文 预算', 'models', 'taskRoutingSettings'],
      ['语音朗读', 'TTS Kokoro DeepSeek 音色 语速', 'voice', 'ttsSettings'],
      ['阅读场景', '场景 类别', 'modes'], ['高亮类别', '正则 AI 提示词 颜色', 'categories'],
      ['PDF 解析', 'MinerU OCR Token 增强识别', 'reading', 'pdfMineruSettings'],
      ['论文网址白名单', '域名 站点', 'reading', 'literatureUrlSettings'],
      ['文献笔记模板', '模板 字段 提示词', 'notes', 'literatureNoteTemplateSettings'],
      ['问答快捷提示词', '问题', 'notes', 'articleChatPromptSettings'],
      ['选区动作', '翻译 文段', 'notes', 'selectionLlmActionSettings'],
      ['Panel 追问', '解图', 'notes', 'panelFollowupSettings'],
      ['网页滤镜', '规则 显示 跨页 导入 导出', 'reading-preferences'],
      ['保存目录与备份', '数据 同步 加密 迁移', 'data', 'directorySyncSettings'],
      ['隐私与权限', '正文发送 同意 风险', 'privacy'],
      ['外部 Agent', 'MCP 配对', 'models', 'focus-agent-entry'],
      ['通用', '快捷键 语言', 'shortcuts'], ['关于 BREVESS', '反馈 许可 开源', 'about']
    ];
    input.addEventListener('input', () => {
      const query = input.value.trim().toLowerCase(); results.replaceChildren(); results.hidden = !query; if (!query) return;
      const matched = entries.filter(entry => [entry[0], entry[1], root.SciLLM?.translateInterfaceText?.(entry[0], 'en')].join(' ').toLowerCase().includes(query));
      for (const entry of matched) results.append(button(entry[0], () => {
        api.navigate(entry[2]); results.hidden = true; input.value = '';
        if (entry[3]) openSection($(entry[3]));
      }, 'focus-search-result'));
      if (!matched.length) results.append(element('p', '', '没有找到相关设置'));
    });
    input.addEventListener('keydown', event => { if (['ArrowDown', 'Enter'].includes(event.key) && !results.hidden) { event.preventDefault(); const first = results.querySelector('button'); if (event.key === 'Enter') first?.click(); else first?.focus(); } });
  }
  root.BrevessSettingsUI = { mount, sync, reveal, updateChrome };
})(globalThis);
