const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const { createBuiltInCategories } = require('../core/category-store.js');
require('../providers/provider-utils.js');
require('../core/prompt-compiler.js');
require('../core/chunker.js');
require('../core/result-validator.js');
require('../core/highlight-stream.js');
require('../core/cache-planner.js');
require('../core/analysis-pipeline.js');
const {
  createMemoryAnalysisCache,
  createIndexedDbAnalysisCache,
  analyzeWithCategoryCache,
  hashDocument,
  ANALYSIS_CACHE_VERSIONS,
  DEFAULT_ANALYSIS_CACHE_MAX_ENTRIES,
  DEFAULT_ANALYSIS_CACHE_MAX_AGE_MS,
  MAX_PROTECTED_MECHANISM_RECORDS
} = require('../core/analysis-cache.js');

function loadAnalysisCacheWithProtectedByteLimit(limit) {
  const sourcePath = path.join(__dirname, '..', 'core', 'analysis-cache.js');
  const original = fs.readFileSync(sourcePath, 'utf8');
  const marker = 'const MAX_PROTECTED_MECHANISM_TOTAL_BYTES = 256 * 1024 * 1024;';
  assert.equal(original.includes(marker), true, 'production capacity marker');
  const source = original.replace(
    marker, `const MAX_PROTECTED_MECHANISM_TOTAL_BYTES = ${limit};`
  );
  const sandbox = {
    module: { exports: {} }, exports: {}, TextEncoder, structuredClone,
    queueMicrotask, setTimeout, clearTimeout
  };
  sandbox.globalThis = sandbox;
  const context = vm.createContext(sandbox);
  vm.runInContext(source, context, { filename: sourcePath });
  return {
    ...sandbox.module.exports,
    toRealm(value) {
      sandbox.__analysisCacheFixture = JSON.stringify(value);
      return vm.runInContext('JSON.parse(__analysisCacheFixture)', context);
    }
  };
}

function protectedRecordWithExactBytes(key, byteLength) {
  const record = { key, createdAt: 1, owner: '' };
  const baseBytes = new TextEncoder().encode(JSON.stringify(record)).byteLength;
  assert.ok(byteLength >= baseBytes);
  record.owner = 'x'.repeat(byteLength - baseBytes);
  assert.equal(new TextEncoder().encode(JSON.stringify(record)).byteLength, byteLength);
  return record;
}

function createTransactionalIndexedDb(initialEntries = [], options = {}) {
  const entries = new Map(initialEntries.map(value => [value.key, value]));
  const transactionModes = [];
  let transactionCount = 0;
  const database = {
    transaction(_name, mode) {
      transactionCount += 1;
      const transactionId = transactionCount;
      if (options.failTransactions?.has(transactionCount)) {
        throw new Error('SECRET maintenance failure');
      }
      transactionModes.push(mode);
      const snapshot = new Map(entries);
      const transaction = {
        error: null,
        pending: 0,
        aborted: false,
        completionScheduled: false,
        abort() {
          if (this.aborted) return;
          this.aborted = true;
          entries.clear();
          snapshot.forEach((value, key) => entries.set(key, value));
          queueMicrotask(() => this.onabort?.());
        },
        schedule() {
          if (this.completionScheduled || this.aborted) return;
          this.completionScheduled = true;
          queueMicrotask(() => {
            this.completionScheduled = false;
            if (!this.aborted && this.pending === 0) {
              if (options.abortTransactions?.has(transactionId)) {
                this.error = new Error('SECRET transaction abort');
                this.abort();
              } else this.oncomplete?.();
            }
          });
        },
        objectStore() {
          const request = (operation, kind) => {
            const output = {};
            transaction.pending += 1;
            if (options.hangRequests?.has(`${transactionId}:${kind}`)) return output;
            queueMicrotask(() => {
              try {
                if (options.failRequests?.has(`${transactionId}:${kind}`)) {
                  throw new Error(`SECRET ${kind} request failure`);
                }
                output.result = operation();
                output.onsuccess?.();
              } catch (error) {
                output.error = error;
                transaction.error = error;
                output.onerror?.();
                transaction.abort();
              } finally {
                transaction.pending -= 1;
                transaction.schedule();
              }
            });
            return output;
          };
          return {
            get(key) {
              return request(() => {
                if (options.failGet) throw new Error('SECRET get request failure');
                return entries.get(key);
              }, 'get');
            },
            put(value) { return request(() => entries.set(value.key, value), 'put'); },
            getAll() { return request(() => [...entries.values()], 'getAll'); },
            delete(key) { return request(() => entries.delete(key), 'delete'); }
          };
        }
      };
      return transaction;
    }
  };
  const indexedDbRef = {
    open() {
      const request = { result: database };
      queueMicrotask(() => request.onsuccess?.());
      return request;
    }
  };
  return {
    indexedDbRef,
    entries,
    transactionModes,
    transactionCount: () => transactionCount
  };
}

function createSerializedIndexedDb(initialEntries = [], onGet = () => {}) {
  const entries = new Map(initialEntries.map(value => [value.key, value]));
  const waiting = [];
  let active = null;
  let nextId = 0;

  function activateNext() {
    if (active || !waiting.length) return;
    active = waiting.shift();
    active.snapshot = new Map(entries);
    active.active = true;
    active.drain();
  }

  function finish(transaction) {
    if (active !== transaction) return;
    active = null;
    transaction.active = false;
    transaction.oncomplete?.();
    queueMicrotask(activateNext);
  }

  const database = {
    objectStoreNames: { contains: () => true },
    transaction(_name, mode) {
      const transaction = {
        id: ++nextId,
        mode,
        error: null,
        aborted: false,
        active: false,
        completing: false,
        snapshot: null,
        requests: [],
        abort() {
          if (this.aborted) return;
          this.aborted = true;
          entries.clear();
          this.snapshot?.forEach((value, key) => entries.set(key, value));
          if (active === this) active = null;
          queueMicrotask(() => {
            this.onabort?.();
            activateNext();
          });
        },
        enqueue(operation) {
          const request = {};
          this.requests.push({ request, operation });
          if (this.active) queueMicrotask(() => this.drain());
          return request;
        },
        drain() {
          if (!this.active || this.aborted) return;
          const item = this.requests.shift();
          if (item) {
            queueMicrotask(() => {
              try {
                item.request.result = item.operation();
                item.request.onsuccess?.();
              } catch (error) {
                item.request.error = error;
                this.error = error;
                item.request.onerror?.();
                this.abort();
                return;
              }
              this.drain();
            });
            return;
          }
          if (this.completing) return;
          this.completing = true;
          setImmediate(() => {
            this.completing = false;
            if (!this.active || this.aborted) return;
            if (this.requests.length) this.drain();
            else finish(this);
          });
        },
        objectStore() {
          return {
            get: key => transaction.enqueue(() => {
              onGet({ key, mode, transactionId: transaction.id });
              return entries.get(key);
            }),
            put: value => transaction.enqueue(() => entries.set(value.key, value)),
            getAll: () => transaction.enqueue(() => [...entries.values()]),
            delete: key => transaction.enqueue(() => entries.delete(key))
          };
        }
      };
      waiting.push(transaction);
      queueMicrotask(activateNext);
      return transaction;
    }
  };
  const indexedDbRef = {
    open() {
      const request = { result: database };
      queueMicrotask(() => request.onsuccess?.());
      return request;
    }
  };
  return { indexedDbRef, entries };
}

