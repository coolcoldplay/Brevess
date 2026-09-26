const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const citationApi = require('../core/article-chat-citations.js');
const nativeDocumentApi = require('../core/pdf-native-document.js');

const contentPath = path.resolve(__dirname, '../content.js');
const source = fs.readFileSync(contentPath, 'utf8');

function loadHarness() {
  const start = source.indexOf('function pdfSemanticNavigationIdentityMatches(');
  const end = source.indexOf('\nfunction resolveWorkspaceParagraph(', start);
  assert.ok(start >= 0 && end > start, 'semantic content focus coordinator is missing');
  const messages = [];
  const context = vm.createContext({
    console,
    document: { getElementById() { return null; } },
    chrome: { runtime: { sendMessage(message) {
      messages.push(structuredClone(message));
      return Promise.resolve();
    } } },
    articleNavigatorState: { activeTab: 'outline' },
    activeNativePdfStructure: () => null,
    renderArticleNavigator: () => {},
    currentArticleStructure: null,
    SciLLM: {
      normalizePdfSemanticEvidenceLocator(value) {
        return citationApi.normalizePdfSemanticEvidenceLocator(structuredClone(value));
      },
      migratePdfArticleChatEvidence(value, semanticContext) {
        return citationApi.migratePdfArticleChatEvidence(
          structuredClone(value), structuredClone(semanticContext));
      },
      countCanonicalTextMatches(text, quote) {
        return citationApi.countCanonicalTextMatches(String(text), String(quote));
      },
      findCanonicalQuoteSourceSpan(text, quote) {
        return citationApi.findCanonicalQuoteSourceSpan(String(text), String(quote));
      },
      normalizeQuoteTextCanonical(value) {
        return citationApi.normalizeQuoteTextCanonical(String(value));
      },
      normalizePdfSelectionEvidence(value) {
        return nativeDocumentApi.normalizePdfSelectionEvidence(structuredClone(value));
      }
    },
    hashArticleChatParagraphText(value) {
      const source = String(value || '');
      let first = 2166136261;
      let second = 2166136261 ^ 0x9e3779b9;
      for (let index = 0; index < source.length; index += 1) {
        const code = source.charCodeAt(index);
        first = Math.imul(first ^ code, 16777619);
        second = Math.imul(second ^ code, 2246822519);
      }
      return `${(first >>> 0).toString(16).padStart(8, '0')}` +
        `${(second >>> 0).toString(16).padStart(8, '0')}`;
    },
    createPdfSemanticHighlightLocator(target, selection = target) {
      return citationApi.normalizePdfSemanticEvidenceLocator({
        locatorKind: 'pdf-semantic',
        documentId: target.documentId,
        documentHash: target.documentHash,
        documentGeneration: target.documentGeneration,
        revision: target.revision,
        semanticCacheKey: target.semanticCacheKey,
        semanticProvenanceKey: target.semanticProvenanceKey,
        paragraphId: target.paragraphId,
        normalizedStart: selection.normalizedStart,
        normalizedEnd: selection.normalizedEnd,
        expectedNormalizedQuote: selection.expectedNormalizedQuote
      });
    }
  });
  vm.runInContext(`
    let activePdfSemanticNavigationContext = null;
    let pdfSemanticFocusSequence = 0;
    ${source.slice(start, end)}
    globalThis.__semanticHarness = {
      refresh: refreshActivePdfSemanticNavigationContext,
      read: readPdfSemanticNavigationContext,
      focus: focusPdfSemanticNavigationTarget,
      resolveQuote: resolvePdfSemanticQuoteFocus,
      focusCitation: focusPdfSemanticCitationTarget,
      upgradeSelection: upgradePreparedPdfSelectionEvidence,
      response: typeof withCurrentPdfSemanticNavigation === 'function'
        ? withCurrentPdfSemanticNavigation : null,
      semanticReady: typeof handlePdfSemanticReady === 'function'
        ? handlePdfSemanticReady : null,
      active: () => activePdfSemanticNavigationContext
    };
  `, context);
  const showStart = source.indexOf('function showArticleNavigator(');
  const showEnd = source.indexOf('\nfunction renderReviewOutlinePanel(', showStart);
  assert.ok(showStart >= 0 && showEnd > showStart, 'navigator response is missing');
  context.__showSnapshot = Object.freeze({ documentId: 'show-workspace' });
  context.extractCurrentArticleStructure = () => ({
    diagnostics: { warnings: [], headingCount: 1, paragraphCount: 1 },
    publisherFamily: 'pdf-workspace',
    strategy: 'native'
  });
  context.buildArticleWorkspaceSnapshot = () => context.__showSnapshot;
  vm.runInContext(`${source.slice(showStart, showEnd)}
    globalThis.__semanticHarness.showNavigator = showArticleNavigator;`, context);
  context.__semanticMessages = messages;
  return context;
}

