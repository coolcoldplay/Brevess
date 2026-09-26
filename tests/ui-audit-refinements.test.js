const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const options = read('options.js');
function functionSource(name, next) {
  const start = options.indexOf(`function ${name}(`);
  const end = options.indexOf(`\nfunction ${next}(`, start);
  assert.ok(start >= 0 && end > start);
  return options.slice(start, end);
}

test('toolbar popup has a content-independent 360px intrinsic width', () => {
  const css = read('action-popup.css');
  assert.match(css, /html,\s*body\s*\{[^}]*width:\s*360px;[^}]*min-width:\s*360px;[^}]*max-width:\s*360px;/);
  assert.doesNotMatch(css, /@media\s*\(max-width:\s*519px\)/);
});

test('PDF entry uses a document icon included in the bundled font', () => {
  const html = read('action-popup.html');
  const pdf = html.slice(html.indexOf('id="openPdf"'), html.indexOf('id="openHistory"'));
  assert.match(pdf, /ph-file-magnifying-glass/);
  assert.match(read('vendor/phosphor/icons.css'), /\.ph\.ph-file-magnifying-glass::before/);
  assert.doesNotMatch(pdf, /ph-file-pdf/);
});

test('single-page settings show one primary heading instead of stacked duplicate heroes', () => {
  const html = read('options.html');
  for (const id of ['analysisModeSettingsHeading', 'localStorageSettingsHeading',
    'readingSettingsHeading', 'providerHeading', 'keyboardShortcutsHeading',
    'localDataHeading', 'aboutSettingsHeading']) {
    assert.match(html, new RegExp(`<h1 id="${id}"`));
  }
  assert.match(read('options.css'), /body:not\(\[data-active-settings-page="categories"\]\) \.page-header\s*\{\s*display:\s*none/);
});

test('long abbreviations wrap within their own table cell', () => {
  assert.match(read('popup.css'), /\.abbreviation-table-jump\s*\{[^}]*overflow-wrap:\s*anywhere/s);
  assert.match(read('popup.css'), /\.abbreviation-table th:nth-child\(1\)\s*\{\s*width:\s*23%/);
});

test('semantic highlight action remains an optional disclosure in excerpts', () => {
  assert.match(read('popup.html'), /<details class="article-chat-highlight-section" id="semanticHighlightControls">\s*<summary>智能检索高亮<\/summary>/);
});

test('missing optional directory has neutral UI but lost existing directory remains an error', () => {
  const elements = new Map();
  const context = {
    userDataUi: { lastStatus: { directoryName: '' }, pendingAction: false },
    normalizePortableConfigStatus: value => value,
    document: { getElementById(id) {
      if (!elements.has(id)) elements.set(id, { dataset: {}, textContent: '', hidden: false });
      return elements.get(id);
    } }
  };
  vm.runInNewContext(functionSource('renderPortableConfigStatus', 'clearPortableConfigDialogInputErrors'), context);
  const unavailable = { state: 'unavailable', revision: 0, updatedAt: '', pending: false, lastError: 'PORTABLE_CONFIG_UNAVAILABLE' };
  context.renderPortableConfigStatus(unavailable);
  assert.equal(elements.get('portableConfigState').dataset.state, 'disabled');
  assert.doesNotMatch(elements.get('portableConfigNotice').textContent, /重试|停止|不可用/);
  assert.equal(context.userDataUi.portableConfigStatus.state, 'unavailable', 'presentation must not weaken the stored safety state');
  context.userDataUi.lastStatus.directoryName = 'Saved papers';
  context.renderPortableConfigStatus(unavailable);
  assert.equal(elements.get('portableConfigState').dataset.state, 'unavailable');
  assert.match(elements.get('portableConfigNotice').textContent, /不可用/);
});

test('profile label does not repeat an identical provider and profile name', () => {
  const context = {
    state: { providers: { openai: { label: 'OpenAI' } } },
    interfaceText: value => value,
    providerVisionCapability: () => true
  };
  vm.runInNewContext(functionSource('profileOptionLabel', 'renderProfileList'), context);
  assert.equal(context.profileOptionLabel({ name: 'OpenAI', providerId: 'openai', config: { model: 'gpt-5-mini' } }),
    'OpenAI · gpt-5-mini · 视觉');
  assert.equal(context.profileOptionLabel({ name: 'Primary', providerId: 'openai', config: { model: 'gpt-5-mini' } }),
    'Primary · OpenAI · gpt-5-mini · 视觉');
});

test('local-only onboarding communicates readiness rather than a failed completion score', () => {
  const elements = new Map();
  const context = {
    state: { settings: { consentGranted: false } },
    userDataUi: { lastStatus: {} }, onboardingUi: { state: { steps: { api: 'skipped', storage: 'skipped' } } },
    hasConfiguredApiProfile: () => false, profileEntries: () => [],
    setOverviewCardState() {}, setSetupRowState() {},
    document: { getElementById(id) {
      if (!elements.has(id)) elements.set(id, { textContent: '', checked: false, value: '' });
      return elements.get(id);
    } }
  };
  vm.runInNewContext(functionSource('renderSettingsOverview', 'openOnboardingStep'), context);
  context.renderSettingsOverview();
  assert.equal(elements.get('onboardingProgress').textContent, '可直接阅读');
  assert.equal(elements.get('setupConsentState').textContent, '启用 AI 时确认');
});

test('PDF outline exposes child headings without expanding all opening paragraphs', () => {
  const source = read('popup.js');
  const section = source.slice(source.indexOf('function renderPopupPdfSemanticNavigation('), source.indexOf('function renderArticleNavigationTree('));
  assert.match(section, /previouslyOpen.has\(section.sectionId\)[\s\S]*depth === 0 && section.children.length > 0/);
  assert.match(section, /workspace-pdf-semantic-paragraphs/);
  assert.match(section, /paragraphContainer.appendChild\(button\)/);
  assert.match(section, /'workspace-pdf-semantic-paragraph-summary'/);
});

test('sidebar includes an explicit Chinese sans-serif fallback', () => {
  assert.match(read('popup.css'), /body\s*\{[^}]*font-family:[^;]*Microsoft YaHei/s);
});

test('saving an incomplete connection explains that AI is still disabled', () => {
  assert.match(options, /配置已保存；AI 尚未启用/);
});

test('note template delete action shares the field row rather than creating a full-width row', () => {
  assert.match(read('options.css'), /\.literature-note-field-delete\s*\{[^}]*grid-column:\s*2;[^}]*grid-row:\s*1/s);
});

test('compact mechanism actions do not split their labels across lines', () => {
  assert.match(read('popup.css'), /\.workspace-mechanism-toolbar \.btn\s*\{[^}]*white-space:\s*nowrap/s);
});

test('PDF source context is presented in readable language', () => {
  assert.match(read('popup.js'), /'pdf-workspace':\s*'PDF 文献'/);
  assert.doesNotMatch(read('popup.html'), /目录由网页结构即时生成|以当前网页正文为上下文/);
});

test('reading settings keep the single save action reachable while scrolling', () => {
  assert.match(read('options.css'), /\.reading-settings-actions\s*\{[^}]*position:\s*sticky;[^}]*bottom:\s*0/s);
});

test('empty library distinguishes first use from a search with no results', () => {
  const source = read('options-local-library.js');
  const start = source.indexOf('function renderArticles(');
  const end = source.indexOf('\n  function renderAbbreviations(', start);
  const context = { state: { query: '' }, element: (tag, cls, text) => ({ text }) };
  vm.runInNewContext(source.slice(start, end), context);
  let result;
  const container = { append: node => { result = node.text; } };
  context.renderArticles(container, []);
  assert.match(result, /尚未保存/);
  context.state.query = 'missing article';
  context.renderArticles(container, []);
  assert.match(result, /没有匹配/);
});
