const test = require('node:test');
const assert = require('node:assert/strict');
const { createSemanticFindController } = require('../semantic-find-controller.js');

function harness(overrides = {}) {
  const nodes = [];
  const document = { createElement(tag) {
    const attrs = new Map(), events = new Map();
    const node = { tagName: tag.toUpperCase(), children: [], textContent: '', value: '',
      append(...children) { children.forEach(child => this.appendChild(child)); },
      appendChild(child) { child.parentElement = this; this.children.push(child); },
      setAttribute: (key, value) => attrs.set(key, String(value)),
      getAttribute: key => attrs.get(key),
      addEventListener: (type, callback) => events.set(type, callback),
      dispatch(type, extra = {}) { events.get(type)?.({ target: this, ...extra }); },
      focus() { document.activeElement = this; },
      closest(selector) {
        if (['INPUT', 'TEXTAREA', 'SELECT'].includes(this.tagName)) return this;
        if (this.tagName === 'A' && selector.includes('a[href]')) return this;
        if (this.tagName === 'BUTTON' && selector.includes('button')) return this;
        return null;
      }
    };
    nodes.push(node); return node;
  } };
  document.body = document.createElement('body');
  const calls = { paints: [], focuses: [], messages: [], clears: 0 };
  const corpus = { sourceKey: 'search024', identity: { kind: 'html' }, coverage: 'full',
    coverageMessage: '当前网页全部已加载且渲染可见的文本（含屏外）；不自动翻页。',
    paragraphs: [{ paragraphId: 'card', text: 'Low. High. Tied. Below.' }],
    sentences: ['low', 'high', 'tied', 'below'].map((id, index) => ({ id, paragraphId: 'card', text: id, start: index * 6, end: index * 6 + 5 })),
    ...overrides.corpus };
  const controller = createSemanticFindController({ document,
    adapter: { buildCorpus: async () => corpus, isCurrent: () => true,
      paint: (_, hits, currentId) => calls.paints.push({ hits, currentId }),
      focus: async (_, hit) => { calls.focuses.push(hit.id); },
      clear: () => { calls.clears += 1; }, confirm: async () => false },
    sendMessage: async message => {
      calls.messages.push(message);
      if (overrides.sendMessage) return overrides.sendMessage(message);
      return { success: true, data: { operationId: message.operationId, sourceKey: message.sourceKey,
        processed: 4, total: 4, skipped: 0, complete: true,
        scores: [{ id: 'tied', score: 0.95 }, { id: 'low', score: 0.72 }, { id: 'high', score: 0.95 }, { id: 'below', score: 0.2 }] } };
    }
  });
  controller.open();
  const role = name => nodes.find(n => n.getAttribute('data-semantic-find-role') === name);
  const key = (value, extra = {}) => controller.handleKeydown({ key: value, target: role('query'), preventDefault() {}, stopPropagation() {}, ...extra });
  const search = async () => { role('query').value = 'matching results'; key('Enter'); await new Promise(resolve => setImmediate(resolve)); };
  return { controller, calls, corpus, role, key, search, document };
}

test('SEARCH024 score-descending navigation is stable for ties and does not rescore threshold changes', async () => {
  const f = harness(); await f.search();
  assert.deepEqual(f.calls.paints.at(-1).hits.map(hit => hit.id), ['high', 'tied', 'low']);
  assert.equal(f.calls.paints.at(-1).currentId, 'high');
  f.key('Enter'); assert.equal(f.calls.paints.at(-1).currentId, 'tied');
  f.key('Enter', { shiftKey: true }); assert.equal(f.calls.paints.at(-1).currentId, 'high');
  f.role('threshold-number').value = '0.1'; f.role('threshold-number').dispatch('change');
  assert.deepEqual(f.calls.paints.at(-1).hits.map(hit => hit.id), ['high', 'tied', 'low', 'below']);
  assert.match(f.role('status').textContent, /找到 4 条/);
  assert.equal(f.calls.messages.filter(m => m.type === 'LLM_SEMANTIC_FIND').length, 1);
});

test('SEARCH024 full HTML corpus publishes core coverage text while cold open makes no whole-page promise', async () => {
  const f = harness();
  assert.ok(f.role('scope'));
  assert.doesNotMatch(f.role('scope').textContent, /全部已加载|全文完成/);
  assert.equal(f.calls.messages.length, 0);
  await f.search();
  assert.ok(f.role('scope').textContent.includes(f.corpus.coverageMessage));
  assert.match(f.role('scope').textContent, /无需.*侧栏/);
  assert.match(f.role('legend').children.map(n => n.textContent).join(''), /分值.*高.*低|高.*低.*分值/);
  f.controller.invalidate('页面内容变化，请重新搜索。');
  assert.doesNotMatch(f.role('scope').textContent, /全部已加载/);
  assert.match(f.role('status').textContent, /重新搜索/);
});

test('SEARCH024 PDF partial coverage remains explicit and is never labelled as complete HTML', async () => {
  const f = harness({ corpus: { identity: { kind: 'pdf' }, coverage: 'partial', coverageMessage: '第4页尚未索引' } });
  await f.search();
  assert.match(f.role('scope')?.textContent || '', /PDF/);
  assert.doesNotMatch(f.role('scope').textContent, /全部已加载.*网页|网页.*全部/);
  assert.match(f.role('progress').textContent, /部分覆盖.*第4页尚未索引/);
});

test('SEARCH024 IME and page inputs are untouched and a cleared query cancels pending work', async () => {
  let finish;
  const f = harness({ sendMessage: message => message.type === 'LLM_SEMANTIC_FIND'
    ? new Promise(resolve => { finish = resolve; }) : Promise.resolve({ success: true }) });
  assert.equal(f.key('Enter', { isComposing: true }), false);
  assert.equal(f.key('Enter', { target: f.document.createElement('input') }), false);
  await f.search();
  f.role('query').value = ''; f.role('query').dispatch('input');
  assert.ok(f.calls.messages.some(m => m.type === 'LLM_SEMANTIC_FIND_CANCEL'));
  finish({ success: true, data: { scores: [{ id: 'high', score: 0.95 }], processed: 1, total: 4 } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.calls.paints.length, 0);
  assert.equal(f.role('position').textContent, '0 / 0');
});

test('SEARCH024 Enter preserves native link/button actions and open-shadow input editing', async () => {
  const f = harness(); await f.search();
  const before = f.calls.paints.length;
  assert.equal(f.key('Enter', { target: f.document.createElement('a') }), false);
  assert.equal(f.key('Enter', { target: f.document.createElement('button') }), false);
  assert.equal(f.key('Enter', { target: f.document.createElement('div'),
    composedPath: () => [f.document.createElement('input')] }), false);
  assert.equal(f.calls.paints.length, before);
});
