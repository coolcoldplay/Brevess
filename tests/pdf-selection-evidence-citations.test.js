const test = require('node:test');
const assert = require('node:assert/strict');

const {
  verifyArticleChatEvidence
} = require('../core/article-chat-citations.js');
const {
  createArticleChatNdjsonParser
} = require('../core/article-chat-stream.js');

function pdfSnapshot(overrides = {}) {
  return {
    revision: 1,
    documentHash: '6980dbe19945fd36ccd200841d8204a22c75404faedd432db23dbb0a70cef5f1',
    paragraphs: [{
      paragraphId: 'pdf-page-1',
      sourceKey: 'pdf-page-1',
      textHash: '4a022607',
      sectionTitle: 'Page 1',
      sectionPath: ['Page 1'],
      text: 'Page one introduces the healthy baseline and the experimental question.'
    }, {
      paragraphId: 'pdf-page-2',
      sourceKey: 'pdf-page-2',
      textHash: 'd4b06170',
      sectionTitle: 'Page 2',
      sectionPath: ['Page 2'],
      text: 'Page two reports that neuronal activity changes microglial process motility in vivo.'
    }],
    ...overrides
  };
}

test('r25-style page-one identity with a page-two quote rebinds uniquely to page two', () => {
  const result = verifyArticleChatEvidence({
    paragraphId: 'pdf-page-1',
    sourceKey: 'pdf-page-1',
    textHash: '4a022607',
    quote: 'neuronal activity changes microglial process motility in vivo',
    documentHash: pdfSnapshot().documentHash,
    documentRevision: 1
  }, pdfSnapshot());

  assert.equal(result.status, 'verified');
  assert.equal(result.matchMethod, 'unique-quote');
  assert.equal(result.candidateCount, 1);
  assert.equal(result.target.paragraphId, 'pdf-page-2');
  assert.equal(result.target.sourceKey, 'pdf-page-2');
  assert.equal(result.target.textHash, 'd4b06170');
  assert.ok(result.target.quoteSpan);
});

test('the real NDJSON parser retains the corrected page-two target for an r25-style block', () => {
  const snapshot = pdfSnapshot();
  const parser = createArticleChatNdjsonParser({ snapshot });
  parser.push(`${JSON.stringify({
    type: 'answer_block',
    block_id: 'r25-block-3',
    markdown: 'The selected passage describes activity-dependent motility.[[1]]',
    evidence: [{
      marker: '1',
      paragraph_id: 'pdf-page-1',
      source_key: 'pdf-page-1',
      text_hash: '4a022607',
      quote: 'neuronal activity changes microglial process motility in vivo',
      section_path: ['Page 1']
    }]
  })}\n`);
  parser.push('{"type":"turn_summary","summary":"Both selected pages were checked."}\n');
  parser.push('{"type":"final","status":"completed"}\n');

  assert.equal(parser.finish(), true);
  const evidence = parser.snapshot().blocks[0].evidence[0];
  assert.equal(evidence.verification.status, 'verified');
  assert.equal(evidence.verification.matchMethod, 'unique-quote');
  assert.equal(evidence.verification.target.paragraphId, 'pdf-page-2');
  assert.equal(evidence.verification.target.textHash, 'd4b06170');
  assert.ok(evidence.verification.target.quoteSpan);
});

test('a forged quote with declared PDF identity stays missing', () => {
  const result = verifyArticleChatEvidence({
    paragraphId: 'pdf-page-1',
    sourceKey: 'pdf-page-1',
    textHash: '4a022607',
    sectionTitle: 'Page 1',
    quote: 'Page one allegedly proves a result that is absent from the PDF.',
    documentHash: pdfSnapshot().documentHash
  }, pdfSnapshot());

  assert.equal(result.status, 'missing');
  assert.equal(result.candidateCount, 0);
  assert.equal(result.target, null);
});

test('a stale hash cannot win the fast path but an exact unique quote can rebind', () => {
  const result = verifyArticleChatEvidence({
    paragraphId: 'pdf-page-1',
    sourceKey: 'pdf-page-1',
    textHash: 'stale-page-one-hash',
    quote: 'healthy baseline and the experimental question',
    documentHash: pdfSnapshot().documentHash
  }, pdfSnapshot());

  assert.equal(result.status, 'verified');
  assert.equal(result.matchMethod, 'unique-quote');
  assert.equal(result.target.paragraphId, 'pdf-page-1');
  assert.equal(result.target.textHash, '4a022607');
  assert.ok(result.target.quoteSpan);
});

test('an identity mismatch cannot select one occurrence of a duplicated PDF quote', () => {
  const duplicate = 'The repeated sentence is present on both selected pages.';
  const snapshot = pdfSnapshot({
    paragraphs: [{
      paragraphId: 'pdf-page-1', sourceKey: 'pdf-page-1', textHash: 'page-one-hash',
      sectionTitle: 'Page 1', sectionPath: ['Page 1'], text: duplicate
    }, {
      paragraphId: 'pdf-page-2', sourceKey: 'pdf-page-2', textHash: 'page-two-hash',
      sectionTitle: 'Page 2', sectionPath: ['Page 2'], text: duplicate
    }]
  });
  const result = verifyArticleChatEvidence({
    paragraphId: 'pdf-page-1',
    sourceKey: 'pdf-page-1',
    textHash: 'wrong-hash',
    quote: duplicate,
    documentHash: snapshot.documentHash
  }, snapshot);

  assert.equal(result.status, 'ambiguous');
  assert.equal(result.reason, 'QUOTE_MATCHED_MULTIPLE_LOCATIONS');
  assert.equal(result.candidateCount, 2);
  assert.equal(result.target, null);
});

test('an exact quote never crosses a PDF document boundary', () => {
  const result = verifyArticleChatEvidence({
    paragraphId: 'pdf-page-1',
    sourceKey: 'pdf-page-1',
    textHash: '4a022607',
    quote: 'neuronal activity changes microglial process motility in vivo',
    documentHash: 'different-pdf'
  }, pdfSnapshot());

  assert.equal(result.status, 'stale');
  assert.equal(result.reason, 'DOCUMENT_CHANGED');
  assert.equal(result.target, null);
});
