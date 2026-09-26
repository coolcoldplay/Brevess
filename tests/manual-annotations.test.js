const test = require('node:test');
const assert = require('node:assert/strict');

require('../core/category-store.js');
require('../core/adaptive-catalog.js');
require('../core/tab-activation.js');
const {
  MAX_NOTE_LENGTH,
  WARNING_ANNOTATIONS_PER_DOCUMENT,
  MAX_ANNOTATIONS_PER_DOCUMENT,
  createDocumentId,
  normalizeManualAnnotation,
  normalizeDocumentRecord,
  locateAnnotationInBlocks,
  makeCategorySnapshot,
  sameManualAnnotationRefreshIdentity,
  manualAnnotationRefreshCommitMode,
  manualAnnotationEventCommitMode
} = require('../core/manual-annotations.js');

function annotation(overrides = {}) {
  return {
    annotationId: 'annotation-1',
    categoryId: 'result',
    quote: 'Treatment improved survival.',
    prefix: 'In this cohort, ',
    suffix: ' The effect was robust.',
    sectionTitle: 'Results',
    blockFingerprint: 'block-old',
    startOffset: 16,
    endOffset: 44,
    note: 'Primary outcome',
    categorySnapshot: { name: '结果陈述', color: '#FFE66D' },
    status: 'located',
    createdAt: '2026-07-15T00:00:00.000Z',
    updatedAt: '2026-07-15T00:00:00.000Z',
    ...overrides
  };
}

test('manual summary refresh accepts the event state committed by its own prepare request', () => {
  const identity = {
    tabId: 41,
    documentId: `sha256:${'a'.repeat(64)}`,
    documentHash: `sha256:${'b'.repeat(64)}`,
    canonicalUrl: 'https://example.test/article',
    contentWorldNonce: '1'.repeat(32),
    documentEpoch: 7
  };

  assert.equal(sameManualAnnotationRefreshIdentity(identity, identity, 41), true);
});

test('manual summary refresh rejects foreign, stale, incomplete, and null event state', () => {
  const response = {
    documentId: `sha256:${'a'.repeat(64)}`,
    documentHash: `sha256:${'b'.repeat(64)}`,
    canonicalUrl: 'https://example.test/article',
    contentWorldNonce: '1'.repeat(32),
    documentEpoch: 7
  };
  const committed = { tabId: 41, ...response };

  assert.equal(sameManualAnnotationRefreshIdentity({ ...committed, tabId: 42 }, response, 41), false);
  assert.equal(sameManualAnnotationRefreshIdentity({ ...committed, documentId: `sha256:${'c'.repeat(64)}` }, response, 41), false);
  assert.equal(sameManualAnnotationRefreshIdentity({ ...committed, documentHash: `sha256:${'d'.repeat(64)}` }, response, 41), false);
  assert.equal(sameManualAnnotationRefreshIdentity({ ...committed, canonicalUrl: 'https://example.test/old' }, response, 41), false);
  assert.equal(sameManualAnnotationRefreshIdentity({ ...committed, contentWorldNonce: '2'.repeat(32) }, response, 41), false);
  assert.equal(sameManualAnnotationRefreshIdentity({ ...committed, documentEpoch: 8 }, response, 41), false);
  assert.equal(sameManualAnnotationRefreshIdentity({ ...committed, documentHash: '' }, response, 41), false);
  assert.equal(sameManualAnnotationRefreshIdentity(null, response, 41), false);
});