function binding(label = 'a', paragraphs = null) {
  const documentHash = label.repeat(64);
  const identity = {
    documentId: `sha256:${documentHash}`,
    documentHash,
    documentGeneration: 3,
    revision: 7,
    semanticCacheKey: `cache-${label}`,
    semanticProvenanceKey: `provenance-${label}`
  };
  const targets = paragraphs || [{
    kind: 'paragraph', ...identity,
    paragraphId: `paragraph-${label}-1`, pageNumber: 1,
    normalizedStart: 0, normalizedEnd: 13,
    expectedNormalizedQuote: 'Alpha result.'
  }];
  const navigation = Object.freeze({
    schemaVersion: 1,
    type: 'pdf-semantic-navigation',
    ...identity,
    sections: Object.freeze([Object.freeze({
      sectionId: `section-${label}`,
      parentSectionId: null,
      title: 'Results',
      level: 1,
      source: 'native-outline',
      pageNumber: 1,
      target: targets[0],
      paragraphTargets: Object.freeze(targets),
      children: Object.freeze([])
    })])
  });
  const createCalls = [];
  const focusCalls = [];
  const pageFocusCalls = [];
  const compatibility = {
    semanticNavigation: navigation,
    createNativeFocusRequest(paragraphId, start, end, expectedQuote) {
      createCalls.push({ paragraphId, start, end, expectedQuote });
      return Object.freeze({
        schemaVersion: 1,
        type: 'pdf-native-focus-request',
        mode: 'ranges',
        ...identity,
        paragraphId,
        pageNumber: 1,
        precision: 'exact-raw',
        ranges: Object.freeze([])
      });
    }
  };
  const native = {
    structure: { adapterId: 'pdf-native', documentId: identity.documentId,
      documentHash, paragraphs: [{ paragraphId: 'pdf-page-1', text: 'legacy' }] },
    documentGeneration: identity.documentGeneration,
    getSemanticNavigation() { return navigation; },
    async focusSemanticTarget(target, selection) {
      focusCalls.push({ target, selection });
      return Object.freeze({ focused: true,
        focusedGranularity: selection ? 'sentence' : 'paragraph',
        precision: 'exact-raw', reasonCode: '', pageNumber: target.pageNumber });
    }
    ,
    async focusPage(pageNumber) {
      pageFocusCalls.push(pageNumber);
      return true;
    }
  };
  const bridge = {
    command(name, ...args) {
      assert.equal(name, 'focusSemanticTarget');
      return native.focusSemanticTarget(...args);
    }
  };
  return { identity, targets, navigation, compatibility, native, bridge,
    createCalls, focusCalls, pageFocusCalls };
}

function install(context, value) {
  context.__brevessPdfSemanticCompatibility = value.compatibility;
  context.__brevessNativePdfDocument = value.native;
  context.__brevessPdfReaderBridge = value.bridge;
}

test('semantic navigation context is independent from legacy article structure and caches', () => {
  assert.match(source, /let activePdfSemanticNavigationContext = null/);
  const eventStart = source.indexOf("document.addEventListener('brevess:pdf-semantic-ready'");
  const eventEnd = source.indexOf('\n});', eventStart) + 4;
  assert.ok(eventStart >= 0 && eventEnd > eventStart);
  const eventBody = source.slice(eventStart, eventEnd);
  assert.match(eventBody, /handlePdfSemanticReady/);
  assert.doesNotMatch(eventBody,
    /currentArticleStructure\s*=|canonicalArticleSnapshotCache\s*=|__brevessNativePdfDocument\.structure\s*=/);
  const coordinatorStart = source.indexOf('function pdfSemanticNavigationIdentityMatches(');
  const coordinatorEnd = source.indexOf('\nfunction resolveWorkspaceParagraph(', coordinatorStart);
  const coordinator = source.slice(coordinatorStart, coordinatorEnd);
  assert.match(coordinator, /getSemanticNavigation/);
  assert.match(coordinator, /focusSemanticTarget/);
  assert.doesNotMatch(coordinator,
    /__brevessPdfSemanticCompatibility|createNativeFocusRequest|__brevessPdfReaderBridge/);
});