test('memory guarded writes roll back new and replaced values when the post-write epoch guard fails', async () => {
  const cache = createMemoryAnalysisCache();
  await cache.setMany([{ key: 'existing', value: 'old' }]);
  let checks = 0;

  await assert.rejects(cache.setManyGuarded([
    { key: 'existing', value: 'new' },
    { key: 'created', value: 'must-disappear' }
  ], {
    signal: new AbortController().signal,
    assertActive() {
      checks += 1;
      if (checks === 3) throw Object.assign(new Error('secret payload'), { code: 'STALE_OPERATION' });
    }
  }), error => error.code === 'CACHE_GUARD_STALE' && !error.message.includes('secret'));

  const values = await cache.getMany(['existing', 'created']);
  assert.equal(values.get('existing').value, 'old');
  assert.equal(values.has('created'), false);
});

test('memory rollback preserves a newer interleaved value', async () => {
  const cache = createMemoryAnalysisCache();
  await cache.setMany([{ key: 'checkpoint', value: 'old' }]);
  const newer = { key: 'checkpoint', value: 'newer' };
  let checks = 0;

  await assert.rejects(cache.setManyGuarded([{ key: 'checkpoint', value: 'stale' }], {
    assertActive() {
      checks += 1;
      if (checks === 3) {
        void cache.setMany([newer]);
        throw Object.assign(new Error('stale'), { code: 'STALE_OPERATION' });
      }
    }
  }), error => error.code === 'CACHE_GUARD_STALE');

  const values = await cache.getMany(['checkpoint']);
  assert.equal(values.get('checkpoint'), newer);
});

test('memory guarded multi-record CAS serializes concurrent revisions', async () => {
  const cache = createMemoryAnalysisCache();
  const guard = { assertActive() {} };
  const initial = { key: 'run', revision: 0, count: 0 };
  const created = await cache.compareAndSetManyGuarded([initial], {
    ...guard, casKey: 'run', expectedRevision: null
  });
  assert.equal(created.applied, true);

  const [first, second] = await Promise.all([
    cache.compareAndSetManyGuarded([{ key: 'run', revision: 1, count: 1 }], {
      ...guard, casKey: 'run', expectedRevision: 0
    }),
    cache.compareAndSetManyGuarded([{ key: 'run', revision: 1, count: 1 }], {
      ...guard, casKey: 'run', expectedRevision: 0
    })
  ]);
  assert.deepEqual([first.applied, second.applied].sort(), [false, true]);
  const stored = await cache.getMany(['run']);
  assert.equal(stored.get('run').revision, 1);
  assert.equal(stored.get('run').count, 1);
});

test('terminal compaction atomically CASes authority and deletes only same-session children', async () => {
  const sessionId = 'a'.repeat(64);
  for (const [kind, cache, inspect] of [
    ['memory', createMemoryAnalysisCache(), null],
    (() => {
      const fake = createTransactionalIndexedDb();
      return ['indexeddb', createIndexedDbAnalysisCache(fake.indexedDbRef), fake.entries];
    })()
  ]) {
    const indexKey = `mechanism-run-index:${sessionId}:operation`;
    const stateKey = `mechanism-run-state:${sessionId}:operation`;
    const checkpointKey = `mechanism-checkpoint:${sessionId}:operation`;
    const initial = {
      key: indexKey, revision: 0, createdAt: 1,
      runIndex: { terminal: 'active', latestRunStateKey: stateKey }
    };
    await cache.setMany([
      initial,
      { key: stateKey, revision: 0, createdAt: 1, runState: { claim: 1 } },
      { key: checkpointKey, createdAt: 1, checkpoint: { phase: 'ready' } }
    ]);
    const receipt = await cache.compareAndSetManyAndDeleteGuarded([{
      ...initial, revision: 1,
      runIndex: { terminal: 'cancelled', latestRunStateKey: stateKey }
    }], [stateKey, checkpointKey], {
      casKey: indexKey, expectedRevision: 0, assertActive() {}
    });
    assert.equal(receipt.applied, true, kind);
    const compacted = await cache.getMany([indexKey, stateKey, checkpointKey]);
    assert.equal(compacted.get(indexKey).revision, 1, kind);
    assert.equal(compacted.has(stateKey), false, kind);
    assert.equal(compacted.has(checkpointKey), false, kind);

    await assert.rejects(
      cache.compareAndSetManyAndDeleteGuarded([{
        ...initial, revision: 2,
        runIndex: { terminal: 'released', latestRunStateKey: stateKey }
      }], [`mechanism-run-state:${'b'.repeat(64)}:foreign`], {
        casKey: indexKey, expectedRevision: 1, assertActive() {}
      }),
      error => error?.code === 'CACHE_GUARD_INVALID_INPUT', kind
    );
    const siblingIndexKey = `mechanism-run-index:${sessionId}:sibling`;
    const siblingStateKey = `mechanism-run-state:${sessionId}:sibling-binding`;
    const siblingCheckpointKey = `mechanism-checkpoint:${sessionId}:sibling-binding`;
    const ownerKey = `mechanism-owner-current:${sessionId}:owner`;
    const disguisedForeignKey =
      `mechanism-run-state:${'b'.repeat(64)}:foreign-${sessionId}:suffix`;
    await cache.setMany([
      { key: siblingIndexKey, revision: 0, createdAt: 1,
        runIndex: { terminal: 'active', latestRunStateKey: siblingStateKey } },
      { key: siblingStateKey, revision: 0, createdAt: 1, runState: { sibling: true } },
      { key: siblingCheckpointKey, createdAt: 1, checkpoint: { sibling: true } },
      { key: ownerKey, createdAt: 1, owner: true },
      { key: disguisedForeignKey, createdAt: 1, foreign: true }
    ]);
    for (const forbiddenDeleteKey of [siblingIndexKey, ownerKey, disguisedForeignKey]) {
      await assert.rejects(
        cache.compareAndSetManyAndDeleteGuarded([{
          ...initial, revision: 2,
          runIndex: { terminal: 'released', latestRunStateKey: stateKey }
        }], [forbiddenDeleteKey], {
          casKey: indexKey, expectedRevision: 1, assertActive() {}
        }),
        error => error?.code === 'CACHE_GUARD_INVALID_INPUT',
        `${kind}: ${forbiddenDeleteKey}`
      );
    }
    await assert.rejects(
      cache.compareAndSetManyAndDeleteGuarded([{
        ...initial, revision: 2,
        runIndex: { terminal: 'released', latestRunStateKey: stateKey }
      }], [siblingStateKey, siblingCheckpointKey], {
        casKey: indexKey, expectedRevision: 1, assertActive() {}
      }),
      error => error?.code === 'CACHE_GUARD_INVALID_INPUT',
      `${kind}: same-session sibling children`
    );
    await assert.rejects(
      cache.compareAndSetManyAndDeleteGuarded([{
        ...initial, revision: 2,
        runIndex: { terminal: 'released', latestRunStateKey: stateKey }
      }], [indexKey], {
        casKey: indexKey, expectedRevision: 1, assertActive() {}
      }),
      error => error?.code === 'CACHE_GUARD_INVALID_INPUT',
      `${kind}: proposal/delete overlap`
    );
    const unchanged = await cache.getMany([
      indexKey, siblingIndexKey, siblingStateKey, siblingCheckpointKey,
      ownerKey, disguisedForeignKey
    ]);
    assert.equal(unchanged.get(indexKey).revision, 1, kind);
    assert.equal(unchanged.has(siblingIndexKey), true, kind);
    assert.equal(unchanged.has(siblingStateKey), true, kind);
    assert.equal(unchanged.has(siblingCheckpointKey), true, kind);
    assert.equal(unchanged.has(ownerKey), true, kind);
    assert.equal(unchanged.has(disguisedForeignKey), true, kind);
    if (inspect) assert.equal(inspect.has(indexKey), true, kind);
  }
});