test('manual summary refresh commits only while the normalized tab document stays stable', () => {
  const response = {
    documentId: `sha256:${'a'.repeat(64)}`,
    documentHash: `sha256:${'b'.repeat(64)}`,
    canonicalUrl: 'https://example.test/article',
    contentWorldNonce: '1'.repeat(32),
    documentEpoch: 7
  };
  const stable = {
    expectedTabId: 41,
    capturedTab: { id: 41, url: 'https://example.test/article#results' },
    currentTab: { id: 41, url: 'https://example.test/article#discussion' },
    response,
    liveProof: { ...response },
    committedState: null,
    superseded: false
  };

  assert.equal(manualAnnotationRefreshCommitMode(stable), 'response');
  assert.equal(manualAnnotationRefreshCommitMode({
    ...stable,
    currentTab: { id: 41, url: 'https://example.test/other' }
  }), null);
  assert.equal(manualAnnotationRefreshCommitMode({
    ...stable,
    currentTab: { id: 42, url: 'https://example.test/article' }
  }), null);
  assert.equal(manualAnnotationRefreshCommitMode({
    ...stable,
    response: { ...response, documentHash: '' }
  }), null);
  assert.equal(manualAnnotationRefreshCommitMode({
    ...stable,
    response: { ...response, canonicalUrl: '' }
  }), null);
});

test('same-URL reload and SPA generation drift cannot pass the manual refresh commit gate', () => {
  const response = {
    documentId: `sha256:${'a'.repeat(64)}`,
    documentHash: `sha256:${'b'.repeat(64)}`,
    canonicalUrl: 'https://example.test/article',
    contentWorldNonce: '1'.repeat(32),
    documentEpoch: 7
  };
  const stable = {
    expectedTabId: 41,
    capturedTab: { id: 41, url: 'https://example.test/article' },
    currentTab: { id: 41, url: 'https://example.test/article' },
    response,
    liveProof: { ...response },
    committedState: null,
    superseded: false
  };

  assert.equal(manualAnnotationRefreshCommitMode(stable), 'response');
  assert.equal(manualAnnotationRefreshCommitMode({
    ...stable,
    liveProof: { ...response, contentWorldNonce: '2'.repeat(32) }
  }), null);
  assert.equal(manualAnnotationRefreshCommitMode({
    ...stable,
    liveProof: { ...response, documentEpoch: 8 }
  }), null);
  assert.equal(manualAnnotationRefreshCommitMode({
    ...stable,
    liveProof: { ...response, documentHash: `sha256:${'c'.repeat(64)}` }
  }), null);
  assert.equal(manualAnnotationRefreshCommitMode({
    ...stable,
    liveProof: { ...response, contentWorldNonce: 'unbounded-or-malformed' }
  }), null);
});

test('superseded manual summary refresh reuses only the exact self-event identity', () => {
  const response = {
    documentId: `sha256:${'a'.repeat(64)}`,
    documentHash: `sha256:${'b'.repeat(64)}`,
    canonicalUrl: 'https://example.test/article',
    contentWorldNonce: '1'.repeat(32),
    documentEpoch: 7
  };
  const input = {
    expectedTabId: 41,
    capturedTab: { id: 41, url: 'https://example.test/article#results' },
    currentTab: { id: 41, url: 'https://example.test/article#discussion' },
    response,
    liveProof: { ...response },
    committedState: { tabId: 41, ...response },
    superseded: true
  };

  assert.equal(manualAnnotationRefreshCommitMode(input), 'committed');
  assert.equal(manualAnnotationRefreshCommitMode({
    ...input,
    committedState: {
      ...input.committedState,
      documentId: `sha256:${'c'.repeat(64)}`
    }
  }), null);
  assert.equal(manualAnnotationRefreshCommitMode({
    ...input,
    currentTab: { id: 41, url: 'https://example.test/navigated' }
  }), null);
});

test('manual annotation events update only an already verified exact content proof', () => {
  const verified = {
    tabId: 41,
    documentId: `sha256:${'a'.repeat(64)}`,
    documentHash: `sha256:${'b'.repeat(64)}`,
    canonicalUrl: 'https://example.test/article',
    contentWorldNonce: '1'.repeat(32),
    documentEpoch: 7
  };

  assert.equal(manualAnnotationEventCommitMode(verified, verified, 41, 41), 'verified');
  assert.equal(manualAnnotationEventCommitMode(null, verified, 41, 41), 'refresh');
  assert.equal(manualAnnotationEventCommitMode(verified, {
    ...verified,
    contentWorldNonce: '2'.repeat(32)
  }, 41, 41), 'refresh');
  assert.equal(manualAnnotationEventCommitMode(verified, {
    ...verified,
    documentEpoch: 8
  }, 41, 41), 'refresh');
  assert.equal(manualAnnotationEventCommitMode(verified, {
    ...verified,
    documentHash: ''
  }, 41, 41), 'refresh');
  assert.equal(manualAnnotationEventCommitMode(verified, verified, 42, 41), 'ignore');
});