test('fresh PDF selection upgrades to a full semantic locator on the same page', () => {
  const context = loadHarness();
  const base = binding('s');
  const paragraphText = 'Alpha selected clause omega.';
  const target = {
    kind: 'paragraph', ...base.identity,
    paragraphId: 'paragraph-s-selection', pageNumber: 1,
    normalizedStart: 100,
    normalizedEnd: 100 + paragraphText.length,
    expectedNormalizedQuote: paragraphText
  };
  const value = binding('s', [target]);
  install(context, value);
  const result = context.__semanticHarness.upgradeSelection({
    text: 'selected clause', pageNumber: 1, paragraphId: 'pdf-page-1',
    contextHash: 'context-s', documentHash: value.identity.documentHash,
    documentGeneration: value.identity.documentGeneration, selectionGeneration: 9,
    paragraphTextHash: 'legacy-page-hash'
  });
  assert.equal(result.paragraphId, target.paragraphId);
  assert.equal(result.semanticLocator.expectedNormalizedQuote, 'selected clause');
  assert.equal(result.semanticLocator.normalizedStart, 106);
  assert.deepEqual(result.pageAnchor, { paragraphId: 'pdf-page-1', pageNumber: 1 });
  assert.equal(result.paragraphTextHash,
    context.hashArticleChatParagraphText(paragraphText));
});

test('fresh PDF selection splits one page-spanning phrase into exact semantic paragraph locators', () => {
  const context = loadHarness();
  const base = binding('t');
  const firstText = 'First selected';
  const secondText = 'clause second';
  const value = binding('t', [{
    kind: 'paragraph', ...base.identity,
    paragraphId: 'paragraph-t-1', pageNumber: 1,
    normalizedStart: 10, normalizedEnd: 10 + firstText.length,
    expectedNormalizedQuote: firstText
  }, {
    kind: 'paragraph', ...base.identity,
    paragraphId: 'paragraph-t-2', pageNumber: 1,
    normalizedStart: 100, normalizedEnd: 100 + secondText.length,
    expectedNormalizedQuote: secondText
  }]);
  install(context, value);
  const result = context.__semanticHarness.upgradeSelection({
    text: 'selected clause', pageNumber: 1, paragraphId: 'pdf-page-1',
    contextHash: 'context-t', documentHash: value.identity.documentHash,
    documentGeneration: value.identity.documentGeneration, selectionGeneration: 10,
    paragraphTextHash: 'legacy-page-hash'
  });
  assert.equal(result.segments.length, 2);
  assert.deepEqual(Array.from(result.segments, item => item.paragraphId),
    ['paragraph-t-1', 'paragraph-t-2']);
  assert.deepEqual(Array.from(result.segments, item => item.text), ['selected', 'clause']);
});

test('fresh selection on the continuation page binds to a cross-page semantic paragraph', () => {
  const context = loadHarness();
  const base = binding('v');
  const paragraphText = 'Cross page paragraph continues on page two.';
  const target = {
    kind: 'paragraph', ...base.identity,
    paragraphId: 'paragraph-v-cross-page', pageNumber: 1, pageNumbers: [1, 2],
    normalizedStart: 50, normalizedEnd: 50 + paragraphText.length,
    expectedNormalizedQuote: paragraphText
  };
  const value = binding('v', [target]);
  install(context, value);
  const result = context.__semanticHarness.upgradeSelection({
    text: 'continues on page two', pageNumber: 2, paragraphId: 'pdf-page-2',
    contextHash: 'context-v', documentHash: value.identity.documentHash,
    documentGeneration: value.identity.documentGeneration, selectionGeneration: 12,
    paragraphTextHash: 'legacy-page-two-hash'
  });
  assert.equal(result.paragraphId, target.paragraphId);
  assert.equal(result.semanticLocator.expectedNormalizedQuote, 'continues on page two.');
  assert.deepEqual(result.pageAnchor, { paragraphId: 'pdf-page-2', pageNumber: 2 });
});

