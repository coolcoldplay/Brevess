const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const hash = value => crypto.createHash('sha256').update(String(value)).digest('hex');

function syntheticFixture() {
  const corpusId = 'synthetic-pdf-semantic-corpus-gate-test';
  const documents = Array.from({ length: 8 }, (_, index) => ({
    documentId: `doc-${index + 1}`,
    documentSha256: hash(`pdf-${index + 1}`)
  }));
  const sentences = [];
  const headings = [];
  const sectionRanges = [];
  for (const [documentIndex, document] of documents.entries()) {
    for (let index = 0; index < 15; index += 1) {
      const id = `sentence-${documentIndex + 1}-${index + 1}`;
      sentences.push({
        id, documentId: document.documentId,
        expectedRawTextSha256: hash(`raw-${id}`),
        expectedNormalizedTextSha256: hash(`normalized-${id}`),
        expectedPageNumbers: [index + 1]
      });
    }
    for (let index = 0; index < 10; index += 1) {
      const id = `heading-${documentIndex + 1}-${index + 1}`;
      headings.push({
        id, documentId: document.documentId,
        label: index < 8 ? 'positive' : 'negative',
        expectedRawTextSha256: hash(`raw-${id}`),
        expectedPageNumber: index + 1
      });
    }
    for (let index = 0; index < 4; index += 1) {
      sectionRanges.push({
        id: `range-${documentIndex + 1}-${index + 1}`,
        documentId: document.documentId,
        expectedStart: { pageNumber: index + 1, offset: 10 },
        expectedEnd: { pageNumber: index + 1, offset: 80 }
      });
    }
  }
  const annotations = {
    schemaVersion: 'brevess.pdf-semantic-corpus.annotations.v1',
    corpusId,
    provenance: { annotationKind: 'synthetic-test-fixture', humanReviewed: false,
      containsSynthetic: true },
    documents, sentences, headings, sectionRanges
  };
  const results = {
    schemaVersion: 'brevess.pdf-semantic-corpus.results.v1', corpusId,
    sentences: sentences.map((item, index) => ({
      annotationId: item.id, documentId: item.documentId,
      documentSha256: documents.find(doc => doc.documentId === item.documentId).documentSha256,
      rawTextSha256: index < 2 ? hash(`wrong-${item.id}`) : item.expectedRawTextSha256,
      normalizedTextSha256: item.expectedNormalizedTextSha256,
      pageNumbers: item.expectedPageNumbers
    })),
    headings: headings.map(item => ({
      annotationId: item.id, documentId: item.documentId,
      documentSha256: documents.find(doc => doc.documentId === item.documentId).documentSha256,
      predicted: item.label === 'positive',
      ...(item.label === 'positive' ? {
        pageNumber: item.expectedPageNumber,
        rawTextSha256: item.expectedRawTextSha256
      } : {})
    })),
    sectionRanges: sectionRanges.map(item => ({
      annotationId: item.id, documentId: item.documentId,
      documentSha256: documents.find(doc => doc.documentId === item.documentId).documentSha256,
      start: item.expectedStart, end: item.expectedEnd
    })),
    performance: documents.map((document, index) => ({
      documentId: document.documentId,
      coldMs: 100 + index * 10,
      hotMs: 20 + index
    }))
  };
  return { annotations, results };
}

test('synthetic fixtures can exercise all thresholds without claiming release PASS', async () => {
  const { evaluatePdfSemanticCorpus } = await import(
    '../scripts/validate-pdf-semantic-corpus.mjs');
  const fixture = syntheticFixture();
  const report = evaluatePdfSemanticCorpus(fixture.annotations, fixture.results,
    { syntheticTestMode: true });
  assert.equal(report.status, 'TEST_PASS');
  assert.equal(report.eligibleForRelease, false);
  assert.deepEqual(report.counts, {
    documents: 8, sentences: 120, headings: 80,
    headingPositives: 64, headingNegatives: 16, sectionRanges: 32
  });
  assert.equal(report.metrics.sentenceAccuracy, 0.983333);
  assert.equal(report.metrics.headingPrecision, 1);
  assert.equal(report.metrics.headingRecall, 1);
  assert.equal(Object.values(report.checks).every(Boolean), true);
});