test('document identity normalizes Unicode and ignores tracking URL differences', async () => {
  const first = await createDocumentId({
    title: '  A  mechanistic  Caf\u00e9 paper ',
    canonicalUrl: 'https://EXAMPLE.org:443/paper/?utm_source=x#results',
    doi: 'https://doi.org/10.1000/ABC.1',
    paragraphs: [{ paragraphId: 'p1', text: 'Stable Caf\u00e9 article text.' }]
  });
  const second = await createDocumentId({
    title: 'A mechanistic Cafe\u0301 paper',
    canonicalUrl: 'https://example.org/paper?utm_source=y&fbclid=noise',
    doi: 'doi:10.1000/abc.1',
    paragraphs: [{ paragraphId: 'changed-id', text: 'Stable Cafe\u0301 article text.' }]
  });

  assert.equal(first, second);
  assert.match(first, /^sha256:[a-f0-9]{64}$/);
});

test('document identity uses DOI and only the first 8000 normalized paragraph characters', async () => {
  const common = {
    title: 'Stable title',
    canonicalUrl: 'https://example.org/article',
    doi: '10.1000/stable',
    paragraphs: [{ text: `${'x'.repeat(8000)}first tail` }]
  };
  const samePrefix = await createDocumentId({
    ...common,
    paragraphs: [{ text: `${'x'.repeat(8000)}second tail` }]
  });
  const base = await createDocumentId(common);
  const changedBody = await createDocumentId({
    ...common,
    paragraphs: [{ text: `y${'x'.repeat(7999)}first tail` }]
  });
  const changedDoi = await createDocumentId({ ...common, doi: '10.1000/other' });

  assert.equal(base, samePrefix);
  assert.notEqual(base, changedBody);
  assert.notEqual(base, changedDoi);
});

test('normalizes a category-bound note and preserves forward annotation fields', () => {
  const input = annotation({
    futureField: { schema: 2 },
    categorySnapshot: {
      name: '结果陈述', color: '#ffe66d', snapshotVersion: 2
    }
  });
  const normalized = normalizeManualAnnotation(input);

  assert.equal(normalized.note, 'Primary outcome');
  assert.deepEqual(normalized.futureField, { schema: 2 });
  assert.equal(normalized.categorySnapshot.snapshotVersion, 2);
  assert.equal(normalized.categorySnapshot.color, '#FFE66D');
  assert.throws(() => normalizeManualAnnotation({
    ...input,
    note: 'x'.repeat(MAX_NOTE_LENGTH + 1)
  }), /NOTE_TOO_LONG/);
  assert.equal(WARNING_ANNOTATIONS_PER_DOCUMENT, 1000);
  assert.equal(MAX_ANNOTATIONS_PER_DOCUMENT, 2000);
});

test('rejects invalid offsets, category ids, and category snapshots', () => {
  assert.throws(() => normalizeManualAnnotation(annotation({
    startOffset: -1
  })), /INVALID_OFFSETS/);
  assert.throws(() => normalizeManualAnnotation(annotation({
    startOffset: 40, endOffset: 20
  })), /INVALID_OFFSETS/);
  assert.throws(() => normalizeManualAnnotation(annotation({
    categoryId: 'Bad Category'
  })), /INVALID_CATEGORY_ID/);
  assert.throws(() => normalizeManualAnnotation(annotation({
    categorySnapshot: { name: '', color: '#FFE66D' }
  })), /INVALID_CATEGORY_SNAPSHOT/);
  assert.throws(() => normalizeManualAnnotation(annotation({
    categorySnapshot: { name: 'Result', color: 'yellow' }
  })), /INVALID_CATEGORY_SNAPSHOT/);
});

