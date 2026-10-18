const test = require('node:test');
const assert = require('node:assert/strict');

const common = require('../core/library-transfer.js');
const radarModel = require('../core/literature-radar-model.js');
const {
  createMemoryRadarBackend,
  createRadarStore
} = require('../core/literature-radar-store.js');
const radarTransfer = require('../core/literature-radar-transfer.js');
const globalTransfer = require('../workbench/global-library-transfer.js');

function radarState() {
  return {
    schema: 1,
    active: null,
    radars: [{
      id: 'radar-fixture',
      name: 'Fixture radar',
      source: 'pubmed',
      query: 'glioma[tiab]',
      enabled: true,
      intervalHours: 24,
      baselineDays: 30,
      editVersion: 2,
      createdAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-02T00:00:00.000Z',
      revisions: [{
        number: 1,
        query: 'glioma[tiab]',
        baselineDays: 30,
        createdAt: '2026-10-01T00:00:00.000Z',
        windowStart: '2026-09-01',
        baselineAt: 1759276800000,
        lastSuccessAt: 1759276800000,
        lastAttemptAt: 1759276800000,
        nextRetryAt: null,
        lastNewCount: 0,
        warnings: [],
        queryTranslation: 'glioma[tiab]',
        error: null,
        articles: [
          {
            id: '12345678',
            title: 'A glioma synapse study',
            journal: 'Nature',
            doi: '10.1000/fixture',
            authors: ['Ada Lovelace'],
            isBaseline: true,
            read: true,
            firstSeenAt: 1759276800000,
            abstractSections: [{ label: 'BACKGROUND', text: 'Abstract text.' }],
            abstractStatus: 'ready'
          },
          {
            id: '23456789',
            title: 'A second glioma study',
            journal: 'Cell',
            doi: '',
            isBaseline: false,
            read: false,
            firstSeenAt: 1759276800000
          }
        ]
      }]
    }]
  };
}

function globalEntries() {
  return [{
    id: 'local-paper',
    kind: 'local',
    title: 'Local glioma paper',
    doi: '10.1000/local',
    pmid: '12345678',
    authors: 'Ada Lovelace',
    tags: ['glioma', 'local'],
    availability: 'local',
    status: 'complete',
    sources: { local: true, radar: false },
    sourceDocuments: [{
      workspaceId: 'workspace:fixture',
      workspaceGeneration: 2,
      documentHash: 'a'.repeat(64),
      hasOfflineSnapshot: true,
      offlineSnapshotStatus: 'complete',
      bytes: new Uint8Array([1, 2, 3])
    }]
  }, {
    id: 'radar-pmid:23456789',
    kind: 'radar',
    sourceKind: 'radar',
    pmid: '23456789',
    title: 'Radar-only paper',
    tags: [],
    availability: 'metadata-only',
    status: 'missing',
    radarRead: true,
    sources: { local: false, radar: true },
    sourceDocuments: []
  }];
}

function reseal(bundle) {
  const copy = JSON.parse(JSON.stringify(bundle));
  delete copy.integrity;
  copy.integrity = { algorithm: 'fnv1a32', digest: common.digest(copy) };
  return copy;
}

test('transfer envelope rejects versions, prototype keys, sensitive fields and binary fields', () => {
  const good = radarTransfer.exportRadarTransfer(radarState());
  assert.equal(good.schema, common.LIBRARY_TRANSFER_SCHEMA);
  assert.equal(good.integrity.algorithm, 'fnv1a32');
  assert.throws(() => common.validateEnvelope({ ...good, version: 2 }), {
    code: 'LIBRARY_TRANSFER_VERSION'
  });
  const badProto = JSON.parse(JSON.stringify(good));
  Object.defineProperty(badProto.payload.radars[0], '__proto__', {
    value: { polluted: true },
    enumerable: true,
    configurable: true
  });
  assert.throws(() => common.validateEnvelope(badProto), {
    code: 'LIBRARY_TRANSFER_PROTOTYPE_KEY'
  });
  const badSecret = JSON.parse(JSON.stringify(good));
  badSecret.payload.radars[0].apiKey = 'must-not-export';
  assert.throws(() => common.validateEnvelope(badSecret), {
    code: 'LIBRARY_TRANSFER_SENSITIVE_FIELD'
  });
  const badBinary = JSON.parse(JSON.stringify(good));
  badBinary.payload.radars[0].revisions[0].articles[0].bytes = 'AA==';
  assert.throws(() => common.validateEnvelope(badBinary), {
    code: 'LIBRARY_TRANSFER_BINARY_FIELD'
  });
});

test('combined transfer preserves both domain payloads and can be split back', () => {
  const radar = radarTransfer.exportRadarTransfer(radarState());
  const global = globalTransfer.exportGlobalLibraryTransfer(globalEntries());
  const combined = common.combineTransfers(radar, global);
  assert.equal(combined.kind, 'combined');
  const parts = common.splitCombinedTransfer(combined);
  assert.equal(parts.radar.kind, 'radar');
  assert.equal(parts.global.kind, 'global-library');
  assert.equal(parts.radar.payload.radars.length, 1);
  assert.equal(parts.global.payload.entries.length, 2);
});