test('protected mechanism authority has a total hard record bound without LRU eviction', async () => {
  const cache = createMemoryAnalysisCache();
  const sessionId = 'c'.repeat(64);
  const records = Array.from({ length: MAX_PROTECTED_MECHANISM_RECORDS }, (_, index) => ({
    key: `mechanism-owner-current:${sessionId}:owner-${index}`,
    createdAt: index, owner: index
  }));
  await cache.setMany(records);
  await assert.rejects(cache.setMany([{
    key: `mechanism-owner-current:${sessionId}:overflow`, createdAt: 1
  }]), error => error?.code === 'CACHE_PROTECTED_CAPACITY_EXCEEDED');
  await cache.setMany([{ key: 'ordinary-cache-entry', createdAt: 1 }]);
  await cache.setMany([{ ...records[0], owner: 'updated' }]);
  const stored = await cache.getMany([
    records[0].key, records.at(-1).key, 'ordinary-cache-entry'
  ]);
  assert.equal(stored.get(records[0].key).owner, 'updated');
  assert.equal(stored.has(records.at(-1).key), true);
  assert.equal(stored.has('ordinary-cache-entry'), true);
});

test('protected memory and IndexedDB records never gain mutable LRU timestamps', async () => {
  const sessionId = 'd'.repeat(64);
  for (const [kind, cache, inspect] of [
    ['memory', createMemoryAnalysisCache(), null],
    (() => {
      const fake = createTransactionalIndexedDb();
      return ['indexeddb', createIndexedDbAnalysisCache(fake.indexedDbRef), fake.entries];
    })()
  ]) {
    const protectedKey = `mechanism-owner-current:${sessionId}:exact-owner`;
    await cache.setMany([{ key: protectedKey, createdAt: 1, owner: 'exact' }]);
    const first = (await cache.getMany([protectedKey])).get(protectedKey);
    const second = (await cache.getMany([protectedKey])).get(protectedKey);
    assert.equal(Object.hasOwn(first, 'lastAccessedAt'), false, kind);
    assert.equal(Object.hasOwn(second, 'lastAccessedAt'), false, kind);
    if (inspect) {
      assert.equal(Object.hasOwn(inspect.get(protectedKey), 'lastAccessedAt'), false, kind);
    }
  }
});

test('protected byte capacity measures exact stored bytes with memory and IndexedDB parity', async () => {
  const exactLimit = 1_000;
  const scaled = loadAnalysisCacheWithProtectedByteLimit(exactLimit);
  const sessionId = 'e'.repeat(64);
  const first = scaled.toRealm(protectedRecordWithExactBytes(
    `mechanism-owner-current:${sessionId}:first`, 480
  ));
  const second = scaled.toRealm(protectedRecordWithExactBytes(
    `mechanism-owner-current:${sessionId}:second`, 520
  ));
  const expected = JSON.stringify([first, second]);
  for (const [kind, cache, inspect] of [
    ['memory', scaled.createMemoryAnalysisCache(), null],
    (() => {
      const fake = createTransactionalIndexedDb();
      return [
        'indexeddb', scaled.createIndexedDbAnalysisCache(fake.indexedDbRef), fake.entries
      ];
    })()
  ]) {
    await cache.setMany([first, second]);
    const firstRead = await cache.getMany([first.key, second.key]);
    const secondRead = await cache.getMany([first.key, second.key]);
    const orderedFirstRead = [firstRead.get(first.key), firstRead.get(second.key)];
    const orderedSecondRead = [secondRead.get(first.key), secondRead.get(second.key)];
    assert.equal(JSON.stringify(orderedFirstRead), expected, `${kind}: first read`);
    assert.equal(JSON.stringify(orderedSecondRead), expected, `${kind}: stable read`);
    assert.equal(orderedFirstRead.reduce((total, record) => total +
      new TextEncoder().encode(JSON.stringify(record)).byteLength, 0), exactLimit, kind);
    assert.equal(orderedFirstRead.some(record =>
      Object.hasOwn(record, 'lastAccessedAt')), false, kind);
    if (inspect) {
      const raw = [inspect.get(first.key), inspect.get(second.key)];
      assert.equal(JSON.stringify(raw), expected, `${kind}: exact stored representation`);
      assert.equal(raw.reduce((total, record) => total +
        new TextEncoder().encode(JSON.stringify(record)).byteLength, 0), exactLimit, kind);
    }
    const overflow = scaled.toRealm(protectedRecordWithExactBytes(first.key, 481));
    await assert.rejects(
      cache.setMany([overflow]),
      error => error?.code === 'CACHE_PROTECTED_CAPACITY_EXCEEDED', kind
    );
    const preserved = await cache.getMany([first.key, second.key]);
    assert.equal(JSON.stringify([preserved.get(first.key), preserved.get(second.key)]),
      expected, `${kind}: overflow is zero-write`);
  }
});

