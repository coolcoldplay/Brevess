const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const engine = require('../core/semantic-find.js');
const { normalizeTextWithOffsets } = require('../core/article-extractor.js');
const { createSemanticFindDomSnapshot } = require('../core/semantic-find-dom.js');
const { domFixture } = require('./helpers/semantic-find-dom-fixture.js');

function fixture(initial = ['Original source.']) {
  const dom = domFixture();
  dom.document.querySelectorAll = () => [];
  dom.document.getSelection = () => ({ rangeCount: 0 });
  let adapter; let queued = 0; let invalidated = 0;
  const sandbox = {
    SciLLM: { ...engine, normalizeTextWithOffsets, createSemanticFindDomSnapshot,
      createSemanticFindController: options => {
        adapter = options.adapter;
        return { close() {}, confirm() {}, invalidate() { invalidated++; }, queueAdditionalSearch() { queued++; } };
      } },
    chrome: { runtime: { sendMessage: async () => ({ success: true, data: {} }) }, storage: { onChanged: { addListener() {} } } },
    crypto: webcrypto, TextEncoder, document: dom.document, window: { addEventListener() {} },
    CSS: { highlights: new Map() }, Highlight: class {},
    currentNativePdfSemanticHighlightState: () => null, activeNativePdfStructure: () => null,
    contentNavigationIdentity: () => 'https://example.org/dynamic', contentDocumentIdentity: 'doc1',
    articleWorkspaceLifecycleGeneration: 1, currentManualSelection: null
  };
  const add = text => {
    const p = dom.element('p', {}, [dom.text(text)]); dom.append(p);
    dom.records.push({ type: 'childList', target: dom.document.body, addedNodes: [p], removedNodes: [] });
    return p;
  };
  initial.forEach(add); dom.records.splice(0);
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../semantic-find-content.js'), 'utf8'), sandbox);
  return { ...dom, sandbox, adapter, add, get queued() { return queued; }, get invalidated() { return invalidated; } };
}

async function settleVisibility(corpus) {
  corpus.dom.isCurrent();
  const started = Date.now();
  while (corpus.dom.pendingVisibilityScan) {
    assert.ok(Date.now() - started < 10000, 'deferred corpus discovery must finish');
    await new Promise(resolve => setTimeout(resolve, 0));
  }
}

test('each added batch has new stable paragraph bindings and only its own source hash/sentences', async () => {
  const f = fixture(); const corpus = await f.adapter.buildCorpus(); const before = JSON.stringify(corpus.paragraphs);
  const second = f.add('Identical added source.');
  const delta1 = await f.adapter.collectAdditionalCorpus(corpus);
  assert.equal(delta1.paragraphs.length, 1); assert.equal(delta1.paragraphs[0].text, 'Identical added source.');
  assert.notEqual(delta1.sourceKey, corpus.sourceKey); assert.equal(f.queued, 1);
  assert.equal(corpus.dom.range(delta1.sentences[0]).startContainer, second.firstChild || second.childNodes[0]);
  assert.equal(await f.adapter.collectAdditionalCorpus(corpus), null, 'drain is idempotent');
  const third = f.add('Identical added source.');
  const delta2 = await f.adapter.collectAdditionalCorpus(corpus);
  assert.notEqual(delta2.paragraphs[0].paragraphId, delta1.paragraphs[0].paragraphId);
  assert.notEqual(delta2.sourceKey, delta1.sourceKey); assert.equal(f.queued, 2);
  assert.equal(delta1.sentences[0].id, delta2.sentences[0].id, 'controller owns operation-local id remapping');
  assert.equal(corpus.dom.range(delta2.sentences[0]).startContainer, third.childNodes[0]);
  assert.equal(JSON.stringify(corpus.dom.paragraphs), before, 'initial DOM input remains immutable');
  assert.equal(corpus.paragraphs.length, 3, 'confirmed incremental paragraphs remain available for save/lookup');
  assert.equal(f.adapter.isCurrent(corpus), true); assert.equal(f.invalidated, 0);
});

test('concurrent drains and additions during digest do not duplicate or drop an admitted batch', async () => {
  const f = fixture(); const corpus = await f.adapter.buildCorpus(); f.add('First delta.');
  let release; let started;
  const begun = new Promise(resolve => { started = resolve; });
  f.sandbox.crypto = { ...webcrypto, subtle: { digest: async (...args) => {
    started(); await new Promise(resolve => { release = resolve; }); return webcrypto.subtle.digest(...args);
  } } };
  const first = f.adapter.collectAdditionalCorpus(corpus); await begun;
  f.add('Second delta.'); const second = f.adapter.collectAdditionalCorpus(corpus);
  f.sandbox.crypto = webcrypto; release();
  const values = await Promise.all([first, second]);
  assert.deepEqual(values.map(value => value.paragraphs[0].text), ['First delta.', 'Second delta.']);
  assert.equal(await f.adapter.collectAdditionalCorpus(corpus), null);
});

