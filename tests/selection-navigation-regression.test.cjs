const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { functionSource } = require('./helpers/r28-full07-source');
const { createFigureGesture } = require('../core/sidebar-interactions.js');
const registry = require('../providers/provider-registry.js');
const content = fs.readFileSync(require.resolve('../content.js'), 'utf8');
const popup = fs.readFileSync(require.resolve('../popup.js'), 'utf8');

test('provider menu keeps Grok out of the domestic group and preserves configured values', () => {
  class Element {
    children = [];
    value = '';
    appendChild(child) { this.children.push(child); }
    replaceChildren() { this.children = []; }
    get options() { return this.children.flatMap(group => group.children); }
  }
  const select = new Element();
  select.value = 'compatible:grok';
  const ctx = {
    document: { getElementById: () => select, createElement: () => new Element() },
    state: { providers: registry.getProviderDefinitions() },
    compatiblePresets: registry.getCompatibleProviderPresets,
    COMPATIBLE_PROVIDER_VALUE_PREFIX: 'compatible:', interfaceText: value => value
  };
  vm.runInNewContext(functionSource(fs.readFileSync(require.resolve('../options.js'), 'utf8'), 'renderProviderOptions'), ctx);
  ctx.renderProviderOptions();
  const groupOf = value => select.children.find(group => group.children.some(option => option.value === value)).label;
  assert.equal(groupOf('compatible:grok'), '常用服务商');
  for (const id of ['kimi', 'zhipu', 'doubao', 'qwen', 'hunyuan-tokenhub', 'hunyuan-classic', 'qianfan', 'minimax']) {
    assert.equal(groupOf('compatible:' + id), '国内模型服务商', id);
  }
  assert.equal(select.value, 'compatible:grok');
  assert.equal(new Set(select.options.map(option => option.value)).size, select.options.length);
});

test('Back/Forward cache restores selection listeners once after each teardown', () => {
  class Target {
    listeners = new Map();
    addEventListener(type, handler) {
      if (!this.listeners.has(type)) this.listeners.set(type, new Set());
      this.listeners.get(type).add(handler);
    }
    removeEventListener(type, handler) { this.listeners.get(type)?.delete(handler); }
    dispatchEvent(event) { for (const handler of [...(this.listeners.get(event.type) || [])]) handler(event); }
  }
  const doc = new Target(), win = new Target();
  doc.getSelection = () => null;
  let selections = 0;
  const ctx = { document: doc, window: win, scheduleManualSelectionInspection() {},
    handleManualPointerUp() { selections++; } };
  for (const name of ['handleManualPointerDown', 'handleManualSelectionChange', 'handleManualKeyDown',
    'handleManualOutsideClick', 'handleNativePdfAnnotationActivate', 'handleManualViewportChange']) ctx[name] = () => {};
  vm.createContext(ctx);
  vm.runInContext(functionSource(content.replace('    function createManualUiLifecycle()', 'function createManualUiLifecycle()'), 'createManualUiLifecycle'), ctx);
  ctx.manualUiLifecycle = ctx.createManualUiLifecycle();
  ctx.disableManualAnnotationUi = () => ctx.manualUiLifecycle.disable();
  vm.runInContext(['initializeManualAnnotationUi', 'handleManualPageShow'].map(name => functionSource(content, name)).join('\n'), ctx);
  // Exercise the same persistent pageshow registration as the content script.
  assert.match(content, /window\.addEventListener\('pageshow', handleManualPageShow\)/);
  win.addEventListener('pageshow', ctx.handleManualPageShow);
  ctx.initializeManualAnnotationUi();
  for (let i = 1; i <= 3; i++) {
    win.dispatchEvent(new Event('pagehide'));
    doc.dispatchEvent(new Event('pointerup'));
    assert.equal(selections, i - 1);
    for (let repeat = 0; repeat < 2; repeat++) {
      const restored = new Event('pageshow'); restored.persisted = true; win.dispatchEvent(restored);
    }
    doc.dispatchEvent(new Event('pointerup'));
    assert.equal(selections, i);
  }
  ctx.manualUiLifecycle.disable();
});