test('memory getMany cannot roll back a concurrent guarded CAS', async () => {
  const cache = createMemoryAnalysisCache();
  await cache.setMany([{ key: 'run', revision: 0, count: 0 }]);
  const [snapshot, receipt] = await Promise.all([
    cache.getMany(['run']),
    cache.compareAndSetManyGuarded([{ key: 'run', revision: 1, count: 1 }], {
      casKey: 'run', expectedRevision: 0, assertActive() {}
    })
  ]);
  assert.equal(snapshot.get('run').revision, 0);
  assert.equal(receipt.applied, true);
  const stored = await cache.getMany(['run']);
  assert.equal(stored.get('run').revision, 1);
  assert.equal(stored.get('run').count, 1);
});

test('IndexedDB getMany LRU touch cannot overwrite a concurrent guarded CAS', async () => {
  let markInitialRead;
  let initialReadSeen = false;
  const initialRead = new Promise(resolve => { markInitialRead = resolve; });
  const fake = createSerializedIndexedDb([
    { key: 'run', revision: 0, count: 0, createdAt: Date.now() }
  ], ({ key, transactionId }) => {
    if (!initialReadSeen && key === 'run' && transactionId === 1) {
      initialReadSeen = true;
      markInitialRead();
    }
  });
  const cache = createIndexedDbAnalysisCache(fake.indexedDbRef);
  const snapshotPending = cache.getMany(['run']);
  await initialRead;
  const casPending = cache.compareAndSetManyGuarded([
    { key: 'run', revision: 1, count: 1, createdAt: Date.now() }
  ], { casKey: 'run', expectedRevision: 0, assertActive() {} });
  const [snapshot, receipt] = await Promise.all([snapshotPending, casPending]);

  assert.equal(snapshot.get('run').revision, 0);
  assert.equal(receipt.applied, true);
  assert.equal(fake.entries.get('run').revision, 1);
  assert.equal(fake.entries.get('run').count, 1);
});

test('guarded CAS never invokes option or current-value accessors', async () => {
  const cache = createMemoryAnalysisCache();
  let optionGetterCalls = 0;
  const poisonedOptions = { assertActive() {}, expectedRevision: null };
  Object.defineProperty(poisonedOptions, 'casKey', {
    enumerable: true,
    get() { optionGetterCalls += 1; throw new Error('secret cas option'); }
  });
  await assert.rejects(
    cache.compareAndSetManyGuarded([{ key: 'run', revision: 0 }], poisonedOptions),
    error => error.code === 'CACHE_GUARD_INVALID_INPUT' && !error.message.includes('secret')
  );
  assert.equal(optionGetterCalls, 0);

  let currentGetterCalls = 0;
  const poisonedCurrent = { key: 'run' };
  Object.defineProperty(poisonedCurrent, 'revision', {
    enumerable: true,
    get() { currentGetterCalls += 1; throw new Error('secret current value'); }
  });
  await cache.setMany([poisonedCurrent]);
  await assert.rejects(
    cache.compareAndSetManyGuarded([{ key: 'run', revision: 1 }], {
      casKey: 'run', expectedRevision: 0, assertActive() {}
    }),
    error => error.code === 'CACHE_GUARD_INVALID_INPUT' && !error.message.includes('secret')
  );
  assert.equal(currentGetterCalls, 0);
});

test('IndexedDB guarded CAS reads and writes inside one readwrite transaction', async () => {
  const createdAt = Date.now();
  const entries = new Map([['run', { key: 'run', revision: 0, count: 0, createdAt }]]);
  const transactionModes = [];
  const operationTransactions = [];
  let transactionId = 0;
  const database = {
    transaction(_name, mode) {
      const id = ++transactionId;
      transactionModes.push(mode);
      const snapshot = new Map(entries);
      const transaction = {
        error: null,
        pending: 0,
        aborted: false,
        completionScheduled: false,
        abort() {
          if (this.aborted) return;
          this.aborted = true;
          entries.clear();
          snapshot.forEach((value, key) => entries.set(key, value));
          queueMicrotask(() => this.onabort?.());
        },
        schedule() {
          if (this.completionScheduled || this.aborted) return;
          this.completionScheduled = true;
          queueMicrotask(() => {
            this.completionScheduled = false;
            if (!this.aborted && this.pending === 0) this.oncomplete?.();
          });
        },
        objectStore() {
          const request = operation => {
            const output = {};
            transaction.pending += 1;
            queueMicrotask(() => {
              try {
                output.result = operation();
                output.onsuccess?.();
              } catch (error) {
                output.error = error;
                transaction.error = error;
                output.onerror?.();
              } finally {
                transaction.pending -= 1;
                transaction.schedule();
              }
            });
            return output;
          };
          return {
            get(key) {
              operationTransactions.push(['get', id]);
              return request(() => entries.get(key));
            },
            put(value) {
              operationTransactions.push(['put', id]);
              return request(() => entries.set(value.key, value));
            },
            getAll() { return request(() => [...entries.values()]); },
            delete(key) { return request(() => entries.delete(key)); }
          };
        }
      };
      return transaction;
    }
  };
  const indexedDbRef = {
    open() {
      const request = { result: database };
      queueMicrotask(() => request.onsuccess?.());
      return request;
    }
  };
  const cache = createIndexedDbAnalysisCache(indexedDbRef);
  const result = await cache.compareAndSetManyGuarded([
    { key: 'run', revision: 1, count: 1, createdAt }
  ], { casKey: 'run', expectedRevision: 0, assertActive() {} });

  assert.equal(result.applied, true);
  assert.equal(entries.get('run').revision, 1);
  assert.deepEqual(operationTransactions.slice(0, 2), [['get', 1], ['put', 1]]);
  assert.equal(transactionModes[0], 'readwrite');
});

test('guarded cache input is bounded own data and does not invoke value getters', async () => {
  const cache = createMemoryAnalysisCache();
  let getterCalls = 0;
  const poisoned = { key: 'poisoned' };
  Object.defineProperty(poisoned, 'payload', {
    enumerable: true,
    get() { getterCalls += 1; return 'secret'; }
  });

  await assert.rejects(
    cache.setManyGuarded([poisoned], { assertActive() {} }),
    error => error.code === 'CACHE_GUARD_INVALID_INPUT' && error.retryable === false
  );
  assert.equal(getterCalls, 0);

  await assert.rejects(
    cache.setManyGuarded(Array.from({ length: 129 }, (_, index) => ({ key: `k${index}` })), {
      assertActive() {}
    }),
    error => error.code === 'CACHE_GUARD_INVALID_INPUT'
  );
});

