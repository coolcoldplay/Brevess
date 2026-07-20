(function attach(root, factory) {
  const api = factory(root.SciLLM || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory(shared) {
  const WORKSPACE_STORE_NAME = 'workspaces';
  const WORKSPACE_ASSET_STORE_NAME = 'workspaceAssets';
  const WORKSPACE_TURN_STORE_NAME = 'workspaceTurns';
  const WORKSPACE_TOMBSTONE_STORE_NAME = 'workspaceTombstones';
  const MAX_PAGE_SIZE = 10_000;

  function fail(code) {
    const error = new Error(code);
    error.code = code;
    throw error;
  }

  function isPlainObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }

  function cloneValue(value) {
    if (typeof structuredClone === 'function') return structuredClone(value);
    if (Array.isArray(value)) return value.map(cloneValue);
    if (isPlainObject(value)) {
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneValue(item)]));
    }
    return value;
  }

  function safeValue(value) {
    if (typeof shared.assertWorkspaceSafeValue !== 'function') fail('WORKSPACE_SAFETY_UNAVAILABLE');
    shared.assertWorkspaceSafeValue(value);
    return cloneValue(value);
  }

  function workspaceId(value) {
    const id = String(value || '').trim().toLocaleLowerCase('en-US');
    if (!/^workspace:[a-f0-9]{64}$/u.test(id)) fail('INVALID_WORKSPACE_ID');
    return id;
  }

  function boundedId(value, code) {
    const id = String(value || '').normalize('NFKC').trim();
    if (!id || id.length > 300 || /[\u0000-\u001f\u007f]/u.test(id)) fail(code);
    return id;
  }

  function normalizeHash(value, code = 'INVALID_CONTENT_HASH') {
    const hash = String(value || '').replace(/^sha256:/iu, '').toLocaleLowerCase('en-US');
    if (!hash || hash.length > 300 || /[\u0000-\u001f\u007f]/u.test(hash)) fail(code);
    return hash;
  }

  function normalizeWorkspace(input) {
    if (!isPlainObject(input)) fail('INVALID_WORKSPACE');
    safeValue(input);
    if (typeof shared.createWorkspaceManifest === 'function') {
      const manifest = shared.createWorkspaceManifest(input, []);
      return {
        schemaVersion: 1,
        workspaceId: workspaceId(manifest.workspaceId),
        canonicalUrl: manifest.canonicalUrl,
        aliases: cloneValue(manifest.aliases),
        title: manifest.title,
        directoryName: manifest.directoryName,
        revision: manifest.contentHash,
        contentHash: manifest.contentHash,
        workspaceGeneration: manifest.workspaceGeneration
      };
    }
    const id = workspaceId(input.workspaceId);
    const revision = normalizeHash(input.revision || input.contentHash);
    const contentHash = normalizeHash(input.contentHash || revision);
    const canonicalUrl = typeof shared.normalizeWorkspaceCanonicalUrl === 'function'
      ? shared.normalizeWorkspaceCanonicalUrl(input.canonicalUrl) : String(input.canonicalUrl || '');
    const directoryName = boundedId(input.directoryName, 'INVALID_WORKSPACE_DIRECTORY');
    return {
      ...cloneValue(input),
      schemaVersion: 1,
      workspaceId: id,
      canonicalUrl,
      aliases: Array.isArray(input.aliases) ? cloneValue(input.aliases) : [],
      title: String(input.title || '').normalize('NFKC').trim().slice(0, 1000),
      directoryName,
      revision,
      contentHash,
      workspaceGeneration: 1
    };
  }

  function assetKey(id, path) {
    return `${workspaceId(id)}\u0000${path}`;
  }

  function turnKey(id, turnId) {
    return `${workspaceId(id)}\u0000${boundedId(turnId, 'INVALID_TURN_ID')}`;
  }

  function tombstoneKey(id, tombstoneId) {
    return `${workspaceId(id)}\u0000${boundedId(tombstoneId, 'INVALID_TOMBSTONE_ID')}`;
  }

  function byteSize(value) {
    if (typeof value === 'string') return new TextEncoder().encode(value).byteLength;
    if (value instanceof ArrayBuffer) return value.byteLength;
    if (ArrayBuffer.isView(value)) return value.byteLength;
    if (typeof Blob !== 'undefined' && value instanceof Blob) return value.size;
    try { return new TextEncoder().encode(JSON.stringify(value)).byteLength; } catch (_) { return 0; }
  }

  function nonNegativeCount(value) {
    return Math.max(0, Number(value) || 0);
  }

  function normalizeWorkspaceSummary(input = {}) {
    return {
      assetCount: nonNegativeCount(input.assetCount),
      assetBytes: nonNegativeCount(input.assetBytes),
      turnCount: nonNegativeCount(input.turnCount),
      turnBytes: nonNegativeCount(input.turnBytes),
      chatTurnCount: nonNegativeCount(input.chatTurnCount),
      figureCount: nonNegativeCount(input.figureCount),
      panelCount: nonNegativeCount(input.panelCount),
      highlightCount: nonNegativeCount(input.highlightCount),
      annotationCount: nonNegativeCount(input.annotationCount)
    };
  }

  function workspaceAssetContribution(path, content, bytes) {
    const contribution = {
      byteSize: nonNegativeCount(bytes), chatTurnCount: 0, figureCount: 0,
      panelCount: 0, highlightCount: 0, annotationCount: 0
    };
    if (path === 'chat/index.json') {
      contribution.chatTurnCount = Array.isArray(content?.turns)
        ? content.turns.length : nonNegativeCount(content?.totalTurns);
    } else if (path === 'figures/inventory.json') {
      const figures = Array.isArray(content?.figures) ? content.figures : [];
      contribution.figureCount = figures.length;
      contribution.panelCount = figures.reduce((total, figure) => {
        const panels = new Set();
        (Array.isArray(figure?.panelHints) ? figure.panelHints : []).forEach(panel =>
          panels.add(String(panel?.panelId || panel?.panel || panel || '')));
        Object.keys(figure?.panelAnalyses || {}).forEach(panel => panels.add(String(panel)));
        Object.keys(figure?.panelFollowups || {}).forEach(panel => panels.add(String(panel)));
        return total + [...panels].filter(Boolean).length;
      }, 0);
    } else if (path === 'annotations/highlights.json') {
      contribution.highlightCount = nonNegativeCount(
        content?.highlightDistribution?.totalHighlights
      );
      contribution.annotationCount = Array.isArray(content?.annotations)
        ? content.annotations.length : 0;
    }
    return contribution;
  }

  function summarizeWorkspaceContributions(contributions = {}, previous = {}) {
    const summary = normalizeWorkspaceSummary(previous);
    const values = Object.values(contributions || {});
    summary.assetCount = values.length;
    summary.assetBytes = values.reduce((sum, item) => sum + nonNegativeCount(item?.byteSize), 0);
    for (const field of [
      'chatTurnCount', 'figureCount', 'panelCount', 'highlightCount', 'annotationCount'
    ]) {
      summary[field] = values.reduce((sum, item) => sum + nonNegativeCount(item?.[field]), 0);
    }
    return summary;
  }

  function stableValue(value) {
    if (Array.isArray(value)) return value.map(stableValue);
    if (!isPlainObject(value)) return value;
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]));
  }

  function contentFingerprint(value) {
    let text;
    try { text = typeof value === 'string' ? value : JSON.stringify(stableValue(value)); }
    catch (_) { text = String(value); }
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }

  function createIndexedDbArticleWorkspaceStore(indexedDbRef, options = {}) {
    if (typeof shared.runUserDataTransaction !== 'function' ||
        typeof shared.requestToPromise !== 'function') {
      fail('USER_DATA_DATABASE_UNAVAILABLE');
    }
    const now = typeof options.now === 'function' ? options.now : () => new Date().toISOString();
    const request = shared.requestToPromise;
    const run = (storeNames, mode, operation) =>
      shared.runUserDataTransaction(indexedDbRef, storeNames, mode, operation);

    async function ensureWorkspace(input, conflict = {}) {
      const normalized = normalizeWorkspace(input);
      return run([WORKSPACE_STORE_NAME, WORKSPACE_TOMBSTONE_STORE_NAME], 'readwrite',
        async transaction => {
          const store = transaction.objectStore(WORKSPACE_STORE_NAME);
          const current = await request(store.get(normalized.workspaceId));
          if (current?.deletionPending) fail('WORKSPACE_DELETION_PENDING');
          if (!current) {
            const tombstones = await request(
              transaction.objectStore(WORKSPACE_TOMBSTONE_STORE_NAME).getAll()
            );
            const latestDeletionGeneration = tombstones
              .filter(item => item.workspaceId === normalized.workspaceId &&
                item.entityType === 'workspace')
              .reduce((maximum, item) =>
                Math.max(maximum, Number(item.workspaceGeneration || 0)), 0);
            if (latestDeletionGeneration >= normalized.workspaceGeneration) {
              fail('WORKSPACE_GENERATION_CONFLICT');
            }
          }
          if (current && conflict.expectedRevision !== undefined &&
              current.revision !== conflict.expectedRevision) fail('WORKSPACE_REVISION_CONFLICT');
          if (current && conflict.expectedContentHash !== undefined &&
              current.contentHash !== conflict.expectedContentHash) fail('WORKSPACE_HASH_CONFLICT');
          const timestamp = now();
          const contentChanged = Boolean(current && current.contentHash !== normalized.contentHash);
          const saved = {
            ...current,
            ...normalized,
            workspaceGeneration: Math.max(
              Number(current?.workspaceGeneration || 0),
              Number(normalized.workspaceGeneration || 1)
            ),
            createdAt: current?.createdAt || timestamp,
            updatedAt: !current || contentChanged ? timestamp : current.updatedAt,
            lastAccessedAt: timestamp,
            summary: normalizeWorkspaceSummary(current?.summary),
            assetSummaryByPath: cloneValue(current?.assetSummaryByPath || {}),
            nextTurnSequence: Number.isSafeInteger(current?.nextTurnSequence)
              ? current.nextTurnSequence : 0,
            storageRevision: Number.isSafeInteger(current?.storageRevision)
              ? current.storageRevision : 0,
            memoryNeedsRebuild: Boolean(current?.memoryNeedsRebuild),
            deletionPending: false
          };
          await request(store.put(saved));
          return cloneValue(saved);
        });
    }

    async function getWorkspace(value) {
      const id = workspaceId(value);
      return run(WORKSPACE_STORE_NAME, 'readonly', async transaction => {
        const result = await request(transaction.objectStore(WORKSPACE_STORE_NAME).get(id));
        return result ? cloneValue(result) : null;
      });
    }

    async function listWorkspaces() {
      return run(WORKSPACE_STORE_NAME, 'readonly', async transaction => {
        const records = await request(transaction.objectStore(WORKSPACE_STORE_NAME).getAll());
        return records.map(cloneValue).sort((first, second) =>
          String(second.updatedAt || '').localeCompare(String(first.updatedAt || '')));
      });
    }

    async function putAsset(value, relativePath, content, conflict = {}) {
      const id = workspaceId(value);
      const path = shared.normalizeWorkspaceRelativePath(relativePath);
      const safeContent = safeValue(content);
      const key = assetKey(id, path);
      return run([WORKSPACE_STORE_NAME, WORKSPACE_ASSET_STORE_NAME], 'readwrite',
        async transaction => {
          const workspaceStore = transaction.objectStore(WORKSPACE_STORE_NAME);
          const assets = transaction.objectStore(WORKSPACE_ASSET_STORE_NAME);
          const owner = await request(workspaceStore.get(id));
          if (!owner || owner.deletionPending) fail('WORKSPACE_NOT_FOUND');
          const current = await request(assets.get(key));
          if (conflict.expectedRevision !== undefined &&
              Number(current?.revision || 0) !== Number(conflict.expectedRevision)) {
            fail('ASSET_REVISION_CONFLICT');
          }
          if (conflict.expectedContentHash !== undefined &&
              String(current?.contentHash || '') !== String(conflict.expectedContentHash)) {
            fail('ASSET_HASH_CONFLICT');
          }
          const timestamp = now();
          const saved = {
            assetKey: key,
            workspaceId: id,
            workspaceGeneration: Number(owner.workspaceGeneration || 1),
            relativePath: path,
            content: safeContent,
            contentHash: String(conflict.contentHash || contentFingerprint(safeContent)),
            revision: Number(current?.revision || 0) + 1,
            byteSize: byteSize(safeContent),
            createdAt: current?.createdAt || timestamp,
            updatedAt: timestamp
          };
          const assetSummaryByPath = {
            ...(owner.assetSummaryByPath || {}),
            [path]: workspaceAssetContribution(path, safeContent, saved.byteSize)
          };
          const updatedOwner = {
            ...owner,
            storageRevision: Number(owner.storageRevision || 0) + 1,
            updatedAt: timestamp,
            summary: summarizeWorkspaceContributions(assetSummaryByPath, owner.summary),
            assetSummaryByPath
          };
          await request(assets.put(saved));
          await request(workspaceStore.put(updatedOwner));
          return cloneValue(saved);
        });
    }

    async function getAsset(value, relativePath) {
      const id = workspaceId(value);
      const path = shared.normalizeWorkspaceRelativePath(relativePath);
      return run(WORKSPACE_ASSET_STORE_NAME, 'readonly', async transaction => {
        const result = await request(transaction.objectStore(WORKSPACE_ASSET_STORE_NAME)
          .get(assetKey(id, path)));
        return result ? cloneValue(result) : null;
      });
    }

    async function listAssets(value) {
      const id = workspaceId(value);
      return run(WORKSPACE_ASSET_STORE_NAME, 'readonly', async transaction => {
        const records = await request(transaction.objectStore(WORKSPACE_ASSET_STORE_NAME).getAll());
        return records.filter(record => record.workspaceId === id).map(cloneValue)
          .sort((first, second) => first.relativePath.localeCompare(second.relativePath));
      });
    }

    async function appendTurn(value, input) {
      const id = workspaceId(value);
      if (!isPlainObject(input)) fail('INVALID_TURN');
      safeValue(input);
      const idOfTurn = boundedId(input.turnId, 'INVALID_TURN_ID');
      const key = turnKey(id, idOfTurn);
      return run([WORKSPACE_STORE_NAME, WORKSPACE_TURN_STORE_NAME], 'readwrite',
        async transaction => {
          const workspaces = transaction.objectStore(WORKSPACE_STORE_NAME);
          const turns = transaction.objectStore(WORKSPACE_TURN_STORE_NAME);
          const owner = await request(workspaces.get(id));
          if (!owner || owner.deletionPending) fail('WORKSPACE_NOT_FOUND');
          if (await request(turns.get(key))) fail('TURN_ALREADY_EXISTS');
          const timestamp = now();
          const sequence = Number(owner.nextTurnSequence || 0) + 1;
          const saved = {
            ...cloneValue(input),
            turnKey: key,
            workspaceId: id,
            workspaceGeneration: Number(owner.workspaceGeneration || 1),
            turnId: idOfTurn,
            sequence,
            revision: 1,
            createdAt: timestamp,
            updatedAt: timestamp
          };
          await request(turns.put(saved));
          await request(workspaces.put({
            ...owner, nextTurnSequence: sequence,
            storageRevision: Number(owner.storageRevision || 0) + 1,
            updatedAt: timestamp,
            summary: {
              ...normalizeWorkspaceSummary(owner.summary),
              turnCount: nonNegativeCount(owner.summary?.turnCount) + 1,
              turnBytes: nonNegativeCount(owner.summary?.turnBytes) + byteSize(saved)
            }
          }));
          return cloneValue(saved);
        });
    }

    async function updateTurn(value, turnIdValue, patch, conflict = {}) {
      const id = workspaceId(value);
      const key = turnKey(id, turnIdValue);
      if (!isPlainObject(patch)) fail('INVALID_TURN');
      safeValue(patch);
      return run([WORKSPACE_STORE_NAME, WORKSPACE_TURN_STORE_NAME], 'readwrite', async transaction => {
        const store = transaction.objectStore(WORKSPACE_TURN_STORE_NAME);
        const workspaces = transaction.objectStore(WORKSPACE_STORE_NAME);
        const current = await request(store.get(key));
        if (!current) fail('TURN_NOT_FOUND');
        if (conflict.expectedRevision !== undefined &&
            Number(current.revision) !== Number(conflict.expectedRevision)) fail('TURN_REVISION_CONFLICT');
        const saved = {
          ...current,
          ...cloneValue(patch),
          turnKey: current.turnKey,
          workspaceId: current.workspaceId,
          turnId: current.turnId,
          sequence: current.sequence,
          revision: Number(current.revision || 0) + 1,
          updatedAt: now()
        };
        await request(store.put(saved));
        const owner = await request(workspaces.get(id));
        if (owner) {
          await request(workspaces.put({
            ...owner,
            updatedAt: saved.updatedAt,
            summary: {
              ...normalizeWorkspaceSummary(owner.summary),
              turnBytes: Math.max(0, nonNegativeCount(owner.summary?.turnBytes) -
                byteSize(current) + byteSize(saved))
            }
          }));
        }
        return cloneValue(saved);
      });
    }

    async function pageTurns(value, options = {}) {
      const id = workspaceId(value);
      const limit = Math.max(1, Math.min(MAX_PAGE_SIZE, Number(options.limit) || 100));
      const after = Math.max(0, Number(options.afterSequence) || 0);
      return run(WORKSPACE_TURN_STORE_NAME, 'readonly', async transaction => {
        const store = transaction.objectStore(WORKSPACE_TURN_STORE_NAME);
        let records;
        if (typeof store.index === 'function' && typeof IDBKeyRange !== 'undefined') {
          const range = IDBKeyRange.bound(
            [id, after], [id, Number.MAX_SAFE_INTEGER], true, false
          );
          records = await request(store.index('workspaceSequence').getAll(range, limit + 1));
        } else {
          records = await request(store.getAll());
        }
        const matching = records.filter(record => record.workspaceId === id && record.sequence > after)
          .sort((first, second) => first.sequence - second.sequence);
        const items = matching.slice(0, limit).map(cloneValue);
        return {
          items,
          hasMore: matching.length > items.length,
          nextSequence: items.length ? items.at(-1).sequence : after
        };
      });
    }

    function newTombstone(id, entityType, entityId, workspaceGeneration = 1) {
      const deletedAt = now();
      const tombstoneId = `${entityType}:${entityId}:${deletedAt}`;
      return {
        tombstoneKey: tombstoneKey(id, tombstoneId),
        tombstoneId,
        workspaceId: id,
        entityType,
        entityId,
        workspaceGeneration,
        deletedAt
      };
    }

    async function deleteTurn(value, turnIdValue) {
      const id = workspaceId(value);
      const idOfTurn = boundedId(turnIdValue, 'INVALID_TURN_ID');
      const key = turnKey(id, idOfTurn);
      return run([
        WORKSPACE_STORE_NAME, WORKSPACE_TURN_STORE_NAME, WORKSPACE_TOMBSTONE_STORE_NAME
      ], 'readwrite',
        async transaction => {
          const turns = transaction.objectStore(WORKSPACE_TURN_STORE_NAME);
          const workspaces = transaction.objectStore(WORKSPACE_STORE_NAME);
          const current = await request(turns.get(key));
          if (!current) return null;
          const tombstone = newTombstone(id, 'turn', idOfTurn,
            Number(current.workspaceGeneration || 1));
          await request(transaction.objectStore(WORKSPACE_TOMBSTONE_STORE_NAME).put(tombstone));
          await request(turns.delete(key));
          const owner = await request(workspaces.get(id));
          if (owner) {
            await request(workspaces.put({
              ...owner,
              updatedAt: tombstone.deletedAt,
              summary: {
                ...normalizeWorkspaceSummary(owner.summary),
                turnCount: Math.max(0, nonNegativeCount(owner.summary?.turnCount) - 1),
                turnBytes: Math.max(0,
                  nonNegativeCount(owner.summary?.turnBytes) - byteSize(current))
              }
            }));
          }
          return cloneValue(tombstone);
        });
    }

    async function markMemoryRebuild(value, required = true) {
      const id = workspaceId(value);
      return run(WORKSPACE_STORE_NAME, 'readwrite', async transaction => {
        const store = transaction.objectStore(WORKSPACE_STORE_NAME);
        const current = await request(store.get(id));
        if (!current) fail('WORKSPACE_NOT_FOUND');
        const saved = { ...current, memoryNeedsRebuild: Boolean(required), updatedAt: now() };
        await request(store.put(saved));
        return cloneValue(saved);
      });
    }

    async function beginWorkspaceDeletion(value) {
      const id = workspaceId(value);
      return run([WORKSPACE_STORE_NAME, WORKSPACE_TOMBSTONE_STORE_NAME], 'readwrite',
        async transaction => {
          const workspaces = transaction.objectStore(WORKSPACE_STORE_NAME);
          const current = await request(workspaces.get(id));
          if (!current) fail('WORKSPACE_NOT_FOUND');
          if (current.deletionPending && current.deletionTombstoneId) {
            const records = await request(
              transaction.objectStore(WORKSPACE_TOMBSTONE_STORE_NAME).getAll()
            );
            const existing = records.find(item =>
              item.workspaceId === id && item.tombstoneId === current.deletionTombstoneId);
            if (existing) return cloneValue(existing);
          }
          const tombstone = newTombstone(id, 'workspace', id,
            Number(current.workspaceGeneration || 1));
          await request(transaction.objectStore(WORKSPACE_TOMBSTONE_STORE_NAME).put(tombstone));
          await request(workspaces.put({
            ...current, deletionPending: true, deletionTombstoneId: tombstone.tombstoneId,
            updatedAt: tombstone.deletedAt
          }));
          return cloneValue(tombstone);
        });
    }

    async function finalizeWorkspaceDeletion(value, tombstoneIdValue) {
      const id = workspaceId(value);
      const deletionId = boundedId(tombstoneIdValue, 'INVALID_TOMBSTONE_ID');
      return run([
        WORKSPACE_STORE_NAME, WORKSPACE_ASSET_STORE_NAME,
        WORKSPACE_TURN_STORE_NAME, WORKSPACE_TOMBSTONE_STORE_NAME
      ], 'readwrite', async transaction => {
        const workspaces = transaction.objectStore(WORKSPACE_STORE_NAME);
        const current = await request(workspaces.get(id));
        if (!current) return false;
        if (!current.deletionPending || current.deletionTombstoneId !== deletionId) {
          fail('WORKSPACE_DELETION_CONFLICT');
        }
        const assetsStore = transaction.objectStore(WORKSPACE_ASSET_STORE_NAME);
        const turnsStore = transaction.objectStore(WORKSPACE_TURN_STORE_NAME);
        const [assets, turns] = await Promise.all([
          request(assetsStore.getAll()), request(turnsStore.getAll())
        ]);
        await Promise.all(assets.filter(item => item.workspaceId === id)
          .map(item => request(assetsStore.delete(item.assetKey))));
        await Promise.all(turns.filter(item => item.workspaceId === id)
          .map(item => request(turnsStore.delete(item.turnKey))));
        await request(workspaces.delete(id));
        return true;
      });
    }

    async function getStorageStatistics() {
      return run([
        WORKSPACE_STORE_NAME, WORKSPACE_TOMBSTONE_STORE_NAME
      ], 'readonly', async transaction => {
        const [workspaces, tombstones] = await Promise.all([
          request(transaction.objectStore(WORKSPACE_STORE_NAME).getAll()),
          request(transaction.objectStore(WORKSPACE_TOMBSTONE_STORE_NAME).getAll())
        ]);
        const summaries = workspaces.map(workspace => normalizeWorkspaceSummary(workspace.summary));
        return {
          workspaceCount: workspaces.length,
          assetCount: summaries.reduce((sum, item) => sum + item.assetCount, 0),
          turnCount: summaries.reduce((sum, item) => sum + item.turnCount, 0),
          tombstoneCount: tombstones.length,
          estimatedBytes: summaries.reduce((sum, item) =>
            sum + item.assetBytes + item.turnBytes, 0)
        };
      });
    }

    async function getWorkspaceGenerationState(value) {
      const id = workspaceId(value);
      return run([WORKSPACE_STORE_NAME, WORKSPACE_TOMBSTONE_STORE_NAME], 'readonly',
        async transaction => {
          const [current, tombstones] = await Promise.all([
            request(transaction.objectStore(WORKSPACE_STORE_NAME).get(id)),
            request(transaction.objectStore(WORKSPACE_TOMBSTONE_STORE_NAME).getAll())
          ]);
          const deletionGeneration = tombstones
            .filter(item => item.workspaceId === id && item.entityType === 'workspace')
            .reduce((maximum, item) =>
              Math.max(maximum, Number(item.workspaceGeneration || 0)), 0);
          return {
            workspaceId: id,
            activeGeneration: Number(current?.workspaceGeneration || 0),
            deletionGeneration,
            deletionPending: Boolean(current?.deletionPending)
          };
        });
    }

    return {
      ensureWorkspace,
      getWorkspace,
      listWorkspaces,
      putAsset,
      getAsset,
      listAssets,
      appendTurn,
      updateTurn,
      pageTurns,
      deleteTurn,
      markMemoryRebuild,
      beginWorkspaceDeletion,
      finalizeWorkspaceDeletion,
      getStorageStatistics,
      getWorkspaceGenerationState
    };
  }

  return {
    WORKSPACE_STORE_NAME,
    WORKSPACE_ASSET_STORE_NAME,
    WORKSPACE_TURN_STORE_NAME,
    WORKSPACE_TOMBSTONE_STORE_NAME,
    createIndexedDbArticleWorkspaceStore
  };
});