test('saved citation anchors to the first resolved raw page of a cross-page paragraph', () => {
  const start = source.indexOf('function attachArticleChatEvidenceIdentity(');
  const end = source.indexOf('\n/* Legacy flat-message workflow', start);
  assert.ok(start >= 0 && end > start);
  const identity = binding('w').identity;
  const target = {
    kind: 'paragraph', ...identity,
    paragraphId: 'paragraph-w-cross-page', pageNumber: 1, pageNumbers: [1, 2],
    normalizedStart: 20, normalizedEnd: 50,
    expectedNormalizedQuote: 'cross-page semantic paragraph'
  };
  const sandbox = {
    refreshActivePdfSemanticNavigationContext: () => ({ ...identity }),
    globalThis: { __brevessNativePdfDocument: { resolveSemanticHighlight() {} } },
    resolvePdfSemanticHighlightFocus: () => ({
      target,
      selection: {
        normalizedStart: 31,
        normalizedEnd: 50,
        expectedNormalizedQuote: 'semantic paragraph'
      },
      candidateCount: 1
    }),
    createPdfSemanticHighlightLocator: (_target, selection) => ({
      locatorKind: 'pdf-semantic', ...identity,
      paragraphId: target.paragraphId,
      normalizedStart: selection.normalizedStart,
      normalizedEnd: selection.normalizedEnd,
      expectedNormalizedQuote: selection.expectedNormalizedQuote
    }),
    resolvePdfSemanticHighlightLocator: () => ({
      status: 'resolved', precision: 'exact-raw',
      ranges: [{ pageNumber: 2, start: 4, end: 22, quote: 'semantic paragraph' }]
    }),
    SciLLM: { verifyArticleChatEvidence() { throw new Error('legacy path used'); } }
  };
  const attach = new Function(...Object.keys(sandbox),
    `${source.slice(start, end)}\nreturn attachArticleChatEvidenceIdentity;`)(
    ...Object.values(sandbox));
  const [saved] = attach([{ quote: 'semantic paragraph' }], {});
  assert.deepEqual(saved.pageAnchor, { paragraphId: 'pdf-page-2', pageNumber: 2 });
  assert.equal(saved.verificationStatus, 'verified');
});

test('fresh PDF selection rejects a repeated quote instead of guessing a semantic paragraph', () => {
  const context = loadHarness();
  const base = binding('u');
  const quote = 'Repeated clause';
  const value = binding('u', [0, 100].map((start, index) => ({
    kind: 'paragraph', ...base.identity,
    paragraphId: `paragraph-u-${index + 1}`, pageNumber: 1,
    normalizedStart: start, normalizedEnd: start + quote.length,
    expectedNormalizedQuote: quote
  })));
  install(context, value);
  assert.throws(() => context.__semanticHarness.upgradeSelection({
    text: quote, pageNumber: 1, paragraphId: 'pdf-page-1',
    contextHash: 'context-u', documentHash: value.identity.documentHash,
    documentGeneration: value.identity.documentGeneration, selectionGeneration: 11,
    paragraphTextHash: 'legacy-page-hash'
  }), error => error?.code === 'PDF_SELECTION_SEMANTIC_AMBIGUOUS');
});

test('workspace responses expose current semantic navigation as a non-persistent sibling', () => {
  const context = loadHarness();
  const value = binding('a');
  install(context, value);
  const snapshot = Object.freeze({ documentId: 'workspace-a', nodes: Object.freeze([]) });
  const before = JSON.stringify(snapshot);
  assert.equal(typeof context.__semanticHarness.response, 'function');
  const response = context.__semanticHarness.response({ success: true, snapshot });
  assert.equal(response.snapshot, snapshot);
  assert.equal(response.pdfSemanticNavigation, value.navigation);
  assert.equal(JSON.stringify(snapshot), before);
  assert.doesNotThrow(() => structuredClone(response));

  const actionStart = source.indexOf("request.action === 'getArticleWorkspaceSnapshot'");
  const actionEnd = source.indexOf("request.action === 'getArticleAbbreviations'", actionStart);
  assert.match(source.slice(actionStart, actionEnd), /withCurrentPdfSemanticNavigation/);
  const showStart = source.indexOf('function showArticleNavigator(');
  const showEnd = source.indexOf('\nfunction renderReviewOutlinePanel(', showStart);
  assert.match(source.slice(showStart, showEnd), /withCurrentPdfSemanticNavigation/);
  const shown = context.__semanticHarness.showNavigator({ tab: 'outline' });
  assert.equal(shown.success, true);
  assert.equal(shown.snapshot, context.__showSnapshot);
  assert.equal(shown.pdfSemanticNavigation, value.navigation);
  assert.doesNotThrow(() => structuredClone(shown));
});

