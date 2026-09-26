const test = require('node:test');
const assert = require('node:assert/strict');

require('../core/sentence-boundary.js');
const { selectPdfFigureContext } = require('../core/pdf-figure-context.js');
const { buildPdfSemanticIndex } = require('../core/pdf-semantic-index.js');

const documentIdentity = {
  documentHash: 'pdf-hash-123', documentGeneration: 3, revision: 4
};
const target = {
  figureId: 'figure-main-2', label: 'Figure 2', pageNumber: 7,
  ...documentIdentity
};

function record(recordId, text, overrides = {}) {
  return {
    recordId,
    paragraphId: `paragraph-${recordId}`,
    sourceKey: `source-${recordId}`,
    recordType: 'body',
    pageNumber: 7,
    paragraphIndex: 0,
    ...documentIdentity,
    text,
    ...overrides
  };
}

function select(records, input = {}, options = {}) {
  return selectPdfFigureContext({
    ...documentIdentity,
    target,
    records,
    route: 'text-only',
    ...input
  }, options);
}

function visualEvidence(overrides = {}) {
  return {
    available: true, sourceType: 'full-figure',
    ...documentIdentity, figureId: target.figureId,
    assetId: 'pdf-figure-asset-2', imageContentHash: 'c'.repeat(64),
    ...overrides
  };
}

test('returns a matching caption separately with traceable sentence offsets', () => {
  const text = 'Figure 2. Treatment reduced lesion volume by 32% at 10 mg/kg.';
  const result = select([
    record('caption-2', text, {
      recordType: 'figure-caption', figureId: target.figureId,
      pageStart: 300, documentStart: 4200
    })
  ]);

  assert.deepEqual(result.textualEvidence.captions.map(item => item.text), [
    'Figure 2.', 'Treatment reduced lesion volume by 32% at 10 mg/kg.'
  ]);
  assert.equal(result.textualEvidence.body.length, 0);
  assert.deepEqual(result.textualEvidence.captions[1].location, {
    recordId: 'caption-2', sourceKey: 'source-caption-2',
    paragraphId: 'paragraph-caption-2',
    sentenceId: 'paragraph-caption-2:sentence:1',
    pageNumber: 7, pageNumbers: [7], paragraphIndex: 0,
    sentenceIndex: 1, sourceStart: 10, sourceEnd: text.length,
    normalizedStart: 10, normalizedEnd: text.length,
    expectedNormalizedQuote: 'Treatment reduced lesion volume by 32% at 10 mg/kg.',
    sourceFragments: [],
    locatorStatus: 'resolved', locatorPrecision: 'exact-raw', locatorIssues: [],
    pageStart: 310, pageEnd: 300 + text.length,
    documentStart: 4210, documentEnd: 4200 + text.length
  });
  assert.equal(result.coverage.matchedCaptionRecordCount, 1);
  assert.equal(result.confidence, 'medium');
});

test('finds a Figure 2 reference near the end of a page record longer than 1,400 characters', () => {
  const prefix = `${'Background measurements were stable. '.repeat(48)}Control observations ended here. `;
  const lateSentence = 'As shown in Figure 2, clearance increased by 41% at 6 h (P = 0.003).';
  assert.ok(prefix.length > 1400);
  const result = select([record('long-page', `${prefix}${lateSentence}`)]);

  const hit = result.textualEvidence.body.find(item => item.relevance === 'direct-reference');
  assert.equal(hit.text, lateSentence);
  assert.equal(hit.location.sourceStart, prefix.length);
  assert.ok(hit.location.sourceStart > 1400);
  assert.equal(result.coverage.matchedBodyRecordCount, 1);
});

test('resolves repeated Figure labels by stable identity and target page', () => {
  const result = select([
    record('supplement-caption', 'Figure 2. Supplemental calibration.', {
      recordType: 'figure-caption', figureId: 'supplement-figure-2', pageNumber: 2
    }),
    record('main-caption', 'Figure 2. Main experiment.', {
      recordType: 'figure-caption', figureId: target.figureId, pageNumber: 7
    })
  ]);

  assert.deepEqual(new Set(result.textualEvidence.captions.map(item => item.location.recordId)),
    new Set(['main-caption']));
  assert.equal(result.coverage.excludedIrrelevantRecordCount, 1);
});

test('excludes same-page competing Figure and adjacent-column records without relevance evidence', () => {
  const result = select([
    record('left-column', 'Baseline was balanced. Figure 2 shows improved perfusion. Recovery persisted.', {
      columnId: 'left', paragraphIndex: 3
    }),
    record('right-column', 'Figure 3 shows an unrelated toxicity assay.', {
      columnId: 'right', paragraphIndex: 4
    }),
    record('adjacent-body', 'Animals were housed under standard conditions.', {
      columnId: 'right', paragraphIndex: 5
    })
  ]);

  assert.deepEqual(new Set(result.textualEvidence.body.map(item => item.location.recordId)),
    new Set(['left-column']));
  assert.deepEqual(result.textualEvidence.body.map(item => item.text), [
    'Baseline was balanced.', 'Figure 2 shows improved perfusion.', 'Recovery persisted.'
  ]);
  assert.equal(result.coverage.excludedIrrelevantRecordCount, 2);
});