test('a synthetic fixture remains NOT_READY under release semantics', async () => {
  const { evaluatePdfSemanticCorpus } = await import(
    '../scripts/validate-pdf-semantic-corpus.mjs');
  const fixture = syntheticFixture();
  const report = evaluatePdfSemanticCorpus(fixture.annotations, fixture.results);
  assert.equal(report.status, 'NOT_READY');
  assert.equal(report.code, 'REAL_HUMAN_ANNOTATIONS_REQUIRED');
  assert.equal(report.eligibleForRelease, false);
});

test('complete exact synthetic results report latency and coverage without raw text', async () => {
  const { evaluatePdfSemanticCorpus } = await import(
    '../scripts/validate-pdf-semantic-corpus.mjs');
  const fixture = syntheticFixture();
  fixture.results.sentences.forEach((item, index) => {
    item.rawTextSha256 = fixture.annotations.sentences[index].expectedRawTextSha256;
  });
  fixture.results.headings.forEach((item, index) => {
    const expected = fixture.annotations.headings[index];
    item.predicted = expected.label === 'positive';
    if (item.predicted) {
      item.pageNumber = expected.expectedPageNumber;
      item.rawTextSha256 = expected.expectedRawTextSha256;
    }
    else delete item.pageNumber;
  });
  const report = evaluatePdfSemanticCorpus(fixture.annotations, fixture.results,
    { syntheticTestMode: true });
  assert.equal(report.status, 'TEST_PASS');
  assert.equal(report.metrics.sentenceAccuracy, 1);
  assert.equal(report.metrics.headingPrecision, 1);
  assert.equal(report.metrics.headingRecall, 1);
  assert.deepEqual(report.coverage,
    { documents: 1, sentences: 1, headings: 1, sectionRanges: 1 });
  assert.equal(report.latency.cold.medianMs, 130);
  assert.equal(report.latency.cold.p95Ms, 170);
  assert.equal(report.latency.hot.medianMs, 23);
  assert.equal(report.privacy.rawTextReported, false);
  assert.equal(JSON.stringify(report).includes('raw-sentence'), false);
});

test('incomplete quotas and result coverage are explicitly NOT_READY', async () => {
  const { evaluatePdfSemanticCorpus } = await import(
    '../scripts/validate-pdf-semantic-corpus.mjs');
  const fixture = syntheticFixture();
  fixture.annotations.sentences.pop();
  let report = evaluatePdfSemanticCorpus(fixture.annotations, fixture.results,
    { syntheticTestMode: true });
  assert.equal(report.status, 'NOT_READY');
  assert.equal(report.code, 'ANNOTATION_QUOTA_INCOMPLETE');

  const complete = syntheticFixture();
  complete.results.performance.pop();
  report = evaluatePdfSemanticCorpus(complete.annotations, complete.results,
    { syntheticTestMode: true });
  assert.equal(report.status, 'NOT_READY');
  assert.equal(report.code, 'RESULT_COVERAGE_INCOMPLETE');
  assert.equal(report.coverage.documents, 0.875);
});

test('document quota cannot be padded with documents lacking annotated target types', async () => {
  const { evaluatePdfSemanticCorpus } = await import(
    '../scripts/validate-pdf-semantic-corpus.mjs');
  const fixture = syntheticFixture();
  fixture.annotations.sectionRanges = fixture.annotations.sectionRanges.map((item, index) => ({
    ...item,
    documentId: index >= 28 ? 'doc-1' : item.documentId
  }));
  const report = evaluatePdfSemanticCorpus(fixture.annotations, fixture.results,
    { syntheticTestMode: true });
  assert.equal(report.status, 'NOT_READY');
  assert.equal(report.code, 'ANNOTATION_QUOTA_INCOMPLETE');
  assert.equal(report.annotationDocumentCoverage.sectionRanges, 7);
});

