const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const nativeDocument = require('../core/pdf-native-document.js');
require('../core/article-chat-tokenizer.js');
require('../core/article-chat-index.js');
require('../core/article-chat-retrieval.js');
require('../core/article-chat-memory.js');
require('../core/article-chat-citations.js');
require('../core/token-budget.js');
require('../core/article-chat-context-planner.js');
const {
  normalizeArticleChatInput,
  prepareArticleChatRequest,
  compileArticleChatPrompt
} = require('../core/article-chat.js');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

function segment(pageNumber, text, contextHash, overrides = {}) {
  return {
    text,
    pageNumber,
    contextHash,
    documentHash: 'doc-cross-page',
    documentGeneration: 7,
    selectionGeneration: 19,
    ...overrides
  };
}

test('native PDF preparation indexes and verifies every selected page segment', async () => {
  const calls = [];
  const snapshot = {
    structure: {
      documentHash: 'doc-cross-page',
      paragraphs: [{
        paragraphId: 'pdf-page-1', textHash: 'page-one-hash',
        text: 'Alpha precedes the first selected clause and its continuation.'
      }, {
        paragraphId: 'pdf-page-2', textHash: 'page-two-hash',
        text: 'The second page contains the final selected clause and conclusion.'
      }]
    },
    documentGeneration: 7
  };
  const evidence = await nativeDocument.prepareNativePdfSelectionEvidence({
    selection: {
      documentHash: 'doc-cross-page', documentGeneration: 7, selectionGeneration: 19,
      segments: [
        segment(1, 'first selected clause', 'context-1a'),
        segment(1, 'its continuation', 'context-1b'),
        segment(2, 'final selected clause', 'context-2')
      ]
    },
    ensurePageIndexed: async (pageNumber, expected) => {
      calls.push({ pageNumber, ...expected });
    },
    getNativeDocument: () => snapshot
  });

  assert.deepEqual(calls.map(item => item.pageNumber), [1, 2]);
  assert.equal(evidence.text,
    'first selected clause\nits continuation\nfinal selected clause');
  assert.deepEqual(evidence.segments.map(item => item.paragraphId),
    ['pdf-page-1', 'pdf-page-1', 'pdf-page-2']);
  assert.deepEqual(evidence.segments.map(item => item.paragraphTextHash),
    ['page-one-hash', 'page-one-hash', 'page-two-hash']);
  assert.ok(evidence.segments.every(item =>
    item.documentHash === evidence.documentHash &&
    item.documentGeneration === evidence.documentGeneration &&
    item.selectionGeneration === evidence.selectionGeneration));
});

test('multi-page preparation fails closed for mixed identity and absent page quotes', async () => {
  await assert.rejects(() => nativeDocument.prepareNativePdfSelectionEvidence({
    selection: {
      documentHash: 'doc-cross-page', documentGeneration: 7, selectionGeneration: 19,
      segments: [
        segment(1, 'present quote', 'context-1'),
        segment(2, 'mixed document quote', 'context-2', { documentHash: 'other-doc' })
      ]
    },
    ensurePageIndexed: async () => undefined,
    getNativeDocument: () => ({})
  }), error => error?.code === 'INVALID_PDF_SELECTION');

  await assert.rejects(() => nativeDocument.prepareNativePdfSelectionEvidence({
    selection: {
      documentHash: 'doc-cross-page', documentGeneration: 7, selectionGeneration: 19,
      segments: [
        segment(1, 'present quote', 'context-1'),
        segment(2, 'absent quote', 'context-2')
      ]
    },
    ensurePageIndexed: async () => undefined,
    getNativeDocument: () => ({
      structure: {
        documentHash: 'doc-cross-page',
        paragraphs: [
          { paragraphId: 'pdf-page-1', text: 'present quote', textHash: 'p1-hash' },
          { paragraphId: 'pdf-page-2', text: 'different text', textHash: 'p2-hash' }
        ]
      },
      documentGeneration: 7
    })
  }), error => error?.code === 'PDF_SELECTION_EVIDENCE_UNAVAILABLE');
});