test('excludes a same-label body explicitly bound to another Figure identity', () => {
  const result = select([
    record('wrong-identity', 'Figure 2 shows a result from the supplemental experiment.', {
      figureId: 'supplement-figure-2', paragraphIndex: 1
    }),
    record('target-identity', 'This identity-bound paragraph reports the intended experiment.', {
      figureId: target.figureId, paragraphIndex: 2
    })
  ]);

  assert.deepEqual(new Set(result.textualEvidence.body.map(item => item.location.recordId)),
    new Set(['target-identity']));
  assert.deepEqual(result.textualEvidence.body.map(item => item.relevance), ['bound-paragraph']);
  assert.equal(result.coverage.matchedBodyRecordCount, 1);
  assert.equal(result.coverage.excludedIrrelevantRecordCount, 1);
});

test('preserves negation, nonsignificance, comparison, numbers, units, and statistics verbatim', () => {
  const sentence = 'In Figure 2, treatment did not increase flow versus vehicle (12.4 vs 12.8 mL/min; P = 0.71), and the difference was not significant.';
  const result = select([record('negative-result', sentence)]);

  assert.equal(result.textualEvidence.body.find(item => item.relevance === 'direct-reference').text,
    sentence);
});

test('enforces the character budget only at complete sentence boundaries', () => {
  const first = 'Figure 2 shows a 24% increase at 5 mg/kg (P = 0.01).';
  const second = 'Figure 2 also shows a delayed 19% decrease at 24 h (P = 0.04).';
  const result = select([
    record('first-hit', first, { paragraphIndex: 1 }),
    record('second-hit', second, { paragraphIndex: 2 })
  ], {}, { maxCharacters: first.length + 2, maxSentences: 8 });

  assert.deepEqual(result.textualEvidence.body.map(item => item.text), [first]);
  assert.equal(result.budget.usedCharacters, first.length);
  assert.equal(result.budget.truncated, true);
  assert.ok(result.coverage.omissions.includes('BUDGET_EXHAUSTED'));
  assert.equal(result.textualEvidence.body[0].location.sourceEnd, first.length);
});

test('enforces the sentence budget without slicing the final selected sentence', () => {
  const sentences = [
    'Figure 2 shows a 10% increase.',
    'Figure 2 shows a 20% increase.',
    'Figure 2 shows a 30% increase.'
  ];
  const result = select(sentences.map((text, index) =>
    record(`sentence-budget-${index}`, text, { paragraphIndex: index })
  ), {}, { maxCharacters: 6000, maxSentences: 2 });
  assert.deepEqual(result.bodyEvidence.map(item => item.text), sentences.slice(0, 2));
  assert.equal(result.budget.usedSentences, 2);
  assert.equal(result.budget.truncated, true);
});

test('prioritizes the direct caption match over earlier caption context under a tiny budget', () => {
  const result = select([
    record('caption-priority', 'Note. Figure 2. Detailed treatment response.', {
      recordType: 'figure-caption', figureId: target.figureId
    })
  ], {}, { maxCharacters: 12, maxSentences: 2 });

  assert.deepEqual(result.textualEvidence.captions.map(item => item.text), ['Figure 2.']);
  assert.deepEqual(result.textualEvidence.captions.map(item => item.relevance), ['caption-match']);
  assert.equal(result.budget.truncated, true);
  assert.ok(result.coverage.omissions.includes('BUDGET_EXHAUSTED'));
});

test('returns an explicit low-confidence empty fallback when no relevance hit exists', () => {
  const result = select([
    record('target-page-unrelated', 'The adjacent column describes housing conditions.'),
    record('other-caption', 'Figure 3. Toxicity measurements.', { recordType: 'figure-caption' })
  ]);

  assert.deepEqual(result.textualEvidence.captions, []);
  assert.deepEqual(result.textualEvidence.body, []);
  assert.equal(result.confidence, 'low');
  assert.equal(result.fallback, 'no-relevance-hit');
  assert.ok(result.coverage.omissions.includes('CAPTION_NOT_FOUND'));
  assert.ok(result.coverage.omissions.includes('BODY_REFERENCE_NOT_FOUND'));
});

