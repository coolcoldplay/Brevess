const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../content.js'), 'utf8');
function api() {
  const start = source.indexOf('function buildNativePdfHighlightOccurrences(');
  const end = source.indexOf('function collectPageHighlightOccurrences(', start);
  assert.ok(start > 0 && end > start, 'native PDF logical occurrence bridge must exist');
  const hashStart = source.indexOf('function hashArticleChatParagraphText(');
  const hashEnd = source.indexOf('function isPdfSemanticHighlightLocator(', hashStart);
  return new Function(`${source.slice(hashStart, hashEnd)}\n${source.slice(start, end)}\n` +
    'return { buildNativePdfHighlightOccurrences };')();
}
function fixture() {
  const identity = { documentId: 'sha256:' + 'a'.repeat(64), documentHash: 'a'.repeat(64),
    documentGeneration: 3, revision: 5, semanticCacheKey: 'cache', semanticProvenanceKey: 'provenance' };
  const quote = 'We tested microglia. We tested neurons.';
  const target = { kind: 'paragraph', ...identity, paragraphId: 'pdf-paragraph:one',
    normalizedStart: 100, normalizedEnd: 100 + quote.length,
    expectedNormalizedQuote: quote, pageNumber: 8, pageNumbers: [8, 9] };
  const locator = { locatorKind: 'pdf-semantic', ...identity, paragraphId: target.paragraphId,
    normalizedStart: 110, normalizedEnd: 119, expectedNormalizedQuote: 'microglia' };
  const item = { category: 'method', name: 'Methods', color: '#12AB34', quote: 'microglia', locator, pageNumbers: [8, 9] };
  const entry = { ...identity, modeId: 'quick', semantic: true, items: [item] };
  return { identity, target, locator, item, entry,
    input: { structure: { adapterId: 'pdf-native', ...identity, nodes: [], paragraphs: [] },
      documentGeneration: identity.documentGeneration,
      navigation: { ...identity, sections: [{ sectionId: 'pdf-section:methods', title: 'Methods',
        level: 1, paragraphTargets: [target], children: [] }] },
      regexModes: new Map([['quick', entry]]), llmModes: new Map(), chatModes: new Map(), manualAnnotations: [] } };
}
test('PDF excerpts count logical hits including unmounted and multiline pages, with text and categories', () => {
  const f = fixture();
  const result = api().buildNativePdfHighlightOccurrences(f.input);
  assert.equal(result.occurrences.length, 1);
  assert.equal(result.occurrences[0].quote, 'microglia');
  assert.equal(result.occurrences[0].sectionId, 'pdf-section:methods');
  assert.equal(result.occurrences[0].color, '#12AB34');
  assert.equal(result.occurrences[0].source, 'regex');
  assert.deepEqual(result.occurrences[0].pageNumbers, [8, 9]);
  assert.equal(result.structure.nodes[0].title, 'Methods');
  assert.equal(api().buildNativePdfHighlightOccurrences(f.input).occurrences[0].highlightId,
    result.occurrences[0].highlightId);
});
test('regex modes deduplicate same source/category/location; LLM and saved manual remain separate', () => {
  const f = fixture();
  f.input.regexModes.set('another', { ...f.entry, modeId: 'another' });
  f.input.llmModes.set('llm', { ...f.identity, analysisMeta: { readingViewId: 'llm' }, categoryMap: {},
    items: [{ ...f.item, categories: [{ categoryId: 'method', categoryName: 'LLM Methods', color: '#456789' }] }] });
  f.input.chatModes.set('turn', { ...f.identity, turnId: 'turn',
    items: [{ ...f.item, categoryId: 'semantic_match', categoryName: 'Semantic', color: '#ABABAB' }] });
  f.input.manualAnnotations.push({ annotationId: 'saved-one', quote: 'microglia', categoryId: 'method',
    categorySnapshot: { name: 'Saved method', color: '#111111' }, note: 'note', startOffset: 1, endOffset: 10,
    pdfAnchor: { documentHash: f.identity.documentHash, pageNumber: 8, quote: 'microglia', quadPoints: [1,2,3,2,1,4,3,4] } });
  const { occurrences } = api().buildNativePdfHighlightOccurrences(f.input);
  assert.equal(occurrences.length, 4);
  assert.deepEqual(occurrences.map(item => item.source), ['regex', 'llm', 'semantic', 'manual']);
  assert.equal(occurrences.find(item => item.source === 'manual').note, 'note');
  assert.equal(new Set(occurrences.map(item => item.highlightId)).size, 4);
});
test('old document, old generation, old semantic revision and invalid quote never enter excerpts', () => {
  for (const mutate of [
    f => { f.entry.documentHash = 'b'.repeat(64); },
    f => { f.entry.documentGeneration = 2; },
    f => { f.locator.revision = 4; },
    f => { f.locator.expectedNormalizedQuote = 'bad quote'; }
  ]) {
    const f = fixture(); mutate(f);
    assert.equal(api().buildNativePdfHighlightOccurrences(f.input).occurrences.length, 0);
  }
});
test('clearing records empties excerpts and loading another document changes IDs', () => {
  const f = fixture(), original = api().buildNativePdfHighlightOccurrences(f.input).occurrences[0].highlightId;
  f.input.documentGeneration = 4; f.entry.documentGeneration = 4;
  f.input.navigation.documentGeneration = 4; f.target.documentGeneration = 4; f.locator.documentGeneration = 4;
  assert.notEqual(api().buildNativePdfHighlightOccurrences(f.input).occurrences[0].highlightId, original);
  f.input.regexModes.clear();
  assert.equal(api().buildNativePdfHighlightOccurrences(f.input).occurrences.length, 0);
});
test('a saved cross-page selection remains one full excerpt with every page and annotation', () => {
  const f = fixture(); f.input.regexModes.clear();
  f.input.manualAnnotations = [8, 9].map((pageNumber, index) => ({
    annotationId: `manual-${index}`, selectionGroupId: 'one-selection', selectionGroupIndex: index,
    quote: index ? 'continued on next page.' : 'This sentence is', categoryId: 'method',
    categorySnapshot: { name: 'Methods', color: '#123456' },
    pdfAnchor: { documentHash: f.identity.documentHash, pageNumber },
    startOffset: 0, endOffset: 10
  }));
  f.input.manualAnnotations.push({ ...f.input.manualAnnotations[0], annotationId: 'deleted', deleted: true });
  const result = api().buildNativePdfHighlightOccurrences(f.input).occurrences;
  assert.equal(result.length, 1);
  assert.equal(result[0].quote, 'This sentence is\ncontinued on next page.');
  assert.deepEqual(result[0].pageNumbers, [8, 9]);
  assert.deepEqual(result[0].annotationIds, ['manual-0', 'manual-1']);
  assert.equal(result[0].focusQuote, 'This sentence is');
});
test('PDF excerpt focus awaits the semantic result and rejects IDs absent from the current document', async () => {
  const f = fixture();
  const result = api().buildNativePdfHighlightOccurrences(f.input);
  let current = result, calls = 0;
  const start = source.indexOf('async function focusNativePdfHighlightOccurrence(');
  const end = source.indexOf('function renderHighlightDistribution(', start);
  const focus = new Function('currentNativePdfHighlightSnapshot', 'refreshActivePdfSemanticNavigationContext',
    'pdfSemanticParagraphTargets', 'focusPdfSemanticNavigationTarget', 'pdfSemanticFocusFailure',
    source.slice(start, end) + '\nreturn focusNativePdfHighlightOccurrence;')(
    () => current, () => ({ navigation: f.input.navigation }), () => [f.target],
    async (_target, selection) => { calls++; await Promise.resolve(); return { focused: true, selection }; },
    reasonCode => ({ focused: false, reasonCode })
  );
  const focused = await focus(result.occurrences[0].highlightId);
  assert.equal(focused.focused, true);
  assert.equal(focused.selection.expectedNormalizedQuote, 'microglia');
  current = { occurrences: [] };
  assert.equal((await focus(result.occurrences[0].highlightId)).focused, false);
  assert.equal(calls, 1);
});
test('section focus only matches supplied nonempty keys in semantic and canonical navigation', async () => {
  const start = source.indexOf('async function focusArticleWorkspaceSource(');
  const end = source.indexOf('function focusHighlightOccurrence(', start);
  const sections = [{ sectionId: 'first', paragraphTargets: [{ pageNumber: 1 }], anchor: 'first-anchor' },
    { sectionId: 'far', paragraphTargets: [{ pageNumber: 8 }], anchor: 'far-anchor' }];
  for (const semantic of [true, false]) {
    const calls = [];
    const focus = new Function('refreshActivePdfSemanticNavigationContext', 'flattenPdfSemanticNavigationSections',
      'focusPdfSemanticNavigationTarget', 'pdfSemanticFocusFailure', 'currentArticleStructure',
      'extractCurrentArticleStructure', 'flattenArticleNodes', 'focusArticleSource',
      source.slice(start, end) + '\nreturn focusArticleWorkspaceSource;')(
      () => semantic ? { navigation: { sections } } : null, items => items || [],
      async target => { calls.push(target.pageNumber); return { focused: true, pageNumber: target.pageNumber }; },
      reasonCode => ({ focused: false, reasonCode }), { nodes: sections }, () => ({ nodes: sections }),
      nodes => nodes, anchor => { calls.push(anchor); return true; }
    );
    const far = await focus({ kind: 'section', sectionId: 'far' });
    assert.equal(semantic ? far.pageNumber : far, semantic ? 8 : true);
    for (const target of [{ kind: 'section', sectionId: 'missing' },
      { kind: 'section' }, { kind: 'section', sectionId: '', sourceKey: '' },
      { kind: 'section', sectionId: '  ', sourceKey: '  ' }]) {
      assert.equal(await focus(target), false);
    }
    assert.deepEqual(calls, semantic ? [8] : ['far-anchor']);
    sections[1].sourceKey = 'far-source';
    const bySource = await focus({ kind: 'section', sourceKey: 'far-source' });
    assert.equal(semantic ? bySource.pageNumber : bySource, semantic ? 8 : true);
    assert.deepEqual(calls, semantic ? [8, 8] : ['far-anchor', 'far-anchor']);
    delete sections[1].sourceKey;
  }
});
