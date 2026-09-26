const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const engine = require('../core/semantic-find.js');

function fixture() {
  const context = { documentId: 'pdf-doc', documentHash: 'a'.repeat(64),
    documentGeneration: 1, revision: 3, semanticCacheKey: 'cache', semanticProvenanceKey: 'source' };
  const targets = [
    { ...context, kind: 'paragraph', paragraphId: 'p1', normalizedStart: 0,
      normalizedEnd: 16, expectedNormalizedQuote: 'To test, we ran.' },
    { ...context, kind: 'paragraph', paragraphId: 'p2', normalizedStart: 100,
      normalizedEnd: 128, expectedNormalizedQuote: 'Another page. To test again.' }
  ];
  context.navigation = { sections: [{ paragraphTargets: targets }] };
  let controllerOptions;
  const marks = new Map([['existing-manual', {}], ['sci-article-citation-focus', {}]]);
  const calls = [];
  const elements = [];
  const native = { diagnostics: { textCoverage: { terminal: true } } };
  const document = {
    body: {}, head: { appendChild() {} }, addEventListener() {},
    querySelectorAll: () => elements,
    getSelection: () => ({ removeAllRanges() {}, addRange() {} })
  };
  const sandbox = {
    SciLLM: { ...engine, createSemanticFindController: options => {
      controllerOptions = options;
      return { invalidate() {}, close() {}, confirm() {} };
    } },
    chrome: { runtime: { sendMessage: async () => ({ success: true, data: {} }) },
      storage: { onChanged: { addListener() {} } } },
    crypto: webcrypto, TextEncoder, document,
    window: { addEventListener() {} }, CSS: { highlights: marks },
    currentNativePdfSemanticHighlightState: () => ({ ready: true, context }),
    activeNativePdfStructure: () => native,
    pdfSemanticParagraphTargets: navigation => navigation.sections[0].paragraphTargets,
    currentManualSelection: null,
    createPdfSemanticHighlightLocator: (target, selection) => ({ ...target, ...selection }),
    paintPdfSemanticHighlightPage: (entry, page, options) => calls.push({ entry, page, options }),
    __brevessPdfReaderBridge: { command: (command, ...args) => calls.push({ command, args }) }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../semantic-find-content.js'), 'utf8'), sandbox);
  return { adapter: controllerOptions.adapter, sandbox, context, targets, marks, calls, elements, native };
}

test('PDF search corpus includes unmounted pages and invalidates the exact source generation', async () => {
  const f = fixture();
  const corpus = await f.adapter.buildCorpus();
  assert.deepEqual(Array.from(corpus.paragraphs, paragraph => paragraph.paragraphId), ['p1', 'p2']);
  assert.equal(corpus.sentences.length, 3);
  assert.match(corpus.sourceKey, /^[a-f0-9]{64}$/);
  assert.equal(f.adapter.isCurrent(corpus), true);
  f.context.documentGeneration++;
  assert.equal(f.adapter.isCurrent(corpus), false);
});

test('PDF painting converts sentence-relative offsets to the exact semantic paragraph span', async () => {
  const f = fixture();
  const corpus = await f.adapter.buildCorpus();
  const sentence = corpus.sentences.find(item => item.text === 'To test again.');
  f.elements.push({ dataset: { pdfPageNumber: '9' }, remove() {} });
  f.adapter.paint(corpus, [{ ...sentence, score: 0.91 }], sentence.id);
  assert.equal(f.calls.length, 1);
  const call = f.calls[0];
  assert.equal(call.page, 9);
  assert.equal(call.options.layerClass, 'pdf-native-semantic-search-layer');
  assert.equal(call.entry.items[0].locator.normalizedStart, 100 + sentence.start);
  assert.equal(call.entry.items[0].locator.expectedNormalizedQuote, sentence.text);
  assert.equal(call.entry.items[0].score, 0.91);
});

test('unreadable PDF pages stay partial even when all available sentences are scored', async () => {
  const f = fixture();
  f.native.diagnostics.textCoverage.emptyPages = 1;
  const corpus = await f.adapter.buildCorpus();
  assert.equal(corpus.coverage, 'partial');
  assert.match(corpus.coverageMessage, /未识别/);
});

test('Escape cleanup deletes only search highlights, preserving original annotation layers', () => {
  const f = fixture();
  f.marks.set('sci-semantic-search-95', {});
  f.adapter.clear();
  assert.equal(f.marks.has('sci-semantic-search-95'), false);
  assert.equal(f.marks.has('existing-manual'), true);
  assert.equal(f.marks.has('sci-article-citation-focus'), true);
});

test('PDF search confirmation uses existing grouped manual anchors after verifying raw quotes', async () => {
  const f = fixture();
  const corpus = await f.adapter.buildCorpus();
  const hit = corpus.sentences[0];
  const raw = [{ pageNumber: 1, start: 0, end: 3, quote: 'One' },
    { pageNumber: 2, start: 0, end: 3, quote: 'Two' }];
  let prepared = 0;
  let described = 0;
  let toolbar = null;
  f.sandbox.prepareManualDocument = async () => { prepared++; };
  f.sandbox.resolvePdfSemanticHighlightLocator = () => ({ status: 'resolved', ranges: raw });
  f.sandbox.__brevessPdfReaderBridge.command = (_command, page) => ({
    documentHash: f.context.documentHash, documentGeneration: 1,
    textLayer: { isConnected: true, text: page === 1 ? 'One' : 'Two' }
  });
  f.sandbox.SciLLM.readPdfTextProjection = layer => layer;
  f.sandbox.SciLLM.pdfProjectionRange = () => ({});
  f.sandbox.describeCurrentManualSelection = () => {
    const page = ++described;
    const anchor = { quote: page === 1 ? 'One' : 'Two', pdfAnchor: { pageNumber: page } };
    return { validation: { valid: true }, anchor,
      anchorSegments: [{ blockId: `pdf-page-${page}`, anchor }] };
  };
  f.sandbox.showManualSelectionToolbar = descriptor => { toolbar = descriptor; };
  await f.adapter.confirm(corpus, hit, { left: 1, right: 2, top: 3, bottom: 4 });
  assert.equal(prepared, 1);
  assert.equal(toolbar.anchorSegments.length, 2);
  assert.equal(toolbar.semanticFindSourceKey, corpus.sourceKey);
  f.sandbox.SciLLM.readPdfTextProjection = () => ({ text: 'wrong' });
  await assert.rejects(f.adapter.confirm(corpus, hit), /原文坐标不匹配/);
  assert.equal(described, 2, 'invalid raw text must never reach the manual save descriptor');
});

test('owned search focus cancellation cannot cancel a different navigation owner', () => {
  const source = fs.readFileSync(path.join(__dirname, '../pdf-native-reader.mjs'), 'utf8');
  const start = source.indexOf('function cancelOwnedSemanticFocus(');
  const end = source.indexOf('async function focusPdfSemanticTarget(', start);
  const events = [];
  const sandbox = { nativeSemanticFocusOwnerToken: 'search-owner',
    nativeSemanticFocusActivity: { cancel: () => events.push('activity') },
    nativeSemanticFocusController: { invalidate: () => events.push('invalidate') },
    beginNativePdfNavigation: () => events.push('navigation') };
  vm.runInNewContext(source.slice(start, end), sandbox);
  assert.equal(sandbox.cancelOwnedSemanticFocus('other'), false);
  assert.deepEqual(events, []);
  assert.equal(sandbox.cancelOwnedSemanticFocus('search-owner'), true);
  assert.deepEqual(events, ['activity', 'invalidate', 'navigation']);
  assert.equal(sandbox.cancelOwnedSemanticFocus('search-owner'), false);
});

test('Escape during manual preparation retires the click lease before any selection or toolbar', async () => {
  const f = fixture();
  const corpus = await f.adapter.buildCorpus();
  let resolvePrepare;
  f.sandbox.prepareManualDocument = () => new Promise(resolve => { resolvePrepare = resolve; });
  f.sandbox.resolvePdfSemanticHighlightLocator = () => assert.fail('cancelled click must not resolve anchors');
  f.sandbox.showManualSelectionToolbar = () => assert.fail('cancelled click must not reopen toolbar');
  const pending = f.adapter.confirm(corpus, corpus.sentences[0]);
  f.adapter.clear();
  resolvePrepare();
  await assert.rejects(pending, /文档已变化/);
  assert.equal(f.adapter.isCurrent(corpus), false);
});

test('HTML semantic corpus excludes plugin note markers while keeping annotated source words', async () => {
  const f = fixture();
  const dom = require('./helpers/semantic-find-dom-fixture.js').domFixture();
  dom.append(dom.element('p', {}, [dom.text('To test the hypothesis, '),
    dom.element('sup', { note: true }, [dom.text('备注')]), dom.text('we used MERFISH.')]));
  Object.assign(f.sandbox, {
    document: dom.document,
    activeNativePdfStructure:()=>null, contentNavigationIdentity:()=> 'https://example.org/paper',
    contentDocumentIdentity:'html-doc', articleStructureChangeSequence:1, articleWorkspaceLifecycleGeneration:1,
    Highlight:class {}, extractArticleWithTrace:()=>assert.fail('general search must not run article extraction')
  });
  f.sandbox.SciLLM.normalizeTextWithOffsets = require('../core/article-extractor.js').normalizeTextWithOffsets;
  f.sandbox.SciLLM.createSemanticFindDomSnapshot = require('../core/semantic-find-dom.js').createSemanticFindDomSnapshot;
  const corpus = await f.adapter.buildCorpus();
  assert.equal(corpus.paragraphs[0].text, 'To test the hypothesis, we used MERFISH.');
});

test('cold canonical article save retains DOI metadata aliases without admitting unrelated identifiers', async () => {
  for (const [name, content, allowed] of [
    ['citation_doi', '10.0000/valid-paper', true],
    ['dc.identifier', 'https://doi.org/10.0000/valid-paper', true],
    ['DC.Identifier', 'doi:10.0000/valid-paper', true],
    ['citation_pmid', '12345678', true],
    ['dc.identifier', 'ordinary-page-id', false],
    ['dc.identifier', 'https://example.org/ordinary', false]
  ]) {
    const f = fixture(); const dom = require('./helpers/semantic-find-dom-fixture.js').domFixture();
    const text = 'A canonical paper result.'; const node = dom.text(text);
    const p = dom.element('p', {}, [node]); dom.append(p); p.dataset.sciLlmParagraphId = 'canon1';
    p.closest = selector => selector === '[data-sci-llm-paragraph-id]' ? p : null;
    const createRange = dom.document.createRange;
    dom.document.createRange = () => Object.assign(createRange(), {
      toString() { return text.slice(this.startOffset, this.endOffset); }
    });
    dom.document.querySelectorAll = selector => selector.includes(`meta[name="${name}"]`) ? [{ name, content }] : [];
    dom.document.getSelection = () => ({ removeAllRanges() {}, addRange() {} });
    let prepared = 0; let shown = 0;
    Object.assign(f.sandbox, {
      document: dom.document, activeNativePdfStructure: () => null,
      contentNavigationIdentity: () => 'https://example.org/paper', contentDocumentIdentity: 'html-doc',
      articleWorkspaceLifecycleGeneration: 1, Highlight: class {}, currentManualDocument: null,
      currentArticleStructure: { paragraphs: [{ paragraphId: 'canon1', text, recordType: 'body' }] },
      manualReadableText: () => text,
      extractArticleWithTrace: () => assert.fail('already verified canonical range needs no extraction'),
      prepareManualDocument: async () => { prepared++; f.sandbox.currentManualDocument = { documentId: 'doc1' }; },
      describeCurrentManualSelection: () => ({ validation: { valid: true }, anchor: {} }),
      showManualSelectionToolbar: () => shown++
    });
    Object.assign(f.sandbox.SciLLM, {
      normalizeTextWithOffsets: require('../core/article-extractor.js').normalizeTextWithOffsets,
      normalizeWorkspaceDoi: require('../core/article-workspace.js').normalizeWorkspaceDoi,
      createSemanticFindDomSnapshot: require('../core/semantic-find-dom.js').createSemanticFindDomSnapshot
    });
    const corpus = await f.adapter.buildCorpus();
    if (allowed) await f.adapter.confirm(corpus, corpus.sentences[0]);
    else await assert.rejects(f.adapter.confirm(corpus, corpus.sentences[0]), /可验证的论文保存位置/);
    assert.equal(prepared, Number(allowed), name); assert.equal(shown, Number(allowed), name);
  }
});