test('guarded cache normalizes one hostile Proxy prototype trap without leaking it', async () => {
  const cache = createMemoryAnalysisCache();
  let prototypeTraps = 0;
  const hostile = new Proxy({ key: 'proxy-checkpoint' }, {
    getPrototypeOf() {
      prototypeTraps += 1;
      throw new Error('secret proxy prototype');
    }
  });

  await assert.rejects(
    cache.setManyGuarded([hostile], { assertActive() {} }),
    error => error.code === 'CACHE_GUARD_INVALID_INPUT' &&
      error.message === 'Guarded cache input is invalid' &&
      !error.message.includes('secret')
  );
  assert.equal(prototypeTraps, 1);
});

test('guarded cache never executes nested signal accessors or hostile Proxy traps', async () => {
  for (const property of ['aborted', 'addEventListener', 'removeEventListener']) {
    const cache = createMemoryAnalysisCache();
    let getterCalls = 0;
    const signal = {
      aborted: false,
      addEventListener() {},
      removeEventListener() {}
    };
    Object.defineProperty(signal, property, {
      enumerable: true,
      get() { getterCalls += 1; throw new Error(`SECRET signal ${property}`); }
    });
    await assert.rejects(
      cache.setManyGuarded([{ key: `signal:${property}` }], { signal, assertActive() {} }),
      error => error.code === 'CACHE_GUARD_INVALID_INPUT' && !error.message.includes('SECRET')
    );
    assert.equal(getterCalls, 0);
  }

  let prototypeTraps = 0;
  const hostileSignal = new Proxy({ aborted: false }, {
    getPrototypeOf() {
      prototypeTraps += 1;
      throw new Error('SECRET signal proxy');
    }
  });
  await assert.rejects(
    createMemoryAnalysisCache().setManyGuarded([{ key: 'signal:proxy' }], {
      signal: hostileSignal, assertActive() {}
    }),
    error => error.code === 'CACHE_GUARD_INVALID_INPUT' && !error.message.includes('SECRET')
  );
  assert.equal(prototypeTraps, 1);
});

test('IndexedDB CAS consumes a failed get transaction without leaking unhandled rejection', async () => {
  const fake = createTransactionalIndexedDb([], { failGet: true });
  const cache = createIndexedDbAnalysisCache(fake.indexedDbRef);
  const unhandled = [];
  const onUnhandled = reason => { unhandled.push(reason); };
  process.on('unhandledRejection', onUnhandled);
  try {
    await assert.rejects(
      cache.compareAndSetManyGuarded([{ key: 'run', revision: 0 }], {
        casKey: 'run', expectedRevision: null, assertActive() {}
      }),
      error => error.code === 'CACHE_GUARD_WRITE_FAILED' && !error.message.includes('SECRET')
    );
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(unhandled.length, 0);
  } finally {
    process.removeListener('unhandledRejection', onUnhandled);
  }
});

test('IndexedDB guarded write aborts a live transaction and removes its listener', async () => {
  let transaction;
  const stored = [];
  const database = {
    objectStoreNames: { contains: () => true },
    transaction() {
      transaction = {
        error: null,
        aborted: false,
        abort() {
          this.aborted = true;
          queueMicrotask(() => this.onabort?.());
        },
        objectStore() {
          return { put(value) { stored.push(value); } };
        }
      };
      return transaction;
    }
  };
  const indexedDbRef = {
    open() {
      const request = { result: database };
      queueMicrotask(() => request.onsuccess?.());
      return request;
    }
  };
  let addedListeners = 0;
  let removedListeners = 0;
  const abortListeners = new Set();
  const countedSignal = {
    aborted: false,
    addEventListener(_type, listener) {
      addedListeners += 1;
      abortListeners.add(listener);
    },
    removeEventListener(_type, listener) {
      removedListeners += 1;
      abortListeners.delete(listener);
    }
  };
  const cache = createIndexedDbAnalysisCache(indexedDbRef);
  const pending = cache.setManyGuarded([{ key: 'checkpoint', payload: { batch: 1 } }], {
    signal: countedSignal,
    assertActive() {}
  });
  await new Promise(resolve => setImmediate(resolve));
  countedSignal.aborted = true;
  [...abortListeners].forEach(listener => listener());

  await assert.rejects(pending, error => error.code === 'CACHE_GUARD_ABORTED');
  assert.equal(transaction.aborted, true);
  assert.equal(stored.length, 1);
  assert.equal(addedListeners, 1);
  assert.equal(removedListeners, 1);
});

test('IndexedDB guarded write rechecks the epoch after transaction completion', async () => {
  const stored = [];
  const database = {
    transaction() {
      const transaction = {
        error: null,
        abort() { queueMicrotask(() => this.onabort?.()); },
        objectStore() {
          return {
            put(value) {
              stored.push(value);
              queueMicrotask(() => transaction.oncomplete?.());
            }
          };
        }
      };
      return transaction;
    }
  };
  const indexedDbRef = {
    open() {
      const request = { result: database };
      queueMicrotask(() => request.onsuccess?.());
      return request;
    }
  };
  let checks = 0;
  const cache = createIndexedDbAnalysisCache(indexedDbRef);
  await assert.rejects(cache.setManyGuarded([{ key: 'checkpoint', payload: { batch: 1 } }], {
    assertActive() {
      checks += 1;
      if (checks === 5) throw Object.assign(new Error('stale secret'), { code: 'STALE_OPERATION' });
    }
  }), error => error.code === 'CACHE_GUARD_STALE' && !error.message.includes('secret'));
  assert.equal(stored.length, 1);
  assert.equal(checks, 5);
});

test('IndexedDB guarded write aborts after a partial synchronous put enqueue', async () => {
  const pending = [];
  const committed = [];
  let abortCalls = 0;
  let completeCalls = 0;
  const database = {
    transaction() {
      let puts = 0;
      return {
        error: null,
        abort() {
          abortCalls += 1;
          pending.splice(0);
        },
        objectStore() {
          return {
            put(value) {
              puts += 1;
              if (puts === 2) throw new Error('secret second put failure');
              pending.push(value);
            }
          };
        },
        complete() {
          completeCalls += 1;
          committed.push(...pending);
          pending.splice(0);
        }
      };
    }
  };
  const indexedDbRef = {
    open() {
      const request = { result: database };
      queueMicrotask(() => request.onsuccess?.());
      return request;
    }
  };
  const cache = createIndexedDbAnalysisCache(indexedDbRef);
  await assert.rejects(cache.setManyGuarded([
    { key: 'checkpoint:1', payload: { batch: 1 } },
    { key: 'checkpoint:2', payload: { batch: 2 } }
  ], { assertActive() {} }), error =>
    error.code === 'CACHE_GUARD_WRITE_FAILED' && !error.message.includes('secret'));

  assert.equal(abortCalls, 1);
  assert.equal(completeCalls, 0);
  assert.equal(pending.length, 0);
  assert.equal(committed.length, 0);
});