test('HTML and legacy PDF workspace responses keep snapshots unchanged and expose no semantic data', () => {
  const context = loadHarness();
  const snapshot = { documentId: 'html-workspace', paragraphs: [{ text: 'HTML remains legacy' }] };
  assert.equal(typeof context.__semanticHarness.response, 'function');
  const html = context.__semanticHarness.response({ success: true, snapshot });
  assert.equal(html.snapshot, snapshot);
  assert.equal(html.pdfSemanticNavigation, null);

  const legacy = binding('a');
  legacy.native.getSemanticNavigation = () => null;
  install(context, legacy);
  const pdf = context.__semanticHarness.response({ success: true, snapshot });
  assert.equal(pdf.snapshot, snapshot);
  assert.equal(pdf.pdfSemanticNavigation, null);
  assert.equal(snapshot.paragraphs[0].text, 'HTML remains legacy');
});

test('workspace response rejects replaced or cleared semantic generations', () => {
  const context = loadHarness();
  const oldBinding = binding('a');
  const nextBinding = binding('b');
  install(context, oldBinding);
  assert.equal(context.__semanticHarness.response({}).pdfSemanticNavigation,
    oldBinding.navigation);
  install(context, nextBinding);
  assert.equal(context.__semanticHarness.response({}).pdfSemanticNavigation,
    nextBinding.navigation);
  assert.notEqual(context.__semanticHarness.response({}).pdfSemanticNavigation,
    oldBinding.navigation);
  context.__brevessNativePdfDocument = undefined;
  assert.equal(context.__semanticHarness.response({}).pdfSemanticNavigation, null);
});

test('semantic-ready notifies only real current context changes with identity and coverage', () => {
  const context = loadHarness();
  const oldBinding = binding('a');
  const nextBinding = binding('b');
  install(context, oldBinding);
  assert.equal(typeof context.__semanticHarness.semanticReady, 'function');
  context.__semanticHarness.semanticReady();
  context.__semanticHarness.semanticReady();
  assert.equal(context.__semanticMessages.length, 1);
  const first = context.__semanticMessages[0];
  assert.deepEqual(Object.keys(first).sort(), [
    'coverage', 'documentGeneration', 'documentHash', 'documentId', 'revision',
    'semanticCacheKey', 'semanticProvenanceKey', 'type'
  ]);
  assert.equal(first.type, 'ARTICLE_STRUCTURE_CHANGED');
  assert.equal(first.documentHash, oldBinding.identity.documentHash);
  assert.deepEqual(first.coverage,
    { sectionCount: 1, paragraphCount: 1, pageCount: 1 });
  assert.doesNotThrow(() => structuredClone(first));
  assert.doesNotMatch(JSON.stringify(first), /Alpha result|expectedNormalizedQuote|sections/);

  install(context, nextBinding);
  context.__semanticHarness.semanticReady();
  context.__semanticHarness.semanticReady();
  assert.equal(context.__semanticMessages.length, 2,
    'a repeated or stale ready event must not republish the current revision');
  assert.equal(context.__semanticMessages[1].documentHash, nextBinding.identity.documentHash);

  context.__brevessNativePdfDocument = undefined;
  context.__semanticHarness.semanticReady();
  context.__semanticHarness.semanticReady();
  assert.equal(context.__semanticMessages.length, 3);
  assert.equal(context.__semanticMessages[2].revision, 0);
  assert.deepEqual(context.__semanticMessages[2].coverage,
    { sectionCount: 0, paragraphCount: 0, pageCount: 0 });
});

test('semantic-ready coverage counts continuation pages of cross-page paragraphs', () => {
  const context = loadHarness();
  const base = binding('x');
  const text = 'paragraph spanning two pages';
  const value = binding('x', [{
    kind: 'paragraph', ...base.identity,
    paragraphId: 'paragraph-x-cross-page', pageNumber: 1, pageNumbers: [1, 2],
    normalizedStart: 0, normalizedEnd: text.length,
    expectedNormalizedQuote: text
  }]);
  install(context, value);
  context.__semanticHarness.semanticReady();
  assert.equal(context.__semanticMessages.length, 1);
  assert.deepEqual(context.__semanticMessages[0].coverage,
    { sectionCount: 1, paragraphCount: 1, pageCount: 2 });
});

test('legacy PDF without semantic publication remains on the old navigation path', async () => {
  const context = loadHarness();
  const result = await context.__semanticHarness.focus({ paragraphId: 'missing' });
  assert.equal(context.__semanticHarness.read(), null);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    focused: false,
    focusedGranularity: 'none',
    precision: 'none',
    reasonCode: 'PDF_SEMANTIC_UNAVAILABLE',
    pageNumber: null
  });
});

