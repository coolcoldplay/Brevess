const test = require('node:test');
const assert = require('node:assert/strict');
require('../core/privacy-sanitizer.js');
require('../core/article-workspace.js');
const api = require('../core/article-workspace-save.js');
const identity = {
  workspaceId: `workspace:${'a'.repeat(64)}`,
  canonicalUrl: 'https://example.org/paper', workspaceGeneration: 3
};
const T0 = '2026-09-23T00:00:00.000Z';
const T1 = '2026-09-23T00:01:00.000Z';
const T2 = '2026-09-23T00:02:00.000Z';
const T3 = '2026-09-23T00:03:00.000Z';
function event(extra = {}) {
  return { ...identity, operationId: 'save:one', status: 'complete', completedAt: T1, scope: 'browser-local', ...extra };
}
function normalize(value, target = identity) {
  assert.equal(typeof api.normalizeLocalLibrarySaveEventsAsset, 'function', 'save-events normalizer must exist');
  return api.normalizeLocalLibrarySaveEventsAsset(value, target);
}
function record(previous, next = event()) {
  assert.equal(typeof api.recordLocalLibrarySaveEvent, 'function', 'save-events recorder must exist');
  return api.recordLocalLibrarySaveEvent(previous, next);
}
function successful() { return record(null).asset; }

test('LIB-010 exports the ordinary browser-local save event asset contract', () => {
  assert.equal(api.LOCAL_LIBRARY_SAVE_EVENTS_ASSET_PATH, 'annotations/library-save-events.json');
  assert.equal(typeof api.normalizeLocalLibrarySaveEventsAsset, 'function');
  assert.equal(typeof api.recordLocalLibrarySaveEvent, 'function');
  assert.equal(api.classifyWorkspaceAssetConflict(api.LOCAL_LIBRARY_SAVE_EVENTS_ASSET_PATH), 'manual_resolution');
});

test('missing historical events remain absent instead of importing workspace or snapshot times', () => {
  assert.equal(normalize(null), null);
  assert.equal(normalize(undefined), null);
  assert.equal(normalize({ ...identity, createdAt: T0, updatedAt: T1, savedAt: T2 }), null);
  const first = record(null, event({ createdAt: T0, updatedAt: T2, capturedAt: T0, savedAt: T3 })).asset;
  assert.equal(first.firstRecordedAt, T1);
  assert.equal(first.lastSavedAt, T1);
  assert.equal(first.createdAt, undefined);
  assert.equal(first.savedAt, undefined);
});

test('first complete operation records its actual completion time with explicit local scope', () => {
  const result = record(null);
  assert.equal(result.changed, true);
  assert.equal(result.reason, 'recorded');
  assert.deepEqual(result.asset, {
    schemaVersion: 1, ...identity, scope: 'browser-local', firstRecordedAt: T1, lastSavedAt: T1,
    operationId: 'save:one', lastAttempt: { operationId: 'save:one', status: 'complete', completedAt: T1 }
  });
  assert.equal(Object.isFrozen(result.asset), true);
  assert.equal(Object.isFrozen(result.asset.lastAttempt), true);
});

test('a later complete operation advances last save but never rewrites first recorded success', () => {
  const result = record(successful(), event({ operationId: 'save:two', completedAt: T2 }));
  assert.equal(result.changed, true);
  assert.equal(result.asset.firstRecordedAt, T1);
  assert.equal(result.asset.lastSavedAt, T2);
  assert.equal(result.asset.operationId, 'save:two');
  assert.deepEqual(result.asset.lastAttempt, { operationId: 'save:two', status: 'complete', completedAt: T2 });
});

test('partial-only history has no successful save time and does not masquerade as directory completion', () => {
  const result = record(null, event({ status: 'partial' }));
  assert.equal(result.changed, true);
  assert.equal(result.asset.firstRecordedAt, '');
  assert.equal(result.asset.lastSavedAt, '');
  assert.equal(result.asset.operationId, '');
  assert.deepEqual(result.asset.lastAttempt, { operationId: 'save:one', status: 'partial', completedAt: T1 });
  assert.equal(result.asset.directoryPersisted, undefined);
  assert.deepEqual(normalize(JSON.parse(JSON.stringify(result.asset))), result.asset);
});

