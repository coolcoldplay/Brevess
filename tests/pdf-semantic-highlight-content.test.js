const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../content.js'), 'utf8');

function body(startText, endText) {
  const start = source.indexOf(startText);
  const end = source.indexOf(endText, start + startText.length);
  assert.ok(start >= 0 && end > start, `missing source boundary: ${startText}`);
  return source.slice(start, end);
}

function semanticHelpers() {
  return body('function createPdfSemanticHighlightLocator(', 'class SciPaperHighlighter');
}

function semanticLocatorHelpers() {
  return body('function createPdfSemanticHighlightLocator(',
    'function currentNativePdfSemanticHighlightState(');
}

function semanticScopeHelpers() {
  return body('function defaultArticleAnalysisSectionSelection(',
    'function filterParagraphsForArticleAnalysis(');
}

function semanticFixture(revision = 7) {
  const hash = '9'.repeat(64);
  const identity = { documentId: `sha256:${hash}`, documentHash: hash,
    documentGeneration: 3, revision, semanticCacheKey: `cache-${revision}`,
    semanticProvenanceKey: `provenance-${revision}` };
  const target = (name, pageNumber, quote) => ({ kind: 'paragraph', ...identity,
    paragraphId: `semantic-${name}-${revision}`, pageNumber,
    normalizedStart: 0, normalizedEnd: quote.length,
    expectedNormalizedQuote: quote });
  const sections = [
    { sectionId: `semantic-intro-${revision}`, title: 'Introduction', level: 1,
      paragraphTargets: [target('intro', 1, 'shared result introduction')], children: [] },
    { sectionId: `semantic-methods-${revision}`, title: 'Methods', level: 1,
      paragraphTargets: [target('methods', 2, 'shared result methods')], children: [] },
    { sectionId: `semantic-results-${revision}`, title: 'Results', level: 1,
      paragraphTargets: [target('results', 3, 'shared result findings')], children: [] }
  ];
  return { ...identity, navigation: { ...identity, sections } };
}

function canonicalScopeSnapshot() {
  return { paragraphs: [
    { paragraphId: 'pdf-page-1', sourceKey: 'pdf-page-1', pageNumber: 1,
      sectionId: 'outline-intro', sectionTitle: 'Introduction', sectionKind: 'introduction' },
    { paragraphId: 'pdf-page-2', sourceKey: 'pdf-page-2', pageNumber: 2,
      sectionId: 'outline-methods', sectionTitle: 'Methods', sectionKind: 'methods' },
    { paragraphId: 'pdf-page-3', sourceKey: 'pdf-page-3', pageNumber: 3,
      sectionId: 'outline-results', sectionTitle: 'Results', sectionKind: 'results' }
  ] };
}

function createScopeApi(selection = new Map()) {
  const articleNavigatorState = { analysisSectionSelection: selection };
  const DEFAULT_ANALYSIS_SECTION_KINDS = new Set([
    'abstract', 'main', 'introduction', 'results', 'discussion', 'conclusion'
  ]);
  return new Function('articleNavigatorState', 'DEFAULT_ANALYSIS_SECTION_KINDS',
    'getCanonicalArticleSnapshot', 'flattenPdfSemanticNavigationSections',
    `${semanticScopeHelpers()}\nreturn { selectedArticleAnalysisParagraphIds, ` +
    'currentNativePdfSemanticAnalysisScope };')(
    articleNavigatorState, DEFAULT_ANALYSIS_SECTION_KINDS,
    () => canonicalScopeSnapshot(), sections => sections
  );
}

function hierarchicalSemanticFixture(revision = 10) {
  const hash = '8'.repeat(64);
  const identity = { documentId: `sha256:${hash}`, documentHash: hash,
    documentGeneration: 4, revision, semanticCacheKey: `cache-h-${revision}`,
    semanticProvenanceKey: `provenance-h-${revision}` };
  const target = (id, pageNumber, quote) => ({ kind: 'paragraph', ...identity,
    paragraphId: `semantic-${id}-${revision}`, pageNumber,
    normalizedStart: 0, normalizedEnd: quote.length, expectedNormalizedQuote: quote });
  const methods = { sectionId: `semantic-methods-${revision}`, title: 'Materials and methods',
    level: 1, paragraphTargets: [], children: [
      { sectionId: `semantic-animals-${revision}`, title: 'Animals', level: 2,
        paragraphTargets: [target('animals', 3, 'method animal evidence')], children: [
          { sectionId: `semantic-implantation-${revision}`,
            title: 'Hippocampal window implantation', level: 3,
            paragraphTargets: [target('implantation', 3, 'method implantation evidence')],
            children: [] }
        ] },
      { sectionId: `semantic-statistics-${revision}`, title: 'Statistical analysis', level: 2,
        paragraphTargets: [target('statistics', 4, 'method statistical evidence')], children: [] }
    ] };
  const sections = [
    { sectionId: `semantic-preamble-${revision}`, title: 'Preamble', level: 1,
      paragraphTargets: [target('preamble', 1, 'front matter')], children: [] },
    { sectionId: `semantic-abstract-${revision}`, title: 'Abstract', level: 1,
      paragraphTargets: [target('abstract', 2, 'abstract evidence')], children: [] },
    methods,
    { sectionId: `semantic-results-${revision}`, title: 'Results', level: 1,
      paragraphTargets: [target('results-boundary', 4, 'result on methods boundary page'),
        target('results', 5, 'result evidence')], children: [] },
    { sectionId: `semantic-transition-${revision}`, title: 'Transition note', level: 1,
      paragraphTargets: [target('transition-method-page', 4, 'transition on selected page'),
        target('transition-result-page', 5, 'transition on unselected page')], children: [] },
    { sectionId: `semantic-discussion-${revision}`, title: 'Discussion', level: 1,
      paragraphTargets: [target('discussion', 6, 'discussion evidence')], children: [] }
  ];
  return { ...identity, navigation: { ...identity, sections } };
}

function hierarchicalCanonicalSnapshot() {
  const nodes = [
    { sectionId: 'canonical-front', title: 'Front matter', level: 1, sectionKind: 'main',
      children: [] },
    { sectionId: 'canonical-abstract', title: 'Abstract', level: 1,
      sectionKind: 'abstract', children: [] },
    { sectionId: 'canonical-methods-root', title: 'Materials and methods', level: 1,
      sectionKind: 'methods', children: [
        { sectionId: 'canonical-animals', title: 'Animals', level: 2,
          sectionKind: 'methods', children: [
            { sectionId: 'canonical-implantation', title: 'Hippocampal window implantation',
              level: 3, sectionKind: 'methods', children: [] }
          ] },
        { sectionId: 'canonical-statistics', title: 'Statistical analysis', level: 2,
          sectionKind: 'methods', children: [] }
      ] },
    { sectionId: 'canonical-results', title: 'Results', level: 1,
      sectionKind: 'results', children: [] },
    { sectionId: 'canonical-discussion', title: 'Discussion', level: 1,
      sectionKind: 'discussion', children: [] }
  ];
  return { structure: { nodes }, nodes, paragraphs: [
    { paragraphId: 'pdf-page-1', sourceKey: 'pdf-page-1', pageNumber: 1,
      sectionId: 'canonical-front', sectionTitle: 'Front matter', sectionKind: 'main' },
    { paragraphId: 'pdf-page-2', sourceKey: 'pdf-page-2', pageNumber: 2,
      sectionId: 'canonical-abstract', sectionTitle: 'Abstract', sectionKind: 'abstract' },
    { paragraphId: 'pdf-page-3', sourceKey: 'pdf-page-3', pageNumber: 3,
      sectionId: 'canonical-implantation', sectionTitle: 'Hippocampal window implantation',
      sectionKind: 'methods' },
    { paragraphId: 'pdf-page-4', sourceKey: 'pdf-page-4', pageNumber: 4,
      sectionId: 'canonical-statistics', sectionTitle: 'Statistical analysis', sectionKind: 'methods' },
    { paragraphId: 'pdf-page-5', sourceKey: 'pdf-page-5', pageNumber: 5,
      sectionId: 'canonical-results', sectionTitle: 'Results', sectionKind: 'results' },
    { paragraphId: 'pdf-page-6', sourceKey: 'pdf-page-6', pageNumber: 6,
      sectionId: 'canonical-discussion', sectionTitle: 'Discussion', sectionKind: 'discussion' }
  ] };
}

