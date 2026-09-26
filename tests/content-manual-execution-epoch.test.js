const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const contentSource = fs.readFileSync(path.join(__dirname, '..', 'content.js'), 'utf8');

function realFunction(name, dependencies = {}) {
  let start = contentSource.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} exists in production content`);
  if (contentSource.slice(start - 6, start) === 'async ') start -= 6;
  const bodyStart = contentSource.indexOf(') {', start) + 2;
  let depth = 0;
  let end = bodyStart;
  for (; end < contentSource.length; end += 1) {
    if (contentSource[end] === '{') depth += 1;
    if (contentSource[end] === '}') depth -= 1;
    if (depth === 0) break;
  }
  assert.ok(end < contentSource.length, `${name} has a complete body`);
  return Function(...Object.keys(dependencies),
    `return (${contentSource.slice(start, end + 1)});`)(...Object.values(dependencies));
}

const nextEpoch = realFunction('nextManualDocumentEpochState');
const prepareProof = realFunction('prepareArticleArchiveRestoreManualExecutionProof', {
  articleWorkspaceRestoreError: () => new Error('ARTICLE_WORKSPACE_RESTORE_TARGET_MISMATCH')
});
const paper = {
  documentId: 'doc-initial',
  record: { documentHash: 'hash-initial', canonicalUrl: 'https://example.test/initial' }
};
const identity = { documentId: paper.documentId, ...paper.record };
const proof = epoch => ({ ...identity, contentWorldNonce: 'a'.repeat(32), documentEpoch: epoch });
const mismatch = /ARTICLE_WORKSPACE_RESTORE_TARGET_MISMATCH/u;

test('initial content lifecycle zero creates the first usable document epoch', () => {
  const initial = contentSource.match(/let articleWorkspaceLifecycleGeneration = (\d+);/u);
  assert.ok(initial, 'read the actual production lifecycle initializer');
  const state = nextEpoch(null, paper, Number(initial[1]));
  assert.equal(state.documentEpoch, 1);
  assert.equal(state.lifecycleGeneration, 0);
  assert.notEqual(state.identityKey, '');
});

test('same binding stays stable at lifecycle zero and zero-to-one replacement advances epoch', () => {
  const initial = nextEpoch(null, paper, 0);
  assert.equal(initial.documentEpoch, 1);
  assert.strictEqual(nextEpoch(initial, { ...paper }, 0), initial);
  const restored = nextEpoch(initial, paper, 1);
  assert.equal(restored.documentEpoch, 2);
  assert.equal(restored.lifecycleGeneration, 1);
  assert.strictEqual(nextEpoch(restored, paper, 1), restored);
  assert.equal(nextEpoch(restored, {
    ...paper, record: { ...paper.record, documentHash: 'changed-hash' }
  }, 1).documentEpoch, 3, 'a changed document cannot reuse the old proof');
});

test('invalid lifecycle numbers and missing identity never create a usable proof', () => {
  const previous = nextEpoch(null, paper, 4);
  for (const lifecycle of [-1, -0.5, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.deepEqual(nextEpoch(previous, paper, lifecycle), {
      documentEpoch: 0, identityKey: '', lifecycleGeneration: 0
    });
  }
  for (const value of [{}, { ...paper, documentId: '' }, {
    ...paper, record: { ...paper.record, documentHash: '' }
  }, { ...paper, record: { ...paper.record, canonicalUrl: '' } }]) {
    assert.equal(nextEpoch(previous, value, 0).documentEpoch, 0);
  }
});

test('first archive restore obtains a strictly newer proof through forced preparation', async () => {
  let epochState = nextEpoch(null, paper, 0);
  const before = proof(epochState.documentEpoch);
  let forcedPreparations = 0;
  const after = await prepareProof({ currentArchive: identity }, {
    manualProofBefore: before
  }, {
    prepare: async options => {
      assert.deepEqual(options, { force: true });
      forcedPreparations += 1;
      epochState = nextEpoch(epochState, paper, 1);
    },
    capture: () => proof(epochState.documentEpoch)
  });
  assert.equal(forcedPreparations, 1);
  assert.equal(before.documentEpoch, 1);
  assert.equal(after.documentEpoch, 2);
});

test('archive proof rejects invalid preconditions before calling forced preparation', async () => {
  const valid = proof(1);
  for (const mutation of [
    { documentEpoch: 0 }, { documentEpoch: -1 }, { documentEpoch: 1.5 },
    { documentId: 'other' }, { documentHash: 'other' }, { canonicalUrl: 'other' },
    { contentWorldNonce: 'invalid' }
  ]) {
    let calls = 0;
    await assert.rejects(() => prepareProof({ currentArchive: identity }, {
      manualProofBefore: { ...valid, ...mutation }
    }, {
      prepare: async () => { calls += 1; }, capture: () => proof(2)
    }), mismatch);
    assert.equal(calls, 0);
  }
});

test('archive proof still rejects a nonincrementing epoch after forced preparation', async () => {
  const state = nextEpoch(null, paper, 4);
  // No lifecycle replacement: a force flag alone must not manufacture a new epoch.
  for (const afterEpoch of [1, 0, -1, 1.5]) {
    let calls = 0;
    await assert.rejects(() => prepareProof({ currentArchive: identity }, {
      manualProofBefore: proof(1)
    }, {
      prepare: async () => {
        calls += 1;
        assert.strictEqual(nextEpoch(state, paper, 4), state);
      },
      capture: () => proof(afterEpoch)
    }), mismatch);
    assert.equal(calls, 1);
  }
});

test('archive proof still rejects changed identity or content world after forced preparation', async () => {
  for (const mutation of [
    { documentId: 'other' }, { documentHash: 'other' }, { canonicalUrl: 'other' },
    { contentWorldNonce: 'b'.repeat(32) }
  ]) {
    let calls = 0;
    await assert.rejects(() => prepareProof({ currentArchive: identity }, {
      manualProofBefore: proof(1)
    }, {
      prepare: async () => { calls += 1; },
      capture: () => ({ ...proof(2), ...mutation })
    }), mismatch);
    assert.equal(calls, 1);
  }
});