test('text-only and vision routes receive identical textual evidence without claiming observation', () => {
  const records = [
    record('caption', 'Figure 2. Perfusion analysis.', {
      recordType: 'figure-caption', figureId: target.figureId
    }),
    record('body', 'Figure 2 shows increased perfusion at 6 h.')
  ];
  const textOnly = select(records);
  const vision = select(records, {
    route: 'vision',
    visualEvidence: visualEvidence()
  });

  assert.deepEqual(vision.textualEvidence, textOnly.textualEvidence);
  assert.deepEqual(textOnly.capabilities, {
    route: 'text-only', hasTextEvidence: true, canAnalyzeText: true,
    imageInputRequested: false, imageInputAvailable: false,
    visualEvidenceBound: false, canSendImageToModel: false,
    imageObservationPerformed: false, canClaimImageObservation: false,
    imageSourceType: 'none', limitations: ['TEXT_ONLY_ROUTE']
  });
  assert.deepEqual(vision.capabilities, {
    route: 'vision', hasTextEvidence: true, canAnalyzeText: true,
    imageInputRequested: true, imageInputAvailable: true,
    visualEvidenceBound: true, canSendImageToModel: true,
    imageObservationPerformed: false, canClaimImageObservation: false,
    imageSourceType: 'full-figure', limitations: ['IMAGE_NOT_YET_OBSERVED']
  });
});

test('vision binds an ordered complete multi-page artwork set without treating caption pages as images', () => {
  const records = [record('multi-visual-body', 'Figure 2 shows preserved flow.')];
  const visualEvidenceSet = {
    version: 'pdf-figure-visual-evidence-set-v1',
    figureId: target.figureId,
    binding: {
      documentHash: documentIdentity.documentHash,
      documentGeneration: documentIdentity.documentGeneration,
      semanticRevision: documentIdentity.revision
    },
    requiredArtworkPageNumbers: [7, 9],
    coverageComplete: true,
    assets: [
      { assetId: 'pdf-figure-page-7', pageNumber: 7,
        imageContentHash: 'a'.repeat(64), sourceType: 'page-region' },
      { assetId: 'pdf-figure-page-9', pageNumber: 9,
        imageContentHash: 'b'.repeat(64), sourceType: 'page-region' }
    ],
    setDigest: 'd'.repeat(64)
  };
  const result = select(records, {
    target: { ...target, pageNumbers: [7, 8], captionPageNumbers: [7, 8],
      artworkPageNumbers: [7, 9], artworkCoverage: 'complete' },
    route: 'vision', visualEvidenceSet,
    sourceCoverage: { pageCount: 20, indexedPageNumbers: [7, 8, 9] }
  });
  assert.equal(result.capabilities.canSendImageToModel, true);
  assert.equal(result.capabilities.imageSourceType, 'visual-evidence-set');
  assert.equal(result.imageInput, null);
  assert.deepEqual(result.imageInputs, [
    { assetId: 'pdf-figure-page-7', imageContentHash: 'a'.repeat(64),
      sourceType: 'page-region', pageNumber: 7 },
    { assetId: 'pdf-figure-page-9', imageContentHash: 'b'.repeat(64),
      sourceType: 'page-region', pageNumber: 9 }
  ]);
  assert.equal(result.visualEvidenceSet.setDigest, 'd'.repeat(64));

  const partial = select(records, {
    target: { ...target, captionPageNumbers: [7, 8],
      artworkPageNumbers: [7, 9], artworkCoverage: 'partial' },
    route: 'vision', visualEvidenceSet: { ...visualEvidenceSet, coverageComplete: false }
  });
  assert.equal(partial.capabilities.canSendImageToModel, false);
  assert.ok(partial.capabilities.limitations.includes('ARTWORK_COVERAGE_INCOMPLETE'));

  const missing = select(records, {
    target: { ...target, artworkPageNumbers: [7, 9], artworkCoverage: 'complete' },
    route: 'vision', visualEvidenceSet: {
      ...visualEvidenceSet,
      requiredArtworkPageNumbers: [7],
      assets: visualEvidenceSet.assets.slice(0, 1)
    }
  });
  assert.equal(missing.capabilities.canSendImageToModel, false);
  assert.ok(missing.capabilities.limitations.includes('VISUAL_SET_COVERAGE_INVALID'));
});

test('uses exact caption and reference hints without broad lexical guessing', () => {
  const hintedTarget = {
    figureId: 'figure-unlabelled', pageNumber: 9,
    ...documentIdentity,
    captionHints: ['Mitochondrial membrane potential after reperfusion'],
    referenceHints: ['the membrane-potential panel']
  };
  const result = select([
    record('hinted-caption', 'Mitochondrial membrane potential after reperfusion.', {
      recordType: 'figure-caption', figureId: hintedTarget.figureId, pageNumber: 9
    }),
    record('hinted-body', 'The membrane-potential panel was unchanged after reperfusion.', {
      pageNumber: 10
    }),
    record('lexical-neighbor', 'Mitochondrial proteins were quantified separately.', {
      pageNumber: 9
    })
  ], { target: hintedTarget });

  assert.deepEqual(new Set([
    ...result.textualEvidence.captions,
    ...result.textualEvidence.body
  ].map(item => item.location.recordId)), new Set(['hinted-caption', 'hinted-body']));
});