function createScopeMessageApi(context, snapshot) {
  const articleNavigatorState = { analysisSectionSelection: new Map() };
  const DEFAULT_ANALYSIS_SECTION_KINDS = new Set([
    'abstract', 'main', 'introduction', 'results', 'discussion', 'conclusion'
  ]);
  const scopeSource = body('function defaultArticleAnalysisSectionSelection(',
    'const REVIEW_ROLE_LABELS');
  const flatten = (sections, output = []) => {
    for (const section of sections || []) {
      output.push(section);
      flatten(section.children, output);
    }
    return output;
  };
  return new Function('articleNavigatorState', 'DEFAULT_ANALYSIS_SECTION_KINDS',
    'getCanonicalArticleSnapshot', 'flattenPdfSemanticNavigationSections',
    'currentNativePdfSemanticHighlightState', 'lastRegexHighlightRequest',
    'highlighter', 'lastLlmAnalysis', 'renderLlmAnalysis',
    'scheduleArticleWorkspaceArtifactsSave', 'scheduleCurrentArticleArchiveSave',
    'buildArticleWorkspaceSnapshot', `${scopeSource}\nreturn { articleNavigatorState, ` +
    'selectedArticleAnalysisParagraphIds, currentNativePdfSemanticAnalysisScope, ' +
    'filterParagraphsForArticleAnalysis, setArticleAnalysisSectionSelection };')(
    articleNavigatorState, DEFAULT_ANALYSIS_SECTION_KINDS, () => snapshot, flatten,
    () => ({ required: true, ready: true, context }), null,
    { applyHighlight() {} }, null, () => {}, () => {}, () => {}, () => ({})
  );
}

function serializeScopeNodes(snapshot, selectionApi) {
  const paragraphCounts = new Map();
  const sectionKinds = new Map();
  for (const paragraph of snapshot.paragraphs) {
    paragraphCounts.set(paragraph.sectionId,
      (paragraphCounts.get(paragraph.sectionId) || 0) + 1);
    sectionKinds.set(paragraph.sectionId, paragraph.sectionKind);
  }
  const serializeSource = body('function serializeArticleWorkspaceNode(',
    'function buildFigureWorkspaceSnapshot(');
  const serialize = new Function('articleAnalysisSectionSelected',
    'normalizeArticleNavigatorText', 'normalizeArticleNavigatorDisplayText',
    `${serializeSource}\nreturn serializeArticleWorkspaceNode;`)(
    (sectionId, sectionKind) => selectionApi.articleNavigatorState
      .analysisSectionSelection.has(sectionId)
      ? selectionApi.articleNavigatorState.analysisSectionSelection.get(sectionId) === true
      : ['abstract', 'main', 'introduction', 'results', 'discussion', 'conclusion']
        .includes(String(sectionKind || '').toLowerCase()),
    value => String(value || '').trim(), value => String(value || '').trim()
  );
  return snapshot.structure.nodes.map(node =>
    serialize(node, paragraphCounts, sectionKinds));
}

function flattenSerializedNodes(nodes, output = []) {
  for (const node of nodes || []) {
    output.push(node);
    flattenSerializedNodes(node.children, output);
  }
  return output;
}

function fakePage() {
  const page = {
    children: [],
    querySelectorAll(selector) {
      const className = String(selector).replace(/^\./, '');
      return this.children.filter(item => item.className === className);
    },
    appendChild(item) {
      item.parent = this;
      item.remove = () => {
        const index = this.children.indexOf(item);
        if (index >= 0) this.children.splice(index, 1);
      };
      this.children.push(item);
    },
    getBoundingClientRect() { return { left: 0, top: 0 }; }
  };
  return page;
}

test('shared painter projects every resolver raw range and replaces remounted layers', () => {
  const pages = new Map([[1, fakePage()], [2, fakePage()]]);
  const projected = [];
  const projectionModes = [];
  const resolverCalls = [];
  const document = {
    createElement() {
      return { className: '', dataset: {}, style: {}, children: [],
        appendChild(child) { this.children.push(child); } };
    }
  };
  const globalThis = {
    __brevessNativePdfDocument: {
      resolveSemanticHighlight(locator) {
        resolverCalls.push(locator);
        return { status: 'resolved', precision: 'normalized-equivalent', ranges: [
          { pageNumber: 1, start: 10, end: 16, quote: 'multi-', precision: 'exact-raw' },
          { pageNumber: 1, start: 30, end: 34, quote: 'line', precision: 'normalized-equivalent' },
          { pageNumber: 2, start: 2, end: 7, quote: 'cross', precision: 'exact-raw' }
        ] };
      }
    },
    __brevessPdfReaderBridge: { command(_name, pageNumber) {
      return { documentHash: 'a'.repeat(64), documentGeneration: 3,
        pageElement: pages.get(pageNumber), textLayer: { pageNumber } };
    } }
  };
  const SciLLM = {
    readPdfTextProjection(textLayer, options) {
      projectionModes.push(options?.mode);
      return { text: textLayer.pageNumber === 1
        ? `${'H'.repeat(10)}multi-${'x'.repeat(14)}line`
        : 'xxcross' };
    },
    pdfProjectionRange(_projection, rawRange) {
      projected.push({ ...rawRange });
      return { rawRange };
    },
    pdfProjectionRects() { return [{ left: 1, top: 2, width: 3, height: 4 }]; }
  };
  const api = new Function('document', 'globalThis', 'SciLLM', `${semanticHelpers()}
    return { createPdfSemanticHighlightLocator, paintPdfSemanticHighlightPage };`
  )(document, globalThis, SciLLM);
  const target = { kind: 'paragraph', documentId: `sha256:${'a'.repeat(64)}`,
    documentHash: 'a'.repeat(64), documentGeneration: 3, revision: 7,
    semanticCacheKey: 'cache', semanticProvenanceKey: 'provenance',
    paragraphId: 'semantic-p1', normalizedStart: 0, normalizedEnd: 10,
    expectedNormalizedQuote: 'multiline!' };
  const locator = api.createPdfSemanticHighlightLocator(target);
  const entry = { documentHash: 'a'.repeat(64), documentGeneration: 3,
    items: [{ locator }] };
  const options = { layerClass: 'semantic-layer', modeId: 'mode',
    createMark: () => ({ style: {} }) };
  assert.equal(api.paintPdfSemanticHighlightPage(entry, 1, options), 2);
  assert.deepEqual(projected.map(item => [item.pageNumber, item.start, item.end]),
    [[1, 10, 16], [1, 30, 34]]);
  assert.equal(pages.get(1).children.length, 1);
  assert.equal(pages.get(1).children[0].children.length, 2);
  assert.equal(api.paintPdfSemanticHighlightPage(entry, 1, options), 2);
  assert.equal(pages.get(1).children.length, 1, 'zoom/remount repaint must replace its layer');
  assert.equal(pages.get(1).children[0].children.length, 2);
  assert.equal(api.paintPdfSemanticHighlightPage(entry, 2, options), 1);
  assert.equal(resolverCalls.length, 3);
  assert.deepEqual(projectionModes, ['raw-offset', 'raw-offset', 'raw-offset']);
});