test('radar transfer roundtrip preserves config, baseline/new/read state and source metadata', () => {
  const exported = radarTransfer.exportRadarTransfer(radarState());
  const imported = radarTransfer.mergeRadarTransfer(radarModel.emptyRadarState(), exported);
  const radar = imported.state.radars[0];
  assert.equal(radar.query, 'glioma[tiab]');
  assert.equal(radar.enabled, true);
  assert.equal(radar.intervalHours, 24);
  assert.equal(radar.revisions[0].articles[0].read, true);
  assert.equal(radar.revisions[0].articles[0].isBaseline, true);
  assert.equal(radar.revisions[0].articles[1].isBaseline, false);
  assert.equal(radar.revisions[0].articles[0].doi, '10.1000/fixture');
  assert.equal(imported.summary.created, 1);
});

test('radar import merges read state, preserves existing query, and reports conflicts', () => {
  const state = radarState();
  const exported = radarTransfer.exportRadarTransfer(state);
  exported.payload.radars[0].revisions[0].articles[0].read = false;
  exported.payload.radars[0].revisions[0].articles.push({
    id: '34567890',
    title: 'New imported paper',
    isBaseline: false,
    read: true,
    doi: '',
    journal: ''
  });
  const merged = radarTransfer.mergeRadarTransfer(state, reseal(exported));
  const radar = merged.state.radars[0];
  assert.equal(radar.revisions[0].articles[0].read, true);
  assert.equal(radar.revisions[0].articles.length, 3);
  assert.equal(merged.summary.articlesAdded, 1);
  const conflict = radarState();
  conflict.radars[0].query = 'different query';
  conflict.radars[0].revisions[0].query = 'different query';
  const conflicting = radarTransfer.exportRadarTransfer(conflict);
  const receipt = radarTransfer.mergeRadarTransfer(state, reseal(conflicting));
  assert.equal(receipt.state.radars[0].query, state.radars[0].query);
  assert.equal(receipt.conflicts[0].type, 'radar-id-query-conflict');
  assert.ok(receipt.warnings.some(warning => warning.includes('QUERY_CONFLICT')));
});

test('radar transfer service is atomic, revision guarded and idempotent', async () => {
  const store = createRadarStore({ backend: createMemoryRadarBackend() });
  const service = radarTransfer.createRadarTransferService({ store });
  const bundle = radarTransfer.exportRadarTransfer(radarState());
  const first = await service.import(bundle, { idempotencyKey: 'radar-import-key-1' });
  assert.equal(first.summary.created, 1);
  assert.equal(first.transferRevision, 1);
  const second = await service.import(bundle, { idempotencyKey: 'radar-import-key-1' });
  assert.equal(second.idempotent, true);
  assert.equal(second.transferRevision, 1);
  await assert.rejects(service.import(bundle, { idempotencyKey: '__proto__' }), {
    code: 'RADAR_TRANSFER_IDEMPOTENCY_REQUIRED'
  });
  await assert.rejects(
    service.import(bundle, { idempotencyKey: 'radar-import-key-2', expectedTransferRevision: 0 }),
    { code: 'RADAR_TRANSFER_REVISION_CONFLICT' }
  );
  const state = await store.read();
  assert.equal(state.transfer.revision, 1);
  assert.equal(state.transfer.audit.length, 1);
  assert.equal(state.radars.length, 1);
});

test('global transfer strips binary data and merges by PMID before DOI/title', () => {
  const bundle = globalTransfer.exportGlobalLibraryTransfer(globalEntries());
  const sent = JSON.stringify(bundle);
  assert.equal(bundle.kind, 'global-library');
  assert.doesNotMatch(sent, /AA==|bytes|dataUrl/u);
  assert.equal(bundle.payload.entries[0].sourceDocuments[0].workspaceId, 'workspace:fixture');
  const incoming = JSON.parse(JSON.stringify(bundle));
  incoming.payload.entries[0].tags.push('incoming');
  incoming.payload.entries[0].sourceDocuments.push({
    workspaceId: 'workspace:second',
    workspaceGeneration: 1,
    documentHash: 'b'.repeat(64),
    hasOfflineSnapshot: false,
    offlineSnapshotStatus: 'partial'
  });
  incoming.payload.entries[1].availability = 'local';
  incoming.payload.entries[1].sourceDocuments = [{
    workspaceId: 'workspace:radar',
    workspaceGeneration: 1,
    documentHash: 'c'.repeat(64)
  }];
  const merged = globalTransfer.mergeGlobalLibraryTransfer(globalEntries(), reseal(incoming));
  const local = merged.entries.find(entry => entry.pmid === '12345678');
  assert.deepEqual(local.tags.sort(), ['glioma', 'incoming', 'local']);
  assert.equal(local.sourceDocuments.length, 2);
  assert.equal(local.availability, 'local');
  assert.equal(local.status, 'complete');
  assert.equal(local.sources.local, true);
  assert.equal(merged.entries.length, 2);
});