test('document replacement before request creation rejects the old semantic target', async () => {
  const context = loadHarness();
  const oldBinding = binding('a');
  const nextBinding = binding('b');
  install(context, oldBinding);
  context.__semanticHarness.refresh();
  install(context, nextBinding);
  const result = await context.__semanticHarness.focus(oldBinding.targets[0]);
  assert.equal(result.focused, false);
  assert.equal(result.reasonCode, 'PDF_FOCUS_STALE');
  assert.equal(oldBinding.createCalls.length, 0);
  assert.equal(nextBinding.focusCalls.length, 0);
});

test('revoked private semantic owner before focus dispatch never invokes the native focus wrapper', async () => {
  const context = loadHarness();
  const oldBinding = binding('a');
  install(context, oldBinding);
  context.__semanticHarness.refresh();
  oldBinding.native.getSemanticNavigation = () => null;
  const result = await context.__semanticHarness.focus(oldBinding.targets[0]);
  assert.equal(result.focused, false);
  assert.equal(result.reasonCode, 'PDF_FOCUS_STALE');
  assert.equal(oldBinding.focusCalls.length, 0);
});

test('semantic focus uses the captured native wrapper and ignores a forged bridge', async () => {
  const context = loadHarness();
  const value = binding('a');
  let bridgeCalls = 0;
  let bridgeReader = { pageNumber: 999 };
  value.bridge.command = () => {
    bridgeCalls += 1;
    return { focused: true, focusedGranularity: 'page',
      precision: 'forged', reasonCode: '', pageNumber: bridgeReader.pageNumber };
  };
  install(context, value);
  context.__semanticHarness.refresh();
  bridgeReader = { pageNumber: 777 };
  const result = await context.__semanticHarness.focus(value.targets[0]);
  assert.equal(bridgeCalls, 0);
  assert.equal(value.focusCalls.length, 1);
  assert.equal(result.focused, true);
  assert.equal(result.focusedGranularity, 'paragraph');
  assert.equal(result.precision, 'exact-raw');
  assert.equal(result.pageNumber, 1);
});

test('semantic navigation and focus do not require a reader bridge', async () => {
  const context = loadHarness();
  const value = binding('a');
  install(context, value);
  context.__brevessPdfReaderBridge = undefined;
  assert.ok(context.__semanticHarness.read());
  const result = await context.__semanticHarness.focus(value.targets[0]);
  assert.equal(result.focused, true);
  assert.equal(value.focusCalls.length, 1);
});

test('document replacement while native focus awaits cannot report success for the old document', async () => {
  const context = loadHarness();
  const oldBinding = binding('a');
  const nextBinding = binding('b');
  let release;
  oldBinding.native.focusSemanticTarget = (target, selection) => {
    oldBinding.focusCalls.push({ target, selection });
    return new Promise(resolve => { release = resolve; });
  };
  install(context, oldBinding);
  context.__semanticHarness.refresh();
  const pending = context.__semanticHarness.focus(oldBinding.targets[0]);
  await Promise.resolve();
  install(context, nextBinding);
  release({ focused: true, focusedGranularity: 'sentence',
    precision: 'exact-raw', reasonCode: '', pageNumber: 1 });
  const result = await pending;
  assert.equal(result.focused, false);
  assert.equal(result.reasonCode, 'PDF_FOCUS_STALE');
  assert.equal(nextBinding.focusCalls.length, 0);
});

test('two consecutive semantic clicks publish only the later result', async () => {
  const context = loadHarness();
  const value = binding('a');
  const releases = [];
  value.native.focusSemanticTarget = (target, selection) => {
    value.focusCalls.push({ target, selection });
    return new Promise(resolve => releases.push(resolve));
  };
  install(context, value);
  context.__semanticHarness.refresh();
  const first = context.__semanticHarness.focus(value.targets[0]);
  const second = context.__semanticHarness.focus(value.targets[0]);
  releases[1]({ focused: true, focusedGranularity: 'paragraph',
    precision: 'exact-raw', reasonCode: '', pageNumber: 1 });
  assert.equal((await second).focused, true);
  releases[0]({ focused: true, focusedGranularity: 'paragraph',
    precision: 'exact-raw', reasonCode: '', pageNumber: 1 });
  const superseded = await first;
  assert.equal(superseded.focused, false);
  assert.equal(superseded.reasonCode, 'PDF_FOCUS_SUPERSEDED');
});

