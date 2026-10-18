'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { fixture } = require('./r28-workbench-idb-fixture.js');
const { createLibraryImportStore, DATABASE_NAME, DATABASE_VERSION, STORE_NAME } = require('../workbench/library-import-store.js');
const transfer = require('../workbench/global-library-transfer.js');

test('persistent imported-library directory survives reopen and remains isolated from local/radar stores', async () => {
  const indexed = fixture();
  const first = createLibraryImportStore({ indexedDB: indexed.indexedDB });
  await first.replace([
    { stableId: 'pmid:11111', title: 'Imported A', availability: 'metadata-only' },
    { stableId: 'doi:10.1000/test', title: 'Imported B', availability: 'local' }
  ]);
  const reopened = createLibraryImportStore({ indexedDB: indexed.indexedDB });
  const rows = await reopened.readAll();
  assert.equal(rows.length, 2);
  assert.equal(rows.find(row => row.stableId === 'pmid:11111').title, 'Imported A');
  assert.equal(rows.find(row => row.stableId === 'doi:10.1000/test').availability, 'local');
  assert.ok(indexed.openCalls.length >= 2);
  assert.ok(indexed.openCalls.every(call => call.name === DATABASE_NAME && call.version === DATABASE_VERSION));
  assert.deepEqual([...indexed.stores.keys()], [STORE_NAME]);
  await reopened.remove('pmid:11111');
  assert.equal((await reopened.readAll()).length, 1);
  await reopened.clear();
  assert.equal((await reopened.readAll()).length, 0);
});

test('replace is transactional and a failed write leaves the prior imported directory intact', async () => {
  const indexed = fixture();
  const store = createLibraryImportStore({ indexedDB: indexed.indexedDB });
  await store.replace([{ stableId: 'pmid:22222', title: 'Before' }]);
  indexed.failNextPutFor(STORE_NAME);
  await assert.rejects(() => store.replace([{ stableId: 'pmid:33333', title: 'After' }]));
  assert.deepEqual(await store.readAll(), [{ stableId: 'pmid:22222', title: 'Before' }]);
});

test('global library transfer commits through the persistent imported directory and reads it back after reopen', async () => {
  const indexed = fixture();
  const store = createLibraryImportStore({ indexedDB: indexed.indexedDB });
  const service = transfer.createGlobalLibraryTransferService({
    readEntries: () => store.readAll(),
    commitEntries: entries => store.replace(entries)
  });
  const bundle = transfer.exportGlobalLibraryTransfer([{
    pmid: '44556677',
    title: 'Persistent imported paper',
    authors: 'A. Author',
    journal: 'Journal',
    year: '2026',
    tags: ['share'],
    availability: 'metadata-only',
    status: 'missing'
  }]);
  const receipt = await service.import(bundle, { idempotencyKey: 'library-persist-0001' });
  assert.equal(receipt.summary.added, 1);
  const reopened = createLibraryImportStore({ indexedDB: indexed.indexedDB });
  const rows = await reopened.readAll();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].stableId, 'pmid:44556677');
  assert.equal(rows[0].title, 'Persistent imported paper');
  assert.equal(rows[0].availability, 'metadata-only');
});

test('global library service commits only the imported overlay when a live radar entry matches', async () => {
  const indexed = fixture();
  const store = createLibraryImportStore({ indexedDB: indexed.indexedDB });
  const live = [{
    stableId: 'doi:10.1000/shared',
    pmid: '55667788',
    doi: '10.1000/shared',
    title: 'Shared radar paper',
    kind: 'radar',
    sourceKind: 'radar',
    availability: 'metadata-only',
    status: 'missing',
    sources: { local: false, radar: true },
    sourceDocuments: []
  }];
  const service = transfer.createGlobalLibraryTransferService({
    readEntries: async () => live,
    readImportedEntries: () => store.readAll(),
    commitEntries: entries => store.replace(entries)
  });
  const bundle = transfer.exportGlobalLibraryTransfer([{
    stableId: 'pmid:55667788',
    pmid: '55667788',
    doi: '10.1000/shared',
    title: 'Shared radar paper',
    availability: 'local',
    status: 'complete',
    workspaceId: 'workspace:remote',
    paperId: 'paper:remote',
    sources: { local: true, radar: false },
    sourceDocuments: [{
      workspaceId: 'workspace:remote',
      workspaceGeneration: 2,
      documentHash: '9'.repeat(64),
      hasOfflineSnapshot: true,
      offlineSnapshotStatus: 'complete'
    }]
  }]);
  const receipt = await service.import(bundle, { idempotencyKey: 'library-overlay-0001' });
  assert.equal(receipt.summary.added, 0);
  assert.equal(receipt.summary.merged, 1);
  const imported = await store.readAll();
  assert.equal(imported.length, 1);
  assert.equal(imported[0].stableId, 'pmid:55667788');
  assert.equal(imported[0].availability, 'metadata-only');
  assert.equal(imported[0].status, 'missing');
  assert.equal(imported[0].inventoryOnly, true);
  assert.equal(imported[0].sources.local, false);
  assert.equal(imported[0].workspaceId, undefined);
  assert.equal(imported[0].paperId, undefined);
  assert.equal(imported[0].sourceDocuments[0].inventoryOnly, true);
});