test('global transfer deduplicates equivalent title and keeps existing metadata on conflict', () => {
  const base = globalEntries();
  const bundle = globalTransfer.exportGlobalLibraryTransfer([{
    id: 'title-only',
    pmid: '23456789',
    title: 'Renamed radar-only paper',
    tags: ['title-match'],
    availability: 'local',
    status: 'partial',
    sourceDocuments: [{ workspaceId: 'workspace:title', workspaceGeneration: 1, documentHash: 'd'.repeat(64) }],
    sources: { local: true, radar: false }
  }]);
  const merged = globalTransfer.mergeGlobalLibraryTransfer(base, reseal(bundle));
  assert.equal(merged.entries.length, 2);
  const item = merged.entries.find(entry => entry.title === 'Radar-only paper');
  assert.equal(item.pmid, '23456789');
  assert.equal(item.availability, 'metadata-only');
  assert.equal(item.status, 'missing');
  assert.equal(item.sources.local, false);
  assert.equal(item.sources.radar, true);
  assert.equal(item.sourceKind, 'radar');
  assert.equal(item.workspaceId, undefined);
  assert.equal(item.paperId, undefined);
  assert.equal(item.sourceDocuments[0].inventoryOnly, true);
  assert.deepEqual(item.tags.sort(), ['title-match']);
  assert.ok(merged.warnings.some(warning => warning.includes('METADATA_CONFLICT')));
});

test('a newly imported global entry records inventory but never claims a local full text on this device', () => {
  const bundle = globalTransfer.exportGlobalLibraryTransfer([{
    id: 'portable',
    pmid: '34567890',
    title: 'Portable metadata-only record',
    availability: 'local',
    status: 'complete',
    sourceDocuments: [{
      workspaceId: 'workspace:remote',
      workspaceGeneration: 1,
      documentHash: 'e'.repeat(64),
      hasOfflineSnapshot: true,
      offlineSnapshotStatus: 'complete'
    }],
    sources: { local: true, radar: false }
  }]);
  const merged = globalTransfer.mergeGlobalLibraryTransfer([], reseal(bundle));
  assert.equal(merged.entries.length, 1);
  assert.equal(merged.entries[0].availability, 'metadata-only');
  assert.equal(merged.entries[0].status, 'missing');
  assert.equal(merged.entries[0].sources.local, false);
  assert.equal(merged.entries[0].inventoryOnly, true);
  assert.equal(merged.entries[0].sourceDocuments.length, 1);
  assert.equal(merged.entries[0].sourceDocuments[0].inventoryOnly, true);
  assert.equal(merged.entries[0].workspaceId, undefined);
  assert.equal(merged.entries[0].paperId, undefined);
});

test('importing a local-device bundle never upgrades an existing radar-only entry to local', () => {
  const radarOnly = globalEntries()[1];
  const bundle = globalTransfer.exportGlobalLibraryTransfer([{
    id: 'remote-local',
    pmid: '23456789',
    title: 'Radar-only paper',
    availability: 'local',
    status: 'complete',
    workspaceId: 'workspace:remote',
    paperId: 'paper:remote',
    sourceDocuments: [{
      workspaceId: 'workspace:remote',
      workspaceGeneration: 3,
      documentHash: 'f'.repeat(64),
      hasOfflineSnapshot: true,
      offlineSnapshotStatus: 'complete'
    }],
    sources: { local: true, radar: false }
  }]);
  const merged = globalTransfer.mergeGlobalLibraryTransfer([radarOnly], reseal(bundle));
  const item = merged.entries[0];
  assert.equal(merged.entries.length, 1);
  assert.equal(item.availability, 'metadata-only');
  assert.equal(item.status, 'missing');
  assert.equal(item.sources.local, false);
  assert.equal(item.sources.radar, true);
  assert.equal(item.sourceKind, 'radar');
  assert.equal(item.workspaceId, undefined);
  assert.equal(item.paperId, undefined);
  assert.equal(item.sourceDocuments.length, 1);
  assert.equal(item.sourceDocuments[0].workspaceId, 'workspace:remote');
  assert.equal(item.sourceDocuments[0].hasOfflineSnapshot, true);
  assert.equal(item.sourceDocuments[0].inventoryOnly, true);
});

test('global transfer service requires idempotency and can roundtrip through an atomic commit', async () => {
  let entries = [];
  const service = globalTransfer.createGlobalLibraryTransferService({
    readEntries: async () => entries,
    commitEntries: async next => { entries = next; }
  });
  const bundle = globalTransfer.exportGlobalLibraryTransfer(globalEntries());
  await assert.rejects(service.import(bundle, {}), {
    code: 'GLOBAL_LIBRARY_TRANSFER_IDEMPOTENCY_REQUIRED'
  });
  const receipt = await service.import(bundle, { idempotencyKey: 'global-import-key-1' });
  assert.equal(receipt.summary.total, 2);
  const repeat = await service.import(bundle, { idempotencyKey: 'global-import-key-1' });
  assert.equal(repeat.idempotent, true);
  assert.equal(entries.length, 2);
});
