const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const readingTools = require('../core/reading-tools.js');

const source = fs.readFileSync(path.resolve(__dirname, '../content.js'), 'utf8');

function executableFunction(name, dependencies = {}) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} must exist`);
  const signatureEnd = source.indexOf(') {', start);
  assert.ok(signatureEnd >= 0);
  const bodyStart = signatureEnd + 2;
  let depth = 0;
  let end = -1;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) { end = index + 1; break; }
  }
  return Function(...Object.keys(dependencies),
    `return (${source.slice(start, end)});`)(...Object.values(dependencies));
}

function fixture() {
  const identity = {
    documentId: `sha256:${'a'.repeat(64)}`,
    documentHash: 'a'.repeat(64),
    documentGeneration: 2,
    revision: 4,
    semanticCacheKey: 'cache-a',
    semanticProvenanceKey: 'proof-a'
  };
  const target = (paragraphId, text, pageNumber, normalizedStart) => ({
    kind: 'paragraph', ...identity, paragraphId, pageNumber, normalizedStart,
    normalizedEnd: normalizedStart + text.length,
    expectedNormalizedQuote: text
  });
  const short = target('semantic-1', 'Grounded result.', 3, 20);
  const long = target('semantic-2', 'x'.repeat(4001), 4, 100);
  return {
    identity, short, long,
    semanticContext: { ...identity, navigation: { sections: [] } },
    paragraphs: [
      { paragraphId: short.paragraphId, semanticTarget: short },
      { paragraphId: long.paragraphId, semanticTarget: long }
    ]
  };
}

function locator(target) {
  return {
    locatorKind: 'pdf-semantic',
    documentId: target.documentId,
    documentHash: target.documentHash,
    documentGeneration: target.documentGeneration,
    revision: target.revision,
    semanticCacheKey: target.semanticCacheKey,
    semanticProvenanceKey: target.semanticProvenanceKey,
    paragraphId: target.paragraphId,
    normalizedStart: target.normalizedStart,
    normalizedEnd: target.normalizedEnd,
    expectedNormalizedQuote: target.expectedNormalizedQuote
  };
}

test('PDF literature-note autofill sends semantic paragraphs instead of page records', () => {
  const start = source.indexOf('async function autofillLiteratureNoteWithLLM(');
  const end = source.indexOf('\nfunction buildFigureOperationProviderPlan', start);
  assert.ok(start >= 0 && end > start);
  const body = source.slice(start, end);
  assert.match(body, /const semanticSnapshot = pdfSemanticArticleChatSnapshot\(\)/);
  assert.match(body, /const snapshot = semanticSnapshot \|\| canonicalSnapshot/);
  assert.match(body, /buildPdfLiteratureNoteFieldEvidence/);
  assert.match(body, /fieldEvidence/);
});

test('supported PDF note fields receive bounded exact semantic evidence', () => {
  const build = executableFunction('buildPdfLiteratureNoteFieldEvidence', {
    createPdfSemanticHighlightLocator: locator
  });
  const snapshot = fixture();
  const evidence = build({ finding: ['semantic-1'] },
    { finding: 'supported' }, snapshot);
  assert.equal(evidence.finding.status, 'verified');
  assert.equal(evidence.finding.precision, 'normalized-exact');
  assert.equal(evidence.finding.locators.length, 1);
  assert.equal(evidence.finding.locators[0].paragraphId, 'semantic-1');
  assert.deepEqual(evidence.finding.pageAnchor,
    { paragraphId: 'pdf-page-3', pageNumber: 3 });

  const normalized = readingTools.normalizeLiteratureNoteDocumentState({
    schemaVersion: 3,
    templateId: 'basic_research',
    valuesByTemplate: { basic_research: { finding: 'Grounded.' } },
    fieldStatusByTemplate: { basic_research: { finding: 'supported' } },
    fieldEvidenceByTemplate: { basic_research: evidence },
    updatedAt: 1
  });
  assert.equal(normalized.fieldEvidenceByTemplate.basic_research.finding.status,
    'verified');
});

test('oversized and missing PDF note sources fail closed without invented sentence precision', () => {
  const build = executableFunction('buildPdfLiteratureNoteFieldEvidence', {
    createPdfSemanticHighlightLocator: locator
  });
  const snapshot = fixture();
  const evidence = build({ method: ['semantic-2'], gap: [] },
    { method: 'supported', gap: 'missing' }, snapshot);
  assert.deepEqual({
    status: evidence.method.status,
    precision: evidence.method.precision,
    reason: evidence.method.degradedReasonCode,
    locators: evidence.method.locators.length,
    page: evidence.method.pageAnchor.pageNumber
  }, {
    status: 'degraded', precision: 'page-only',
    reason: 'PDF_NOTE_SOURCE_LOCATOR_DEGRADED', locators: 0, page: 4
  });
  assert.equal(evidence.gap.status, 'missing');
  assert.equal(evidence.gap.precision, 'none');
  assert.equal(evidence.gap.pageAnchor, null);
});
