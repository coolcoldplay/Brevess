const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const { createSemanticFindController } = require('../semantic-find-controller.js');
const engine = require('../core/semantic-find.js');
const tick = () => new Promise(resolve => setImmediate(resolve));

// Real controller + complete adapter. The leaf DOM snapshot is an observable
// source lease; browser geometry and manual preparation are supplied fixtures.
async function fixture() {
  const nodes = [], events = new Map(), retired = new Set(), timers = new Map();
  let counts = {}, watch, valid = true, timerId = 0, selected = [], toolbar = null;
  const count = name => { counts[name] = (counts[name] || 0) + 1; };
  const document = {
    addEventListener: (type, fn) => events.set(type, fn), querySelectorAll: () => [],
    getSelection: () => ({ get rangeCount() { return selected.length; },
      getRangeAt: i => selected[i], removeAllRanges() { selected = []; }, addRange(r) { selected.push(r); } }),
    createElement(tag) {
      const attributes = new Map(), listeners = new Map();
      const node = { tagName: tag.toUpperCase(), children: [], value: '', textContent: '', dataset: {},
        append(...children) { children.forEach(child => this.appendChild(child)); },
        appendChild(child) { child.parentElement = this; child.isConnected = true; this.children.push(child); },
        setAttribute: (key, value) => attributes.set(key, String(value)), getAttribute: key => attributes.get(key),
        addEventListener: (type, fn) => listeners.set(type, fn), dispatch: type => listeners.get(type)?.({ target: node }),
        closest() { return ['BUTTON', 'INPUT'].includes(this.tagName) ? this : null; },
        focus() {}, remove() { this.isConnected = false; } };
      nodes.push(node); return node;
    }
  };
  document.body = document.createElement('body'); document.head = document.createElement('head');
  const paragraphs = Array.from({ length: 3 }, (_, i) => ({ paragraphId: `p${i}`, text: `Stable source ${i}.` }));
  const sentences = engine.createSemanticFindSentences(paragraphs);
  const sourceNodes = new Map(paragraphs.map(p => {
    const block = { textContent: p.text, dataset: { sciLlmParagraphId: p.paragraphId }, scrollIntoView() {} };
    block.closest = selector => selector === '[data-sci-llm-paragraph-id]' ? block : null;
    return [p.paragraphId, { parentElement: block, getRootNode: () => document }];
  }));
  const ranges = hit => {
    count('ranges'); if (retired.has(hit.paragraphId)) return [];
    const node = sourceNodes.get(hit.paragraphId);
    return [{ startContainer: node, endContainer: node, startOffset: hit.start, endOffset: hit.end,
      toString: () => node.parentElement.textContent.slice(hit.start, hit.end),
      getClientRects: () => [{ left: 0, top: 0, right: 200, bottom: 20, width: 200, height: 20 }] }];
  };
  const dom = { paragraphs, bindings: new Map(), roots: [], watch(...callbacks) { watch = callbacks; }, disconnect() {},
    isCurrent() { count('sourceChecks'); return valid; },
    isHitCurrent(hit) { count('hitChecks'); return !retired.has(hit.paragraphId); },
    ranges, range: hit => ranges(hit)[0], reveal: () => true, isVisible: () => true, drainAdditionalParagraphs: () => [] };
  class Highlights extends Map {
    delete(key) { count('highlightDeletes'); return super.delete(key); }
  }
  const sandbox = { document, TextEncoder, crypto: webcrypto, CSS: { highlights: new Highlights() }, Highlight: class {},
    currentManualSelection: null, currentManualDocument: { documentId: 'canonical-paper' },
    currentArticleStructure: { paragraphs }, currentNativePdfSemanticHighlightState: () => ({}), activeNativePdfStructure: () => null,
    contentNavigationIdentity: () => 'https://example.org/paper', contentDocumentIdentity: 'test-document', articleWorkspaceLifecycleGeneration: 1,
    manualReadableText: node => node.textContent,
    prepareManualDocument: async () => { count('prepare'); },
    describeCurrentManualSelection: () => ({ validation: { valid: true }, anchor: { quote: selected[0].toString() }, text: selected[0].toString() }),
    showManualSelectionToolbar(descriptor) { count('toolbar'); toolbar = descriptor; sandbox.currentManualSelection = descriptor; },
    releaseSelectionAfterManualAction() { count('released'); toolbar = null; sandbox.currentManualSelection = null; selected = []; },
    window: { addEventListener() {}, setTimeout(fn) { timers.set(++timerId, fn); return timerId; }, clearTimeout(id) { timers.delete(id); } },
    SciLLM: { ...engine, createSemanticFindController,
      normalizeTextWithOffsets: text => ({ text }),
      createSemanticFindDomSnapshot(_, options) { options.validateAdditionalParagraphs(paragraphs, { initial: true }); return dom; },
      semanticFindScoreAlpha: score => score },
    chrome: { runtime: { async sendMessage(message) {
      if (message.type !== 'LLM_SEMANTIC_FIND') return { success: true, data: {} };
      return { success: true, data: { operationId: message.operationId, sourceKey: message.sourceKey,
        processed: 3, total: 3, skipped: 0, complete: true, scores: sentences.map((s, i) => ({ id: s.id, score: .95 - .01 * i })) } };
    } } }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../semantic-find-content.js'), 'utf8'), sandbox);
  const controller = sandbox.__brevessSemanticFind;
  const role = key => nodes.find(n => n.getAttribute('data-semantic-find-role') === key);
  controller.open(); role('query').value = 'stable source'; role('submit').dispatch('click');
  for (let i = 0; i < 100 && !/找到 3 条/.test(role('status').textContent); i++) await tick();
  assert.match(role('status').textContent, /找到 3 条/);
  counts = {};
  const click = (target = { closest: () => null }, extra = {}) => events.get('click')({
    target, button: 0, clientX: 5, clientY: 5,
    preventDefault() { count('prevented'); }, stopImmediatePropagation() { count('stopped'); }, ...extra });
  return { controller, role, click, sandbox, retired, paragraphs, sourceNodes,
    rebound: () => watch[1](), counts: () => ({ ...counts }), reset() { counts = {}; },
    setValid(value) { valid = value; }, toolbar: () => toolbar, selection: () => [...selected] };
}

test('capture excludes plugin UI, links, controls and existing annotation targets before source validation', async () => {
  const f = await fixture();
  for (const selector of ['[data-sci-plugin-ui]', 'button', 'a', 'input', 'textarea', 'select', '[role="button"]', '[contenteditable]', '.sci-manual-highlight', '.sci-llm-highlight']) {
    f.reset();
    f.click({ closest: query => { assert.ok(query.includes(selector)); return {}; } });
    assert.equal(f.counts().sourceChecks || 0, 0, selector);
    assert.equal(f.counts().ranges || 0, 0, selector);
  }
  f.controller.destroy();
});

test('a score-filtered empty result set does not validate unrelated page clicks', async () => {
  const f = await fixture(); f.role('threshold-number').value = '1'; f.role('threshold-number').dispatch('change');
  assert.equal(f.role('position').textContent, '0 / 0'); f.reset(); f.click();
  assert.equal(f.counts().sourceChecks || 0, 0);
  f.controller.destroy();
});

test('one source rebound paints once and preserves selected hit and range selection', async () => {
  const f = await fixture(); f.role('next').dispatch('click'); await tick();
  const selectedBefore = f.role('position').textContent;
  f.reset(); f.rebound();
  assert.equal(f.counts().highlightDeletes, 102, 'one complete highlight paint, not two');
  assert.equal(f.role('position').textContent, selectedBefore);
  assert.equal(f.counts().released || 0, 0);
  f.controller.destroy();
});

test('real source-hit click still opens a fresh canonical manual-save descriptor', async () => {
  const f = await fixture(); f.click(); await tick();
  assert.ok(f.counts().sourceChecks > 0); assert.ok(f.counts().hitChecks > 0);
  assert.equal(f.counts().toolbar, 1); assert.equal(f.counts().prepare, 1);
  assert.equal(f.toolbar().anchor.quote, 'Stable source 0.');
  assert.equal(f.controller.isCurrentSource(f.toolbar().semanticFindSourceKey), true);
  f.controller.destroy();
});

test('source identity invalidation prevents page-hit confirmation before manual preparation', async () => {
  const f = await fixture(); f.setValid(false); f.click(); await tick();
  assert.ok(f.counts().sourceChecks > 0); assert.equal(f.counts().prepare || 0, 0);
  assert.equal(f.toolbar(), null); f.controller.destroy();
});

test('retirement during manual preparation still prevents stale selection and toolbar', async () => {
  const f = await fixture(); let finish;
  f.sandbox.prepareManualDocument = () => new Promise(resolve => { finish = resolve; });
  f.click(); assert.equal(typeof finish, 'function');
  f.retired.add('p0'); finish(); await tick();
  assert.equal(f.toolbar(), null); assert.equal(f.selection().length, 0);
  f.controller.destroy();
});

test('retiring confirmed text releases its owned toolbar and selection before one repaint', async () => {
  const f = await fixture(); f.click(); await tick(); const key = f.toolbar().semanticFindSourceKey;
  f.retired.add('p0'); f.reset(); f.rebound();
  assert.equal(f.counts().released, 1); assert.equal(f.toolbar(), null); assert.equal(f.selection().length, 0);
  assert.equal(f.controller.isCurrentSource(key), false); assert.equal(f.role('position').textContent, '1 / 2');
  assert.equal(f.counts().highlightDeletes, 102);
  f.controller.destroy();
});

test('retiring a different hit leaves the confirmed toolbar and user selection intact', async () => {
  const f = await fixture(); f.click(); await tick(); const descriptor = f.toolbar(), selection = f.selection()[0];
  f.retired.add('p2'); f.reset(); f.rebound();
  assert.equal(f.counts().released || 0, 0); assert.equal(f.toolbar(), descriptor); assert.equal(f.selection()[0], selection);
  assert.equal(f.controller.isCurrentSource(descriptor.semanticFindSourceKey), true);
  f.controller.destroy();
});

test('retirement never releases a newer selection owned by another manual action', async () => {
  const f = await fixture(); f.click(); await tick();
  const other = { semanticFindSourceKey: 'another-owner' }; f.sandbox.currentManualSelection = other;
  f.retired.add('p0'); f.reset(); f.rebound();
  assert.equal(f.counts().released || 0, 0); assert.equal(f.sandbox.currentManualSelection, other);
  f.controller.destroy();
});