test('source mutation during digest retires only its hit while close rejects the entire late batch', async () => {
  for (const action of ['edit', 'close']) {
    const f = fixture(); const corpus = await f.adapter.buildCorpus(); const added = f.add('New source.');
    let release; let started; const begun = new Promise(resolve => { started = resolve; });
    f.sandbox.crypto = { subtle: { digest: async (...args) => {
      started(); await new Promise(resolve => { release = resolve; }); return webcrypto.subtle.digest(...args);
    } } };
    const pending = f.adapter.collectAdditionalCorpus(corpus); await begun;
    if (action === 'edit') {
      added.childNodes[0].nodeValue = 'Changed source.';
      f.records.push({ type: 'characterData', target: added.childNodes[0] });
    } else f.adapter.clear();
    f.sandbox.crypto = webcrypto; release();
    if (action === 'close') await assert.rejects(pending, { code: 'SEMANTIC_FIND_SOURCE_STALE' });
    else {
      const obsolete = await pending;
      assert.equal(f.adapter.isCurrent(corpus), true);
      assert.equal(f.adapter.isHitCurrent(corpus, obsolete.sentences[0]), false);
      assert.deepEqual(corpus.dom.ranges(obsolete.sentences[0]), []);
      assert.equal(f.adapter.isHitCurrent(corpus, corpus.sentences[0]), true);
      const replacement = await f.adapter.collectAdditionalCorpus(corpus);
      assert.equal(replacement.paragraphs[0].text, 'Changed source.');
      assert.notEqual(replacement.paragraphs[0].paragraphId, obsolete.paragraphs[0].paragraphId);
      assert.equal(f.adapter.isHitCurrent(corpus, replacement.sentences[0]), true);
    }
  }
});

test('additions during initial digest remain queued for the first supplemental drain', async () => {
  const f = fixture(); let release; let started; const begun = new Promise(resolve => { started = resolve; });
  f.sandbox.crypto = { subtle: { digest: async (...args) => {
    started(); await new Promise(resolve => { release = resolve; }); return webcrypto.subtle.digest(...args);
  } } };
  const initial = f.adapter.buildCorpus(); await begun; f.add('Arrived during initial digest.');
  f.sandbox.crypto = webcrypto; release(); const corpus = await initial;
  const delta = await f.adapter.collectAdditionalCorpus(corpus);
  assert.equal(delta.paragraphs[0].text, 'Arrived during initial digest.');
});

test('cumulative paragraph, UTF-8 byte and sentence limits reject delta without clearing original corpus', async () => {
  for (const [initial, addition] of [
    [Array(5000).fill('Source.'), 'One extra.'],
    [['测'.repeat(700000)], '测'.repeat(700000)],
    [['Sentence. '.repeat(10000)], 'One extra.']
  ]) {
    const f = fixture(initial); const corpus = await f.adapter.buildCorpus(); f.add(addition);
    await settleVisibility(corpus);
    await assert.rejects(f.adapter.collectAdditionalCorpus(corpus), { code: 'SEMANTIC_FIND_LIMIT_EXCEEDED' });
    assert.equal(f.adapter.isCurrent(corpus), true); assert.equal(f.invalidated, 0);
    assert.equal(corpus.dom.bindings.size, initial.length);
  }
});

test('initial corpus uses the same paragraph, byte, per-paragraph and sentence admission limits', async () => {
  for (const initial of [Array(5001).fill('Source.'), ['测'.repeat(700000), '测'.repeat(700000)],
    ['x'.repeat(1000001)], ['Sentence. '.repeat(10001)]]) {
    const f = fixture(initial);
    await assert.rejects(f.adapter.buildCorpus(), { code: 'SEMANTIC_FIND_LIMIT_EXCEEDED' });
    assert.equal(f.queued, 0);
  }
});

test('a stopped limit never silently admits later content or grows queued bindings', async () => {
  const f = fixture(['Sentence. '.repeat(10000)]); const corpus = await f.adapter.buildCorpus();
  f.add('Over limit.');
  await settleVisibility(corpus);
  await assert.rejects(f.adapter.collectAdditionalCorpus(corpus), { code: 'SEMANTIC_FIND_LIMIT_EXCEEDED' });
  const queued = f.queued;
  for (let index = 0; index < 3; index++) {
    f.add(`Still stopped ${index}.`);
    await settleVisibility(corpus);
    await assert.rejects(f.adapter.collectAdditionalCorpus(corpus), { code: 'SEMANTIC_FIND_LIMIT_EXCEEDED' });
  }
  assert.equal(f.queued, queued); assert.equal(corpus.dom.bindings.size, 1);
  assert.equal(f.adapter.isCurrent(corpus), true);
});