test('selection evidence persistence roundtrip keeps canonical segments and rejects unsafe input', () => {
  const selection = {
    documentHash: 'doc-cross-page', documentGeneration: 7, selectionGeneration: 19,
    ignoredCallerField: 'must-not-persist',
    segments: [
      { ...segment(1, 'first selected clause', 'context-1'),
        paragraphTextHash: 'page-one-hash', ignoredSegmentField: true },
      { ...segment(2, 'final selected clause', 'context-2'),
        paragraphTextHash: 'page-two-hash' }
    ]
  };
  const stored = nativeDocument.serializePdfSelectionEvidence(
    selection, 'sha256:doc-cross-page'
  );
  const restored = nativeDocument.serializePdfSelectionEvidence(
    JSON.parse(JSON.stringify(stored)), 'doc-cross-page'
  );
  assert.deepEqual(restored, stored);
  assert.deepEqual(restored.segments.map(item => item.pageNumber), [1, 2]);
  assert.equal('ignoredCallerField' in restored, false);
  assert.equal('ignoredSegmentField' in restored.segments[0], false);

  const legacy = segment(1, 'legacy one-page selection', 'legacy-context', {
    paragraphTextHash: 'page-one-hash'
  });
  const restoredLegacy = nativeDocument.serializePdfSelectionEvidence(
    JSON.parse(JSON.stringify(nativeDocument.serializePdfSelectionEvidence(
      legacy, 'doc-cross-page'
    ))), 'doc-cross-page'
  );
  assert.equal(restoredLegacy.text, legacy.text);
  assert.equal(Array.isArray(restoredLegacy.segments), false);

  assert.throws(() => nativeDocument.serializePdfSelectionEvidence(
    selection, 'other-document'
  ), error => error?.code === 'STALE_PDF_SELECTION');
  assert.throws(() => nativeDocument.serializePdfSelectionEvidence({
    ...selection,
    segments: [selection.segments[0], {
      ...selection.segments[1], documentHash: 'other-document'
    }]
  }, 'doc-cross-page'), error => error?.code === 'INVALID_PDF_SELECTION');
});

test('the production public-turn serializer retains selection evidence across JSON restore', () => {
  const content = read('content.js');
  const start = content.indexOf('function publicArticleChatTurn');
  const end = content.indexOf('function getPublicArticleChatState', start);
  const context = {
    SciLLM: {
      serializePdfSelectionEvidence: nativeDocument.serializePdfSelectionEvidence
    },
    currentManualDocument: null,
    publicArticleChatBlock: block => block,
    normalizeArticleChatWebGroundingForTurn: () => null,
    normalizeArticleChatContextScope: value => value || { sectionIds: [] },
    publicArticleChatPlan: value => value || null,
    __brevessNativePdfDocument: {
      structure: { documentHash: 'doc-cross-page' }
    }
  };
  context.globalThis = context;
  vm.runInNewContext(`${content.slice(start, end)}\nthis.serializeTurn = publicArticleChatTurn;`,
    context);
  const selectionEvidence = {
    documentHash: 'doc-cross-page', documentGeneration: 7, selectionGeneration: 19,
    segments: [
      segment(1, 'first selected clause', 'context-1'),
      segment(2, 'final selected clause', 'context-2')
    ]
  };
  const stored = context.serializeTurn({
    turnId: 'turn-cross-page', question: 'Explain both pages.', status: 'completed',
    selectionEvidence, answerBlocks: [{ blockId: 'b1', markdown: 'answer' }],
    webSearch: { enabled: false }
  });
  const restored = context.serializeTurn(JSON.parse(JSON.stringify(stored)));
  assert.deepEqual(Array.from(restored.selectionEvidence.segments, item => item.pageNumber),
    [1, 2]);
  assert.equal(restored.selectionEvidence.documentHash, 'doc-cross-page');

  context.__brevessNativePdfDocument.structure.documentHash = 'other-document';
  const rejected = context.serializeTurn(JSON.parse(JSON.stringify(stored)));
  assert.equal('selectionEvidence' in rejected, false);
});