test('normalizes document records without erasing forward-version data', () => {
  const record = normalizeDocumentRecord({
    schemaVersion: 99,
    documentId: `sha256:${'a'.repeat(64)}`,
    title: '  Study   title ',
    canonicalUrl: 'https://example.org/paper?utm_source=x#discussion',
    studyType: 'observational',
    annotations: [annotation({ futureAnnotationField: true })],
    revision: 4,
    updatedAt: '2026-07-15T00:00:00.000Z',
    futureDocumentField: { mirrorRevision: 7 }
  });

  assert.equal(record.schemaVersion, 1);
  assert.equal(record.title, 'Study title');
  assert.equal(record.canonicalUrl, 'https://example.org/paper');
  assert.equal(record.annotations[0].futureAnnotationField, true);
  assert.deepEqual(record.futureDocumentField, { mirrorRevision: 7 });
});

test('creates a minimal validated category snapshot', () => {
  assert.deepEqual(makeCategorySnapshot({
    categoryId: 'result', name: ' Result ', color: '#ffe66d', definition: 'omit'
  }), { name: 'Result', color: '#FFE66D' });
  assert.throws(() => makeCategorySnapshot({ name: 'Result', color: '#12GG00' }),
    /INVALID_CATEGORY_SNAPSHOT/);
});

test('anchor recovery first uses block fingerprint and exact offsets', () => {
  const located = locateAnnotationInBlocks(annotation({
    blockFingerprint: 'block-1'
  }), [{
    blockId: 'visible-1',
    blockFingerprint: 'block-1',
    sectionTitle: 'Results',
    text: 'In this cohort, Treatment improved survival. The effect was robust.'
  }]);

  assert.equal(located.status, 'located');
  assert.equal(located.matchStage, 'fingerprint_offset');
  assert.equal(located.blockId, 'visible-1');
  assert.equal(located.startOffset, 16);
  assert.equal(located.endOffset, 44);
});

test('anchor recovery uses a unique best context inside the original section', () => {
  const located = locateAnnotationInBlocks(annotation({ blockFingerprint: 'stale' }), [
    {
      blockId: 'wrong', sectionTitle: 'Results',
      text: 'In another cohort, Treatment improved survival. The estimate was fragile.'
    },
    {
      blockId: 'right', sectionTitle: 'Results',
      text: 'In this cohort, Treatment improved survival. The effect was robust.'
    }
  ]);

  assert.equal(located.status, 'located');
  assert.equal(located.matchStage, 'section_context');
  assert.equal(located.blockId, 'right');
});

test('anchor recovery falls back to a unique full-document context after a section rename', () => {
  const located = locateAnnotationInBlocks(annotation({
    sectionTitle: 'Old results', blockFingerprint: 'stale'
  }), [{
    blockId: 'renamed', sectionTitle: 'Efficacy findings',
    text: 'In this cohort, Treatment improved survival. The effect was robust.'
  }]);

  assert.equal(located.status, 'located');
  assert.equal(located.matchStage, 'document_context');
  assert.equal(located.blockId, 'renamed');
});

test('duplicate quotes can be resolved only by a uniquely better context', () => {
  const located = locateAnnotationInBlocks(annotation({
    sectionTitle: 'Missing', blockFingerprint: 'stale'
  }), [
    { blockId: 'wrong', sectionTitle: 'A', text: 'Elsewhere, Treatment improved survival. Unclear.' },
    { blockId: 'right', sectionTitle: 'B', text: 'In this cohort, Treatment improved survival. The effect was robust.' }
  ]);

  assert.equal(located.status, 'located');
  assert.equal(located.blockId, 'right');
  assert.equal(located.matchStage, 'document_context');
});