test('fails closed for missing, conflicting, stale, or replaced document bindings', () => {
  const source = record('bound', 'Figure 2 shows preserved flow.');
  const cases = [
    [{ documentGeneration: undefined }, 'DOCUMENT_BINDING_MISSING'],
    [{ target: { ...target, documentHash: 'other-document' } }, 'TARGET_BINDING_CONFLICT'],
    [{ records: [{ ...source, documentGeneration: 2 }] }, 'SOURCE_BINDING_CONFLICT'],
    [{ expectedBinding: {
      ...documentIdentity, documentGeneration: documentIdentity.documentGeneration + 1
    } }, 'STALE_DOCUMENT_GENERATION'],
    [{ expectedBinding: { ...documentIdentity, revision: 5 } },
      'STALE_SEMANTIC_REVISION'],
    [{ expectedBinding: { ...documentIdentity, documentHash: 'replacement' } },
      'DOCUMENT_BINDING_CONFLICT']
  ];
  for (const [overrides, reason] of cases) {
    const result = select([source], overrides);
    assert.equal(result.binding.valid, false, reason);
    assert.equal(result.binding.failureReason, reason, reason);
    assert.deepEqual(result.captionEvidence, [], reason);
    assert.deepEqual(result.bodyEvidence, [], reason);
    assert.equal(result.capabilities.canSendImageToModel, false, reason);
  }
});

test('keeps bound cross-page captions separate from far-page semantic body evidence', () => {
  const caption = record('cross-page-caption',
    'Figure 2. Clearance increased by 31% after treatment.', {
      recordType: 'figure-caption', figureId: target.figureId,
      pageNumber: 7, pageNumbers: [7, 8]
    });
  const farBody = record('far-body',
    'At the distant endpoint, Figure 2 did not show toxicity (P = 0.82).', {
      pageNumber: 42, paragraphIndex: 90
    });
  const result = select([caption, farBody], {
    sourceCoverage: {
      pageCount: 50, indexedPageNumbers: [7, 8, 42],
      missingPageNumbers: [9], failedPageNumbers: [11]
    }
  });
  assert.equal(result.captionEvidence.length, 2);
  assert.equal(result.bodyEvidence.some(item => item.location.pageNumber === 42), true);
  assert.deepEqual(result.captionEvidence[0].location.pageNumbers, [7, 8]);
  assert.deepEqual(result.coverage.matchedCaptionPageNumbers, [7, 8]);
  assert.deepEqual(result.coverage.matchedBodyPageNumbers, [42]);
  assert.equal(result.coverage.captionHit, true);
  assert.equal(result.coverage.bodyHit, true);
  assert.equal(result.coverage.partialIndex, true);
  assert.equal(result.coverage.targetPage.indexed, true);
  assert.ok(result.coverage.omissions.includes('MISSING_PAGES'));
  assert.ok(result.coverage.omissions.includes('FAILED_PAGES'));
});

test('requires an explicitly bound caption when same-name Figures conflict', () => {
  const result = select([
    record('unbound-caption', 'Figure 2. Ambiguous same-name caption.', {
      recordType: 'figure-caption', figureId: undefined
    }),
    record('wrong-caption', 'Figure 2. Supplemental caption.', {
      recordType: 'figure-caption', figureId: 'supplement-figure-2'
    }),
    record('right-caption', 'Figure 2. Bound main caption.', {
      recordType: 'figure-caption', figureId: target.figureId
    })
  ]);
  assert.deepEqual(new Set(result.captionEvidence.map(item => item.location.recordId)),
    new Set(['right-caption']));
  assert.ok(result.coverage.omissions.includes('UNBOUND_CAPTION_RECORDS'));
});

test('disambiguates duplicate quotes by semantic identity and normalized position', () => {
  const sentence = 'Figure 2 shows no significant change (P = 0.71).';
  const result = select([
    record('duplicate-a', sentence, { pageNumber: 12, paragraphIndex: 4 }),
    record('duplicate-b', sentence, { pageNumber: 18, paragraphIndex: 9 })
  ]);
  assert.equal(result.bodyEvidence.length, 2);
  assert.deepEqual(result.bodyEvidence.map(item => item.location.paragraphId),
    ['paragraph-duplicate-a', 'paragraph-duplicate-b']);
  for (const item of result.bodyEvidence) {
    assert.equal(item.location.normalizedStart, 0);
    assert.equal(item.location.normalizedEnd, sentence.length);
    assert.equal(item.location.expectedNormalizedQuote, sentence);
  }
});