test('explicit regeneration rebinds only strictly reverified selection evidence', async () => {
  const oldSelection = {
    documentHash: 'doc-cross-page', documentGeneration: 7, selectionGeneration: 19,
    segments: [
      { ...segment(1, 'first selected clause', 'context-1'),
        paragraphTextHash: 'page-one-hash' },
      { ...segment(2, 'final selected clause', 'context-2'),
        paragraphTextHash: 'page-two-hash' }
    ]
  };
  const snapshot = {
    structure: {
      documentHash: 'doc-cross-page',
      paragraphs: [
        { paragraphId: 'pdf-page-1', textHash: 'page-one-hash',
          text: 'prefix first selected clause suffix' },
        { paragraphId: 'pdf-page-2', textHash: 'page-two-hash',
          text: 'prefix final selected clause suffix' }
      ]
    },
    documentGeneration: 31
  };
  const indexed = [];
  const rebound = await nativeDocument.rebindNativePdfSelectionEvidence({
    selection: oldSelection,
    selectionGeneration: 2,
    ensurePageIndexed: async (pageNumber, expected) => indexed.push({
      pageNumber, ...expected
    }),
    getNativeDocument: () => snapshot
  });
  assert.deepEqual(indexed.map(item => item.pageNumber), [1, 2]);
  assert.equal(rebound.documentGeneration, 31);
  assert.equal(rebound.selectionGeneration, 2);
  assert.deepEqual(rebound.segments.map(item => item.paragraphTextHash),
    ['page-one-hash', 'page-two-hash']);

  await assert.rejects(() => nativeDocument.rebindNativePdfSelectionEvidence({
    selection: oldSelection,
    selectionGeneration: 2,
    ensurePageIndexed: async () => undefined,
    getNativeDocument: () => ({ ...snapshot, structure: {
      ...snapshot.structure, documentHash: 'other-document'
    } })
  }), error => error?.code === 'STALE_PDF_SELECTION');
  await assert.rejects(() => nativeDocument.rebindNativePdfSelectionEvidence({
    selection: oldSelection,
    selectionGeneration: 2,
    ensurePageIndexed: async () => undefined,
    getNativeDocument: () => ({ ...snapshot, structure: {
      ...snapshot.structure,
      paragraphs: snapshot.structure.paragraphs.map(item =>
        item.paragraphId === 'pdf-page-2'
          ? { ...item, textHash: 'changed-page-two-hash' } : item)
    } })
  }), error => error?.code === 'PDF_SELECTION_EVIDENCE_UNAVAILABLE');
});

test('chat planning pins every chunk intersecting every verified selected segment', async () => {
  const pageOne = Array.from({ length: 18 }, (_, index) =>
    `Page one sentence ${index} records mechanism evidence number ${index}.`).join(' ');
  const pageTwo = Array.from({ length: 12 }, (_, index) =>
    `Page two sentence ${index} records outcome evidence number ${index}.`).join(' ');
  const firstStart = pageOne.indexOf('Page one sentence 3');
  const firstText = pageOne.slice(firstStart, pageOne.indexOf('Page one sentence 10'));
  const secondStart = pageTwo.indexOf('Page two sentence 4');
  const secondText = pageTwo.slice(secondStart, pageTwo.indexOf('Page two sentence 8'));
  const selectionEvidence = {
    documentHash: 'doc-cross-page', documentGeneration: 7, selectionGeneration: 19,
    segments: [
      { ...segment(1, firstText, 'context-page-1'), paragraphId: 'pdf-page-1',
        paragraphTextHash: 'page-one-hash' },
      { ...segment(2, secondText, 'context-page-2'), paragraphId: 'pdf-page-2',
        paragraphTextHash: 'page-two-hash' }
    ]
  };
  const input = normalizeArticleChatInput({
    question: 'Explain every selected passage.',
    profileId: 'profile_cross_page',
    history: [],
    selectionEvidence,
    document: {
      title: 'Public PDF', documentHash: 'doc-cross-page', revision: 3,
      paragraphs: [{
        paragraphId: 'pdf-page-1', sourceKey: 'pdf-page-1', textHash: 'page-one-hash',
        sectionId: 'page-1', sectionTitle: 'Page 1', sectionKind: 'main', text: pageOne
      }, {
        paragraphId: 'pdf-page-2', sourceKey: 'pdf-page-2', textHash: 'page-two-hash',
        sectionId: 'page-2', sectionTitle: 'Page 2', sectionKind: 'main', text: pageTwo
      }]
    }
  });
  const prepared = await prepareArticleChatRequest(input, {
    contextWindowTokens: 32768, maxOutputTokens: 4096
  }, { indexOptions: { minChars: 120, targetChars: 140, maxChars: 160 } });

  const plannedIds = new Set(prepared.plan.chunks.map(item => item.chunkId));
  for (const selected of input.selectionEvidence.segments) {
    const paragraph = input.document.typedRecords.find(item =>
      item.paragraphId === selected.paragraphId);
    const start = paragraph.text.indexOf(selected.text);
    const end = start + selected.text.length;
    const intersecting = prepared.index.chunks.filter(chunk =>
      chunk.sourceSpans.some(span => span.paragraphId === selected.paragraphId &&
        span.sourceStart < end && span.sourceEnd > start));
    assert.ok(intersecting.length >= 2, 'fixture must cross an index chunk boundary');
    assert.ok(intersecting.every(chunk => plannedIds.has(chunk.chunkId)),
      'every chunk covering selected text must be required context');
  }
  const prompt = compileArticleChatPrompt(input, prepared.plan);
  assert.deepEqual(input.selectionEvidence.segments.map(item => item.paragraphId),
    ['pdf-page-1', 'pdf-page-2']);
  assert.ok(input.selectionEvidence.segments.every(item =>
    prompt.userPrompt.includes(item.text)));
  assert.match(prompt.systemPrompt,
    /every entry in selected_evidence\.segments.*Do not omit a selected page/is);
});