test('shared painter leaves no empty layer when every semantic range is unresolved', () => {
  const page = fakePage();
  const document = { createElement: () => ({ className: '', dataset: {}, style: {},
    children: [], appendChild(child) { this.children.push(child); } }) };
  const globalThis = {
    __brevessNativePdfDocument: { resolveSemanticHighlight: () => ({
      status: 'unresolved', precision: 'none', ranges: [], reasonCode: 'STALE'
    }) },
    __brevessPdfReaderBridge: { command: () => ({
      documentHash: 'a'.repeat(64), documentGeneration: 3,
      pageElement: page, textLayer: {}
    }) }
  };
  const api = new Function('document', 'globalThis', 'SciLLM', `${semanticHelpers()}
    return { paintPdfSemanticHighlightPage };`)(document, globalThis, {
    readPdfTextProjection: () => ({ text: '' }),
    pdfProjectionRange: () => null, pdfProjectionRects: () => []
  });
  const locator = { locatorKind: 'pdf-semantic', paragraphId: 'semantic-p1' };
  assert.equal(api.paintPdfSemanticHighlightPage({
    documentHash: 'a'.repeat(64), documentGeneration: 3, items: [{ locator }]
  }, 1, { layerClass: 'semantic-layer', modeId: 'mode' }), 0);
  assert.equal(page.children.length, 0);
});

test('shared painter rejects a mismatched raw quote before creating a DOM Range', () => {
  const page = fakePage();
  let rangeCalls = 0;
  let projectionMode = '';
  const diagnostics = { degradedCount: 0, unresolvedCount: 0,
    highlightReasonCodes: [] };
  const document = { createElement: () => ({ className: '', dataset: {}, style: {},
    children: [], appendChild(child) { this.children.push(child); } }) };
  const globalThis = {
    __brevessNativePdfDocument: { resolveSemanticHighlight: () => ({
      status: 'resolved', precision: 'exact-raw', ranges: [
        { pageNumber: 1, start: 7, end: 13, quote: 'result', precision: 'exact-raw' },
        { pageNumber: 1, start: 14, end: 20, quote: 'second', precision: 'exact-raw' }
      ]
    }) },
    __brevessPdfReaderBridge: { command: () => ({
      documentHash: 'a'.repeat(64), documentGeneration: 3,
      pageElement: page, textLayer: {}
    }) }
  };
  const api = new Function('document', 'globalThis', 'SciLLM', `${semanticHelpers()}
    return { paintPdfSemanticHighlightPage };`)(document, globalThis, {
    readPdfTextProjection: (_layer, options) => {
      projectionMode = options?.mode || '';
      return { text: 'HEADER result wrong' };
    },
    pdfProjectionRange: () => { rangeCalls += 1; return {}; },
    pdfProjectionRects: () => [{ left: 1, top: 1, width: 1, height: 1 }]
  });
  const painted = api.paintPdfSemanticHighlightPage({
    documentHash: 'a'.repeat(64), documentGeneration: 3,
    items: [{ locator: { locatorKind: 'pdf-semantic', paragraphId: 'semantic-p1' } }]
  }, 1, { layerClass: 'semantic-layer', modeId: 'mode', diagnostics,
    createMark: () => ({ style: {} }) });
  assert.equal(painted, 0);
  assert.equal(projectionMode, 'raw-offset');
  assert.equal(rangeCalls, 0);
  assert.equal(page.children.length, 0);
  assert.equal(diagnostics.unresolvedCount, 1);
  assert.deepEqual(diagnostics.highlightReasonCodes, ['PDF_HIGHLIGHT_RAW_QUOTE_MISMATCH']);
});

test('active native semantic infrastructure never falls back to regex page offsets while navigation waits', () => {
  const classSource = body('class SciPaperHighlighter',
    '// DOM-independent manual annotation UI helpers: start');
  const structure = { documentHash: 'c'.repeat(64), paragraphs: [{
    paragraphId: 'pdf-page-1', pageNumber: 1, text: 'result'
  }] };
  const globalThis = { __brevessNativePdfDocument: {
    structure, documentGeneration: 5, resolveSemanticHighlight: () => ({
      status: 'unresolved', ranges: [], reasonCode: 'NOT_READY'
    })
  } };
  const Class = new Function('document', 'globalThis', 'activeNativePdfStructure',
    'SciLLM', 'console', 'refreshActivePdfSemanticNavigationContext',
    'pdfSemanticParagraphTargets', `${semanticHelpers()}\n${classSource}\n` +
    'return SciPaperHighlighter;')(
    { addEventListener() {}, querySelectorAll: () => [], getElementById: () => null },
    globalThis, () => structure,
    { findScientificSentenceBounds: (_text, start, end) => ({ start, end }) },
    { log() {} }, () => null, () => []
  );
  const instance = new Class();
  assert.deepEqual(instance.applyHighlight({ result: {
    isRegex: true, patterns: ['result'], name: 'Result'
  } }, 'word', { analysisModeId: 'waiting' }), { result: 0 });
  assert.equal(instance.nativePdfModes.get('waiting')?.waitingForSemantic, true);
  assert.equal(instance.lastNativePdfHighlightDiagnostics.unresolvedCount, 1);
});

test('native semantic regex maps the real default canonical section selection into semantic ids', () => {
  const context = semanticFixture(7);
  const api = createScopeApi();
  const canonicalIds = api.selectedArticleAnalysisParagraphIds(canonicalScopeSnapshot());
  assert.deepEqual([...canonicalIds].sort(),
    ['pdf-page-1', 'pdf-page-3']);
  const scope = api.currentNativePdfSemanticAnalysisScope(
    context, canonicalScopeSnapshot());
  assert.equal(scope.status, 'ready');
  assert.deepEqual([...scope.semanticParagraphIds].sort(),
    ['semantic-intro-7', 'semantic-results-7']);
  assert.match(scope.identity, /cache-7/u);
});

