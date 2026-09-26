const test = require('node:test');
const assert = require('node:assert/strict');
const { createSemanticFindController } = require('../semantic-find-controller.js');
const { createSemanticFindSentences } = require('../core/semantic-find.js');
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function source(paragraphId, text = 'First loaded sentence. Second loaded sentence.') {
  const paragraphs = [{ paragraphId, text }];
  return { sourceKey: ['original', 'near-limit'].includes(paragraphId) ? 'stable-source' : `delta:${paragraphId}`, identity: { kind: 'html' }, coverage: 'full', paragraphs, sentences: createSemanticFindSentences(paragraphs) };
}
function response(message, score = .85) {
  const sentences = createSemanticFindSentences(message.paragraphs);
  return { success: true, data: { operationId: message.operationId, sourceKey: message.sourceKey,
    processed: sentences.length, skipped: 0, total: sentences.length, complete: true,
    scores: sentences.map((s, i) => ({ id: s.id, score: typeof score === 'function' ? score(i) : score })) } };
}
function harness(options = {}) {
  const nodes = [], timers = new Map(); let now = 0, timerId = 0, current = true;
  const retired = new Set();
  const clock = {
    setTimeout(fn, delay) { const id = ++timerId; timers.set(id, { fn, at: now + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    async advance(ms = 500) {
      now += ms;
      for (const [id, job] of [...timers]) if (job.at <= now) { timers.delete(id); job.fn(); }
      await tick();
    },
    get pending() { return timers.size; }
  };
  const document = { createElement(tag) {
    const attrs = new Map(), listeners = new Map();
    const node = { tagName: tag.toUpperCase(), children: [], textContent: '', value: '',
      setAttribute(k, v) { attrs.set(k, String(v)); }, getAttribute: k => attrs.get(k),
      append(...children) { children.forEach(child => this.appendChild(child)); },
      appendChild(child) { child.parentElement = this; this.children.push(child); },
      addEventListener(k, fn) { listeners.set(k, fn); }, dispatch(k) { listeners.get(k)?.({ target: this }); },
      focus() { document.activeElement = this; }, remove() {}, closest() { return null; } };
    nodes.push(node); return node;
  } };
  document.body = document.createElement('body');
  const calls = { messages: [], paints: [], focuses: [], collects: 0, clears: 0, confirms: [] };
  const additions = [];
  const adapter = { buildCorpus: options.buildCorpus || (() => source('original')),
    isCurrent: () => current,
    isHitCurrent: options.isHitCurrent || ((_, hit) => !retired.has(hit.paragraphId)),
    paint: (candidate, hits, currentId) => calls.paints.push({ candidate, hits: structuredClone(hits), currentId }),
    focus: async (_, hit) => { calls.focuses.push(hit.id); }, clear: () => { calls.clears++; },
    confirm: async (_, hit) => { calls.confirms.push(hit); return options.confirm ? options.confirm(hit) : true; },
    collectAdditionalCorpus: async candidate => { calls.collects++; return options.collect ? options.collect(candidate) : additions.shift() || null; }
  };
  if (options.noAdditional) delete adapter.collectAdditionalCorpus;
  if (options.noHitCurrent) delete adapter.isHitCurrent;
  const controller = createSemanticFindController({ document, window: clock, adapter,
    sendMessage: async message => {
      calls.messages.push(structuredClone(message));
      if (message.type !== 'LLM_SEMANTIC_FIND') return { success: true };
      return options.score ? options.score(message) : response(message);
    } });
  controller.open();
  const role = name => nodes.find(n => n.getAttribute('data-semantic-find-role') === name);
  const search = async (query = 'same semantic question') => { role('query').value = query; role('query').dispatch('input'); role('submit').dispatch('click'); await tick(); };
  const requests = () => calls.messages.filter(m => m.type === 'LLM_SEMANTIC_FIND');
  const progress = (request, payload) => controller.handleProgress({ action: 'semanticFindProgress', operationId: request.operationId, sourceKey: request.sourceKey, progress: payload });
  return { controller, role, search, requests, progress, calls, additions, clock, adapter, retired, setCurrent(value) { current = value; } };
}

test('incremental debounce sends delta only and maps request-local IDs without changing current result', async () => {
  const f = harness({ score: message => response(message, message.paragraphs[0].paragraphId === 'original' ? .85 : .99) });
  await f.search(); f.role('next').dispatch('click'); await tick();
  const before = f.calls.paints.at(-1), focuses = f.calls.focuses.length, clears = f.calls.clears;
  const delta = source('append-one'); f.additions.push(delta);
  assert.equal(typeof f.controller.queueAdditionalSearch, 'function');
  assert.equal(f.controller.queueAdditionalSearch(), true);
  f.controller.queueAdditionalSearch(); f.controller.queueAdditionalSearch();
  await f.clock.advance(399); assert.equal(f.requests().length, 1);
  await f.clock.advance(1);
  assert.equal(f.requests().length, 2); assert.deepEqual(f.requests()[1].paragraphs, delta.paragraphs);
  assert.equal(f.requests()[1].query, f.requests()[0].query); assert.equal(f.requests()[1].sourceKey, delta.sourceKey);
  assert.notEqual(f.requests()[1].sourceKey, f.requests()[0].sourceKey);
  assert.notEqual(f.requests()[1].operationId, f.requests()[0].operationId);
  const after = f.calls.paints.at(-1);
  assert.equal(after.currentId, before.currentId); assert.equal(f.calls.focuses.length, focuses); assert.equal(f.calls.clears, clears);
  assert.equal(new Set(after.hits.map(h => h.id)).size, 4);
  assert.deepEqual(after.candidate.sentences.map(s => s.id), [...before.hits.map(h => h.id), ...after.hits.filter(h => h.paragraphId === 'append-one').map(h => h.id)]);
  assert.deepEqual(after.hits.filter(h => h.paragraphId === 'original'), before.hits);
  assert.deepEqual(after.hits.map(h => h.paragraphId), ['append-one', 'append-one', 'original', 'original']);
  assert.ok(after.hits.filter(h => h.paragraphId === 'append-one').every(h => !before.hits.some(old => old.id === h.id)));
  assert.match(f.role('progress').textContent, /已处理 4 \/ 4/);
  f.role('threshold-number').value = '.9'; f.role('threshold-number').dispatch('change');
  assert.equal(f.calls.paints.at(-1).hits.length, 2); assert.equal(f.requests().length, 2);
  assert.equal(await f.controller.confirm(after.hits[0].id, {}), true);
  assert.equal(f.calls.confirms[0].paragraphId, 'append-one');
});

test('queue during initial build/request waits for transport settlement even after done progress', async () => {
  const build = deferred(), first = deferred();
  const f = harness({ buildCorpus: () => build.promise, score: m => m.paragraphs[0].paragraphId === 'original' ? first.promise : response(m) });
  await f.search(); f.additions.push(source('after-build'));
  assert.equal(f.controller.queueAdditionalSearch(), true);
  await f.clock.advance(); assert.equal(f.calls.collects, 0); assert.equal(f.requests().length, 0);
  build.resolve(source('original')); await tick();
  const request = f.requests()[0];
  assert.equal(f.progress(request, { ...response(request).data, done: true }), true);
  await f.clock.advance(); assert.equal(f.requests().length, 1, 'terminal stream is not transport completion');
  assert.equal(f.calls.collects, 0);
  first.resolve(response(request)); await tick(); await f.clock.advance();
  assert.equal(f.requests().length, 2); assert.equal(f.calls.messages.some(m => m.type.endsWith('_CANCEL') && m.operationId === request.operationId), false);
  assert.equal(f.calls.paints.at(-1).hits.length, 4);
});

test('new changes during a delta request queue one later batch and duplicate paragraphs never rescore', async () => {
  const pending = deferred();
  const f = harness({ score: m => m.paragraphs[0].paragraphId === 'append-one' ? pending.promise : response(m) });
  await f.search(); f.additions.push(source('append-one')); f.controller.queueAdditionalSearch(); await f.clock.advance();
  const firstDelta = f.requests()[1]; f.additions.push(source('append-two'));
  for (let i = 0; i < 4; i++) f.controller.queueAdditionalSearch();
  await f.clock.advance(); assert.equal(f.requests().length, 2); assert.equal(f.calls.collects, 1);
  pending.resolve(response(firstDelta)); await tick(); await f.clock.advance();
  assert.equal(f.requests().length, 3); assert.deepEqual(f.requests()[2].paragraphs.map(p => p.paragraphId), ['append-two']);
  assert.equal(f.calls.paints.at(-1).hits.length, 6);
  f.additions.push(source('append-one')); f.controller.queueAdditionalSearch(); await f.clock.advance();
  assert.equal(f.requests().length, 3, 'already consumed paragraphs are never sent again');
  assert.match(f.role('progress').textContent, /已处理 6 \/ 6/);
});

test('delta stream scores are isolated per local batch and a rejected batch rolls back only its scores', async () => {
  const pending = deferred();
  const f = harness({ score: m => m.paragraphs[0].paragraphId === 'bad-delta' ? pending.promise : response(m) });
  await f.search(); const before = f.calls.paints.at(-1), clears = f.calls.clears;
  f.additions.push(source('bad-delta')); f.controller.queueAdditionalSearch(); await f.clock.advance();
  const request = f.requests()[1];
  assert.equal(f.progress(request, { processed: 1, total: 2, skipped: 0, scores: [{ id: 'semantic_sentence_0', score: .97 }] }), true);
  assert.equal(f.calls.paints.at(-1).hits.length, 3);
  assert.equal(f.calls.paints.at(-1).currentId, before.currentId);
  pending.reject(new Error('delta transport failed')); await tick();
  assert.deepEqual(f.calls.paints.at(-1).hits, before.hits); assert.equal(f.calls.paints.at(-1).currentId, before.currentId);
  assert.equal(f.calls.clears, clears); assert.match(f.role('status').textContent, /新增|补充/); assert.match(f.role('status').textContent, /失败/);
  assert.doesNotMatch(f.role('scope').textContent, /delta transport failed|补充检索失败/, 'failure reason appears once, in status');
  assert.match(f.role('progress').textContent, /部分覆盖/);
  f.role('threshold-number').value = '.8'; f.role('threshold-number').dispatch('change');
  assert.match(f.role('status').textContent, /失败/, 'threshold does not disguise a failed batch as full success');
  await f.clock.advance(5000); assert.equal(f.requests().length, 2, 'failed batch does not auto-retry');
  f.additions.push(source('bad-delta')); f.controller.queueAdditionalSearch(); await f.clock.advance(); assert.equal(f.requests().length, 2);
  f.additions.push(source('new-after-failure')); f.controller.queueAdditionalSearch(); await f.clock.advance();
  assert.equal(f.requests().length, 3); assert.equal(f.calls.paints.at(-1).hits.length, 4);
  assert.match(f.role('status').textContent, /失败/); assert.match(f.role('progress').textContent, /已处理 4 \/ 6.*部分覆盖/);
  assert.doesNotMatch(f.role('scope').textContent, /delta transport failed|补充检索失败/);
  await f.search(); assert.equal(f.requests().length, 4, 'an explicit search starts a fresh attempt');
  assert.doesNotMatch(f.role('status').textContent, /失败/);
});

test('invalid incremental IDs/probabilities/conflicts/counts never alter old successful scores', async () => {
  const invalidPayloads = [
    { scores: [{ id: 'not-this-batch', score: .9 }] },
    { scores: [{ id: 'semantic_sentence_0', score: '0.9' }] },
    { scores: [{ id: 'semantic_sentence_0', score: Infinity }] },
    { scores: [{ id: 'semantic_sentence_0', score: .9 }, { id: 'semantic_sentence_0', score: .8 }] },
    { total: 4, processed: 4 }, { processed: 1 }, { skipped: 1 }, { total: '2' }
  ];
  for (const invalid of invalidPayloads) {
    const f = harness({ score: m => m.paragraphs[0].paragraphId === 'original' ? response(m) : { success: true, data: { ...response(m).data, ...invalid } } });
    await f.search(); const before = f.calls.paints.at(-1);
    f.additions.push(source('invalid')); f.controller.queueAdditionalSearch(); await f.clock.advance();
    assert.equal(f.requests().length, 2); assert.deepEqual(f.calls.paints.at(-1).hits, before.hits, JSON.stringify(invalid));
    assert.equal(f.calls.paints.at(-1).currentId, before.currentId);
    assert.match(f.role('status').textContent, /失败/); assert.match(f.role('progress').textContent, /部分覆盖/);
  }
});

test('incremental progress counts are per-batch while cumulative readout includes skipped sentences', async () => {
  const pending = deferred();
  const f = harness({ score: m => m.paragraphs[0].paragraphId === 'original' ? response(m) : pending.promise });
  await f.search(); f.additions.push(source('skipped')); f.controller.queueAdditionalSearch(); await f.clock.advance();
  const request = f.requests()[1];
  const data = { operationId: request.operationId, sourceKey: request.sourceKey, processed: 1, total: 2, skipped: 1, coverage: 'partial', scores: [{ id: 'semantic_sentence_0', score: .91 }], done: true };
  assert.equal(f.progress(request, data), true);
  assert.equal(f.progress(request, data), false, 'terminal incremental progress cannot be replayed');
  pending.resolve({ success: true, data }); await tick();
  assert.match(f.role('progress').textContent, /已处理 3 \/ 4.*部分覆盖/);
  assert.equal(f.calls.paints.at(-1).hits.length, 3); assert.doesNotMatch(f.role('status').textContent, /失败|不一致/);
});

test('clear/close/invalidate/destroy/new query cancel timers and reject late incremental progress and responses', async () => {
  for (const action of ['clear', 'close', 'invalidate', 'destroy', 'new-query']) {
    const pending = deferred(); const f = harness({ score: m => m.paragraphs[0].paragraphId === 'late' ? pending.promise : response(m) });
    await f.search(); f.additions.push(source('late')); f.controller.queueAdditionalSearch(); await f.clock.advance();
    const request = f.requests()[1]; f.controller.queueAdditionalSearch();
    if (action === 'clear') { f.role('query').value = ''; f.role('query').dispatch('input'); }
    else if (action === 'new-query') await f.search('different query');
    else f.controller[action]();
    const before = structuredClone(f.calls.paints), requestCount = f.requests().length;
    assert.equal(f.progress(request, response(request).data), false, action);
    pending.resolve(response(request)); await tick(); await f.clock.advance(5000);
    assert.deepEqual(f.calls.paints, before, action); assert.equal(f.requests().length, requestCount, action); assert.equal(f.clock.pending, 0, action);
    assert.ok(f.calls.messages.some(m => m.type.endsWith('_CANCEL') && m.operationId === request.operationId), action);
  }
});

test('queued-but-not-started additions and idle callers never make paid requests', async () => {
  for (const action of ['clear', 'close', 'invalidate', 'destroy']) {
    const f = harness(); assert.equal(f.controller.queueAdditionalSearch(), false);
    await f.search(); f.additions.push(source('queued')); f.controller.queueAdditionalSearch();
    if (action === 'clear') { f.role('query').value = ''; f.role('query').dispatch('input'); }
    else f.controller[action]();
    await f.clock.advance(5000); assert.equal(f.requests().length, 1); assert.equal(f.calls.collects, 0);
  }
});

test('late collection from a superseded source cannot admit paragraphs or send a delta', async () => {
  const collect = deferred(); let drains = 0;
  const f = harness({ collect: () => ++drains === 1 ? collect.promise : null });
  await f.search(); f.controller.queueAdditionalSearch(); await f.clock.advance();
  assert.equal(f.calls.collects, 1); await f.search('replacement question');
  const before = structuredClone(f.calls.paints);
  collect.resolve(source('obsolete')); await tick(); await f.clock.advance();
  assert.deepEqual(f.calls.paints, before); assert.equal(f.requests().length, 2);
});

test('cumulative sentence cap prevents an over-limit delta without discarding old results', async () => {
  const large = source('near-limit', Array.from({ length: 9999 }, (_, i) => `Sentence ${i}!`).join(' '));
  const f = harness({ buildCorpus: () => large }); await f.search();
  f.additions.push(source('over-limit')); f.controller.queueAdditionalSearch(); await f.clock.advance();
  assert.equal(f.requests().length, 1); assert.equal(f.calls.paints.at(-1).hits.length, 9999);
  assert.match(f.role('status').textContent + f.role('scope').textContent, /10000|上限/);
});

test('collector errors, missing batch key and malformed/empty deltas preserve prior results without extra requests', async () => {
  for (const collect of [() => null, () => ({ sourceKey: 'stable-source', paragraphs: [], sentences: [] }),
    () => { throw Error('collect failed'); }, () => ({ ...source('wrong'), sourceKey: '' }),
    () => ({ ...source('malformed'), sentences: [{ id: 'forged', paragraphId: 'missing', text: 'forged' }] })]) {
    const f = harness({ collect }); await f.search(); const before = f.calls.paints.at(-1).hits;
    f.controller.queueAdditionalSearch(); await f.clock.advance();
    assert.equal(f.requests().length, 1); assert.deepEqual(f.calls.paints.at(-1).hits, before);
  }
});

test('adapters without incremental support retain the original search behaviour', async () => {
  const f = harness({ noAdditional: true }); await f.search();
  assert.equal(f.controller.queueAdditionalSearch(), false); await f.clock.advance();
  assert.equal(f.requests().length, 1); assert.equal(f.calls.paints.at(-1).hits.length, 2);
});

test('a core cumulative-limit signal stops all automatic drains until an explicit fresh search', async () => {
  let attempts = 0;
  const f = harness({ collect: () => { attempts++; const error = Error('Core scope limit'); error.code = 'SEMANTIC_FIND_LIMIT_EXCEEDED'; throw error; } });
  await f.search(); f.controller.queueAdditionalSearch(); await f.clock.advance();
  const before = f.calls.paints.at(-1);
  assert.equal(attempts, 1); assert.equal(f.requests().length, 1);
  assert.equal(f.controller.queueAdditionalSearch(), false); await f.clock.advance(5000);
  assert.equal(attempts, 1); assert.equal(f.calls.paints.at(-1).currentId, before.currentId);
  assert.match(f.role('status').textContent, /容量上限/);
  assert.doesNotMatch(f.role('status').textContent, /10000/, 'a core byte/paragraph limit must not be mislabeled as the sentence limit');
  await f.search('fresh query'); assert.equal(f.controller.queueAdditionalSearch(), true);
});

test('incremental outer operation/source identities are required and done progress cannot release transport early', async () => {
  const pending = deferred();
  const f = harness({ score: m => m.paragraphs[0].paragraphId === 'append-one' ? pending.promise : response(m) });
  await f.search(); f.additions.push(source('append-one')); f.controller.queueAdditionalSearch(); await f.clock.advance();
  const request = f.requests()[1], data = response(request).data;
  const before = structuredClone(f.calls.paints);
  assert.equal(f.progress({ ...request, sourceKey: f.requests()[0].sourceKey }, data), false);
  assert.equal(f.progress({ ...request, operationId: f.requests()[0].operationId }, data), false);
  assert.deepEqual(f.calls.paints, before);
  f.additions.push(source('append-two')); f.controller.queueAdditionalSearch();
  assert.equal(f.progress(request, { ...data, done: true }), true);
  await f.clock.advance(1000); assert.equal(f.requests().length, 2);
  pending.resolve(response(request)); await tick(); await f.clock.advance();
  assert.equal(f.requests().length, 3); assert.equal(f.calls.paints.at(-1).hits.length, 6);
});

test('a nonempty sentence list without paragraphs is an explicit collection failure, not an empty drain', async () => {
  const f = harness({ collect: () => ({ ...source('missing-paragraphs'), paragraphs: [] }) });
  await f.search(); f.controller.queueAdditionalSearch(); await f.clock.advance();
  assert.equal(f.requests().length, 1); assert.equal(f.calls.paints.at(-1).hits.length, 2);
  assert.match(f.role('status').textContent, /失败/);
});

function separateParagraphs() {
  const paragraphs = [{ paragraphId: 'old-a', text: 'Alpha remains an exact source.' },
    { paragraphId: 'old-b', text: 'Beta remains an exact source.' },
    { paragraphId: 'old-c', text: 'Gamma remains an exact source.' }];
  return { ...source('original'), paragraphs, sentences: createSemanticFindSentences(paragraphs) };
}

test('paragraph retirement removes only related hits and refresh makes no model call or scroll', async () => {
  const f = harness({ buildCorpus: separateParagraphs }); await f.search();
  const before = f.calls.paints.at(-1), focusCount = f.calls.focuses.length, clears = f.calls.clears;
  f.retired.add('old-b');
  assert.equal(typeof f.controller.refreshSourceHits, 'function');
  assert.equal(f.controller.refreshSourceHits(), true);
  const after = f.calls.paints.at(-1);
  assert.deepEqual(after.hits.map(h => h.paragraphId), ['old-a', 'old-c']);
  assert.equal(after.currentId, before.currentId); assert.equal(f.calls.focuses.length, focusCount);
  assert.equal(f.requests().length, 1); assert.equal(f.calls.clears, clears);
  assert.match(f.role('position').textContent, /1 \/ 2/); assert.match(f.role('status').textContent, /找到 2 条/);
  assert.match(f.role('progress').textContent, /累计已处理 3 \/ 3/);
  assert.equal(await f.controller.confirm(before.hits.find(h => h.paragraphId === 'old-b').id, {}), false);
  assert.equal(f.calls.confirms.length, 0);
  f.role('threshold-number').value = '.1'; f.role('threshold-number').dispatch('change');
  assert.deepEqual(f.calls.paints.at(-1).hits.map(h => h.paragraphId), ['old-a', 'old-c']);
});

test('rewriting the selected paragraph retires old coordinates and admits only new-ID text without jumping', async () => {
  const f = harness({ buildCorpus: separateParagraphs }); await f.search();
  const focusCount = f.calls.focuses.length;
  f.retired.add('old-a'); f.controller.refreshSourceHits();
  assert.equal(f.calls.paints.at(-1).hits[0].paragraphId, 'old-b');
  const selected = f.calls.paints.at(-1).currentId;
  f.additions.push(source('replacement-a', 'Rewritten Alpha uses a different exact sentence.'));
  f.controller.queueAdditionalSearch(); await f.clock.advance();
  const after = f.calls.paints.at(-1);
  assert.deepEqual(after.hits.map(h => h.paragraphId), ['old-b', 'old-c', 'replacement-a']);
  assert.equal(after.currentId, selected); assert.equal(f.calls.focuses.length, focusCount);
  assert.equal(f.requests().length, 2); assert.deepEqual(f.requests()[1].paragraphs.map(p => p.paragraphId), ['replacement-a']);
  assert.match(f.role('progress').textContent, /累计已处理 4 \/ 4/);
  assert.equal(f.controller.isOpen(), true);
});

test('retired initial-source scores still validate transport accounting but never paint or focus old text', async () => {
  const pending = deferred();
  const f = harness({ buildCorpus: separateParagraphs, score: m => m.paragraphs[0].paragraphId === 'old-a' ? pending.promise : response(m) });
  await f.search(); const request = f.requests()[0];
  f.retired.add('old-a'); f.controller.refreshSourceHits();
  f.additions.push(source('replacement-a', 'New exact Alpha text.')); f.controller.queueAdditionalSearch();
  assert.equal(f.progress(request, { processed: 2, total: 3, skipped: 0, scores: [{ id: 'semantic_sentence_0', score: .99 }, { id: 'semantic_sentence_1', score: .85 }] }), true);
  assert.deepEqual(f.calls.paints.at(-1).hits.map(h => h.paragraphId), ['old-b']);
  assert.ok(!f.calls.focuses.includes('semantic_sentence_0'));
  pending.resolve(response(request, i => i === 0 ? .99 : .85)); await tick(); await f.clock.advance();
  assert.deepEqual(f.calls.paints.at(-1).hits.map(h => h.paragraphId), ['old-b', 'old-c', 'replacement-a']);
  assert.match(f.role('progress').textContent, /累计已处理 4 \/ 4/); assert.doesNotMatch(f.role('status').textContent, /不一致|失败/);
});

test('a delta paragraph retired mid-stream cannot reappear on late progress/response; later replacement can score', async () => {
  const pending = deferred();
  const f = harness({ score: m => m.paragraphs[0].paragraphId === 'changing-delta' ? pending.promise : response(m) });
  await f.search(); f.additions.push(source('changing-delta')); f.controller.queueAdditionalSearch(); await f.clock.advance();
  const request = f.requests()[1];
  assert.equal(f.progress(request, { processed: 1, total: 2, skipped: 0, scores: [{ id: 'semantic_sentence_0', score: .85 }] }), true);
  assert.equal(f.calls.paints.at(-1).hits.length, 3);
  f.retired.add('changing-delta'); f.controller.refreshSourceHits(); assert.equal(f.calls.paints.at(-1).hits.length, 2);
  f.additions.push(source('replacement-delta')); f.controller.queueAdditionalSearch();
  pending.resolve(response(request)); await tick(); await f.clock.advance();
  assert.equal(f.requests().length, 3);
  assert.ok(f.calls.paints.at(-1).hits.every(h => h.paragraphId !== 'changing-delta'));
  assert.equal(f.calls.paints.at(-1).hits.length, 4); assert.match(f.role('progress').textContent, /累计已处理 6 \/ 6/);
});

test('retired, throwing and unsupported hit predicates fail safely without corrupting unrelated controller state', async () => {
  const f = harness({ isHitCurrent: () => { throw Error('missing source'); } }); await f.search();
  assert.equal(f.calls.paints.at(-1).hits.length, 0); assert.equal(f.calls.focuses.length, 0);
  assert.equal(await f.controller.confirm('semantic_sentence_0', {}), false);
  const compatible = harness({ noHitCurrent: true }); await compatible.search();
  assert.equal(compatible.calls.paints.at(-1).hits.length, 2);
  compatible.controller.close(); const before = compatible.calls.paints.length;
  assert.equal(compatible.controller.refreshSourceHits(), false); assert.equal(compatible.calls.paints.length, before);
});

test('confirmation completion is rejected when the specific paragraph retires across its await', async () => {
  const pending = deferred(); const f = harness({ buildCorpus: separateParagraphs, confirm: () => pending.promise });
  await f.search(); const result = f.controller.confirm('semantic_sentence_0', {});
  f.retired.add('old-a'); f.controller.refreshSourceHits(); pending.resolve(true);
  assert.equal(await result, false); assert.equal(f.calls.paints.at(-1).hits.length, 2);
});

test('a retired-paragraph confirmation rejection cannot overwrite the refreshed current-result status', async () => {
  const pending = deferred(); const f = harness({ buildCorpus: separateParagraphs, confirm: () => pending.promise });
  await f.search(); const result = f.controller.confirm('semantic_sentence_0', {});
  f.retired.add('old-a'); f.controller.refreshSourceHits(); const status = f.role('status').textContent;
  pending.reject(Error('stale paragraph confirmation failure'));
  assert.equal(await result, false); assert.equal(f.role('status').textContent, status);
});

test('source-wide navigation invalidation clears the readout instead of restoring an old hit count', async () => {
  const f = harness(); await f.search(); const clears = f.calls.clears;
  f.setCurrent(false); f.role('next').dispatch('click');
  assert.equal(f.role('position').textContent, '0 / 0');
  assert.equal(f.role('next').disabled, true); assert.equal(f.role('previous').disabled, true);
  assert.equal(f.requests().length, 1); assert.ok(f.calls.clears > clears);
  assert.match(f.role('status').textContent, /文档已变化/);
});