test('chat rejects one stale paragraph hash without accepting the other selected page', async () => {
  const input = normalizeArticleChatInput({
    question: 'Explain both selections.', profileId: 'profile_cross_page', history: [],
    selectionEvidence: {
      documentHash: 'doc-cross-page', documentGeneration: 7, selectionGeneration: 19,
      segments: [
        { ...segment(1, 'verified one', 'context-1'), paragraphId: 'pdf-page-1',
          paragraphTextHash: 'page-one-hash' },
        { ...segment(2, 'verified two', 'context-2'), paragraphId: 'pdf-page-2',
          paragraphTextHash: 'stale-page-two-hash' }
      ]
    },
    document: {
      documentHash: 'doc-cross-page', revision: 3,
      paragraphs: [
        { paragraphId: 'pdf-page-1', textHash: 'page-one-hash', text: 'verified one' },
        { paragraphId: 'pdf-page-2', textHash: 'page-two-hash', text: 'verified two' }
      ]
    }
  });
  await assert.rejects(() => prepareArticleChatRequest(input, {
    contextWindowTokens: 8192, maxOutputTokens: 2048
  }), error => error?.code === 'PDF_SELECTION_EVIDENCE_UNAVAILABLE');
});

function semanticLocator(overrides = {}) {
  const quote = overrides.expectedNormalizedQuote || 'selected semantic clause';
  const normalizedStart = overrides.normalizedStart ?? 120;
  return {
    locatorKind: 'pdf-semantic',
    documentId: 'sha256:doc-cross-page',
    documentHash: 'doc-cross-page',
    documentGeneration: 7,
    revision: 4,
    semanticCacheKey: 'semantic-cache-4',
    semanticProvenanceKey: 'semantic-provenance-4',
    paragraphId: 'semantic-paragraph-1',
    normalizedStart,
    normalizedEnd: normalizedStart + quote.length,
    expectedNormalizedQuote: quote,
    ...overrides
  };
}

test('semantic PDF selection evidence survives normalization and persistence with its page fallback', () => {
  const locator = semanticLocator();
  const normalized = nativeDocument.normalizePdfSelectionEvidence({
    ...segment(1, locator.expectedNormalizedQuote, 'semantic-context'),
    paragraphId: locator.paragraphId,
    paragraphTextHash: 'semantic-p1-hash',
    semanticLocator: locator,
    pageAnchor: { paragraphId: 'pdf-page-1', pageNumber: 1 }
  });
  const stored = nativeDocument.serializePdfSelectionEvidence(
    normalized, 'doc-cross-page'
  );
  assert.equal(stored.paragraphId, 'semantic-paragraph-1');
  assert.deepEqual(stored.semanticLocator, locator);
  assert.deepEqual(stored.pageAnchor,
    { paragraphId: 'pdf-page-1', pageNumber: 1 });
  assert.notEqual(stored.semanticLocator, locator,
    'persistence result must not retain a caller-owned locator object');
});