test('text and vision routes share exact text while visual binding checks every identity field', () => {
  const records = [
    record('caption-parity', 'Figure 2. Bound caption.', {
      recordType: 'figure-caption', figureId: target.figureId
    }),
    record('body-parity', 'Figure 2 shows a 2.4-fold increase at 6 h.')
  ];
  const textOnly = select(records);
  const vision = select(records, { route: 'vision', visualEvidence: {
    ...visualEvidence()
  } });
  const wrongVision = select(records, { route: 'vision', visualEvidence: {
    ...visualEvidence(), revision: documentIdentity.revision - 1
  } });
  assert.equal(JSON.stringify(textOnly.textualEvidence),
    JSON.stringify(vision.textualEvidence));
  assert.equal(JSON.stringify(textOnly.textualEvidence),
    JSON.stringify(wrongVision.textualEvidence));
  assert.equal(textOnly.capabilities.canClaimImageObservation, false);
  assert.equal(vision.capabilities.canSendImageToModel, true);
  assert.equal(wrongVision.capabilities.canSendImageToModel, false);
  assert.ok(wrongVision.capabilities.limitations.includes('VISUAL_BINDING_CONFLICT'));
});

test('uses normalized semantic text and exposes discontinuous trace without positionRuns', () => {
  const normalizedText = 'Figure 2 shows co-localization across pages.';
  const result = select([record('nfkc-discontinuous',
    'Figure 2 shows co-\nlocalization across pages.', {
    normalizedText,
    pageNumber: 20,
    pageNumbers: [20, 21],
    semanticSentences: [{
      sentenceId: 'pdf-sentence:stable', normalizedStart: 0,
      normalizedEnd: normalizedText.length, normalizedText,
      sourceFragments: [
        { pageNumber: 20, start: 900, end: 925 },
        { pageNumber: 21, start: 0, end: 19 }
      ]
    }],
    positionRuns: [{ secret: 'must-not-leak' }],
    rawText: 'sensitive raw full text'
  })]);
  assert.equal(result.bodyEvidence[0].text, normalizedText);
  assert.equal(result.bodyEvidence[0].location.sentenceId, 'pdf-sentence:stable');
  assert.deepEqual(result.bodyEvidence[0].location.sourceFragments, [
    { pageNumber: 20, start: 900, end: 925 },
    { pageNumber: 21, start: 0, end: 19 }
  ]);
  assert.equal(result.bodyEvidence[0].location.locatorPrecision, 'unavailable');
  assert.equal(result.bodyEvidence[0].location.sourceStart, null);
  assert.equal(result.bodyEvidence[0].location.sourceEnd, null);
  assert.ok(result.bodyEvidence[0].location.locatorIssues
    .includes('SOURCE_FRAGMENT_QUOTE_MISSING'));
  assert.ok(result.coverage.omissions.includes('SOURCE_FRAGMENT_QUOTE_MISSING'));
  assert.doesNotMatch(JSON.stringify(result), /positionRuns|secret|sensitive raw/u);
});

test('adapts real semantic-index paragraphs without inventing raw offsets', () => {
  const index = buildPdfSemanticIndex({
    documentHash: documentIdentity.documentHash,
    revision: documentIdentity.revision,
    pages: [{
      pageNumber: 7,
      text: 'Figure 2 shows co-\nlocalization after treatment.'
    }]
  });
  assert.ok(index.paragraphs.length > 0);
  assert.equal(index.paragraphs[0].semanticSentences, undefined);
  assert.ok(index.paragraphs[0].positionRuns.length > 0);
  assert.ok(index.paragraphs[0].sentenceIds.length > 0);
  assert.ok(index.paragraphs[0].ranges.length > 0);

  const records = index.paragraphs.map(paragraph => ({
    ...paragraph,
    recordType: 'semantic-paragraph',
    documentHash: index.document.documentHash,
    documentGeneration: documentIdentity.documentGeneration,
    revision: index.document.revision,
    pageNumber: paragraph.ranges[0]?.pageNumber
  }));
  const result = select(records);
  assert.equal(result.bodyEvidence.length, 1);
  const location = result.bodyEvidence[0].location;
  assert.equal(location.locatorPrecision, 'unavailable');
  assert.equal(location.sourceStart, null);
  assert.equal(location.sourceEnd, null);
  assert.equal(location.pageStart, null);
  assert.equal(location.pageEnd, null);
  assert.equal(location.documentStart, null);
  assert.equal(location.documentEnd, null);
  assert.ok(location.locatorIssues.includes('SOURCE_MAPPING_UNAVAILABLE'));
});

test('keeps public trace identifiers but strips sensitive URL-shaped source metadata', () => {
  const result = select([record('safe-record', 'Figure 2 shows preserved perfusion.', {
    sourceKey: 'https://private.example/paper?token=secret',
    sourceUrl: 'https://private.example/raw.pdf?token=secret'
  })], { route: 'vision', visualEvidence: {
    available: true, figureId: target.figureId, ...documentIdentity,
    sourceType: 'https://private.example/image?token=secret'
  } });
  assert.equal(result.bodyEvidence[0].location.recordId, 'safe-record');
  assert.equal(result.bodyEvidence[0].location.sourceKey, 'safe-record');
  assert.equal(result.capabilities.imageSourceType, 'unknown');
  assert.equal(result.capabilities.canSendImageToModel, false);
  assert.doesNotMatch(JSON.stringify(result), /private\.example|token=secret/u);
});

