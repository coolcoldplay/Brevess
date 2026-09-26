const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..');
const manifestPath = path.join(repoRoot, 'benchmarks', 'scenarios-v1', 'manifest.json');
const manifestLockPath = path.join(repoRoot, 'benchmarks', 'scenarios-v1', 'manifest.lock.json');
const privateDir = path.join(repoRoot, 'tmp', 'scenario-corpus-v1');
const corpusRoot = path.resolve(process.env.ZOTERO_MINERU_ROOT || path.join(
  os.homedir(), 'Zotero', 'llm-for-zotero-mineru'
));
const splitNames = ['development', 'validation', 'locked_test'];

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function readJsonl(file) {
  return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map(JSON.parse);
}

test('tracked scenario manifest is sanitized, pending, and balanced by split and stratum', () => {
  const manifest = readJson(manifestPath);
  assert.equal(manifest.counts.total, 48);
  assert.deepEqual(manifest.counts.bySplit, {
    development: 24,
    locked_test: 12,
    validation: 12
  });
  assert.deepEqual(manifest.counts.bySamplingStratum, {
    clinical_observational: 16,
    mechanism_preclinical: 16,
    review: 16
  });
  assert.equal(manifest.records.length, 48);
  assert.ok(manifest.records.every(record => record.annotationStatus === 'pending'));
  assert.ok(manifest.records.every(record => Array.isArray(record.labels) && record.labels.length === 0));
  assert.ok(manifest.records.every(record => !Object.hasOwn(record.window, 'text')));
  assert.ok(manifest.records.every(record => !Object.hasOwn(record.window, 'paragraphs')));
  assert.ok(manifest.records.every(record => record.source.doi || record.source.pmcid));
  assert.equal(manifest.provenance.externalApiOrModelRequests, 0);
  assert.equal(manifest.annotationPolicy.humanGoldClaimed, false);
  assert.ok(manifest.counts.bySection.methods > 0);
  assert.ok(manifest.counts.bySection.results > 0);
  assert.ok(manifest.counts.bySection.discussion > 0);
});

test('scenario manifest lock covers the exact tracked manifest bytes', () => {
  const text = fs.readFileSync(manifestPath, 'utf8');
  const lock = readJson(manifestLockPath);
  assert.equal(lock.algorithm, 'sha256');
  assert.equal(lock.bytes, Buffer.byteLength(text));
  assert.equal(lock.sha256, sha256(text));
});

test('record IDs are stable and DOI/cluster identities do not cross splits', () => {
  const manifest = readJson(manifestPath);
  const seenIds = new Set();
  const clusterSplits = new Map();
  const doiSplits = new Map();
  const checkpoint = readJson(path.join(repoRoot, 'benchmarks', 'checkpoint2', 'split-manifest.json'));
  const authoritativeSplits = new Map(checkpoint.clusters.map(item => [item.clusterId, item.split]));
  for (const record of manifest.records) {
    const expectedId = `scenario-${sha256([
      manifest.samplingSeed,
      record.source.clusterId,
      record.source.documentId,
      record.section.kind,
      record.window.startByteOffset,
      record.window.sha256
    ].join('|')).slice(0, 20)}`;
    assert.equal(record.recordId, expectedId);
    assert.equal(seenIds.has(record.recordId), false);
    seenIds.add(record.recordId);
    assert.equal(authoritativeSplits.get(record.source.clusterId), record.split);
    assert.equal(clusterSplits.has(record.source.clusterId), false, 'one window must be sampled per cluster');
    clusterSplits.set(record.source.clusterId, record.split);
    if (record.source.doi) {
      const prior = doiSplits.get(record.source.doi);
      assert.ok(!prior || prior === record.split, `DOI crosses splits: ${record.source.doi}`);
      doiSplits.set(record.source.doi, record.split);
    }
  }
});

const localArtifactsAvailable = fs.existsSync(corpusRoot)
  && splitNames.every(split => fs.existsSync(path.join(privateDir, `${split}.jsonl`)));

test('private windows match exact contiguous source offsets and hashes', {
  skip: !localArtifactsAvailable
}, () => {
  const records = splitNames.flatMap(split => readJsonl(path.join(privateDir, `${split}.jsonl`)));
  assert.equal(records.length, 48);
  for (const record of records) {
    const sourceFile = path.join(corpusRoot, record.source.markdownPath);
    const source = fs.readFileSync(sourceFile, 'utf8');
    assert.equal(sha256(source), record.source.markdownSha256);
    assert.equal(source.slice(record.window.startOffset, record.window.endOffset), record.window.text);
    assert.equal(sha256(record.window.text), record.window.sha256);
    assert.equal(Buffer.byteLength(record.window.text), record.window.byteCount);
    assert.equal(record.window.paragraphCount, 3);
    assert.equal(record.window.paragraphs.length, 3);
    assert.equal(record.window.paragraphEndIndex - record.window.paragraphStartIndex, 2);
    for (const paragraph of record.window.paragraphs) {
      assert.equal(source.slice(paragraph.startOffset, paragraph.endOffset), paragraph.text);
      assert.equal(sha256(paragraph.text), paragraph.sha256);
    }
    assert.equal(record.annotationStatus, 'pending');
    assert.deepEqual(record.labels, []);
    assert.equal(record.providerDataPolicy.externalUploadPerformed, false);
  }
});

test('tracked artifacts contain no locked-test paragraph or heading text', {
  skip: !localArtifactsAvailable
}, () => {
  const trackedText = [manifestPath, manifestLockPath,
    path.join(repoRoot, 'benchmarks', 'scenarios-v1', 'README.md')]
    .map(file => fs.readFileSync(file, 'utf8')).join('\n');
  const lockedRecords = readJsonl(path.join(privateDir, 'locked_test.jsonl'));
  for (const record of lockedRecords) {
    assert.equal(trackedText.includes(record.window.text), false);
    assert.equal(trackedText.includes(record.section.heading), false);
    for (const paragraph of record.window.paragraphs) {
      assert.equal(trackedText.includes(paragraph.text), false);
    }
  }
});

test('deterministic regeneration verifies all tracked and private artifacts', {
  skip: !localArtifactsAvailable,
  timeout: 60_000
}, async () => {
  const generator = await import(pathToFileURL(
    path.join(repoRoot, 'scripts', 'prepare-scenario-corpus.mjs')
  ));
  const summary = generator.main(['--verify']);
  assert.equal(summary.mode, 'verify');
});
