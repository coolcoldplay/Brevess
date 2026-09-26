const test = require('node:test');
const assert = require('node:assert/strict');
const { createSemanticFindController } = require('../semantic-find-controller.js');
const NOTICE = '页面新增内容尚未纳入本轮；重新搜索可更新范围。';
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const corpus = (key = 'source-a', sourceNotice = '') => ({ sourceKey: key, sourceNotice, identity: { kind: 'html' },
  coverage: 'full', coverageMessage: '已加载文本（含屏幕外）；不自动翻页。',
  paragraphs: [{ paragraphId: 'p', text: 'One. Two. Three.' }],
  sentences: ['one', 'two', 'three'].map((id, index) => ({ id, paragraphId: 'p', text: id, start: index * 5, end: index * 5 + 3 })) });
const response = message => ({ success: true, data: { operationId: message.operationId, sourceKey: message.sourceKey,
  processed: 3, total: 3, skipped: 0, complete: true,
  scores: [{ id: 'three', score: .72 }, { id: 'one', score: .96 }, { id: 'two', score: .84 }] } });

function harness({ buildCorpus = async () => corpus(), score = async message => response(message) } = {}) {
  const nodes = [], calls = { messages: [], paints: [], focuses: [], clears: 0 };
  const document = { createElement(tag) {
    const attrs = new Map(), events = new Map();
    const node = { tagName: tag.toUpperCase(), children: [], textContent: '', value: '',
      setAttribute: (k, v) => attrs.set(k, String(v)), getAttribute: k => attrs.get(k),
      append(...children) { children.forEach(child => this.appendChild(child)); },
      appendChild(child) { this.children.push(child); child.parentElement = this; },
      addEventListener: (name, callback) => events.set(name, callback),
      dispatch(name) { events.get(name)?.({ target: this }); },
      focus() { document.activeElement = this; }, remove() {}, closest() { return null; } };
    nodes.push(node); return node;
  } };
  document.body = document.createElement('body');
  const controller = createSemanticFindController({ document,
    adapter: { buildCorpus, isCurrent: () => true,
      paint: (source, hits, currentId) => calls.paints.push({ source: source.sourceKey, hits, currentId }),
      focus: async (_, hit) => calls.focuses.push(hit.id), clear: () => { calls.clears++; }, confirm: async () => true },
    sendMessage: async message => { calls.messages.push(message); return message.type === 'LLM_SEMANTIC_FIND' ? score(message) : { success: true }; } });
  controller.open();
  const role = name => nodes.find(n => n.getAttribute('data-semantic-find-role') === name);
  const search = async (query = 'first query') => { role('query').value = query; role('query').dispatch('input'); role('submit').dispatch('click'); await tick(); };
  return { controller, role, search, calls, nodes };
}

test('SEARCH024 source notice is a scope-only update, preserving scores/current result and no new work', async () => {
  const f = harness(); await f.search();
  f.role('next').dispatch('click'); await tick();
  const before = structuredClone(f.calls), status = f.role('status').textContent;
  const position = f.role('position').textContent, score = f.role('score').textContent;
  assert.equal(typeof f.controller.updateSourceNotice, 'function');
  assert.equal(f.controller.updateSourceNotice(NOTICE), true);
  assert.ok(f.role('scope').textContent.endsWith(NOTICE));
  assert.ok(f.role('scope').textContent.includes('含屏幕外'));
  assert.deepEqual(f.calls, before);
  assert.equal(f.role('status').textContent, status);
  assert.equal(f.role('status').getAttribute('data-state'), 'success');
  assert.equal(f.role('position').textContent, position); assert.equal(f.role('score').textContent, score);
  f.controller.updateSourceNotice(NOTICE);
  assert.equal(f.role('scope').textContent.split(NOTICE).length, 2, 'repeated notices are not appended twice');
});

test('SEARCH024 admits candidate.sourceNotice without altering the original coverage message', async () => {
  const candidate = corpus('early', NOTICE), coverage = candidate.coverageMessage;
  const f = harness({ buildCorpus: async () => candidate }); await f.search();
  assert.ok(f.role('scope').textContent.endsWith(NOTICE));
  assert.equal(candidate.coverageMessage, coverage);
  assert.equal(f.role('position').textContent, '1 / 3');
});

test('SEARCH024 source notice survives progress, threshold, navigation and terminal completion', async () => {
  const pending = deferred(); const f = harness({ score: () => pending.promise }); await f.search();
  const request = f.calls.messages.find(m => m.type === 'LLM_SEMANTIC_FIND');
  assert.equal(f.controller.updateSourceNotice(NOTICE), true);
  assert.equal(f.controller.handleProgress({ action: 'semanticFindProgress', operationId: request.operationId, sourceKey: request.sourceKey,
    progress: { scores: [{ id: 'one', score: .96 }, { id: 'two', score: .84 }], processed: 2, total: 3 } }), true);
  await tick();
  f.role('threshold-number').value = '.8'; f.role('threshold-number').dispatch('change');
  f.role('next').dispatch('click'); f.role('previous').dispatch('click'); await tick();
  assert.ok(f.role('scope').textContent.endsWith(NOTICE));
  assert.equal(f.calls.messages.length, 1, 'notice must not cancel or restart the operation');
  pending.resolve(response(request)); await tick();
  assert.equal(f.role('position').textContent, '1 / 2');
  assert.equal(f.role('status').getAttribute('data-state'), 'success');
  assert.ok(f.role('scope').textContent.endsWith(NOTICE));
  assert.equal(f.calls.messages.length, 1);
});