test('semantic PDF selection rebinds a unique quote across a revision and rejects duplicates', async () => {
  const locator = semanticLocator();
  const selection = {
    ...segment(1, locator.expectedNormalizedQuote, 'semantic-context'),
    paragraphId: locator.paragraphId,
    paragraphTextHash: 'semantic-p1-hash',
    semanticLocator: locator,
    pageAnchor: { paragraphId: 'pdf-page-1', pageNumber: 1 }
  };
  const nativeSnapshot = {
    structure: { documentHash: 'doc-cross-page', paragraphs: [] },
    documentGeneration: 7
  };
  const semanticContext = {
    documentId: locator.documentId,
    documentHash: locator.documentHash,
    documentGeneration: 7,
    revision: 5,
    semanticCacheKey: 'semantic-cache-5',
    semanticProvenanceKey: 'semantic-provenance-5',
    paragraphs: [{
      paragraphId: 'semantic-paragraph-1',
      normalizedText: `prefix ${locator.expectedNormalizedQuote} suffix`,
      normalizedStart: 100,
      normalizedEnd: 100 + `prefix ${locator.expectedNormalizedQuote} suffix`.length,
      pageNumber: 1,
      legacyParagraphIds: ['pdf-page-1'],
      textHash: 'semantic-p1-current-hash'
    }]
  };
  const rebound = await nativeDocument.rebindNativePdfSelectionEvidence({
    selection,
    selectionGeneration: 20,
    ensurePageIndexed: async () => undefined,
    getNativeDocument: () => nativeSnapshot,
    semanticContext
  });
  assert.equal(rebound.semanticLocator.revision, 5);
  assert.equal(rebound.semanticLocator.normalizedStart, 107);
  assert.equal(rebound.paragraphTextHash, 'semantic-p1-current-hash');

  await assert.rejects(() => nativeDocument.rebindNativePdfSelectionEvidence({
    selection,
    selectionGeneration: 20,
    ensurePageIndexed: async () => undefined,
    getNativeDocument: () => nativeSnapshot,
    semanticContext: {
      ...semanticContext,
      paragraphs: [semanticContext.paragraphs[0], {
        ...semanticContext.paragraphs[0],
        paragraphId: 'semantic-paragraph-2',
        normalizedStart: 500,
        normalizedEnd: 500 + semanticContext.paragraphs[0].normalizedText.length
      }]
    }
  }), error => error?.code === 'PDF_SELECTION_EVIDENCE_UNAVAILABLE');
});

test('semantic selection on a cross-page paragraph rebinds from its continuation page', async () => {
  const locator = semanticLocator({
    expectedNormalizedQuote: 'continuation clause', normalizedStart: 140
  });
  const selection = {
    ...segment(2, locator.expectedNormalizedQuote, 'semantic-page-two-context'),
    paragraphId: locator.paragraphId,
    paragraphTextHash: 'semantic-cross-page-old-hash',
    semanticLocator: locator,
    pageAnchor: { paragraphId: 'pdf-page-2', pageNumber: 2 }
  };
  const nativeSnapshot = {
    structure: { documentHash: 'doc-cross-page', paragraphs: [] },
    documentGeneration: 7
  };
  const normalizedText = 'prefix continuation clause suffix';
  const rebound = await nativeDocument.rebindNativePdfSelectionEvidence({
    selection,
    selectionGeneration: 21,
    ensurePageIndexed: async () => undefined,
    getNativeDocument: () => nativeSnapshot,
    semanticContext: {
      documentId: locator.documentId,
      documentHash: locator.documentHash,
      documentGeneration: 7,
      revision: 5,
      semanticCacheKey: 'semantic-cache-5',
      semanticProvenanceKey: 'semantic-provenance-5',
      paragraphs: [{
        paragraphId: locator.paragraphId,
        normalizedText,
        normalizedStart: 100,
        normalizedEnd: 100 + normalizedText.length,
        pageNumber: 1,
        legacyParagraphIds: ['pdf-page-1', 'pdf-page-2'],
        textHash: 'semantic-cross-page-current-hash'
      }]
    }
  });
  assert.equal(rebound.pageNumber, 2);
  assert.equal(rebound.pageAnchor.pageNumber, 2);
  assert.equal(rebound.semanticLocator.normalizedStart, 107);
  assert.equal(rebound.paragraphTextHash, 'semantic-cross-page-current-hash');
});

