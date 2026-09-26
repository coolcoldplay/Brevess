const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const base = path.join(root, 'benchmarks', 'baseline');
const out = path.join(root, 'benchmarks', 'checkpoint2');
const json = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const canonicalizeLf = bytes => Buffer.from(
  bytes.toString('utf8').replace(/\r\n?|\n/g, '\n'),
  'utf8'
);

test('52 production variants map deterministically to 51 Prompt review records', () => {
  const text = fs.readFileSync(path.join(base, 'prompt-record-to-variant-map.csv'), 'utf8');
  const rows = text.trim().split(/\r?\n/).slice(1);
  assert.equal(rows.length, 52);
  const recordIds = new Set(rows.map(line => line.match(/^"([^"]+)"/)?.[1]));
  assert.equal(recordIds.size, 51);
  assert.match(text, /abbreviation\.translation\.default/);
  assert.match(text, /abbreviation\.translation\.partial/);
});

test('split manifest hash is locked and clusters never cross splits', () => {
  const bytes = canonicalizeLf(fs.readFileSync(path.join(out, 'split-manifest.json')));
  const lock = json(path.join(out, 'split-manifest.lock'));
  assert.equal(bytes.length, lock.bytes);
  assert.equal(sha(bytes), lock.sha256);
  const split = JSON.parse(bytes);
  const seen = new Map();
  for (const item of split.clusters) {
    assert.ok(['development', 'validation', 'locked_test'].includes(item.split));
    assert.equal(seen.get(item.clusterId) || item.split, item.split);
    seen.set(item.clusterId, item.split);
  }
});

test('split manifest byte canonicalization treats all line endings as LF', () => {
  assert.deepEqual(
    canonicalizeLf(Buffer.from('first\r\nsecond\rthird\n', 'utf8')),
    Buffer.from('first\nsecond\nthird\n', 'utf8')
  );
});

test('blind human queue uses natural candidates and keeps locked_test invisible', () => {
  const queue = json(path.join(out, 'human-review-queue.json'));
  assert.equal(queue.items.length, 528);
  assert.equal(queue.lockedTestItemsIncluded, false);
  assert.ok(queue.items.every(item => ['development', 'validation'].includes(item.split)));
  assert.equal(Object.keys(queue.coverage).length, 12);
  for (const [category, coverage] of Object.entries(queue.coverage)) {
    assert.ok(coverage.naturalHardNegatives >= 30, category);
    assert.ok(coverage.distinctPaperClusters >= 5, category);
    assert.equal(coverage.syntheticExamplesUsed, 0, category);
    assert.equal(coverage.positiveShortage,
      Math.max(0, 15 - coverage.naturalPositiveCandidates), category);
  }
});

test('Figure queue has 30 unique real images, full modality strata, and no cluster copies', () => {
  const queue = json(path.join(out, 'figure-review-queue.json'));
  assert.equal(queue.items.length, 30);
  assert.equal(queue.lockedTestItemsIncluded, false);
  assert.equal(new Set(queue.items.map(item => item.imageSha256)).size, 30);
  assert.equal(new Set(queue.items.map(item => item.clusterId)).size, 30);
  for (const [modality, count] of Object.entries(queue.modalityCoverage)) {
    assert.ok(count >= 1, modality);
  }
  for (const item of queue.items) {
    assert.ok(['development', 'validation'].includes(item.split));
    const file = path.join(out, item.imageAsset);
    assert.ok(fs.existsSync(file), item.imageAsset);
    assert.equal(sha(fs.readFileSync(file)), item.imageSha256);
    assert.ok(item.imageWidth >= 250 && item.imageHeight >= 140);
  }
});

test('review HTML files are standalone and expose required adjudication controls', () => {
  const human = fs.readFileSync(path.join(root, 'Checkpoint2_Human_Review_Queue.html'), 'utf8');
  const figures = fs.readFileSync(path.join(root, 'Checkpoint2_Figure_Review_Queue.html'), 'utf8');
  assert.match(human, /候选标签在此之前不会显示/);
  assert.match(human, /contextInsufficient/);
  assert.match(human, /quoteStart/);
  assert.match(human, /application\/jsonl/);
  assert.match(figures, /panelLabels/);
  assert.match(figures, /captionPairing/);
  assert.match(figures, /directObservations/);
  assert.match(figures, /unsupportedConclusions/);
  assert.match(figures, /application\/jsonl/);
});

test('conflict report preserves the frozen 38.87 per 1000 denominator', () => {
  const report = json(path.join(out, 'conflict-analysis.json'));
  assert.equal(report.denominatorActiveSentences, 209343);
  assert.equal(report.totalActiveConflictSentences, 8138);
  assert.equal(report.activeConflictRatePer1000, 38.87);
  assert.equal(report.topPairs.length, 20);
  assert.ok(report.topPairs.every(pair => pair.examples.length >= 1));
});