test('never treats an unbound whole-page prefix as Figure body evidence', () => {
  const result = select([record('whole-page',
    `Figure 2 appears in a page prefix. ${'Unrelated page text. '.repeat(100)}`, {
      recordType: 'pdf-page', paragraphId: 'pdf-page-7'
    })]);
  assert.deepEqual(result.bodyEvidence, []);
  assert.ok(result.coverage.omissions.includes('WHOLE_PAGE_RECORDS_EXCLUDED'));
});

test('requires a content-addressed visual asset and validates page-region geometry', () => {
  const records = [record('visual-body', 'Figure 2 shows preserved flow.')];
  const missingAsset = select(records, {
    route: 'vision', visualEvidence: {
      available: true, sourceType: 'full-figure', ...documentIdentity,
      figureId: target.figureId
    }
  });
  assert.equal(missingAsset.capabilities.imageInputAvailable, false);
  assert.equal(missingAsset.capabilities.canSendImageToModel, false);
  assert.ok(missingAsset.capabilities.limitations.includes('VISUAL_ASSET_HANDLE_MISSING'));

  const badHash = select(records, { route: 'vision', visualEvidence: visualEvidence({
    imageContentHash: 'not-a-sha256'
  }) });
  assert.equal(badHash.capabilities.imageInputAvailable, false);
  assert.ok(badHash.capabilities.limitations.includes('VISUAL_CONTENT_IDENTITY_INVALID'));

  const badRegion = select(records, { route: 'vision', visualEvidence: visualEvidence({
    sourceType: 'page-region', pageNumber: 7,
    rect: { x: 0.9, y: 0.2, width: 0.2, height: 0.4 }
  }) });
  assert.equal(badRegion.capabilities.canSendImageToModel, false);
  assert.ok(badRegion.capabilities.limitations.includes('VISUAL_REGION_INVALID'));

  const validRegion = select(records, { route: 'vision', visualEvidence: visualEvidence({
    sourceType: 'page-region', pageNumber: 7,
    rect: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 }
  }) });
  assert.equal(validRegion.capabilities.imageInputAvailable, true);
  assert.equal(validRegion.capabilities.canSendImageToModel, true);
  assert.deepEqual(validRegion.imageInput, {
    assetId: 'pdf-figure-asset-2', imageContentHash: 'c'.repeat(64),
    sourceType: 'page-region', pageNumber: 7,
    rect: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 }
  });

  const outOfDocument = select(records, {
    route: 'vision',
    sourceCoverage: { pageCount: 20, indexedPageNumbers: [7] },
    visualEvidence: visualEvidence({
      sourceType: 'page-region', pageNumber: 999,
      rect: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 }
    })
  });
  assert.equal(outOfDocument.capabilities.imageInputAvailable, false);
  assert.equal(outOfDocument.capabilities.canSendImageToModel, false);
  assert.ok(outOfDocument.capabilities.limitations.includes('VISUAL_REGION_INVALID'));

  const wrongTargetPage = select(records, {
    route: 'vision',
    sourceCoverage: { pageCount: 20, indexedPageNumbers: [7, 8] },
    visualEvidence: visualEvidence({
      sourceType: 'page-region', pageNumber: 8,
      rect: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 }
    })
  });
  assert.equal(wrongTargetPage.capabilities.canSendImageToModel, false);
  assert.ok(wrongTargetPage.capabilities.limitations.includes('VISUAL_REGION_INVALID'));

  const trustedCrossPage = select(records, {
    target: { ...target, pageNumbers: [7, 8] },
    route: 'vision',
    sourceCoverage: { pageCount: 20, indexedPageNumbers: [7, 8] },
    visualEvidence: visualEvidence({
      sourceType: 'page-region', pageNumber: 8,
      rect: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 }
    })
  });
  assert.equal(trustedCrossPage.capabilities.canSendImageToModel, true);

  const partialArtwork = select(records, {
    target: { ...target, artworkPageNumbers: [7], artworkCoverage: 'partial' },
    route: 'vision', visualEvidence: visualEvidence()
  });
  assert.equal(partialArtwork.capabilities.canSendImageToModel, false);
  assert.ok(partialArtwork.capabilities.limitations
    .includes('ARTWORK_COVERAGE_INCOMPLETE'));
});