test('equal context scores never select one of duplicate quotes', () => {
  const located = locateAnnotationInBlocks(annotation({
    prefix: '', suffix: '', sectionTitle: 'Results', blockFingerprint: 'missing',
    startOffset: 0, endOffset: 28
  }), [
    { blockId: 'a', sectionTitle: 'Results', text: 'Treatment improved survival.' },
    { blockId: 'b', sectionTitle: 'Results', text: 'Treatment improved survival.' }
  ]);

  assert.equal(located.status, 'unresolved');
  assert.equal(located.reason, 'AMBIGUOUS_CONTEXT');
});

test('anchor recovery keeps JavaScript Unicode offsets for emoji and CJK text', () => {
  const quote = '治疗🧬改善了生存。';
  const text = `结果：${quote}该效应稳定。`;
  const startOffset = text.indexOf(quote);
  const located = locateAnnotationInBlocks({
    quote,
    prefix: '结果：',
    suffix: '该效应稳定。',
    sectionTitle: '结果',
    blockFingerprint: 'unicode',
    startOffset,
    endOffset: startOffset + quote.length
  }, [{
    blockId: 'unicode', blockFingerprint: 'unicode', sectionTitle: '结果', text
  }]);

  assert.equal(located.status, 'located');
  assert.equal(located.startOffset, startOffset);
  assert.equal(located.endOffset, startOffset + quote.length);
});

test('anchor payload preserves length-changing compatibility characters and DOM offsets', () => {
  const raw = annotation({
    quote: 'ﬃ',
    prefix: 'A',
    suffix: 'B',
    blockFingerprint: 'compatibility',
    startOffset: 1,
    endOffset: 2
  });
  const normalized = normalizeManualAnnotation(raw);
  const located = locateAnnotationInBlocks(normalized, [{
    blockId: 'compatibility',
    blockFingerprint: 'compatibility',
    sectionTitle: 'Results',
    text: 'AﬃB'
  }]);

  assert.equal(normalized.quote, 'ﬃ');
  assert.equal(normalized.prefix, 'A');
  assert.equal(normalized.suffix, 'B');
  assert.equal(normalized.startOffset, 1);
  assert.equal(normalized.endOffset, 2);
  assert.equal(located.status, 'located');
  assert.equal(located.startOffset, 1);
  assert.equal(located.endOffset, 2);
});

test('duplicate stage-one fingerprints continue to section and context recovery', () => {
  const quote = 'Treatment improved survival.';
  const located = locateAnnotationInBlocks(annotation({
    quote,
    prefix: 'B ',
    suffix: ' Robust.',
    sectionTitle: 'Results',
    blockFingerprint: 'duplicate',
    startOffset: 2,
    endOffset: 2 + quote.length
  }), [
    {
      blockId: 'intro', blockFingerprint: 'duplicate', sectionTitle: 'Introduction',
      text: `A ${quote} Background.`
    },
    {
      blockId: 'results', blockFingerprint: 'duplicate', sectionTitle: 'Results',
      text: `B ${quote} Robust.`
    }
  ]);

  assert.equal(located.status, 'located');
  assert.equal(located.matchStage, 'section_context');
  assert.equal(located.blockId, 'results');
});

test('duplicate stage-one fingerprints remain unresolved when fallback scores tie', () => {
  const quote = 'Treatment improved survival.';
  const located = locateAnnotationInBlocks(annotation({
    quote,
    prefix: '',
    suffix: '',
    sectionTitle: 'Results',
    blockFingerprint: 'duplicate',
    startOffset: 0,
    endOffset: quote.length
  }), [
    {
      blockId: 'first', blockFingerprint: 'duplicate', sectionTitle: 'Results', text: quote
    },
    {
      blockId: 'second', blockFingerprint: 'duplicate', sectionTitle: 'Results', text: quote
    }
  ]);

  assert.equal(located.status, 'unresolved');
  assert.equal(located.reason, 'AMBIGUOUS_CONTEXT');
});