test('SEARCH024 new search removes prior source notice immediately and admits only the new notice', async () => {
  const next = deferred(); let count = 0;
  const f = harness({ buildCorpus: () => ++count === 1 ? corpus('old', NOTICE) : next.promise });
  await f.search(); assert.ok(f.role('scope').textContent.endsWith(NOTICE));
  await f.search('second query'); assert.ok(!f.role('scope').textContent.includes(NOTICE));
  assert.equal(f.controller.updateSourceNotice('stale notification while building'), false);
  next.resolve(corpus('new')); await tick();
  assert.ok(!f.role('scope').textContent.includes(NOTICE));
  assert.ok(!f.role('scope').textContent.includes('stale notification'));
  assert.equal(f.calls.paints.at(-1).source, 'new');
});

test('SEARCH024 clear, close, invalidate and destroy remove source notices and refuse idle updates', async () => {
  for (const action of ['clear', 'close', 'invalidate', 'destroy']) {
    const f = harness();
    assert.equal(f.controller.updateSourceNotice(NOTICE), false);
    await f.search(); f.controller.updateSourceNotice(NOTICE);
    if (action === 'clear') { f.role('query').value = ''; f.role('query').dispatch('input'); }
    else if (action === 'invalidate') f.controller.invalidate('Actual changed source');
    else f.controller[action]();
    assert.ok(!f.role('scope').textContent.includes(NOTICE), action);
    assert.equal(f.controller.updateSourceNotice('late source notification'), false, action);
    if (action === 'close') { f.controller.open(); assert.ok(!f.role('scope').textContent.includes(NOTICE)); }
    if (action === 'invalidate') assert.equal(f.role('status').textContent, 'Actual changed source');
  }
});

test('SEARCH024 late superseded build cannot leak its candidate notice into a newer corpus', async () => {
  const old = deferred(); let count = 0;
  const f = harness({ buildCorpus: () => ++count === 1 ? old.promise : corpus('new', 'CURRENT NOTICE') });
  await f.search('old query'); await f.search('new query');
  old.resolve(corpus('old', 'STALE NOTICE')); await tick();
  assert.ok(f.role('scope').textContent.endsWith('CURRENT NOTICE'));
  assert.ok(!f.role('scope').textContent.includes('STALE NOTICE'));
  assert.equal(f.calls.messages.filter(m => m.type === 'LLM_SEMANTIC_FIND').length, 1);
  assert.equal(f.calls.paints.at(-1).source, 'new');
});

test('SEARCH024 old model progress/response cannot overwrite a newer source notice or its results', async () => {
  const old = deferred(); let count = 0;
  const f = harness({ buildCorpus: () => corpus(`source-${++count}`), score: message => message.query === 'old query' ? old.promise : response(message) });
  await f.search('old query'); const request = f.calls.messages.find(m => m.type === 'LLM_SEMANTIC_FIND');
  f.controller.updateSourceNotice('OLD NOTICE'); await f.search('new query');
  f.controller.updateSourceNotice('CURRENT NOTICE'); const before = structuredClone(f.calls.paints);
  assert.equal(f.controller.handleProgress({ action: 'semanticFindProgress', operationId: request.operationId, sourceKey: request.sourceKey,
    progress: { ...response(request).data, sourceNotice: 'STALE NOTICE' } }), false);
  old.resolve({ success: true, data: { ...response(request).data, sourceNotice: 'STALE NOTICE' } }); await tick();
  assert.deepEqual(f.calls.paints, before);
  assert.ok(f.role('scope').textContent.endsWith('CURRENT NOTICE'));
  assert.ok(!f.role('scope').textContent.includes('OLD NOTICE'));
});

test('SEARCH024 source notice is rendered as plain text and empty update clears only the notice', async () => {
  const f = harness(); await f.search(); const before = structuredClone(f.calls);
  const scope = f.role('scope'), nodes = f.nodes.length;
  f.controller.updateSourceNotice(' <img src=x onerror=alert(1)> ');
  assert.ok(scope.textContent.endsWith('<img src=x onerror=alert(1)>'));
  assert.equal(f.nodes.length, nodes, 'no new UI row or markup is created');
  f.controller.updateSourceNotice('');
  assert.ok(!scope.textContent.includes('<img'));
  assert.ok(scope.textContent.includes('含屏幕外'));
  assert.deepEqual(f.calls, before);
});
