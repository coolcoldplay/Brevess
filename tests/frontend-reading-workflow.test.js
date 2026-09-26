const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(file) {
  return fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
}

function executableFunctionSource(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `missing ${name}`);
  let parentheses = 0;
  let open = -1;
  for (let index = source.indexOf('(', start); index < source.length; index += 1) {
    if (source[index] === '(') parentheses += 1;
    if (source[index] === ')') parentheses -= 1;
    if (parentheses === 0) {
      open = source.indexOf('{', index);
      break;
    }
  }
  assert.ok(open >= 0, `missing body for ${name}`);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`unterminated ${name}`);
}

test('reading toolbar keeps every action while grouping secondary tools behind a labelled menu', () => {
  const html = read('popup.html');
  const menu = html.match(/<details[^>]*id="sidePanelMoreTools"[\s\S]*?<\/details>/)?.[0] || '';

  assert.match(html, /id="showArticleAbbreviations"/);
  assert.match(html, /id="saveCurrentArticleWorkspace"/);
  assert.match(menu, /id="scanArticleWorkspace"[\s\S]*扫描并恢复本地工作区/);
  assert.match(menu, /id="importCurrentArticleArchiveButton"[\s\S]*导入 JSON/);
  assert.match(menu, /id="exportCurrentArticleArchive"[\s\S]*导出 JSON/);
  assert.match(menu, /id="exportPptMaterials"[\s\S]*导出 PPT 材料包/);
  assert.match(menu, /id="exportEnhancedSnapshotToZotero"[\s\S]*导出到 Zotero/);
  assert.match(menu, /id="clearArticleWorkspace"[\s\S]*清空本地工作区/);
  assert.match(menu, /role="menu"/);
});

test('disclosure menus close on Escape and return focus to their trigger', () => {
  const source = executableFunctionSource(read('popup.js'), 'closeSidePanelDisclosureOnEscape');
  const closeSidePanelDisclosureOnEscape = new Function(
    `${source}\nreturn closeSidePanelDisclosureOnEscape;`
  )();
  let focused = 0;
  let prevented = 0;
  const details = { open: true };
  const trigger = { focus() { focused += 1; } };
  const closed = closeSidePanelDisclosureOnEscape({
    key: 'Escape', preventDefault() { prevented += 1; }
  }, details, trigger);

  assert.equal(closed, true);
  assert.equal(details.open, false);
  assert.equal(focused, 1);
  assert.equal(prevented, 1);
});

test('literature notes use readable text and only the drawer form scrolls', () => {
  const html = read('popup.html');
  const css = read('popup.css');
  assert.match(html, /id="literatureNoteModelHint"[\s\S]*id="openLiteratureNoteModelSettings"/);
  assert.match(css, /\.literature-note-field\s*\{[^}]*font-size:\s*14px/s);
  assert.match(css, /\.literature-note-field-status\s*\{[^}]*font-size:\s*12px/s);
  assert.match(css, /\.literature-note-field textarea\s*\{[^}]*overflow-y:\s*hidden/s);
  assert.match(css, /\.literature-note-field-status\.is-idle\s*\{[^}]*display:\s*none/s);
});

test('literature-note status names the configured task profile instead of the first profile', () => {
  const source = executableFunctionSource(read('popup.js'), 'resolveConfiguredTaskProfile');
  const resolveConfiguredTaskProfile = new Function(
    `${source}\nreturn resolveConfiguredTaskProfile;`
  )();
  const profiles = {
    A: { name: 'Profile A' }, B: { name: 'Profile B' }, C: { name: 'Profile C' }
  };
  const settings = {
    profiles, globalProfileId: 'B',
    taskPolicies: { literature_note_autofill: { mode: 'profile', profileId: 'C' } }
  };
  assert.deepEqual(
    resolveConfiguredTaskProfile(settings, 'literature_note_autofill', Object.entries(profiles)),
    ['C', profiles.C]
  );
  settings.taskPolicies.literature_note_autofill = { mode: 'global', profileId: null };
  assert.deepEqual(
    resolveConfiguredTaskProfile(settings, 'literature_note_autofill', Object.entries(profiles)),
    ['B', profiles.B]
  );
  settings.globalProfileId = 'missing';
  assert.equal(resolveConfiguredTaskProfile(settings, 'literature_note_autofill', []), null);
});

test('chat composer explains model readiness and separates optional web search', () => {
  const html = read('popup.html');
  const script = read('popup.js');
  assert.match(html, /id="articleChatModelStatus"[^>]*aria-live="polite"/);
  assert.match(html, /id="openArticleChatModelSettings"/);
  assert.match(html, /class="article-chat-search-option"[\s\S]*联网检索是可选辅助来源/);
  assert.match(script, /function renderArticleChatModelStatus\(/);
  assert.match(script, /renderArticleChatModelStatus\(profiles/);
});

test('Figure display localization maps structural enums without changing unknown values', () => {
  const source = executableFunctionSource(read('popup.js'), 'localizeFigureWorkspaceDisplayValue');
  const localizeFigureWorkspaceDisplayValue = new Function(
    `${source}\nreturn localizeFigureWorkspaceDisplayValue;`
  )();

  assert.equal(localizeFigureWorkspaceDisplayValue('phenotype_measurement'), '表型测量');
  assert.equal(localizeFigureWorkspaceDisplayValue('phenotype measurement'), '表型测量');
  assert.equal(localizeFigureWorkspaceDisplayValue('caption_statement'), '图注陈述');
  assert.equal(localizeFigureWorkspaceDisplayValue('caption statement'), '图注陈述');
  assert.equal(localizeFigureWorkspaceDisplayValue('novel_enum'), 'novel_enum');
  assert.deepEqual(
    localizeFigureWorkspaceDisplayValue(['phenotype_measurement', 'novel_enum']),
    ['表型测量', 'novel_enum']
  );
});

test('Figure fields edit by double click or accessible keyboard activation without a visible edit button', () => {
  const script = read('popup.js');
  const source = executableFunctionSource(script, 'appendFigureWorkspaceViewField');
  assert.match(source, /addEventListener\('dblclick', edit\)/);
  assert.match(source, /aria-keyshortcuts/);
  assert.match(source, /event\.key === 'Enter' \|\| event\.key === ' '/);
  assert.doesNotMatch(source, /workspace-figure-edit-button|editButton/);
});