test('semantic locator precision never presents normalized offsets as raw offsets', () => {
  const normalized = 'Figure 2 shows affinity normalization.';
  const equivalent = select([record('equivalent', 'raw ignored', {
    normalizedText: normalized,
    semanticSentences: [{
      sentenceId: 'sentence-equivalent', normalizedStart: 0,
      normalizedEnd: normalized.length, normalizedText: normalized,
      sourceFragments: [{
        pageNumber: 7, start: 100, end: 139,
        quote: 'Figure ２ shows aﬃnity normalization.'
      }]
    }]
  })]);
  const equivalentLocation = equivalent.bodyEvidence[0].location;
  assert.equal(equivalentLocation.normalizedStart, 0);
  assert.equal(equivalentLocation.sourceStart, null);
  assert.equal(equivalentLocation.sourceEnd, null);
  assert.equal(equivalentLocation.locatorStatus, 'degraded');
  assert.equal(equivalentLocation.locatorPrecision, 'normalized-equivalent');

  const invalid = select([record('invalid-fragment', 'Figure 2 is unchanged.', {
    normalizedText: 'Figure 2 is unchanged.',
    semanticSentences: [{
      normalizedStart: 0, normalizedEnd: 22,
      normalizedText: 'Figure 2 is unchanged.',
      sourceFragments: [
        { pageNumber: 7, start: 50, end: 70 },
        { pageNumber: 7, start: 60, end: 80 }
      ]
    }]
  })]);
  assert.equal(invalid.bodyEvidence[0].location.locatorPrecision, 'unavailable');
  assert.equal(invalid.bodyEvidence[0].location.sourceStart, null);
  assert.ok(invalid.bodyEvidence[0].location.locatorIssues
    .includes('SOURCE_FRAGMENT_CONFLICT'));
  assert.ok(invalid.coverage.omissions.includes('SOURCE_FRAGMENT_CONFLICT'));
});

test('recognizes exact main, supplementary, and Extended Data Figure labels', () => {
  const cases = [
    ['Figure 2A', [
      'Fig. 2A shows the target.', 'Figure 2A confirms it.',
      'Fig.2A remains exact.', 'Figure2A remains exact.'
    ],
      ['Figure 2B is different.', 'Figure 20A is different.']],
    ['Supplementary Figure 2A',
      ['Supplementary Figure 2A shows the target.', 'Supp. Fig. 2A confirms it.'],
      ['Figure 2A is the main figure.', 'Supplementary Figure 2B differs.']],
    ['Extended Data Figure 2A', ['Extended Data Figure 2A shows the target.'],
      ['Figure 2A is the main figure.', 'Extended Data Figure 20A differs.']]
  ];
  for (const [label, matches, misses] of cases) {
    const customTarget = { ...target, label };
    const records = [
      ...matches.map((text, index) => record(`hit-${label}-${index}`, text)),
      ...misses.map((text, index) => record(`miss-${label}-${index}`, text))
    ];
    const result = select(records, { target: customTarget });
    assert.deepEqual(result.bodyEvidence.map(item => item.text), matches, label);
  }
});

test('a whole main Figure target collects lettered panel references without number bleed', () => {
  const records = [
    record('main-panel-a-short', 'Fig. 2A shows effect.'),
    record('main-panel-a-tight', 'Figure2A confirms effect.'),
    record('main-panel-b', 'Figure 2B shows a second effect.'),
    record('main-panel-c', 'Fig.2C shows a third effect.'),
    record('wrong-figure-20', 'Figure 20A is unrelated.'),
    record('wrong-figure-21', 'Fig. 21B is unrelated.'),
    record('qualified-extended', 'Extended Data Figure 2A is separate.')
  ];
  const result = select(records);
  assert.deepEqual(result.bodyEvidence.map(item => item.location.recordId), [
    'main-panel-a-short', 'main-panel-a-tight', 'main-panel-b', 'main-panel-c'
  ]);
});

test('supplementary S-number targets accept Supplementary and Supp. spellings only', () => {
  const supplementaryTarget = {
    ...target, figureId: 'figure-supplement-s2a', label: 'Supplementary Figure S2A'
  };
  const result = select([
    record('supp-long', 'Supplementary Figure S2A shows effect.'),
    record('supp-short', 'Supp. Fig. S2A confirms effect.'),
    record('supp-tight', 'Supp. Fig.S2A remains consistent.'),
    record('wrong-s-panel', 'Supplementary Figure S2B differs.'),
    record('wrong-s-number', 'Supp. Fig. S20A differs.'),
    record('unqualified-same', 'Figure S2A is not a supplementary citation.'),
    record('extended-same', 'Extended Data Figure S2A is separate.')
  ], { target: supplementaryTarget });
  assert.deepEqual(result.bodyEvidence.map(item => item.location.recordId), [
    'supp-long', 'supp-short', 'supp-tight'
  ]);
});

test('panel-specific and Extended Data targets retain exact qualifier isolation', () => {
  const panelTarget = { ...target, label: 'Figure 2A' };
  const panel = select([
    record('panel-a', 'Figure 2A is the target.'),
    record('panel-b', 'Figure 2B is another panel.'),
    record('panel-20a', 'Figure 20A is another figure.'),
    record('panel-extended', 'Extended Data Figure 2A is separate.')
  ], { target: panelTarget });
  assert.deepEqual(panel.bodyEvidence.map(item => item.location.recordId), ['panel-a']);

  const extendedTarget = { ...target, label: 'Extended Data Figure 2' };
  const extended = select([
    record('extended-a', 'Extended Data Figure 2A shows effect.'),
    record('extended-b', 'Extended Data Figure 2B confirms effect.'),
    record('main-a', 'Figure 2A is the main figure.'),
    record('supp-a', 'Supplementary Figure 2A is separate.')
  ], { target: extendedTarget });
  assert.deepEqual(extended.bodyEvidence.map(item => item.location.recordId), [
    'extended-a', 'extended-b'
  ]);
});