test('retirement does not release cumulative admission budget or revive old source IDs', async () => {
  const f = fixture(Array(5000).fill('Source.')); const corpus = await f.adapter.buildCorpus();
  const old = corpus.sentences[0]; const stable = corpus.sentences[1];
  const node = f.document.body.childNodes[0].childNodes[0]; node.nodeValue = 'Changed counter.';
  f.records.push({ type: 'characterData', target: node });
  await assert.rejects(f.adapter.collectAdditionalCorpus(corpus), { code: 'SEMANTIC_FIND_LIMIT_EXCEEDED' });
  assert.equal(f.adapter.isCurrent(corpus), true); assert.equal(f.adapter.isHitCurrent(corpus, old), false);
  assert.equal(f.adapter.isHitCurrent(corpus, stable), true); assert.equal(corpus.dom.bindings.size, 4999);
});

function manualArticle(f) {
  f.document.createElement = tag => f.element(tag);
  f.document.head.appendChild = node => { node.parentElement = node.parentNode = f.document.head; f.document.head.childNodes.push(node); };
  f.document.getSelection = () => ({ removeAllRanges() {}, addRange() {} });
  const originalRange = f.document.createRange;
  f.document.createRange = () => Object.assign(originalRange(), {
    toString() { return this.startContainer.nodeValue.slice(this.startOffset, this.endOffset); }
  });
  const paragraphs = f.document.body.childNodes.map((p, index) => {
    p.dataset.sciLlmParagraphId = `canonical${index}`;
    const closest = p.closest;
    p.closest = selector => selector === '[data-sci-llm-paragraph-id]' ? p : closest.call(p, selector);
    return { paragraphId: p.dataset.sciLlmParagraphId, text: p.childNodes[0].nodeValue, recordType: 'body' };
  });
  Object.assign(f.sandbox, {
    currentManualDocument: { documentId: 'article1' }, currentArticleStructure: { paragraphs },
    manualReadableText: element => element.childNodes.map(node => node.nodeValue || '').join(''),
    prepareManualDocument: async () => {}, describeCurrentManualSelection: () => ({ validation: { valid: true }, anchor: {} }),
    showManualSelectionToolbar: descriptor => { f.sandbox.currentManualSelection = descriptor; },
    releaseSelectionAfterManualAction: () => { f.sandbox.currentManualSelection = null; }
  });
}

test('manual toolbar permission stays bound to its exact hit after retirement and another confirmation', async () => {
  const f = fixture(['Canonical first source.', 'Canonical second source.']); manualArticle(f);
  const corpus = await f.adapter.buildCorpus(); f.adapter.paint(corpus, [], '');
  await f.adapter.confirm(corpus, corpus.sentences[0]);
  const firstKey = f.sandbox.currentManualSelection.semanticFindSourceKey;
  assert.equal(f.sandbox.__brevessSemanticFind.isCurrentSource(firstKey), true);
  const node = f.document.body.childNodes[0].childNodes[0]; node.nodeValue = 'Changed first source.';
  f.records.push({ type: 'characterData', target: node });
  assert.equal(f.adapter.isCurrent(corpus), true);
  assert.equal(f.sandbox.__brevessSemanticFind.isCurrentSource(firstKey), false, 'retired source cannot be saved from an already open toolbar');
  await f.adapter.confirm(corpus, corpus.sentences[1]);
  const secondKey = f.sandbox.currentManualSelection.semanticFindSourceKey;
  assert.notEqual(firstKey, secondKey, 'a new toolbar must not revive an earlier descriptor');
  assert.equal(f.sandbox.__brevessSemanticFind.isCurrentSource(firstKey), false);
  assert.equal(f.sandbox.__brevessSemanticFind.isCurrentSource(secondKey), true);
});

test('manual preparation crossing an await cannot show a toolbar for a retired hit', async () => {
  const f = fixture(['Canonical first source.', 'Canonical second source.']); manualArticle(f);
  const corpus = await f.adapter.buildCorpus(); let release;
  f.sandbox.prepareManualDocument = () => new Promise(resolve => { release = resolve; });
  const pending = f.adapter.confirm(corpus, corpus.sentences[0]);
  const node = f.document.body.childNodes[0].childNodes[0]; node.nodeValue = 'Changed during preparation.';
  f.records.push({ type: 'characterData', target: node }); release();
  await assert.rejects(pending, /变化|不存在/);
  assert.equal(f.sandbox.currentManualSelection, null);
  assert.equal(f.adapter.isHitCurrent(corpus, corpus.sentences[1]), true);
});