test('successful IndexedDB guarded writes perform real capacity pruning', async () => {
  const current = Date.now();
  const fake = createTransactionalIndexedDb([
    { key: 'oldest', createdAt: current - 2_000, lastAccessedAt: current - 2_000 },
    { key: 'newer', createdAt: current - 1_000, lastAccessedAt: current - 1_000 }
  ]);
  const cache = createIndexedDbAnalysisCache(fake.indexedDbRef, { maxEntries: 2 });
  await cache.setManyGuarded([{ key: 'latest', createdAt: Date.now() }], {
    assertActive() {}
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(fake.entries.has('oldest'), false);
  assert.equal(fake.entries.has('newer'), true);
  assert.equal(fake.entries.has('latest'), true);
});

test('IndexedDB pruning never evicts durable mechanism authority records', async () => {
  const current = Date.now();
  const authority = [
    {
      key: 'mechanism-run-index:active-operation',
      createdAt: current - 10_000,
      revision: 0,
      runIndex: { terminal: 'active' }
    },
    {
      key: 'mechanism-run-state:active-operation',
      createdAt: current - 10_000,
      revision: 0,
      runState: { providerRequestsClaimed: 1 }
    },
    {
      key: 'mechanism-checkpoint:active-operation',
      createdAt: current - 10_000,
      checkpoint: { providerReceiptIds: [] }
    }
  ];
  const fake = createTransactionalIndexedDb([
    ...authority,
    { key: 'ordinary-old', createdAt: current - 9_000, lastAccessedAt: current - 9_000 }
  ]);
  const cache = createIndexedDbAnalysisCache(fake.indexedDbRef, {
    maxEntries: 1,
    maxAgeMs: 5_000
  });

  await cache.setManyGuarded([{ key: 'ordinary-new', createdAt: current }], {
    assertActive() {}
  });
  await new Promise(resolve => setImmediate(resolve));

  authority.forEach(record => assert.equal(fake.entries.has(record.key), true));
  assert.equal(fake.entries.has('ordinary-old'), false);
  assert.equal(fake.entries.has('ordinary-new'), true);
});

test('an IndexedDB mechanism receipt survives 1200 ordinary LRU writes and reconstruction', async () => {
  Object.assign(globalThis.SciLLM || (globalThis.SciLLM = {}),
    require('../core/operation-control.js'),
    require('../core/evidence-first-mechanism.js'));
  delete require.cache[require.resolve('../core/mechanism-operation-coordinator.js')];
  const coordinatorApi = require('../core/mechanism-operation-coordinator.js');
  const fake = createTransactionalIndexedDb();
  const cache = createIndexedDbAnalysisCache(fake.indexedDbRef, { maxEntries: 1_200 });
  const input = {
    operationId: 'mechanism:indexeddb-prune-receipt',
    documentId: 'indexeddb-prune-document',
    documentHash: 'a'.repeat(64),
    workspaceId: 'indexeddb-prune-workspace',
    workspaceGeneration: 1,
    workspaceLifecycle: 0,
    mechanismChainFingerprint: 'indexeddb-prune-chain',
    senderExtensionId: 'extension-1',
    senderTabId: 41,
    senderFrameId: 0,
    senderDocumentId: '41414141-4141-4141-8141-414141414141',
    profileSignature: 'profile-indexeddb-prune',
    baseWorkspaceRevision: 0
  };
  const receipt = { receipt: 'c'.repeat(64), bindingDigest: 'd'.repeat(64) };
  const first = coordinatorApi.createMechanismOperationCoordinator({ cacheStore: cache });
  const operation = await first.beginEvidenceFirstOperation(input);
  await first.claimProviderRequest(operation, receipt);

  const now = Date.now();
  await cache.setMany(Array.from({ length: 1_201 }, (_, index) => ({
    key: `ordinary-churn-${index}`,
    createdAt: now + index,
    payload: index
  })));

  const protectedKeys = [...fake.entries.keys()].filter(key =>
    key.startsWith('mechanism-run-') || key.startsWith('mechanism-checkpoint:'));
  assert.equal(protectedKeys.filter(key => key.startsWith('mechanism-run-index:')).length, 1);
  assert.equal(protectedKeys.filter(key => key.startsWith('mechanism-run-state:')).length, 1);
  const restarted = coordinatorApi.createMechanismOperationCoordinator({ cacheStore: cache });
  const restored = await restarted.beginEvidenceFirstOperation(input);
  await assert.rejects(
    restarted.resume(restored),
    error => error.code === 'MECHANISM_PROVIDER_RECEIPT_AMBIGUOUS'
  );
  await assert.rejects(
    restarted.claimProviderRequest(restored, receipt),
    error => error.code === 'MECHANISM_PROVIDER_RECEIPT_AMBIGUOUS'
  );
});

test('IndexedDB setMany rejects database open failure before writing', async () => {
  const error = new Error('database unavailable');
  const cache = createIndexedDbAnalysisCache({
    open() {
      const request = { error };
      queueMicrotask(() => request.onerror?.());
      return request;
    }
  });
  await assert.rejects(cache.setMany([{ key: 'new', createdAt: Date.now() }]),
    actual => actual === error);
});

for (const [label, options] of [
  ['transaction creation failure', { failTransactions: new Set([1]) }],
  ['put request failure', { failRequests: new Set(['1:put']) }],
  ['transaction abort', { abortTransactions: new Set([1]) }]
]) {
  test(`IndexedDB setMany rejects ${label} without claiming commit`, async () => {
    const old = { key: 'existing', createdAt: Date.now(), manualEdits: { summary: '' } };
    const fake = createTransactionalIndexedDb([old], options);
    const cache = createIndexedDbAnalysisCache(fake.indexedDbRef);
    await assert.rejects(cache.setMany([
      { ...old, manualEdits: { summary: 'must roll back' } },
      { key: 'new', createdAt: Date.now() }
    ]));
    assert.deepEqual([...fake.entries.values()], [old]);
    assert.equal(fake.transactionCount(), 1, 'failed commit must not schedule pruning');
  });
}

for (const [label, options] of [
  ['read transaction creation failure', { failTransactions: new Set([2]) }],
  ['read request failure', { failRequests: new Set(['2:getAll']) }],
  ['delete request failure', { failRequests: new Set(['3:delete']) }],
  ['read request never returns', { hangRequests: new Set(['2:getAll']) }],
  ['delete request never returns', { hangRequests: new Set(['3:delete']) }]
]) {
  test(`IndexedDB setMany preserves committed success after prune ${label}`, async () => {
    const old = { key: 'old', createdAt: 1, lastAccessedAt: 1 };
    const fake = createTransactionalIndexedDb([old], options);
    const cache = createIndexedDbAnalysisCache(fake.indexedDbRef, { maxEntries: 1 });
    const saved = {
      key: 'figure:committed', createdAt: Date.now(),
      result: { panels: [{ label: 'A', conclusion: 'saved result' }] },
      manualEdits: { summary: '', conclusion: 'human correction' }, humanReviewed: true
    };
    const outcome = await Promise.race([
      cache.setMany([saved]).then(() => 'committed', error => error),
      new Promise(resolve => setImmediate(() => resolve('pending')))
    ]);
    assert.equal(outcome, 'committed', 'maintenance must not reject or hold a committed save');
    const reconstructed = createIndexedDbAnalysisCache(fake.indexedDbRef);
    const readback = (await reconstructed.getMany([saved.key])).get(saved.key);
    assert.deepEqual(readback.result, saved.result);
    assert.deepEqual(readback.manualEdits, saved.manualEdits);
    assert.equal(readback.humanReviewed, true);
    assert.ok(fake.transactionCount() >= 3, 'real maintenance and readback paths ran');
  });
}

test('IndexedDB maintenance failure diagnostics are bounded and contain no stored data or error details', async () => {
  const fake = createTransactionalIndexedDb([], { failTransactions: new Set([2, 4, 6]) });
  const cache = createIndexedDbAnalysisCache(fake.indexedDbRef);
  const warnings = [];
  const previousWarn = console.warn;
  console.warn = (...args) => {
    warnings.push(args);
    throw new Error('diagnostic sink unavailable');
  };
  try {
    for (let i = 0; i < 3; i += 1) {
      await cache.setMany([{ key: `SECRET figure ${i}`, createdAt: Date.now() }]);
      await new Promise(resolve => setImmediate(resolve));
    }
    assert.equal(warnings.length, 1);
    assert.deepEqual(warnings[0], ['BREVESS analysis cache maintenance failed after commit.']);
    assert.equal(fake.entries.size, 3, 'diagnostic errors cannot undo successful commits');
  } finally {
    console.warn = previousWarn;
  }
});

test('post-commit prune failure never changes guarded write or CAS receipts', async () => {
  const guardedFake = createTransactionalIndexedDb([], { failTransactions: new Set([2]) });
  const guarded = createIndexedDbAnalysisCache(guardedFake.indexedDbRef);
  await guarded.setManyGuarded([{ key: 'checkpoint', createdAt: Date.now() }], {
    assertActive() {}
  });
  assert.equal(guardedFake.entries.has('checkpoint'), true);

  const casFake = createTransactionalIndexedDb([], { failTransactions: new Set([2]) });
  const cas = createIndexedDbAnalysisCache(casFake.indexedDbRef);
  const receipt = await cas.compareAndSetManyGuarded([
    { key: 'run', revision: 0, createdAt: Date.now() }
  ], { casKey: 'run', expectedRevision: null, assertActive() {} });
  assert.equal(receipt.applied, true);
  assert.equal(casFake.entries.get('run').revision, 0);
});

test('keeps a multi-paper local cache window for zero-token return visits', () => {
  assert.equal(DEFAULT_ANALYSIS_CACHE_MAX_ENTRIES, 1200);
  assert.equal(DEFAULT_ANALYSIS_CACHE_MAX_AGE_MS, 90 * 24 * 60 * 60 * 1000);
});

test('refreshes last-access time so capacity pruning is true LRU rather than FIFO', () => {
  const source = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '..', 'core', 'analysis-cache.js'), 'utf8'
  );
  assert.match(source, /lastAccessedAt:\s*accessedAt/);
  assert.match(source, /Number\(b\.lastAccessedAt\s*\|\|\s*b\.createdAt\)/);
});