test('native semantic regex initial apply and counts use the real Methods-only selection', () => {
  const selection = new Map([
    ['outline-intro', false], ['outline-methods', true], ['outline-results', false]
  ]);
  const context = semanticFixture(7);
  const api = createScopeApi(selection);
  const canonicalIds = api.selectedArticleAnalysisParagraphIds(canonicalScopeSnapshot());
  const scope = api.currentNativePdfSemanticAnalysisScope(
    context, canonicalScopeSnapshot());
  const classSource = body('class SciPaperHighlighter',
    '// DOM-independent manual annotation UI helpers: start');
  const structure = { adapterId: 'pdf-native', documentHash: context.documentHash,
    paragraphs: canonicalScopeSnapshot().paragraphs.map(item => ({ ...item, text: 'legacy' })) };
  let resolverCalls = 0;
  const globalThis = { __brevessNativePdfDocument: {
    structure, documentGeneration: 3,
    resolveSemanticHighlight(locator) {
      resolverCalls += 1;
      return { status: 'resolved', ranges: [{ pageNumber: 2, start: 0,
        end: locator.expectedNormalizedQuote.length,
        quote: locator.expectedNormalizedQuote, precision: 'exact-raw' }] };
    }
  } };
  const Class = new Function('document', 'globalThis', 'activeNativePdfStructure',
    'SciLLM', 'console', 'refreshActivePdfSemanticNavigationContext',
    'pdfSemanticParagraphTargets', `${semanticHelpers()}\n${classSource}\n` +
    'return SciPaperHighlighter;')(
    { addEventListener() {}, querySelectorAll: () => [], getElementById: () => null },
    globalThis, () => structure,
    { findScientificSentenceBounds: (_text, start, end) => ({ start, end }) },
    { log() {} }, () => context,
    navigation => navigation.sections.flatMap(section => section.paragraphTargets)
  );
  const instance = new Class();
  instance.paintNativePage = () => {};
  const rules = { result: { isRegex: true, patterns: ['result'], name: 'Result' } };
  assert.deepEqual(instance.applyHighlight(rules, 'word', {
    allowedParagraphIds: canonicalIds, semanticAnalysisScope: scope,
    analysisModeId: 'methods-only'
  }), { result: 1 });
  assert.equal(instance.nativePdfModes.get('methods-only').items[0].locator.paragraphId,
    'semantic-methods-7');
  assert.deepEqual(instance.getMatchCounts(rules, { semanticAnalysisScope: scope }),
    { result: 1 });
  assert.equal(resolverCalls, 2);
});

test('native semantic scope preserves Methods-only selection across revision ids', () => {
  const selection = new Map([
    ['outline-intro', false], ['outline-methods', true], ['outline-results', false]
  ]);
  const api = createScopeApi(selection);
  const revision7 = api.currentNativePdfSemanticAnalysisScope(
    semanticFixture(7), canonicalScopeSnapshot());
  const revision8 = api.currentNativePdfSemanticAnalysisScope(
    semanticFixture(8), canonicalScopeSnapshot());
  assert.deepEqual([...revision7.semanticParagraphIds], ['semantic-methods-7']);
  assert.deepEqual([...revision8.semanticParagraphIds], ['semantic-methods-8']);
  assert.notEqual(revision7.identity, revision8.identity);
});

test('real selection message path maps all-false then Methods-true to Methods descendants only', () => {
  const context = hierarchicalSemanticFixture(10);
  const snapshot = hierarchicalCanonicalSnapshot();
  const api = createScopeMessageApi(context, snapshot);
  const serialized = serializeScopeNodes(snapshot, api);
  const flatSerialized = flattenSerializedNodes(serialized);
  const allCanonicalSectionIds = [...new Set(flatSerialized.flatMap(node =>
    node.analysisSectionIds))];
  const methodsNode = flatSerialized.find(node =>
    node.sectionId === 'canonical-methods-root');
  api.setArticleAnalysisSectionSelection(allCanonicalSectionIds, false);
  api.setArticleAnalysisSectionSelection(methodsNode.analysisSectionIds, true);
  const canonicalIds = api.selectedArticleAnalysisParagraphIds(snapshot);
  assert.deepEqual([...canonicalIds].sort(), ['pdf-page-3', 'pdf-page-4']);
  const scope = api.currentNativePdfSemanticAnalysisScope(context, snapshot);
  assert.equal(scope.status, 'ready');
  assert.deepEqual([...scope.semanticParagraphIds].sort(), [
    'semantic-animals-10', 'semantic-implantation-10', 'semantic-statistics-10'
  ]);
  for (const excluded of ['preamble', 'abstract', 'results', 'discussion']) {
    assert.equal([...scope.semanticParagraphIds].some(id => id.includes(excluded)), false);
  }
});

test('mapped Methods targets create locators owned by the current semantic context', () => {
  const context = hierarchicalSemanticFixture(10);
  const snapshot = hierarchicalCanonicalSnapshot();
  const api = createScopeMessageApi(context, snapshot);
  const serialized = flattenSerializedNodes(serializeScopeNodes(snapshot, api));
  const allIds = [...new Set(serialized.flatMap(node => node.analysisSectionIds))];
  const methodIds = serialized.find(node =>
    node.sectionId === 'canonical-methods-root').analysisSectionIds;
  api.setArticleAnalysisSectionSelection(allIds, false);
  api.setArticleAnalysisSectionSelection(methodIds, true);
  const scope = api.currentNativePdfSemanticAnalysisScope(context, snapshot);
  const targets = [];
  const visit = sections => (sections || []).forEach(section => {
    targets.push(...(section.paragraphTargets || []));
    visit(section.children);
  });
  visit(context.navigation.sections);
  const scopedTargets = targets.filter(target =>
    scope.semanticParagraphIds.has(target.paragraphId));
  let resolverCalls = 0;
  const globalThis = { __brevessNativePdfDocument: {
    resolveSemanticHighlight(locator) {
      resolverCalls += 1;
      for (const field of ['documentHash', 'documentGeneration', 'revision',
        'semanticCacheKey', 'semanticProvenanceKey']) {
        if (locator[field] !== context[field]) {
          return { status: 'stale', ranges: [], reasonCode: 'PDF_HIGHLIGHT_STALE' };
        }
      }
      return { status: 'resolved', ranges: [{ pageNumber: 3, start: 0,
        end: locator.expectedNormalizedQuote.length,
        quote: locator.expectedNormalizedQuote, precision: 'exact-raw' }] };
    }
  } };
  const locatorApi = new Function('globalThis',
    `${semanticLocatorHelpers()}\nreturn { createPdfSemanticHighlightLocator, ` +
    'resolvePdfSemanticHighlightLocator };')(globalThis);
  for (const target of scopedTargets) {
    const quote = target.expectedNormalizedQuote.slice(0, 6);
    const locator = locatorApi.createPdfSemanticHighlightLocator(target, {
      normalizedStart: target.normalizedStart,
      normalizedEnd: target.normalizedStart + quote.length,
      expectedNormalizedQuote: quote
    });
    assert.equal(locatorApi.resolvePdfSemanticHighlightLocator(locator).status, 'resolved');
  }
  assert.equal(scopedTargets.length, 3);
  assert.equal(resolverCalls, 3);
});

test('nonempty canonical selection with no semantic bridge waits as unmapped', () => {
  const context = hierarchicalSemanticFixture(10);
  context.navigation.sections = [{ sectionId: 'semantic-appendix', title: 'Appendix',
    level: 1, paragraphTargets: [{ kind: 'paragraph',
      ...context.navigation.sections[0].paragraphTargets[0],
      paragraphId: 'semantic-appendix-p1', pageNumber: 6 }], children: [] }];
  const snapshot = hierarchicalCanonicalSnapshot();
  const api = createScopeMessageApi(context, snapshot);
  api.setArticleAnalysisSectionSelection(
    [...new Set(snapshot.paragraphs.map(item => item.sectionId))], false);
  api.setArticleAnalysisSectionSelection(['canonical-implantation'], true);
  assert.ok(api.selectedArticleAnalysisParagraphIds(snapshot).size > 0);
  const scope = api.currentNativePdfSemanticAnalysisScope(context, snapshot);
  assert.equal(scope.status, 'waiting');
  assert.equal(scope.reasonCode, 'PDF_SEMANTIC_SCOPE_UNMAPPED');
  assert.equal(scope.semanticParagraphIds.size, 0);
});