test('wrong page and wrong document are hard failures even when text hashes match', async () => {
  const { evaluatePdfSemanticCorpus } = await import(
    '../scripts/validate-pdf-semantic-corpus.mjs');
  const fixture = syntheticFixture();
  fixture.results.sentences.forEach((item, index) => {
    item.rawTextSha256 = fixture.annotations.sentences[index].expectedRawTextSha256;
  });
  fixture.results.headings.forEach((item, index) => {
    const expected = fixture.annotations.headings[index];
    item.predicted = expected.label === 'positive';
    if (item.predicted) {
      item.pageNumber = expected.expectedPageNumber;
      item.rawTextSha256 = expected.expectedRawTextSha256;
    }
    else delete item.pageNumber;
  });
  fixture.results.sentences[0].pageNumbers = [99];
  fixture.results.sentences[1].documentSha256 = hash('wrong-document');
  const report = evaluatePdfSemanticCorpus(fixture.annotations, fixture.results,
    { syntheticTestMode: true });
  assert.equal(report.status, 'TEST_FAIL');
  assert.equal(report.metrics.wrongPageCount, 1);
  assert.equal(report.metrics.wrongDocumentCount, 1);
  assert.equal(report.checks.noWrongPage, false);
  assert.equal(report.checks.noWrongDocument, false);
});

test('versioned JSONL annotations are accepted and bounded', async () => {
  const { readVersionedCorpusFile, ANNOTATION_SCHEMA_VERSION } = await import(
    '../scripts/validate-pdf-semantic-corpus.mjs');
  const fixture = syntheticFixture();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'brevess-pdf-corpus-'));
  const file = path.join(directory, 'annotations.jsonl');
  const records = [
    { recordType: 'meta', schemaVersion: ANNOTATION_SCHEMA_VERSION,
      corpusId: fixture.annotations.corpusId, provenance: fixture.annotations.provenance },
    ...fixture.annotations.documents.map(item => ({ recordType: 'document', ...item })),
    ...fixture.annotations.sentences.map(item => ({ recordType: 'sentence', ...item })),
    ...fixture.annotations.headings.map(item => ({ recordType: 'heading', ...item })),
    ...fixture.annotations.sectionRanges.map(item => ({ recordType: 'section-range', ...item }))
  ];
  fs.writeFileSync(file, `${records.map(item => JSON.stringify(item)).join('\n')}\n`, 'utf8');
  try {
    const parsed = readVersionedCorpusFile(file, ANNOTATION_SCHEMA_VERSION);
    assert.equal(parsed.documents.length, 8);
    assert.equal(parsed.sentences.length, 120);
    assert.equal(parsed.headings.length, 80);
    assert.equal(parsed.sectionRanges.length, 32);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('CLI with no real annotation file reports NOT_READY rather than passing', async () => {
  const { runPdfSemanticCorpusCli } = await import(
    '../scripts/validate-pdf-semantic-corpus.mjs');
  const report = runPdfSemanticCorpusCli(['node', 'validate-pdf-semantic-corpus.mjs']);
  assert.equal(report.status, 'NOT_READY');
  assert.equal(report.code, 'ANNOTATIONS_REQUIRED');
  assert.equal(report.eligibleForRelease, false);
});

test('real CLI child process exits 2 when human annotations are not ready', t => {
  const script = path.resolve(__dirname, '..', 'scripts', 'validate-pdf-semantic-corpus.mjs');
  const child = childProcess.spawnSync(process.execPath, [script], {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf8',
    windowsHide: true,
    timeout: 10_000,
    maxBuffer: 1024 * 1024
  });
  if (child.error?.code === 'EPERM') {
    t.skip('the current filesystem sandbox forbids Node child processes');
    return;
  }
  assert.ifError(child.error);
  assert.equal(child.signal, null);
  assert.equal(child.status, 2);
  assert.equal(child.stderr, '');
  const report = JSON.parse(child.stdout);
  assert.equal(report.status, 'NOT_READY');
  assert.equal(report.code, 'ANNOTATIONS_REQUIRED');
});