const paragraphs = [{
  paragraphId: 'p1',
  sectionTitle: 'Discussion',
  text: 'This study is limited by its small sample size.'
}];

test('uses adaptive prompt, classifier, and ledger cache versions', () => {
  assert.deepEqual(ANALYSIS_CACHE_VERSIONS, {
    prompt: '12-scenario-configurable-evidence', chunker: '5-paragraph-checkpoint',
    classifier: '2', ledger: '2'
  });
});

test('document hash changes when a paragraph moves between major section kinds', async () => {
  const base = [{ paragraphId: 'p1', sectionTitle: 'Model performance', text: 'Result.' }];
  const resultHash = await hashDocument([{ ...base[0], sectionKind: 'results' }]);
  const discussionHash = await hashDocument([{ ...base[0], sectionKind: 'discussion' }]);
  assert.notEqual(resultHash, discussionHash);
});

test('document hash changes when heading ancestry changes', async () => {
  const base = {
    paragraphId: 'p1', sectionTitle: 'Immune axis', sectionKind: 'article', text: 'Evidence.'
  };
  const first = await hashDocument([{ ...base, headingLevel: 3, headingPath: [
    { level: 1, sectionId: 'sec-review', title: 'Review' },
    { level: 2, sectionId: 'sec-mechanisms', title: 'Mechanisms' },
    { level: 3, sectionId: 'sec-immune-axis', title: 'Immune axis' }
  ] }]);
  const second = await hashDocument([{ ...base, headingLevel: 2, headingPath: [
    { level: 1, sectionId: 'sec-review', title: 'Review' },
    { level: 2, sectionId: 'sec-immune-axis', title: 'Immune axis' }
  ] }]);
  assert.notEqual(first, second);
});

test('reuses cached category results without another provider call', async () => {
  const categories = createBuiltInCategories();
  const cacheStore = createMemoryAnalysisCache();
  let calls = 0;
  const adapter = {
    async analyzeChunk(request) {
      calls += 1;
      return {
        paragraphs_reviewed: ['p1'],
        annotations: [{
          paragraph_id: 'p1',
          quote: paragraphs[0].text,
          occurrence: 0,
          category_id: 'limitation',
          confidence: 0.95,
          reason_zh: '明确局限'
        }]
      };
    }
  };
  const input = {
    paragraphs,
    selectedCategories: [categories.limitation, categories.future],
    providerId: 'openai',
    model: 'gpt-5-mini',
    adapter,
    cacheStore
  };
  const first = await analyzeWithCategoryCache(input);
  const second = await analyzeWithCategoryCache(input);
  assert.equal(calls, 1);
  assert.deepEqual(first.analyzedCategoryIds, ['limitation', 'future']);
  assert.deepEqual(second.cachedCategoryIds, ['limitation', 'future']);
  assert.equal(second.annotations.length, 1);
});