test('empty canonical message scope rejects article chat before any model request', async () => {
  const context = hierarchicalSemanticFixture(10);
  const snapshot = hierarchicalCanonicalSnapshot();
  const api = createScopeMessageApi(context, snapshot);
  api.setArticleAnalysisSectionSelection(
    [...new Set(snapshot.paragraphs.map(item => item.sectionId))], false);
  const scope = api.currentNativePdfSemanticAnalysisScope(context, snapshot);
  assert.equal(scope.status, 'ready');
  assert.equal(scope.semanticParagraphIds.size, 0);

  const chatScopeSource = body('function pdfSemanticArticleChatSnapshot(',
    'function articleChatRequestQuestion(');
  const askSource = body('async function askArticleWithLLM(',
    'async function cancelArticleChatWithLLM(');
  const flatten = (sections, output = []) => {
    for (const section of sections || []) {
      output.push(section);
      flatten(section.children, output);
    }
    return output;
  };
  const sandbox = {
    refreshActivePdfSemanticNavigationContext: () => context,
    flattenPdfSemanticNavigationSections: flatten,
    normalizeArticleChatContextScope: value => value || { sectionIds: [], scopes: [] },
    SciLLM: { resolveArticleChatContextScope: normalized => ({ requested: false,
      complete: true, paragraphIds: [], sectionIds: [], contextScope: normalized,
      unresolvedScopes: [] }) },
    currentNativePdfSemanticAnalysisScope: () => scope,
    getCanonicalArticleSnapshot: () => snapshot,
    filterParagraphsForArticleAnalysis: api.filterParagraphsForArticleAnalysis,
    hashArticleChatParagraphText(value) {
      const sourceText = String(value || '');
      let first = 2166136261;
      let second = 2166136261 ^ 0x9e3779b9;
      for (let index = 0; index < sourceText.length; index += 1) {
        const code = sourceText.charCodeAt(index);
        first = Math.imul(first ^ code, 16777619);
        second = Math.imul(second ^ code, 2246822519);
      }
      return `${(first >>> 0).toString(16).padStart(8, '0')}` +
        `${(second >>> 0).toString(16).padStart(8, '0')}`;
    },
    articleChatClearInFlight: false,
    createArticleChatTurn: () => { throw new Error('MODEL_REQUEST_STARTED'); },
    articleChatState: { turns: [] },
    notifyArticleChatStateChanged: () => {},
    persistArticleChatCheckpoint: () => Promise.resolve(),
    scheduleCurrentArticleArchiveSave: () => {},
    pumpArticleChatQueue: () => { throw new Error('MODEL_REQUEST_STARTED'); },
    publicArticleChatTurn: turn => turn
  };
  const ask = new Function(...Object.keys(sandbox),
    `${chatScopeSource}\n${askSource}\nreturn askArticleWithLLM;`)(
    ...Object.values(sandbox));
  await assert.rejects(() => ask('question', 'profile', {}),
    error => error.code === 'ARTICLE_CHAT_SCOPE_EMPTY');
  assert.equal(sandbox.articleChatState.turns.length, 0);
});

test('regex counts one semantic hit when resolver returns multiline cross-page ranges', () => {
  const classSource = body('class SciPaperHighlighter',
    '// DOM-independent manual annotation UI helpers: start');
  const target = { kind: 'paragraph', documentId: `sha256:${'b'.repeat(64)}`,
    documentHash: 'b'.repeat(64), documentGeneration: 4, revision: 8,
    semanticCacheKey: 'cache-b', semanticProvenanceKey: 'provenance-b',
    paragraphId: 'semantic-results-1', pageNumber: 1,
    normalizedStart: 0, normalizedEnd: 13,
    expectedNormalizedQuote: 'Alpha result.' };
  const structure = { adapterId: 'pdf-native', documentHash: 'b'.repeat(64),
    paragraphs: [{ paragraphId: 'pdf-page-1', pageNumber: 1, text: 'legacy' }] };
  let resolverCalls = 0;
  const globalThis = { __brevessNativePdfDocument: {
    structure, documentGeneration: 4,
    resolveSemanticHighlight() {
      resolverCalls += 1;
      return { status: 'resolved', precision: 'normalized-equivalent', ranges: [
        { pageNumber: 1, start: 20, end: 26, quote: 'Alpha ', precision: 'exact-raw' },
        { pageNumber: 2, start: 0, end: 7, quote: 'result.', precision: 'normalized-equivalent' }
      ] };
    }
  } };
  const document = { addEventListener() {}, querySelectorAll: () => [],
    getElementById: () => null };
  const Class = new Function('document', 'globalThis', 'activeNativePdfStructure',
    'SciLLM', 'console', 'refreshActivePdfSemanticNavigationContext',
    'pdfSemanticParagraphTargets', `${semanticHelpers()}\n${classSource}\n` +
    'return SciPaperHighlighter;')(
    document, globalThis, () => structure,
    { findScientificSentenceBounds: (_text, start, end) => ({ start, end }) },
    { log() {} }, () => ({ navigation: {}, documentHash: 'b'.repeat(64),
      documentGeneration: 4 }), () => [target]
  );
  const instance = new Class();
  const paintedPages = [];
  instance.paintNativePage = (_entry, pageNumber) => paintedPages.push(pageNumber);
  const counts = instance.applyHighlight({ result: {
    isRegex: true, patterns: ['result'], color: '#ff0', name: 'Result'
  } }, 'word', { analysisModeId: 'semantic-regex' });
  assert.deepEqual(counts, { result: 1 });
  const entry = instance.nativePdfModes.get('semantic-regex');
  assert.equal(entry.items.length, 1);
  assert.deepEqual(entry.items[0].pageNumbers, [1, 2]);
  assert.deepEqual(paintedPages, [1, 2]);
  assert.equal(resolverCalls, 1);
});

test('regex counts after pattern merge and after exact semantic resolution', () => {
  const classSource = body('class SciPaperHighlighter',
    '// DOM-independent manual annotation UI helpers: start');
  const target = { kind: 'paragraph', documentId: `sha256:${'d'.repeat(64)}`,
    documentHash: 'd'.repeat(64), documentGeneration: 6, revision: 9,
    semanticCacheKey: 'cache-d', semanticProvenanceKey: 'provenance-d',
    paragraphId: 'semantic-overlap', normalizedStart: 0, normalizedEnd: 12,
    expectedNormalizedQuote: 'alpha result' };
  const structure = { documentHash: 'd'.repeat(64), paragraphs: [] };
  let outcome = 'resolved';
  const globalThis = { __brevessNativePdfDocument: { structure, documentGeneration: 6,
    resolveSemanticHighlight: () => outcome === 'resolved'
      ? { status: 'resolved', ranges: [
        { pageNumber: 1, start: 1, end: 13, quote: 'alpha result', precision: 'exact-raw' },
        { pageNumber: 2, start: 4, end: 10, quote: 'result', precision: 'exact-raw' }
      ] }
      : { status: outcome, ranges: [], reasonCode: outcome === 'degraded'
        ? 'PAGE_ONLY' : 'UNRESOLVED' } } };
  const Class = new Function('document', 'globalThis', 'activeNativePdfStructure',
    'SciLLM', 'console', 'refreshActivePdfSemanticNavigationContext',
    'pdfSemanticParagraphTargets', `${semanticHelpers()}\n${classSource}\n` +
    'return SciPaperHighlighter;')(
    { addEventListener() {}, querySelectorAll: () => [], getElementById: () => null },
    globalThis, () => structure,
    { findScientificSentenceBounds: (_text, start, end) => ({ start, end }) },
    { log() {} }, () => ({ navigation: {}, documentHash: 'd'.repeat(64),
      documentGeneration: 6 }), () => [target]
  );
  const instance = new Class();
  instance.paintNativePage = () => {};
  const rules = {
    broad: { isRegex: true, patterns: ['alpha result'], name: 'Broad' },
    nested: { isRegex: true, patterns: ['result'], name: 'Nested' }
  };
  assert.deepEqual(instance.applyHighlight(rules, 'word'), { broad: 1, nested: 0 });
  assert.equal(instance.nativePdfModes.get('regex-default').items.length, 1);
  outcome = 'degraded';
  assert.deepEqual(instance.applyHighlight(rules, 'word'), { broad: 0, nested: 0 });
  assert.equal(instance.lastNativePdfHighlightDiagnostics.degradedCount, 1);
  outcome = 'unresolved';
  assert.deepEqual(instance.applyHighlight(rules, 'word'), { broad: 0, nested: 0 });
  assert.equal(instance.lastNativePdfHighlightDiagnostics.unresolvedCount, 1);
});