test('semantic quote resolution uses trusted offsets and never chooses the first duplicate', () => {
  const first = { ...binding('a').targets[0], paragraphId: 'repeat-one',
    normalizedEnd: 'Same. Same. Tail'.length,
    expectedNormalizedQuote: 'Same. Same. Tail' };
  const second = { ...first, paragraphId: 'repeat-two', pageNumber: 2 };
  const context = loadHarness();
  const value = binding('a', [first, second]);
  install(context, value);
  const active = context.__semanticHarness.refresh();
  const trusted = context.__semanticHarness.resolveQuote({
    paragraphId: 'repeat-one', quote: 'Same.',
    normalizedStart: 6, normalizedEnd: 11
  }, active);
  assert.equal(trusted.target.paragraphId, 'repeat-one');
  assert.deepEqual(JSON.parse(JSON.stringify(trusted.selection)), {
    normalizedStart: 6, normalizedEnd: 11, expectedNormalizedQuote: 'Same.'
  });
  const repeatedInsideParagraph = context.__semanticHarness.resolveQuote({
    paragraphId: 'repeat-one', quote: 'Same.'
  }, active);
  assert.equal(repeatedInsideParagraph.target.paragraphId, 'repeat-one');
  assert.equal(repeatedInsideParagraph.selection, null);
  assert.equal(repeatedInsideParagraph.reasonCode, 'PDF_FOCUS_QUOTE_REPEATED_IN_PARAGRAPH');
  const repeatedAcrossParagraphs = context.__semanticHarness.resolveQuote({ quote: 'Same.' }, active);
  assert.equal(repeatedAcrossParagraphs.target, null);
  assert.equal(repeatedAcrossParagraphs.reasonCode, 'PDF_FOCUS_QUOTE_AMBIGUOUS');
  const forgedPage = context.__semanticHarness.resolveQuote({ quote: 'Same.', pageNumber: 2 }, active);
  assert.equal(forgedPage.target, null);
  assert.equal(forgedPage.reasonCode, 'PDF_FOCUS_QUOTE_AMBIGUOUS');
});

test('unique semantic citation focus forwards an exact normalized selection asynchronously', async () => {
  const target = { ...binding('a').targets[0],
    normalizedEnd: 'Alpha unique result. End'.length,
    expectedNormalizedQuote: 'Alpha unique result. End' };
  const context = loadHarness();
  const value = binding('a', [target]);
  install(context, value);
  context.__semanticHarness.refresh();
  const pending = context.__semanticHarness.focusCitation({ quote: 'unique result.' });
  assert.equal(typeof pending?.then, 'function');
  const result = await pending;
  assert.equal(result.focused, true);
  assert.equal(result.focusedGranularity, 'sentence');
  assert.deepEqual(JSON.parse(JSON.stringify(value.focusCalls[0].selection)), {
    normalizedStart: 6,
    normalizedEnd: 20,
    expectedNormalizedQuote: 'unique result.'
  });
  assert.doesNotThrow(() => structuredClone(result));
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /createNativeFocusRequest|focusSemanticTarget|ranges|rawText|positionRuns/);
});

test('saved semantic citation uses its full locator to disambiguate duplicate quotes', async () => {
  const base = binding('a');
  const first = { ...base.targets[0], paragraphId: 'duplicate-first',
    normalizedStart: 0, normalizedEnd: 5, expectedNormalizedQuote: 'Same.' };
  const second = { ...base.targets[0], paragraphId: 'duplicate-second', pageNumber: 2,
    normalizedStart: 20, normalizedEnd: 25, expectedNormalizedQuote: 'Same.' };
  const context = loadHarness();
  const value = binding('a', [first, second]);
  install(context, value);
  context.__semanticHarness.refresh();
  const result = await context.__semanticHarness.focusCitation({
    locatorKind: 'pdf-semantic', ...value.identity,
    paragraphId: second.paragraphId,
    normalizedStart: second.normalizedStart,
    normalizedEnd: second.normalizedEnd,
    expectedNormalizedQuote: second.expectedNormalizedQuote,
    pageAnchor: { paragraphId: 'pdf-page-2', pageNumber: 2 }
  });
  assert.equal(result.focused, true);
  assert.equal(result.matchMethod, 'semantic-locator');
  assert.equal(value.focusCalls.length, 1);
  assert.equal(value.focusCalls[0].target.paragraphId, 'duplicate-second');
  assert.equal(value.pageFocusCalls.length, 0);
});

