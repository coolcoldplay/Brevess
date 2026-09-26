const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'popup.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'popup.css'), 'utf8');
const script = fs.readFileSync(path.join(root, 'popup.js'), 'utf8');

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} must exist`);
  const parametersStart = source.indexOf('(', start);
  let parametersDepth = 0;
  let bodyStart = -1;
  let parameterQuote = '';
  let parameterEscaped = false;
  for (let index = parametersStart; index < source.length; index += 1) {
    const char = source[index];
    if (parameterQuote) {
      if (parameterEscaped) parameterEscaped = false;
      else if (char === '\\') parameterEscaped = true;
      else if (char === parameterQuote) parameterQuote = '';
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      parameterQuote = char;
      continue;
    }
    if (char === '(') parametersDepth += 1;
    if (char === ')') {
      parametersDepth -= 1;
      if (parametersDepth === 0) {
        bodyStart = source.indexOf('{', index);
        break;
      }
    }
  }
  assert.notEqual(bodyStart, -1, `${name} body must exist`);
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`unterminated ${name}`);
}

class FakeEventTarget {
  constructor() {
    this.listeners = new Map();
  }
  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }
  removeEventListener(type, listener) {
    this.listeners.set(type, (this.listeners.get(type) || []).filter(item => item !== listener));
  }
  dispatch(type, event = {}) {
    for (const listener of this.listeners.get(type) || []) listener({ type, ...event });
  }
}

class FakeClassList {
  constructor() {
    this.values = new Set();
  }
  contains(value) { return this.values.has(value); }
  toggle(value, force) {
    const next = force === undefined ? !this.values.has(value) : force;
    if (next) this.values.add(value);
    else this.values.delete(value);
    return next;
  }
}

function controllerFixture({ language = 'zh-CN', deferEscape = () => false } = {}) {
  const announcementElement = { textContent: '' };
  const region = { scrollTop: 137 };
  const rootElement = {
    classList: new FakeClassList(),
    querySelectorAll: () => [region]
  };
  const documentElement = { lang: language };
  const documentRef = new FakeEventTarget();
  documentRef.documentElement = documentElement;
  documentRef.querySelector = () => null;
  const requestFrame = callback => callback();
  const Controller = new Function(`return (${extractFunction(script, 'createSidebarFocusModeController')});`)();
  const controller = Controller({
    root: rootElement,
    announcementElement,
    documentRef,
    requestFrame,
    shouldDeferEscape: deferEscape,
    MutationObserverCtor: null
  });
  return { announcementElement, controller, documentRef, region, rootElement };
}

test('focus control and structural hooks cover every sidebar view', () => {
  assert.doesNotMatch(html, /id="toggleSidebarFocus"/);
  assert.match(html, /id="sidebarFocusAnnouncement"[^>]+role="status"/);
  for (const view of ['navigation', 'highlights', 'figures', 'mechanism', 'chat']) {
    const match = html.match(new RegExp(
      `<section[^>]+data-workspace-view="${view}"[\\s\\S]*?<\\/section>`
    ));
    assert.ok(match, `${view} view exists`);
    if (view === 'mechanism') {
      assert.match(match[0], /data-sidebar-focus-heading-copy/,
        'the nested mechanism view retains its existing focus-mode heading hook');
    } else {
      assert.doesNotMatch(match[0], /data-sidebar-focus-(?:heading-copy|empty-heading)/,
        `${view} no longer reserves a redundant title/copy row`);
    }
  }
  assert.match(html, /id="articleChatCoverage"[^>]+data-sidebar-focus-static-context/);
  assert.doesNotMatch(
    html.match(/id="articleChatModelStatus"[^>]*>/)?.[0] || '',
    /data-sidebar-focus-static-context/,
    'model access status remains visible'
  );
  assert.doesNotMatch(html, /id="literatureNoteTitle"/,
    'the redundant note title is removed rather than reserving a collapsible row');
  assert.match(html, /<small id="literatureNoteStatus"[^>]*role="status"[^>]*aria-live="polite"/,
    'autosave status remains live and outside the hidden heading hook');
  assert.match(html, /id="mechanismGenerationStatus"[\s\S]+id="cancelMechanismGeneration"/);
});

test('focus CSS uses one root state and retains essential status and controls', () => {
  assert.match(css, /\.side-panel-app\.is-sidebar-focus-mode\s+\.side-panel-header/);
  assert.match(css, /\.side-panel-app\.is-sidebar-focus-mode\s+\.side-panel-header\s*\{[^}]*display:\s*none/);
  assert.match(css, /\.is-sidebar-focus-mode[^{]*\[data-sidebar-focus-heading-copy\][^}]*display:\s*none/);
  assert.match(css, /\.is-sidebar-focus-mode[^{]*\[data-sidebar-focus-static-context\][^}]*display:\s*none/);
  assert.match(css, /\.is-sidebar-focus-mode[^{]*\.side-panel-document-status\.is-error[^{]*\{[^}]*display:\s*flex/);
  assert.match(css, /\.is-sidebar-focus-mode[^{]*#mechanismGenerationStatus/);
  assert.match(css, /@media\s*\(max-width:\s*359px\)[\s\S]*body\s*\{[^}]*min-width:\s*320px/);
});

test('controller toggles session-only layout, bilingual labels, and restores scroll', () => {
  const { announcementElement, controller, region, rootElement } = controllerFixture();
  assert.ok(controller, 'focus mode must initialize without the removed button');
  assert.equal(announcementElement.textContent, '');

  controller.toggle();
  assert.equal(rootElement.classList.contains('is-sidebar-focus-mode'), true);
  assert.match(announcementElement.textContent, /专注阅读已开启/);
  region.scrollTop = 204;
  controller.setActive(false);
  assert.equal(region.scrollTop, 204);
  assert.equal(rootElement.classList.contains('is-sidebar-focus-mode'), false);

  const english = controllerFixture({ language: 'en' });
  english.controller.setActive(true);
  assert.match(english.announcementElement.textContent, /Focus mode on/);
});

test('dedicated focus shortcut toggles layout directly without hidden control clicks', () => {
  const calls = [];
  const run = new Function('sidebarFocusModeController', 'setupSidebarFocusMode', 'clickShortcutControl',
    `return (${extractFunction(script, 'runGlobalKeyboardShortcut')});`
  )(null, () => ({ toggle: () => calls.push('toggle') }), () => false);
  assert.equal(run('focusReading'), true);
  assert.equal(run('focusReading'), true);
  assert.deepEqual(calls, ['toggle', 'toggle']);
});

test('focus language sync is idempotent and cannot feed the page translation observer', () => {
  const {controller,announcementElement} = controllerFixture();
  let value = announcementElement.textContent;
  let writes = 0;
  Object.defineProperty(announcementElement, 'textContent', {
    get: () => value, set: next => { value = next; writes++; }
  });
  controller.setActive(true);
  controller.sync();
  controller.sync();
  assert.equal(writes, 1, 'repeating unchanged state must not recreate text nodes');
});

test('Escape exits only when existing editor and menu semantics do not have priority', () => {
  let defer = true;
  const fixture = controllerFixture({ deferEscape: () => defer });
  fixture.controller.setActive(true);
  let prevented = false;
  fixture.documentRef.dispatch('keydown', {
    key: 'Escape',
    defaultPrevented: false,
    isComposing: false,
    target: { closest: () => null },
    preventDefault() { prevented = true; }
  });
  assert.equal(fixture.controller.isActive(), true);
  assert.equal(prevented, false);

  defer = false;
  fixture.documentRef.dispatch('keydown', {
    key: 'Escape',
    defaultPrevented: false,
    isComposing: false,
    target: { closest: () => null },
    preventDefault() { prevented = true; }
  });
  assert.equal(fixture.controller.isActive(), false);
  assert.equal(prevented, true);

  fixture.controller.setActive(true);
  fixture.documentRef.dispatch('keydown', {
    key: 'Escape',
    defaultPrevented: false,
    isComposing: false,
    target: { closest: selector => selector.includes('textarea') ? {} : null },
    preventDefault() { throw new Error('editable Escape must remain available to editor'); }
  });
  assert.equal(fixture.controller.isActive(), true);
});

test('boot and view switching keep focus controller independent of data lifecycle', () => {
  const bootStart = script.indexOf("document.addEventListener('DOMContentLoaded'");
  const boot = script.slice(bootStart, script.indexOf("window.addEventListener('focus'", bootStart));
  assert.match(boot, /setupSidePanelMoreTools\(\);[\s\S]*setupSidebarFocusMode\(\);/);
  const switcher = extractFunction(script, 'switchWorkspaceView');
  assert.match(switcher, /sidebarFocusModeController\?\.sync\(\)/);
  assert.match(extractFunction(script, 'createSidebarFocusModeController'),
    /checkVisibility[\s\S]*getClientRects/,
    'only visible menus and dialogs may defer focus-mode Escape');
  assert.doesNotMatch(extractFunction(script, 'createSidebarFocusModeController'),
    /chrome\.|sendTabMessage|loadSettings|cancelArticleChat|articleChatContextScopes/);
});

test('browser verifier switches persisted language through the production settings path', () => {
  const verifier = fs.readFileSync(path.join(root, 'scripts/verify-sidebar-focus-mode.mjs'), 'utf8');
  assert.doesNotMatch(verifier, /document\.documentElement\.lang\s*=(?!=)/,
    'writing only the DOM language leaves the translation observer in the old language');
  assert.match(verifier, /type:\s*'LLM_UPDATE_PREFERENCES'[\s\S]*preferences:\s*\{\s*language/);
  assert.match(verifier, /await loadLlmSettings\(\)/);
  assert.match(verifier, /llmSettingsState\?\.settings\?\.language\s*===\s*selected/);
  assert.match(verifier, /\/Focus mode on\\\..\*Escape to exit\/u/,
    'the English announcement assertion must not be relaxed');
});