test('LLM and semantic chat wait instead of entering legacy/manual PDF paths', async () => {
  const llmSource = body('function applyNativePdfLlmHighlights(',
    "document.addEventListener('brevess:pdf-page-rendered'");
  const native = { structure: { documentHash: 'e'.repeat(64), paragraphs: [{
    paragraphId: 'pdf-page-1', pageNumber: 1, text: 'legacy result'
  }] }, documentGeneration: 4, resolveSemanticHighlight() {} };
  let paints = 0;
  const llm = new Function('activeNativePdfStructure', 'globalThis',
    'currentNativePdfSemanticHighlightState',
    'refreshActivePdfSemanticNavigationContext', 'pdfSemanticParagraphTargets',
    'clearLlmHighlights', 'SciLLM', 'llmPresentationState',
    'nativePdfLlmHighlightsByMode', 'paintNativePdfLlmPage',
    'addPdfSemanticHighlightDiagnostic', 'isPdfSemanticHighlightLocator',
    'resolvePdfSemanticHighlightFocus', 'createPdfSemanticHighlightLocator',
    'resolvePdfSemanticHighlightLocator', `${llmSource}\nreturn applyNativePdfLlmHighlights;`)(
    () => native.structure, { __brevessNativePdfDocument: native },
    () => ({ required: true, ready: false, context: null }), () => null,
    () => [], () => {}, {
      createBuiltInCategories: () => ({}), resolveAnnotationPresentation: value => value
    }, { density: 'all', hiddenFamilyIds: [] }, new Map(), () => { paints += 1; },
    () => {}, () => false, () => null, () => null, () => null
  );
  const llmResult = llm([{ paragraphId: 'pdf-page-1', start: 0, end: 6,
    quote: 'legacy', categories: [{ categoryId: 'claim' }] }], {
    readingViewId: 'waiting', categories: []
  });
  assert.equal(llmResult.highlightedCount, 0);
  assert.equal(llmResult.waitingForSemantic, true);
  assert.equal(paints, 0);

  const chatSource = body('async function createSemanticAnnotationsFromTurn(',
    'async function runArticleChatTurn(');
  let manualPrepareCalls = 0;
  const chat = new Function('activeNativePdfStructure', 'globalThis',
    'currentNativePdfSemanticHighlightState',
    'refreshActivePdfSemanticNavigationContext', 'manualPreparePromise',
    'prepareManualDocument', 'scheduleArticleWorkspaceArtifactsSave',
    `${chatSource}\nreturn createSemanticAnnotationsFromTurn;`)(
    () => native.structure, { __brevessNativePdfDocument: native },
    () => ({ required: true, ready: false, context: null }), () => null,
    null, async () => { manualPrepareCalls += 1; }, () => {}
  );
  const turn = { turnId: 'chat-wait', intent: 'highlight', answerBlocks: [] };
  assert.equal(await chat(turn), 0);
  assert.equal(turn.waitingForSemantic, true);
  assert.equal(manualPrepareCalls, 0);
});

test('semantic-ready native LLM rebinds legacy page annotations or fails closed', () => {
  const context = semanticFixture(7);
  const target = context.navigation.sections[2].paragraphTargets[0];
  target.expectedNormalizedQuote = 'A unique result supports the conclusion.';
  target.normalizedEnd = target.expectedNormalizedQuote.length;
  const structure = { adapterId: 'pdf-native', documentHash: context.documentHash,
    paragraphs: [{ paragraphId: 'pdf-page-3', pageNumber: 3,
      text: target.expectedNormalizedQuote }] };
  const native = { structure, documentGeneration: 3,
    resolveSemanticHighlight(locator) {
      return { status: 'resolved', ranges: [{ pageNumber: 3, start: 2,
        end: 15, quote: locator.expectedNormalizedQuote, precision: 'exact-raw' }] };
    } };
  const modes = new Map();
  let paints = 0;
  const focusSource = body('function resolvePdfSemanticQuoteFocus(',
    'async function focusPdfSemanticCitationTarget(');
  const llmSource = body('function applyNativePdfLlmHighlights(',
    "document.addEventListener('brevess:pdf-page-rendered'");
  const SciLLM = {
    createBuiltInCategories: () => ({}), resolveAnnotationPresentation: value => value,
    countCanonicalTextMatches(text, quote) {
      return text.split(quote).length - 1;
    },
    findCanonicalQuoteSourceSpan(text, quote) {
      const start = text.indexOf(quote);
      return start < 0 ? null : { sourceStart: start, sourceEnd: start + quote.length };
    }
  };
  const apply = new Function('activeNativePdfStructure', 'globalThis',
    'currentNativePdfSemanticHighlightState', 'refreshActivePdfSemanticNavigationContext',
    'pdfSemanticParagraphTargets', 'clearLlmHighlights', 'SciLLM',
    'llmPresentationState', 'nativePdfLlmHighlightsByMode', 'paintNativePdfLlmPage',
    `${semanticLocatorHelpers()}\n${focusSource}\n${llmSource}\n` +
    'return applyNativePdfLlmHighlights;')(
    () => structure, { __brevessNativePdfDocument: native },
    () => ({ required: true, ready: true, context }), () => context,
    navigation => navigation.sections.flatMap(section => section.paragraphTargets),
    modeId => modes.delete(modeId), SciLLM,
    { density: 'all', hiddenFamilyIds: [] }, modes, () => { paints += 1; }
  );
  const meta = { readingViewId: 'legacy-rebind', categories: [] };
  const success = apply([{ paragraphId: 'pdf-page-3', start: 2, end: 15,
    quote: 'unique result', categories: [{ categoryId: 'claim' }] }], meta);
  assert.equal(success.highlightedCount, 1);
  assert.equal(success.unresolvedCount, 0);
  const rebound = modes.get('legacy-rebind').items[0];
  assert.equal(rebound.locatorKind, 'pdf-semantic');
  assert.equal(rebound.paragraphId, target.paragraphId);
  assert.equal(rebound.locator.revision, 7);
  assert.equal(rebound.pageNumber, undefined, 'semantic-ready path must not store a legacy page offset');
  assert.equal(paints, 1);

  const failed = apply([{ paragraphId: 'pdf-page-3', start: 0, end: 7,
    quote: 'missing', categories: [{ categoryId: 'claim' }] }], meta);
  assert.equal(failed.highlightedCount, 0);
  assert.equal(failed.unresolvedCount, 1);
  assert.deepEqual(failed.counts, {});
  assert.equal(modes.get('legacy-rebind').items.length, 0);
});