test('semantic selection rebind reads the current revision after page indexing completes', async () => {
  const oldLocator = semanticLocator({
    expectedNormalizedQuote: 'current clause', normalizedStart: 40
  });
  const selection = {
    ...segment(1, oldLocator.expectedNormalizedQuote, 'semantic-current-context'),
    paragraphId: oldLocator.paragraphId,
    paragraphTextHash: 'old-hash',
    semanticLocator: oldLocator,
    pageAnchor: { paragraphId: 'pdf-page-1', pageNumber: 1 }
  };
  const nativeSnapshot = {
    structure: { documentHash: 'doc-cross-page', paragraphs: [] },
    documentGeneration: 7
  };
  let indexed = false;
  const currentText = 'prefix current clause suffix';
  const currentContext = {
    documentId: oldLocator.documentId,
    documentHash: oldLocator.documentHash,
    documentGeneration: 7,
    revision: 5,
    semanticCacheKey: 'semantic-cache-5',
    semanticProvenanceKey: 'semantic-provenance-5',
    paragraphs: [{
      paragraphId: oldLocator.paragraphId,
      normalizedText: currentText,
      normalizedStart: 100,
      normalizedEnd: 100 + currentText.length,
      pageNumber: 1,
      legacyParagraphIds: ['pdf-page-1'],
      textHash: 'current-hash'
    }]
  };
  const rebound = await nativeDocument.rebindNativePdfSelectionEvidence({
    selection,
    selectionGeneration: 22,
    ensurePageIndexed: async () => { indexed = true; },
    getNativeDocument: () => nativeSnapshot,
    semanticContext: {
      ...currentContext,
      revision: 4,
      semanticCacheKey: 'semantic-cache-4',
      semanticProvenanceKey: 'semantic-provenance-4'
    },
    getSemanticContext: () => {
      assert.equal(indexed, true);
      return currentContext;
    }
  });
  assert.equal(rebound.semanticLocator.revision, 5);
  assert.equal(rebound.semanticLocator.semanticCacheKey, 'semantic-cache-5');
  assert.equal(rebound.paragraphTextHash, 'current-hash');
});

test('article chat requires the semantic paragraph hash and preserves locator metadata', async () => {
  const locator = semanticLocator();
  const input = normalizeArticleChatInput({
    question: 'Explain this selection.', profileId: 'profile_semantic_pdf', history: [],
    selectionEvidence: {
      ...segment(1, locator.expectedNormalizedQuote, 'semantic-context'),
      paragraphId: locator.paragraphId,
      paragraphTextHash: 'semantic-p1-hash',
      semanticLocator: locator,
      pageAnchor: { paragraphId: 'pdf-page-1', pageNumber: 1 }
    },
    document: {
      documentHash: 'doc-cross-page', revision: 4,
      paragraphs: [{
        paragraphId: locator.paragraphId,
        sourceKey: locator.paragraphId,
        textHash: 'semantic-p1-hash',
        sectionId: 'methods', sectionTitle: 'Methods', sectionKind: 'methods',
        text: `prefix ${locator.expectedNormalizedQuote} suffix`
      }]
    }
  });
  assert.equal(input.selectionEvidence.paragraphId, locator.paragraphId);
  assert.deepEqual(input.selectionEvidence.semanticLocator, locator);
  await assert.doesNotReject(() => prepareArticleChatRequest(input, {
    contextWindowTokens: 8192, maxOutputTokens: 2048
  }));
});

test('content builds every PDF selection segment and injects every selected page', () => {
  const content = read('content.js');
  const actionStart = content.indexOf('async function runManualSelectionLlmAction');
  const actionEnd = content.indexOf('function showManualSelectionToolbar', actionStart);
  const action = content.slice(actionStart, actionEnd);
  const chatStart = content.indexOf('async function runArticleChatTurn');
  const chatEnd = content.indexOf('function scheduleArticleChatPump', chatStart);
  const chat = content.slice(chatStart, chatEnd);

  assert.match(action, /descriptor\?\.anchorSegments/);
  assert.match(action, /segments:\s*pdfSegments/);
  assert.match(action, /segment\?\.anchor\?\.quote/);
  assert.match(action, /ensurePageIndexed/);
  assert.match(chat, /selectionEvidence\?\.segments/);
  assert.match(chat, /selectedEvidenceParagraphs/);
  assert.match(chat, /selectionSegments\.some/);

  const serializerStart = content.indexOf('function publicArticleChatTurn');
  const serializerEnd = content.indexOf('function getPublicArticleChatState', serializerStart);
  const serializer = content.slice(serializerStart, serializerEnd);
  const regenerateStart = content.indexOf('async function regenerateArticleChatTurn');
  const regenerateEnd = content.indexOf('async function clearArticleChat', regenerateStart);
  const regenerate = content.slice(regenerateStart, regenerateEnd);
  assert.match(serializer, /serializePdfSelectionEvidence/);
  assert.match(serializer, /\.\.\.\(selectionEvidence \? \{ selectionEvidence \} : \{\}\)/);
  assert.match(regenerate, /rebindNativePdfSelectionEvidence/);
  assert.match(regenerate, /ensurePageIndexed/);
});
