(function(root, factory) {
  const common = typeof module === 'object' && module.exports;
  const api = factory(
    common ? require('../core/library-transfer.js') : root.BrevessLibraryTransfer,
    common ? require('./global-library.js') : root.BrevessWorkbenchLibrary
  );
  if (common) module.exports = api;
  root.BrevessWorkbenchLibrary = Object.assign(root.BrevessWorkbenchLibrary || {}, api);
})(globalThis, function(t, library) {
  'use strict';
  const fail = t.transferError;
  const GLOBAL_TRANSFER_KIND = 'global-library';
  const STATUS_VALUES = new Set(['missing', 'unknown', 'partial', 'complete']);
  const ENTRY_KEYS = [
    'id', 'stableId', 'pmid', 'doi', 'title', 'authors', 'journal', 'publicationDate',
    'year', 'abstract', 'url', 'kind', 'sourceKind', 'availability', 'status', 'tags',
    'sourceDocuments', 'sources', 'radarRead', 'radarId', 'radarRevision',
    'workspaceId', 'paperId', 'imported', 'inventoryOnly'
  ];
  const DOCUMENT_KEYS = [
    'workspaceId', 'workspaceGeneration', 'documentId', 'documentHash', 'documentGeneration',
    'title', 'fileName', 'canonicalUrl', 'sourceUrl', 'offlineSnapshotStatus',
    'hasOfflineSnapshot', 'lastSaveAttemptStatus', 'availability', 'mimeType', 'paperId'
  ];
  const DOCUMENT_KEY = document => [
    document.workspaceId || '', document.workspaceGeneration || '', document.documentId || '',
    document.documentHash || '', document.fileName || '', document.title || ''
  ].join('|');
  function sanitizeDocument(document = {}) {
    const result = {};
    for (const key of DOCUMENT_KEYS) {
      if (document[key] !== undefined && document[key] !== null) {
        result[key] = typeof document[key] === 'string'
          ? t.sanitizeString(document[key], 4000)
          : t.clone(document[key]);
      }
    }
    if (document.inventoryOnly === true) result.inventoryOnly = true;
    return result;
  }
  function sanitizeEntry(entry = {}) {
    if (!t.plain(entry) || typeof entry.title !== 'string' || !entry.title.trim()) {
      throw fail('GLOBAL_LIBRARY_TRANSFER_ENTRY_INVALID', 'global library entry 缺少标题。');
    }
    const result = {};
    for (const key of ENTRY_KEYS) if (entry[key] !== undefined) result[key] = t.clone(entry[key]);
    result.title = t.sanitizeString(entry.title, 4000);
    result.authors = t.sanitizeString(entry.authors, 20000);
    result.journal = t.sanitizeString(entry.journal, 1000);
    result.abstract = t.sanitizeString(entry.abstract, 120000);
    result.pmid = t.normalizePmid(entry.pmid || entry.id);
    result.doi = t.normalizeDoi(entry.doi);
    result.year = t.sanitizeString(entry.year, 16);
    result.url = t.sanitizeString(entry.url, 4000);
    result.tags = t.sanitizeStringArray(entry.tags, 64, 200);
    result.sourceDocuments = (Array.isArray(entry.sourceDocuments) ? entry.sourceDocuments : [])
      .slice(0, 100).map(sanitizeDocument);
    result.availability = entry.availability === 'local' ? 'local' : 'metadata-only';
    result.status = STATUS_VALUES.has(entry.status) ? entry.status : 'missing';
    result.sources = {
      local: entry.sources?.local === true,
      radar: entry.sources?.radar === true
    };
    result.radarRead = entry.radarRead === true;
    result.kind = entry.kind === 'local' ? 'local' : entry.kind === 'radar' ? 'radar' : 'local';
    result.sourceKind = result.sources.local && result.sources.radar ? 'mixed'
      : result.sources.radar ? 'radar' : 'local';
    result.stableId = t.identityKey(result);
    if (!result.stableId) throw fail('GLOBAL_LIBRARY_TRANSFER_ENTRY_INVALID', 'global library entry 身份为空。');
    return result;
  }
  function validateGlobalTransfer(bundle) {
    const value = t.validateEnvelope(bundle, { expectedKind: GLOBAL_TRANSFER_KIND });
    if (!t.plain(value.payload) || !Array.isArray(value.payload.entries) ||
        value.payload.entries.length > 5000) throw fail('GLOBAL_LIBRARY_TRANSFER_INVALID');
    for (const entry of value.payload.entries) sanitizeEntry(entry);
    return value;
  }
  function exportGlobalLibraryTransfer(entries, { now = Date.now } = {}) {
    if (!Array.isArray(entries) || entries.length > 5000) throw fail('GLOBAL_LIBRARY_TRANSFER_ENTRIES');
    const at = typeof now === 'function' ? now() : now;
    return t.makeEnvelope({
      kind: GLOBAL_TRANSFER_KIND,
      generatedAt: new Date(at).toISOString(),
      source: { app: 'brevess', libraryView: 'global', copiesBinary: false },
      payload: { entries: entries.map(sanitizeEntry) }
    });
  }
  function mergeDocumentList(existing, incoming) {
    const map = new Map((Array.isArray(existing) ? existing : []).map(document => [DOCUMENT_KEY(document), document]));
    for (const document of Array.isArray(incoming) ? incoming : []) {
      const key = DOCUMENT_KEY(document);
      if (!map.has(key)) map.set(key, sanitizeDocument(document));
    }
    return [...map.values()];
  }
  function mergeGlobalLibraryTransfer(existingEntries, bundle, { now = Date.now } = {}) {
    if (!Array.isArray(existingEntries)) throw fail('GLOBAL_LIBRARY_TRANSFER_ENTRIES');
    const value = validateGlobalTransfer(bundle);
    const entries = existingEntries.map(sanitizeEntry);
    const warnings = [], conflicts = [], added = [], merged = [];
    const index = new Map();
    for (const entry of entries) for (const key of t.allIdentityKeys(entry)) if (!index.has(key)) index.set(key, entry);
    for (const raw of value.payload.entries) {
      const incoming = sanitizeEntry(raw);
      let target = null;
      for (const key of t.allIdentityKeys(incoming)) {
        if (index.has(key)) { target = index.get(key); break; }
      }
      if (!target) {
        const {
          workspaceId: _workspaceId,
          paperId: _paperId,
          ...portable
        } = incoming;
        const imported = {
          ...portable,
          imported: true,
          inventoryOnly: true,
          availability: 'metadata-only',
          status: 'missing',
          sources: { local: false, radar: incoming.sources?.radar === true },
          sourceKind: incoming.sources?.radar === true ? 'radar' : 'local',
          sourceDocuments: (incoming.sourceDocuments || []).map(document => ({
            ...document,
            inventoryOnly: true
          }))
        };
        entries.push(imported);
        for (const key of t.allIdentityKeys(imported)) index.set(key, imported);
        added.push(imported.stableId);
        continue;
      }
      const metadataConflict = ['title', 'doi', 'pmid'].some(key =>
        target[key] && incoming[key] && String(target[key]).toLowerCase() !== String(incoming[key]).toLowerCase());
      if (metadataConflict) {
        conflicts.push({ type: 'global-library-metadata-conflict', stableId: target.stableId });
        warnings.push(`GLOBAL_LIBRARY_METADATA_CONFLICT:${target.stableId}`);
      }
      target.tags = [...new Set([...(target.tags || []), ...(incoming.tags || [])])].slice(0, 64);
      target.sourceDocuments = mergeDocumentList(
        target.sourceDocuments,
        (incoming.sourceDocuments || []).map(document => ({ ...document, inventoryOnly: true }))
      );
      target.radarRead = target.radarRead === true || incoming.radarRead === true;
      const targetIsLocal = target.imported !== true &&
        (target.sources?.local === true || target.availability === 'local');
      target.sources = {
        local: targetIsLocal,
        radar: target.sources?.radar === true || incoming.sources?.radar === true
      };
      target.sourceKind = target.sources.local && target.sources.radar ? 'mixed'
        : target.sources.radar ? 'radar' : 'local';
      if (!targetIsLocal) {
        target.availability = 'metadata-only';
        target.status = 'missing';
        target.inventoryOnly = true;
      }
      for (const key of ['stableId', 'pmid', 'doi', 'title', 'authors', 'journal', 'publicationDate',
        'year', 'abstract', 'url', 'radarId', 'radarRevision']) {
        if ((target[key] === undefined || target[key] === null || target[key] === '') && incoming[key] !== undefined) {
          target[key] = incoming[key];
        }
      }
      target.stableId = target.stableId || t.identityKey(target);
      merged.push(target.stableId);
    }
    return { entries, warnings: [...new Set(warnings)], conflicts, added, merged, summary: {
      added: added.length, merged: merged.length, total: entries.length
    } };
  }
  function createGlobalLibraryTransferService({
    readEntries,
    readImportedEntries = null,
    commitEntries,
    now = Date.now,
    audit = () => {}
  } = {}) {
    if (typeof readEntries !== 'function' || typeof commitEntries !== 'function') {
      throw fail('GLOBAL_LIBRARY_TRANSFER_SERVICE_REQUIRED');
    }
    let revision = 0;
    const idempotency = new Map();
    async function exportBundle() {
      return exportGlobalLibraryTransfer(await readEntries(), { now: now() });
    }
    async function importBundle(bundle, { idempotencyKey } = {}) {
      if (typeof idempotencyKey !== 'string' || idempotencyKey.length < 8 || idempotencyKey.length > 160) {
        throw fail('GLOBAL_LIBRARY_TRANSFER_IDEMPOTENCY_REQUIRED');
      }
      const validated = validateGlobalTransfer(bundle);
      const digest = validated.integrity.digest;
      if (idempotency.get(idempotencyKey)?.digest === digest) {
        return { ...idempotency.get(idempotencyKey).receipt, idempotent: true };
      }
      const existing = await readEntries();
      const merged = mergeGlobalLibraryTransfer(existing, validated, { now: now() });
      const importedBase = typeof readImportedEntries === 'function'
        ? await readImportedEntries()
        : existing;
      const importedMerged = importedBase === existing
        ? merged
        : mergeGlobalLibraryTransfer(importedBase, validated, { now: now() });
      await commitEntries(importedMerged.entries, { digest, summary: merged.summary });
      revision += 1;
      const receipt = {
        kind: GLOBAL_TRANSFER_KIND, digest, transferRevision: revision,
        warnings: merged.warnings, conflicts: merged.conflicts, summary: merged.summary
      };
      idempotency.set(idempotencyKey, { digest, receipt });
      while (idempotency.size > 32) idempotency.delete(idempotency.keys().next().value);
      try { audit({ action: 'import', kind: GLOBAL_TRANSFER_KIND, digest,
        transferRevision: revision, summary: merged.summary, at: new Date(now()).toISOString() }); } catch (_) {}
      return receipt;
    }
    return { export: exportBundle, import: importBundle, get revision() { return revision; } };
  }
  return {
    GLOBAL_TRANSFER_KIND,
    sanitizeDocument,
    sanitizeEntry,
    validateGlobalTransfer,
    exportGlobalLibraryTransfer,
    mergeGlobalLibraryTransfer,
    createGlobalLibraryTransferService
  };
});