test('semantic-ready event actively restores pending regex and LLM once current', () => {
  const eventSource = body("document.addEventListener('brevess:pdf-semantic-ready'",
    "document.addEventListener('brevess:pdf-page-rendered'");
  const listeners = new Map();
  const context = semanticFixture(8);
  const calls = [];
  new Function('document', 'activePdfSemanticNavigationContext',
    'handlePdfSemanticReady', 'rebuildNativePdfSemanticHighlightConsumers',
    'restoreNativePdfSemanticChatHighlights', 'repaintNativePdfSemanticHighlights',
    'restorePendingNativePdfRegexHighlights', 'restorePendingNativePdfLlmHighlights',
    'articleWorkspaceLifecycleGeneration', 'samePdfSemanticNavigationContext',
    'readPdfSemanticNavigationContext', `${eventSource}`)(
    { addEventListener(name, handler) { listeners.set(name, handler); } },
    semanticFixture(7), () => context,
    () => ({ status: 'rebuilt', rebuilds: 1 }), () => {}, () => {},
    () => { calls.push('regex'); return { status: 'applied' }; },
    () => { calls.push('llm'); return { status: 'applied' }; },
    12, (left, right) => left === right, () => context
  );
  listeners.get('brevess:pdf-semantic-ready')();
  assert.deepEqual(calls, ['regex', 'llm']);
});

test('semantic-ready restore prunes stale modes while preserving current restored modes', () => {
  const rebuildSource = body('function rebuildNativePdfSemanticHighlightConsumers(',
    'function restoreNativePdfSemanticChatHighlights(');
  const eventSource = body("document.addEventListener('brevess:pdf-semantic-ready'",
    "document.addEventListener('brevess:pdf-page-rendered'");
  const listeners = new Map();
  const previous = semanticFixture(7);
  const current = semanticFixture(8);
  const live = { context: current };
  const entry = revision => ({ semantic: true, documentHash: current.documentHash,
    documentGeneration: current.documentGeneration, revision,
    semanticCacheKey: `cache-${revision}`,
    semanticProvenanceKey: `provenance-${revision}` });
  const regexModes = new Map([
    ['active-regex', entry(7)], ['old-other', entry(7)]
  ]);
  const llmModes = new Map([
    ['active-llm', entry(7)], ['old-view', entry(7)]
  ]);
  const chatMap = new Map([['chat-1', { revision: 7 }]]);
  const removedRegexLayers = [];
  const removedLlmLayers = [];
  let regexRestoreCalls = 0;
  let llmRestoreCalls = 0;
  let regexResolverCalls = 0;
  let llmResolverCalls = 0;
  let chatRebuilds = 0;
  const highlighter = {
    nativePdfModes: regexModes,
    clearHighlight(modeId) {
      removedRegexLayers.push(modeId);
      regexModes.delete(modeId);
    },
    applyHighlight() {
      regexResolverCalls += 1;
      highlighter.clearHighlight('active-regex');
      regexModes.set('active-regex', entry(8));
      return { result: 1 };
    }
  };
  const dependencies = {
    document: { addEventListener(name, handler) { listeners.set(name, handler); } },
    activePdfSemanticNavigationContext: previous,
    handlePdfSemanticReady: () => current,
    articleWorkspaceLifecycleGeneration: 14,
    samePdfSemanticNavigationContext: (left, right) => left === right,
    readPdfSemanticNavigationContext: () => live.context,
    highlighter,
    lastRegexHighlightRequest: { categories: { result: {} }, mode: 'word',
      analysisModeId: 'active-regex' },
    currentNativePdfSemanticAnalysisScope: () => ({ status: 'ready',
      canonicalParagraphIds: new Set(['pdf-page-2']),
      semanticParagraphIds: new Set(['semantic-methods-8']) }),
    clearLlmHighlights: modeId => {
      if (modeId) {
        removedLlmLayers.push(modeId);
        llmModes.delete(modeId);
      } else {
        [...llmModes.keys()].forEach(id => {
          removedLlmLayers.push(id);
          llmModes.delete(id);
        });
      }
    },
    nativePdfLlmHighlightsByMode: llmModes,
    lastLlmAnalysis: { rawAnalysis: { annotations: [] }, paragraphs: [], threshold: 0.8 },
    renderLlmAnalysis: () => {
      llmResolverCalls += 1;
      dependencies.clearLlmHighlights('active-llm');
      llmModes.set('active-llm', entry(8));
      return { highlightedCount: 1 };
    },
    clearNativePdfSemanticChatHighlights: () => chatMap.clear(),
    articleChatState: { turns: [{ turnId: 'chat-1', intent: 'highlight',
      status: 'completed' }] },
    createSemanticAnnotationsFromTurn: turn => {
      chatRebuilds += 1;
      chatMap.set(turn.turnId, { revision: 8 });
    },
    restoreNativePdfSemanticChatHighlights: () => {},
    repaintNativePdfSemanticHighlights: () => {},
    restorePendingNativePdfRegexHighlights: () => {
      regexRestoreCalls += 1;
      highlighter.applyHighlight();
      return { status: 'applied', restoredModeIds: ['active-regex'] };
    },
    restorePendingNativePdfLlmHighlights: () => {
      llmRestoreCalls += 1;
      dependencies.renderLlmAnalysis();
      return { status: 'applied', restoredModeIds: ['active-llm'] };
    }
  };
  new Function(...Object.keys(dependencies),
    `${rebuildSource}\n${eventSource}`)(...Object.values(dependencies));
  listeners.get('brevess:pdf-semantic-ready')();
  assert.equal(regexRestoreCalls, 1);
  assert.equal(llmRestoreCalls, 1);
  assert.equal(regexResolverCalls, 1);
  assert.equal(llmResolverCalls, 1);
  assert.equal(regexModes.size, 1);
  assert.equal(regexModes.get('active-regex').revision, 8);
  assert.equal(regexModes.has('old-other'), false);
  assert.ok(removedRegexLayers.includes('old-other'));
  assert.equal(llmModes.size, 1);
  assert.equal(llmModes.get('active-llm').revision, 8);
  assert.equal(llmModes.has('old-view'), false);
  assert.ok(removedLlmLayers.includes('old-view'));
  assert.equal(chatRebuilds, 1, 'chat rebuild must remain unchanged');
  assert.equal(chatMap.get('chat-1').revision, 8);
});