test('translated text admits reading tools while nested controls remain excluded', () => {
  const UI = '[data-sci-plugin-ui]', BLOCKED = 'input,button';
  const translation = {};
  const element = (ui, blocked = false, translated = true) => ({ nodeType: 1,
    closest(selector) {
      if (selector === UI) return ui;
      if (selector === BLOCKED) return blocked ? this : null;
      if (selector === '.sci-bilingual-translation[data-sci-translation]') return translated ? translation : null;
      return null;
    }
  });
  const ctx = { Node: { ELEMENT_NODE: 1 }, MANUAL_UI_SELECTOR: UI, MANUAL_BLOCKED_SELECTOR: BLOCKED };
  vm.runInNewContext(['manualElementForNode', 'manualClosest', 'manualTranslationSelectionElement', 'isManualSelectionUiTarget']
    .map(name => functionSource(content, name)).join('\n'), ctx);
  assert.equal(ctx.isManualSelectionUiTarget(element(translation)), false);
  assert.equal(ctx.isManualSelectionUiTarget(element(translation, true)), true);
  assert.equal(ctx.isManualSelectionUiTarget(element({}, false)), true);
  assert.equal(ctx.isManualSelectionUiTarget(element(null, false, false)), false);
});

function gestureHarness(immediateLocate = true) {
  const calls = [], timers = new Map(); let id = 0;
  const gesture = createFigureGesture({ immediateLocate,
    onLocate: () => calls.push('locate'), onAnalyze: () => calls.push('analyze'), onInspect: () => calls.push('inspect'),
    setTimer: callback => { timers.set(++id, callback); return id; }, clearTimer: key => timers.delete(key)
  });
  const press = { pointerId: 1, button: 0, clientX: 10, clientY: 10 };
  const click = detail => { gesture.pointerDown(press); gesture.pointerUp(press); gesture.click({ detail }); };
  return { gesture, press, calls, click, flush() { for (const [key, callback] of [...timers]) { timers.delete(key); callback(); } } };
}

test('in-page Figure navigation dispatches immediately without the 500 ms click timer', () => {
  const h = gestureHarness(); h.click(1);
  assert.deepEqual(h.calls, ['locate']);
  h.flush(); assert.deepEqual(h.calls, ['locate']);
  assert.match(popup, /immediateLocate: !figure\.sourceExternal/);
});

test('immediate Figure navigation preserves double-click analysis and long-press inspection', () => {
  const h = gestureHarness(); h.click(1); h.click(2); h.gesture.doubleClick({}); h.flush();
  assert.deepEqual(h.calls, ['locate', 'analyze']);
  const long = gestureHarness(); long.gesture.pointerDown(long.press); long.flush();
  long.gesture.pointerUp(long.press); long.gesture.click({ detail: 1 });
  assert.deepEqual(long.calls, ['inspect']);
});

test('external Figure double click does not open an unwanted tab', () => {
  const h = gestureHarness(false); h.click(1);
  assert.deepEqual(h.calls, []);
  h.click(2); h.gesture.doubleClick({}); h.flush();
  assert.deepEqual(h.calls, ['analyze']);
});

test('pending navigation deduplicates requests without disabling double-click interaction', async () => {
  let resolve, requests = 0;
  const button = { isConnected: true, disabled: false, dataset: {}, setAttribute() {} };
  const ctx = { isCurrentPanelContext: () => true, showStatus(message) { assert.fail(message); },
    capturePanelContext: () => ({}), focusWorkspaceSourceDetailed: () => {
      requests++; return new Promise(done => { resolve = done; });
    } };
  vm.runInNewContext(functionSource(popup, 'handleFigureWorkspaceJump'), ctx);
  const first = ctx.handleFigureWorkspaceJump({ figureId: 'Fig1' }, button);
  assert.equal(requests, 1); assert.equal(button.disabled, false);
  assert.equal(await ctx.handleFigureWorkspaceJump({ figureId: 'Fig1' }, button), null);
  assert.equal(requests, 1);
  resolve({ success: true, focused: true }); await first;
  assert.equal(button.dataset.figureJumpPending, undefined);
});