test('saved semantic citation rejects document replacement before any focus side effect', async () => {
  const context = loadHarness();
  const current = binding('b');
  install(context, current);
  context.__semanticHarness.refresh();
  const oldHash = 'a'.repeat(64);
  const result = await context.__semanticHarness.focusCitation({
    locatorKind: 'pdf-semantic',
    documentId: `sha256:${oldHash}`,
    documentHash: oldHash,
    documentGeneration: 3,
    revision: 7,
    semanticCacheKey: 'cache-a',
    semanticProvenanceKey: 'provenance-a',
    paragraphId: 'paragraph-a-1',
    normalizedStart: 0,
    normalizedEnd: 13,
    expectedNormalizedQuote: 'Alpha result.',
    pageAnchor: { paragraphId: 'pdf-page-1', pageNumber: 1 }
  });
  assert.equal(result.focused, false);
  assert.equal(result.migrationStatus, 'stale');
  assert.equal(result.degradedReasonCode, 'PDF_DOCUMENT_CHANGED');
  assert.equal(current.focusCalls.length, 0);
  assert.equal(current.pageFocusCalls.length, 0);
});

test('legacy PDF citation remains usable only as an explicit page-level focus', async () => {
  const context = loadHarness();
  const value = binding('a');
  install(context, value);
  context.__semanticHarness.refresh();
  const result = await context.__semanticHarness.focusCitation({
    paragraphId: 'pdf-page-1',
    pageNumber: 1,
    quote: 'Alpha result.',
    pageAnchor: { paragraphId: 'pdf-page-1', pageNumber: 1 }
  });
  assert.equal(result.focused, true);
  assert.equal(result.focusedGranularity, 'page');
  assert.equal(result.precision, 'page-only');
  assert.equal(result.migrationStatus, 'degraded');
  assert.equal(value.pageFocusCalls.length, 1);
  assert.equal(value.focusCalls.length, 0,
    'a legacy candidate must not be silently promoted to sentence focus');
});

test('workspace focus message awaits async results and keeps the response channel open', () => {
  assert.match(source, /async function verifyAndFocusArticleChatCitation\(/);
  assert.match(source, /async function focusArticleWorkspaceSource\(/);
  const actionStart = source.indexOf("request.action === 'focusArticleWorkspaceSource'");
  const actionEnd = source.indexOf("request.action === 'armSidePanelRestore'", actionStart);
  const action = source.slice(actionStart, actionEnd);
  assert.match(action, /focusArticleWorkspaceSource\(request\.target \|\| \{\}\)\s*\.then/);
  assert.match(action, /sendResponse/);
  assert.match(source.slice(actionStart), /return true; \/\/ 保持消息通道开放/);
});

test('open semantic outline renders async focus controls with pending and diagnostic states', () => {
  const renderStart = source.indexOf('function renderPdfSemanticOutline(');
  const renderEnd = source.indexOf('\nfunction renderArticleOutline(', renderStart);
  assert.ok(renderStart >= 0 && renderEnd > renderStart);
  const renderer = source.slice(renderStart, renderEnd);
  assert.match(renderer, /semanticFocusState = 'pending'/);
  assert.match(renderer, /await focusPdfSemanticNavigationTarget/);
  assert.match(renderer, /semanticFocusReason/);
  assert.doesNotMatch(renderer, /button\.disabled = true/,
    'pending diagnostics must not suppress a later click');
  assert.doesNotMatch(renderer, /createNativeFocusRequest|__brevessPdfSemanticCompatibility/);
  const navigatorStart = source.indexOf('function renderArticleNavigator(');
  const navigatorEnd = source.indexOf('\nfunction showArticleNavigator(', navigatorStart);
  const navigator = source.slice(navigatorStart, navigatorEnd);
  assert.match(navigator, /refreshActivePdfSemanticNavigationContext/);
  assert.match(navigator, /renderPdfSemanticOutline/);
});

test('HTML paragraph and figure focus branches remain present and do not use semantic wrappers', () => {
  const start = source.indexOf('async function focusArticleWorkspaceSource(');
  const end = source.indexOf('\nfunction focusHighlightOccurrence', start);
  const body = source.slice(start, end);
  assert.match(body, /target\.kind === 'figure'/);
  assert.match(body, /findFigureAnalysisTarget/);
  assert.match(body, /target\.kind === 'paragraph'/);
  assert.match(body, /focusArticleSourceQuote/);
  assert.match(body, /focusArticleSource\(/);
});