test('first complete after partial-only history starts both successful dates at the actual complete event', () => {
  const partial = record(null, event({ status: 'partial' })).asset;
  const result = record(partial, event({ operationId: 'save:two', completedAt: T2 }));
  assert.equal(result.asset.firstRecordedAt, T2);
  assert.equal(result.asset.lastSavedAt, T2);
});

test('a newer partial attempt preserves the previous complete timestamp and operation', () => {
  const result = record(successful(), event({ operationId: 'save:partial', status: 'partial', completedAt: T2 }));
  assert.equal(result.changed, true);
  assert.equal(result.asset.firstRecordedAt, T1);
  assert.equal(result.asset.lastSavedAt, T1);
  assert.equal(result.asset.operationId, 'save:one');
  assert.deepEqual(result.asset.lastAttempt, { operationId: 'save:partial', status: 'partial', completedAt: T2 });
  assert.deepEqual(normalize(JSON.parse(JSON.stringify(result.asset))), result.asset);
});

test('the retained last successful operation is idempotent even after a newer partial attempt', () => {
  const previous = record(successful(), event({ operationId: 'save:partial', status: 'partial', completedAt: T2 })).asset;
  for (const next of [event(), event({ completedAt: T3 }), event({ completedAt: T3, status: 'partial' })]) {
    const result = record(previous, next);
    assert.equal(result.changed, false);
    assert.equal(result.reason, 'duplicate-operation');
    assert.deepEqual(result.asset, previous);
  }
});

test('the retained latest attempt is immutable: retry payload cannot promote partial to complete', () => {
  const previous = record(null, event({ status: 'partial' })).asset;
  for (const next of [event({ status: 'partial' }), event({ completedAt: T3 })]) {
    const result = record(previous, next);
    assert.equal(result.changed, false);
    assert.equal(result.reason, 'duplicate-operation');
    assert.deepEqual(result.asset, previous);
  }
});

test('out-of-order and equal-time new operations do not rewind success or overwrite last attempt', () => {
  const previous = record(successful(), event({ operationId: 'save:partial', status: 'partial', completedAt: T2 })).asset;
  for (const completedAt of [T0, T1, T2]) {
    const result = record(previous, event({ operationId: 'save:delayed', completedAt }));
    assert.equal(result.changed, false);
    assert.equal(result.reason, 'out-of-order');
    assert.deepEqual(result.asset, previous);
  }
});

test('an operation no longer retained is blocked by its frozen old completion time, not an invented infinite ID history', () => {
  const second = record(successful(), event({ operationId: 'save:two', completedAt: T2 })).asset;
  const third = record(second, event({ operationId: 'save:three', completedAt: T3 })).asset;
  const result = record(third, event());
  assert.equal(result.changed, false);
  assert.equal(result.reason, 'out-of-order');
  assert.deepEqual(result.asset, third);
});

test('complete events can use strict leap-day UTC instants with no wall-clock or timezone guess', () => {
  const completedAt = '2024-02-29T23:59:59.999Z';
  assert.equal(record(null, event({ completedAt })).asset.lastSavedAt, completedAt);
  assert.equal(record(null, event({ completedAt: '0001-01-01T00:00:00.000Z' })).asset.lastSavedAt,
    '0001-01-01T00:00:00.000Z');
});

test('invalid, imprecise, offset and oversized timestamps never acquire Date.now fallback', () => {
  for (const completedAt of [undefined, null, '', 1727000000, '2026-09-23', '2026-09-23T00:00:00Z',
    '2026-09-23T00:00:00.000+00:00', '2023-02-29T00:00:00.000Z', '1900-02-29T00:00:00.000Z',
    '2026-04-31T00:00:00.000Z', '2026-01-01T24:00:00.000Z', '2026-01-01T00:00:60.000Z',
    '0000-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z\n', '2'.repeat(10000)]) {
    assert.throws(() => record(null, event({ completedAt })), { code: 'LOCAL_LIBRARY_SAVE_EVENT_INVALID' });
  }
});