test('reserves body evidence and reports selected hits after budget truncation', () => {
  const caption = record('long-caption',
    'Figure 2. Caption context one. Caption context two. Caption context three.', {
      recordType: 'figure-caption', figureId: target.figureId
    });
  const body = record('budget-body', 'Figure 2 shows no toxicity (P = 0.91).');
  const result = select([caption, body], {}, { maxSentences: 2, maxCharacters: 200 });
  assert.equal(result.captionEvidence.length, 1);
  assert.equal(result.bodyEvidence.length, 1);
  assert.equal(result.coverage.captionHit, true);
  assert.equal(result.coverage.bodyHit, true);

  const fittingBody = record('fitting-body', 'Figure 2 shows stable flow.', {
    paragraphIndex: 2
  });
  const skipsOversizedBody = select([
    record('oversized-body', `Figure 2 ${'has extensive detail '.repeat(12)}`, {
      paragraphIndex: 1
    }),
    fittingBody,
    record('compact-caption', 'Figure 2.', {
      recordType: 'figure-caption', figureId: target.figureId, paragraphIndex: 3
    })
  ], {}, { maxSentences: 2, maxCharacters: 60 });
  assert.deepEqual(skipsOversizedBody.bodyEvidence.map(item => item.text),
    ['Figure 2 shows stable flow.']);
  assert.deepEqual(skipsOversizedBody.captionEvidence.map(item => item.text), ['Figure 2.']);

  const longBody = `Figure 2 ${'x'.repeat(46)}.`;
  const shortBody = 'Figure 2 works.';
  assert.equal(longBody.length, 56);
  assert.equal(shortBody.length, 15);
  const joint = select([
    record('fitting-but-crowding-body', longBody, { paragraphIndex: 1 }),
    record('short-pair-body', shortBody, { paragraphIndex: 2 }),
    record('nine-character-caption', 'Figure 2.', {
      recordType: 'figure-caption', figureId: target.figureId, paragraphIndex: 3
    })
  ], {}, { maxSentences: 2, maxCharacters: 60 });
  assert.deepEqual(joint.bodyEvidence.map(item => item.text), [shortBody]);
  assert.deepEqual(joint.captionEvidence.map(item => item.text), ['Figure 2.']);

  const none = select([body], {}, { maxSentences: 2, maxCharacters: 1 });
  assert.equal(none.bodyEvidence.length, 0);
  assert.equal(none.coverage.bodyHit, false);
  assert.equal(none.confidence, 'low');
  assert.equal(none.fallback, 'budget-exhausted');
  assert.equal(none.capabilities.canAnalyzeText, false);
  assert.ok(none.coverage.missingReasons.includes('BODY_BUDGET_OMITTED'));
});

test('counts every semantic fragment page and reports truncated fragment locators', () => {
  const normalized = 'Figure 2 spans two indexed pages.';
  const fragments = Array.from({ length: 25 }, (_, index) => ({
    pageNumber: index < 12 ? 30 : 31, start: index * 2, end: index * 2 + 1
  }));
  const result = select([record('fragment-pages', 'raw ignored', {
    normalizedText: normalized, pageNumber: 30,
    semanticSentences: [{
      normalizedStart: 0, normalizedEnd: normalized.length,
      normalizedText: normalized, sourceFragments: fragments
    }]
  })], { sourceCoverage: {
    pageCount: 40, indexedPageNumbers: [30, 31],
    missingPageNumbers: [], failedPageNumbers: []
  } });
  assert.deepEqual(result.coverage.providedPageNumbers, [30, 31]);
  assert.deepEqual(result.coverage.matchedBodyPageNumbers, [30, 31]);
  assert.equal(result.bodyEvidence[0].location.locatorPrecision, 'unavailable');
  assert.ok(result.bodyEvidence[0].location.locatorIssues
    .includes('SOURCE_FRAGMENTS_TRUNCATED'));
  assert.ok(result.coverage.omissions.includes('SOURCE_FRAGMENTS_TRUNCATED'));

  const invalid = select([record('invalid-fragment-shape', 'raw ignored', {
    normalizedText: normalized,
    semanticSentences: [{
      normalizedStart: 0, normalizedEnd: normalized.length,
      normalizedText: normalized,
      sourceFragments: [{ pageNumber: 30, start: 8, end: 4 }]
    }]
  })]);
  assert.equal(invalid.bodyEvidence[0].location.locatorPrecision, 'unavailable');
  assert.ok(invalid.bodyEvidence[0].location.locatorIssues
    .includes('SOURCE_FRAGMENTS_INVALID'));
  assert.ok(invalid.coverage.omissions.includes('SOURCE_FRAGMENTS_INVALID'));
});