test('semantic-ready stops before either current map commits after context drift', () => {
  const eventSource = body("document.addEventListener('brevess:pdf-semantic-ready'",
    "document.addEventListener('brevess:pdf-page-rendered'");
  const listeners = new Map();
  const previous = semanticFixture(7);
  const current = semanticFixture(8);
  const live = { context: current };
  let llmRestoreCalls = 0;
  let rebuildCalls = 0;
  new Function('document', 'activePdfSemanticNavigationContext',
    'handlePdfSemanticReady', 'rebuildNativePdfSemanticHighlightConsumers',
    'restoreNativePdfSemanticChatHighlights', 'repaintNativePdfSemanticHighlights',
    'restorePendingNativePdfRegexHighlights', 'restorePendingNativePdfLlmHighlights',
    'articleWorkspaceLifecycleGeneration', 'samePdfSemanticNavigationContext',
    'readPdfSemanticNavigationContext', `${eventSource}`)(
    { addEventListener(name, handler) { listeners.set(name, handler); } },
    previous, () => current, () => { rebuildCalls += 1; }, () => {}, () => {},
    () => { live.context = semanticFixture(9); return { status: 'waiting' }; },
    () => { llmRestoreCalls += 1; return { status: 'applied' }; },
    14, (left, right) => left === right, () => live.context
  );
  listeners.get('brevess:pdf-semantic-ready')();
  assert.equal(llmRestoreCalls, 0);
  assert.equal(rebuildCalls, 0);
});

test('semantic revision changes rebuild every consumer including an existing chat map', () => {
  const rebuildSource = body('function rebuildNativePdfSemanticHighlightConsumers(',
    'function restoreNativePdfSemanticChatHighlights(');
  const previous = { documentHash: 'f'.repeat(64), documentGeneration: 3,
    revision: 7, semanticCacheKey: 'cache-7', semanticProvenanceKey: 'prov-7' };
  const next = semanticFixture(8);
  const chatMap = new Map([['chat-1', { revision: 7 }]]);
  let regexRebuilds = 0;
  let llmRebuilds = 0;
  let chatRebuilds = 0;
  let llmClears = 0;
  let regexScope = null;
  const regexModes = new Map([['old-regex', { semantic: true, revision: 7 }]]);
  const llmModes = new Map([['old-llm', { items: [{ locator: {
    locatorKind: 'pdf-semantic', revision: 7
  } }] }]]);
  const dependencies = {
    articleWorkspaceLifecycleGeneration: 11,
    samePdfSemanticNavigationContext: (a, b) => a?.revision === b?.revision &&
      a?.semanticCacheKey === b?.semanticCacheKey,
    readPdfSemanticNavigationContext: () => next,
    lastRegexHighlightRequest: { categories: { result: {} }, mode: 'word',
      analysisModeId: 'regex' },
    highlighter: { nativePdfModes: regexModes,
      clearHighlight(modeId) { regexModes.delete(modeId); },
      applyHighlight(_categories, _mode, options) {
        regexRebuilds += 1;
        regexScope = options.semanticAnalysisScope;
        return { result: 1 };
      } },
    currentNativePdfSemanticAnalysisScope: context => createScopeApi(new Map([
      ['outline-intro', false], ['outline-methods', true], ['outline-results', false]
    ])).currentNativePdfSemanticAnalysisScope(context, canonicalScopeSnapshot()),
    lastLlmAnalysis: { rawAnalysis: { annotations: [] }, paragraphs: [], threshold: 0.8 },
    nativePdfLlmHighlightsByMode: llmModes,
    clearLlmHighlights() { llmClears += 1; llmModes.clear(); },
    renderLlmAnalysis() { llmRebuilds += 1; return { highlightedCount: 1 }; },
    nativePdfSemanticChatHighlightsByTurn: chatMap,
    clearNativePdfSemanticChatHighlights() { chatMap.clear(); },
    articleChatState: { turns: [{ turnId: 'chat-1', intent: 'highlight',
      status: 'completed' }] },
    createSemanticAnnotationsFromTurn(turn) {
      chatRebuilds += 1;
      chatMap.set(turn.turnId, { revision: 8 });
    }
  };
  const rebuild = new Function(...Object.keys(dependencies),
    `${rebuildSource}\nreturn rebuildNativePdfSemanticHighlightConsumers;`)(
    ...Object.values(dependencies));
  const result = rebuild(previous, next, 11);
  assert.ok(result.rebuilds > 0);
  assert.equal(regexRebuilds, 1);
  assert.deepEqual([...regexScope.semanticParagraphIds], ['semantic-methods-8']);
  assert.equal(llmRebuilds, 1);
  assert.equal(llmClears, 1);
  assert.equal(regexModes.has('old-regex'), false);
  assert.equal(llmModes.has('old-llm'), false);
  assert.equal(chatRebuilds, 1);
  assert.equal(chatMap.get('chat-1').revision, 8);
});

test('all native PDF semantic consumers use one raw-range projection painter', () => {
  const shared = body('function createPdfSemanticHighlightLocator(',
    'class SciPaperHighlighter');
  assert.match(shared, /resolveSemanticHighlight\(locator\)/);
  assert.match(shared, /result\.ranges/);
  assert.match(shared, /pdfProjectionRange\(textProjection, rawRange, document\)/);
  assert.doesNotMatch(shared,
    /pdfProjectionRange\([^\n]*(normalizedStart|normalizedEnd)/);

  const regex = body('class SciPaperHighlighter',
    '// DOM-independent manual annotation UI helpers: start');
  const llm = body('function paintNativePdfLlmPage(',
    'function applyLlmHighlights(');
  const chat = body('async function createSemanticAnnotationsFromTurn(',
    'async function runArticleChatTurn(');
  for (const consumer of [regex, llm, chat]) {
    assert.match(consumer, /paintPdfSemanticHighlightPage|resolvePdfSemanticHighlightLocator/);
  }
  assert.doesNotMatch(chat, /saveAutomaticAnnotation[\s\S]*locatorKind\s*===\s*'pdf-semantic'/);
});

test('semantic locator persistence is explicit, bounded, and excludes raw geometry', () => {
  const normalizer = body('function normalizeArticleChatEvidence(',
    'function publicArticleChatBlock(');
  for (const field of ['locatorKind', 'documentGeneration', 'revision',
    'semanticCacheKey', 'semanticProvenanceKey', 'normalizedStart',
    'normalizedEnd', 'expectedNormalizedQuote']) {
    assert.match(normalizer, new RegExp(field));
  }
  assert.doesNotMatch(normalizer, /ranges|fallbackPageAnchors|rawText|positionRuns/);

  const publicTurn = body('function publicArticleChatTurn(',
    'function createArticleChatTurn(');
  assert.match(publicTurn, /degradedCount/);
  assert.match(publicTurn, /unresolvedCount/);
  assert.match(publicTurn, /highlightReasonCodes/);
});

test('semantic consumers keep legacy and semantic branches mutually exclusive', () => {
  const regex = body('class SciPaperHighlighter',
    '// DOM-independent manual annotation UI helpers: start');
  const llm = body('function applyNativePdfLlmHighlights(',
    "document.addEventListener('brevess:pdf-page-rendered'");
  assert.match(regex, /locatorKind:\s*'pdf-semantic'/);
  assert.match(regex, /paragraphId\.startsWith\('pdf-page-'\)/);
  assert.match(llm, /semanticCandidate = Boolean\(semanticContext && semanticState\.ready\)/u);
  assert.match(llm, /else[\s\S]*paragraph\.text\.slice/);
});

test('page lifecycle clears every automatic semantic layer and repaint is replacement based', () => {
  const painter = body('function createPdfSemanticHighlightLocator(',
    'class SciPaperHighlighter');
  assert.match(painter, /querySelectorAll\([^)]*layerClass[^)]*\)[\s\S]*layer\.remove/);
  assert.match(source, /brevess:pdf-page-unmounted[\s\S]*pdf-native-semantic-chat-layer/);
  assert.match(source, /brevess:pdf-semantic-ready[\s\S]*repaintNativePdfSemanticHighlights/);
});