test('only explicit complete or partial browser-local outcomes are valid input events', () => {
  for (const next of [null, [], {}, event({ status: undefined }), event({ status: true }),
    event({ status: 'completed' }), event({ status: 'pending' }), event({ scope: undefined }),
    event({ scope: 'directory' }), event({ operationId: '' }), event({ operationId: 123 }),
    event({ operationId: 'a'.repeat(121) }), event({ operationId: 'save\n1' }),
    event({ operationId: ' save:one' }), event({ operationId: 'save/one' })]) {
    assert.throws(() => record(null, next), { code: 'LOCAL_LIBRARY_SAVE_EVENT_INVALID' });
  }
  assert.equal(record(null, event({ operationId: 'a'.repeat(120) })).asset.operationId.length, 120);
});

test('workspace identity and generation are required and mismatches preserve the old asset', () => {
  const previous = successful();
  const before = JSON.stringify(previous);
  for (const changed of [{ workspaceId: `workspace:${'b'.repeat(64)}` },
    { canonicalUrl: 'https://example.org/other' }, { workspaceGeneration: 4 }]) {
    assert.equal(normalize(previous, { ...identity, ...changed }), null);
    assert.throws(() => record(previous, event({ operationId: 'save:other', completedAt: T2, ...changed })),
      { code: 'LOCAL_LIBRARY_SAVE_EVENTS_ASSET_INVALID' });
  }
  for (const changed of [{ workspaceId: 'bad' }, { workspaceGeneration: 0 }, { workspaceGeneration: '3' },
    { workspaceGeneration: Number.MAX_SAFE_INTEGER + 1 }, { canonicalUrl: 'javascript:alert(1)' },
    { canonicalUrl: 'https://user:pass@example.org/paper' }, { canonicalUrl: `https://example.org/${'x'.repeat(4000)}` }]) {
    assert.throws(() => record(null, event(changed)), { code: 'LOCAL_LIBRARY_SAVE_EVENT_INVALID' });
  }
  assert.equal(JSON.stringify(previous), before);
});

test('normalizer rejects malformed history and impossible relationships between attempt and success', () => {
  const valid = successful();
  for (const changed of [{ schemaVersion: 2 }, { scope: 'directory' }, { firstRecordedAt: T2 },
    { lastSavedAt: '' }, { firstRecordedAt: '' }, { operationId: '' }, { lastAttempt: null },
    { lastAttempt: { ...valid.lastAttempt, completedAt: T0 } },
    { lastAttempt: { ...valid.lastAttempt, operationId: 'wrong' } },
    { lastAttempt: { ...valid.lastAttempt, status: 'partial', completedAt: T2 } }]) {
    assert.equal(normalize({ ...valid, ...changed }), null, JSON.stringify(changed));
  }
  assert.equal(normalize({ ...valid, lastSavedAt: '2023-02-29T00:00:00.000Z' }), null);
});

test('invalid existing asset is not treated as missing, overwritten or repaired by a new event', () => {
  for (const previous of [{}, [], { ...successful(), schemaVersion: 99 }]) {
    const before = JSON.stringify(previous);
    assert.throws(() => record(previous, event({ operationId: 'save:next', completedAt: T2 })),
      { code: 'LOCAL_LIBRARY_SAVE_EVENTS_ASSET_INVALID' });
    assert.equal(JSON.stringify(previous), before);
  }
});

test('normalize and record return only immutable event fields and leave caller data untouched', () => {
  const previous = JSON.parse(JSON.stringify(successful()));
  previous.untrusted = '<script>ignored</script>';
  previous.lastAttempt.extra = 'ignored';
  const before = JSON.stringify(previous);
  const clean = normalize(previous);
  assert.equal(clean.untrusted, undefined);
  assert.equal(clean.lastAttempt.extra, undefined);
  const result = record(previous, event({ operationId: 'save:next', completedAt: T2 }));
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.asset), true);
  assert.equal(JSON.stringify(previous), before);
});

test('unrelated publication aliases are never traversed when validating the event identity', () => {
  const previous = { ...successful() };
  Object.defineProperty(previous, 'aliases', { get() { throw new Error('UNRELATED_ALIASES_READ'); } });
  assert.notEqual(normalize(previous), null);
  const next = event({ operationId: 'save:next', completedAt: T2 });
  Object.defineProperty(next, 'doi', { get() { throw new Error('UNRELATED_DOI_READ'); } });
  assert.equal(record(previous, next).asset.lastSavedAt, T2);
});