test('does not reuse category cache entries across task-policy cache signatures', async () => {
  const categories = createBuiltInCategories();
  const cacheStore = createMemoryAnalysisCache();
  let calls = 0;
  const input = {
    paragraphs, selectedCategories: [categories.limitation], providerId: 'openai',
    model: 'gpt-5-mini', cacheStore,
    adapter: { async analyzeChunk(request) {
      calls += 1;
      return { paragraphs_reviewed: request.paragraphs.map(item => item.paragraphId), annotations: [] };
    } }
  };
  await analyzeWithCategoryCache({
    ...input, profileSignature: 'document_highlight:policy-a'
  });
  await analyzeWithCategoryCache({
    ...input, profileSignature: 'document_highlight:policy-b'
  });
  assert.equal(calls, 2);
});

test('analyzes only a newly enabled category and merges prior cache', async () => {
  const categories = createBuiltInCategories();
  const cacheStore = createMemoryAnalysisCache();
  const requested = [];
  const adapter = {
    async analyzeChunk(request) {
      requested.push(request.requestedCategoryIds);
      return { paragraphs_reviewed: ['p1'], annotations: [] };
    }
  };
  const base = {
    paragraphs,
    providerId: 'openai',
    model: 'gpt-5-mini',
    adapter,
    cacheStore
  };
  await analyzeWithCategoryCache({ ...base, selectedCategories: [categories.limitation] });
  const expanded = await analyzeWithCategoryCache({
    ...base,
    selectedCategories: [categories.limitation, categories.result]
  });
  assert.deepEqual(requested, [['limitation'], ['result']]);
  assert.deepEqual(expanded.cachedCategoryIds, ['limitation']);
  assert.deepEqual(expanded.analyzedCategoryIds, ['result']);
});

test('checkpoints completed chunks and resumes at the failed chunk', async () => {
  const categories = createBuiltInCategories();
  const cacheStore = createMemoryAnalysisCache();
  const calls = [];
  let failedOnce = false;
  const input = {
    paragraphs: [
      { paragraphId: 'p1', sectionTitle: 'Results', text: 'A'.repeat(90) },
      { paragraphId: 'p2', sectionTitle: 'Results', text: 'B'.repeat(90) },
      { paragraphId: 'p3', sectionTitle: 'Results', text: 'C'.repeat(90) }
    ],
    selectedCategories: [categories.result],
    providerId: 'deepseek',
    model: 'deepseek-v4-flash',
    cacheStore,
    maxChars: 100,
    adapter: {
      async analyzeChunk(request) {
        const chunkId = JSON.parse(request.userPrompt).chunk_id;
        calls.push(chunkId);
        if (chunkId === 'chunk-002' && !failedOnce) {
          failedOnce = true;
          throw Object.assign(new Error('overloaded'), {
            code: 'PROVIDER_UNAVAILABLE', retryable: false
          });
        }
        return { paragraphs_reviewed: request.paragraphs.map(item => item.paragraphId), annotations: [] };
      }
    }
  };

  await assert.rejects(() => analyzeWithCategoryCache(input), /overloaded/);
  await analyzeWithCategoryCache(input);
  assert.deepEqual(calls, ['chunk-001', 'chunk-002', 'chunk-003', 'chunk-002']);
});

test('does not resume progress created for a different effective category definition', async () => {
  const categories = createBuiltInCategories();
  const cacheStore = createMemoryAnalysisCache();
  const calls = [];
  let failedOnce = false;
  const base = {
    paragraphs: [
      { paragraphId: 'p1', sectionTitle: 'Results', text: 'A'.repeat(90) },
      { paragraphId: 'p2', sectionTitle: 'Results', text: 'B'.repeat(90) },
      { paragraphId: 'p3', sectionTitle: 'Results', text: 'C'.repeat(90) }
    ],
    providerId: 'deepseek',
    model: 'deepseek-v4-flash',
    cacheStore,
    maxChars: 100,
    adapter: {
      async analyzeChunk(request) {
        const chunkId = JSON.parse(request.userPrompt).chunk_id;
        calls.push(chunkId);
        if (chunkId === 'chunk-002' && !failedOnce) {
          failedOnce = true;
          throw Object.assign(new Error('overloaded'), {
            code: 'PROVIDER_UNAVAILABLE', retryable: false
          });
        }
        return {
          paragraphs_reviewed: request.paragraphs.map(item => item.paragraphId),
          annotations: []
        };
      }
    }
  };
  const original = categories.result;
  const changed = structuredClone(original);
  changed.prompt.definition = 'A changed effective result definition.';
  changed.definition = changed.prompt.definition;

  await assert.rejects(() => analyzeWithCategoryCache({
    ...base,
    selectedCategories: [original]
  }), /overloaded/);
  await analyzeWithCategoryCache({ ...base, selectedCategories: [changed] });

  assert.deepEqual(calls, [
    'chunk-001', 'chunk-002', 'chunk-003',
    'chunk-001', 'chunk-002', 'chunk-003'
  ]);
});

test('persists paragraph checkpoints and resumes a truncated stream from only missing indices', async () => {
  const categories = createBuiltInCategories();
  const cacheStore = createMemoryAnalysisCache();
  const source = [
    { paragraphId: 'p1', sectionTitle: 'Results', text: 'Treatment increased survival.' },
    { paragraphId: 'p2', sectionTitle: 'Results', text: 'Controls were unchanged.' }
  ];
  let fail = true;
  const payloads = [];
  const adapter = {
    async *generateTextStream(request) {
      const payload = JSON.parse(request.userPrompt);
      payloads.push(payload.source_data.map(item => item.i));
      if (fail && payloads.length === 1) {
        yield { type: 'text_delta', text: '{"t":"p","i":0,"a":[{"c":"C0","prov":"current","d":[{"x":"Treatment increased survival.","r":"statement"}],"s":[],"sl":{},"need":false}]}\n' };
      }
      if (fail) {
        yield { type: 'error', error: { code: 'AUTH_INVALID', message: 'stop' } };
        return;
      }
      yield { type: 'text_delta', text: '{"t":"p","i":1,"a":[]}\n{"t":"final","n":1}\n' };
      yield { type: 'completed', finishReason: 'stop' };
    }
  };
  await assert.rejects(analyzeWithCategoryCache({
    paragraphs: source,
    selectedCategories: [categories.result],
    providerId: 'openai', model: 'model', adapter, cacheStore,
    maxChars: 1000, concurrency: 1
  }), error => error.code === 'AUTH_INVALID');
  fail = false;
  const start = payloads.length;
  const result = await analyzeWithCategoryCache({
    paragraphs: source,
    selectedCategories: [categories.result],
    providerId: 'openai', model: 'model', adapter, cacheStore,
    maxChars: 1000, concurrency: 1
  });
  assert.deepEqual(payloads[start], [1]);
  assert.equal(result.annotations.length, 1);
});
