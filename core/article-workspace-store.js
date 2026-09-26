(function attach(root, factory) {
  const api = factory(root.SciLLM || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory(shared) {
  const WORKSPACE_STORE_NAME = 'workspaces';
  const WORKSPACE_ASSET_STORE_NAME = 'workspaceAssets';
  const WORKSPACE_TURN_STORE_NAME = 'workspaceTurns';
  const WORKSPACE_TOMBSTONE_STORE_NAME = 'workspaceTombstones';
  const DOCUMENT_STORE_NAME = 'documents';
  const MAX_PAGE_SIZE = 10_000;
  const INTERNAL_FIGURE_RETRY_STAGING_PREFIX = 'internal/figure-retry-staging/';

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

  function contentEqual(left, right) {
    try { return JSON.stringify(stableValue(left)) === JSON.stringify(stableValue(right)); }
    catch (_) { return false; }
  }

  function documentRestoreHelpers() {
    // document-store may load after this module in the shared browser namespace.
    if (typeof shared.normalizeDocumentRecord !== 'function' ||
        typeof shared.finalizeDocumentRecordForWrite !== 'function') {
      fail('DOCUMENT_SCHEMA_UNAVAILABLE');
    }
    return shared;
  }

  function restoreDocumentId(value) {
    if (typeof value !== 'string') fail('INVALID_DOCUMENT_ID');
    return documentRestoreHelpers().normalizeDocumentRecord({ documentId: value }).documentId;
  }

  function cloneRestoreDocument(value) {
    if (value !== null && !isPlainObject(value)) fail('INVALID_DOCUMENT_RESTORE_RECORD');
    let visited = 0;
    let characters = 0;
    const seen = new Set();
    function visit(item, depth = 0) {
      if (++visited > 100000 || depth > 40) fail('WORKSPACE_RESTORE_TOO_LARGE');
      if (typeof item === 'string') characters += item.length;
      if (characters > 64 * 1024 * 1024) fail('WORKSPACE_RESTORE_TOO_LARGE');
      if (item === null || item === undefined || ['string', 'number', 'boolean'].includes(typeof item)) return;
      if ((!Array.isArray(item) && !isPlainObject(item)) || seen.has(item)) {
        fail('INVALID_DOCUMENT_RESTORE_RECORD');
      }
      if (Array.isArray(item) && item.length > 100000) fail('WORKSPACE_RESTORE_TOO_LARGE');
      seen.add(item);
      for (const key of Object.keys(item)) {
        characters += key.length;
        const descriptor = Object.getOwnPropertyDescriptor(item, key);
        if (!Object.hasOwn(descriptor, 'value')) fail('INVALID_DOCUMENT_RESTORE_RECORD');
        visit(descriptor.value, depth + 1);
      }
      seen.delete(item);
    }
    visit(value);
    return cloneValue(value);
  }

  function sameRestoreDocument(left, right) {
    if (Object.is(left, right)) return true;
    if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object' ||
        Array.isArray(left) !== Array.isArray(right) ||
        (Array.isArray(left) && left.length !== right.length)) return false;
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    return leftKeys.length === rightKeys.length && leftKeys.every((key, index) =>
      key === rightKeys[index] && sameRestoreDocument(left[key], right[key]));
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

    const restoreStoreNames = [
      WORKSPACE_STORE_NAME, WORKSPACE_ASSET_STORE_NAME,
      WORKSPACE_TURN_STORE_NAME, WORKSPACE_TOMBSTONE_STORE_NAME
    ];

    async function readRestoreRows(transaction, name, id, maximum) {
      const store = transaction.objectStore(name);
      // The existing v4 workspaceId index bounds native reads to this workspace.
      // The fallback supports the project's small in-memory IndexedDB fixture.
      const records = typeof store.index === 'function'
        ? await request(store.index('workspaceId').getAll(id, maximum + 1))
        : await request(store.getAll());
      const matching = records.filter(record => record.workspaceId === id);
      if (matching.length > maximum) fail('WORKSPACE_RESTORE_TOO_LARGE');
      return matching;
    }

    async function readRestoreState(transaction, id, documentId) {
      const [workspace, assets, turns, tombstones, document] = await Promise.all([
        request(transaction.objectStore(WORKSPACE_STORE_NAME).get(id)),
        readRestoreRows(transaction, WORKSPACE_ASSET_STORE_NAME, id, 1000),
        readRestoreRows(transaction, WORKSPACE_TURN_STORE_NAME, id, MAX_PAGE_SIZE),
        readRestoreRows(transaction, WORKSPACE_TOMBSTONE_STORE_NAME, id, MAX_PAGE_SIZE),
        documentId === undefined ? undefined
          : request(transaction.objectStore(DOCUMENT_STORE_NAME).get(documentId))
      ]);
      return { workspaceId: id, workspace: workspace || null, assets, turns, tombstones,
        ...(documentId === undefined ? {} : { documentId,
          document: cloneRestoreDocument(document === undefined ? null : document) }) };
    }

    function restoreBaseline(state) {
      return {
        workspaceId: state.workspaceId,
        workspace: cloneValue(state.workspace),
        assets: state.assets.map(({ content, ...metadata }) => cloneValue(metadata))
          .sort((left, right) => String(left.assetKey).localeCompare(String(right.assetKey))),
        turns: state.turns.map(turn => ({
          turnKey: turn.turnKey, workspaceId: turn.workspaceId,
          workspaceGeneration: turn.workspaceGeneration, turnId: turn.turnId,
          revision: turn.revision, sequence: turn.sequence,
          createdAt: turn.createdAt, updatedAt: turn.updatedAt
        })).sort((left, right) => String(left.turnKey).localeCompare(String(right.turnKey))),
        tombstones: state.tombstones.map(cloneValue)
          .sort((left, right) => String(left.tombstoneKey).localeCompare(String(right.tombstoneKey))),
        ...(state.documentId === undefined ? {} : {
          documentId: state.documentId, document: cloneRestoreDocument(state.document)
        })
      };
    }

    function comparableRestoreBaseline(baseline) {
      const { lastAccessedAt, ...workspace } = baseline.workspace || {};
      const { document, ...workspaceBaseline } = baseline;
      return { ...workspaceBaseline, workspace: baseline.workspace ? workspace : null };
    }

    async function captureRestoreBaseline(value, options = {}) {
      const id = workspaceId(value);
      if (!isPlainObject(options)) fail('INVALID_DOCUMENT_RESTORE_BASELINE');
      const documentId = Object.hasOwn(options, 'documentId')
        ? restoreDocumentId(options.documentId) : undefined;
      const stores = documentId === undefined ? restoreStoreNames : [...restoreStoreNames, DOCUMENT_STORE_NAME];
      return run(stores, 'readonly', async transaction =>
        restoreBaseline(await readRestoreState(transaction, id, documentId)));
    }

    function nextRestoreCounter(value) {
      const current = value === undefined || value === null ? 0 : Number(value);
      if (!Number.isSafeInteger(current) || current < 0 || current >= Number.MAX_SAFE_INTEGER) {
        fail('INVALID_WORKSPACE_RESTORE_STATE');
      }
      return current + 1;
    }

    async function commitRestoreIfUnchanged(input = {}) {
      if (!isPlainObject(input)) fail('INVALID_WORKSPACE_RESTORE_BASELINE');
      const normalized = normalizeWorkspace(input.identity);
      const id = normalized.workspaceId;
      if (!Number.isSafeInteger(normalized.workspaceGeneration) || normalized.workspaceGeneration < 1) {
        fail('INVALID_WORKSPACE_GENERATION');
      }
      const baseline = input.expectedLocal;
      if (!isPlainObject(baseline) || !Object.hasOwn(baseline, 'workspace') ||
          (baseline.workspace !== null && !isPlainObject(baseline.workspace)) ||
          !Array.isArray(baseline.assets) || !Array.isArray(baseline.turns) ||
          !Array.isArray(baseline.tombstones)) fail('INVALID_WORKSPACE_RESTORE_BASELINE');
      if (baseline.workspaceId !== id) fail('WORKSPACE_RESTORE_CONFLICT');
      if (baseline.assets.length > 1000 || baseline.turns.length > MAX_PAGE_SIZE ||
          baseline.tombstones.length > MAX_PAGE_SIZE) fail('WORKSPACE_RESTORE_TOO_LARGE');
      const hasDocumentScope = Object.hasOwn(baseline, 'documentId');
      const hasDocumentCandidate = Object.hasOwn(input, 'document');
      if (hasDocumentScope !== Object.hasOwn(baseline, 'document') ||
          (hasDocumentCandidate && !hasDocumentScope)) fail('INVALID_DOCUMENT_RESTORE_BASELINE');
      const documentId = hasDocumentScope ? restoreDocumentId(baseline.documentId) : undefined;
      const { document: baselineDocument, ...workspaceBaseline } = baseline;
      const expected = safeValue(workspaceBaseline);
      let documentCandidate;
      if (hasDocumentScope) {
        expected.documentId = documentId;
        expected.document = cloneRestoreDocument(baselineDocument);
        if (expected.document !== null && expected.document.documentId !== documentId) {
          fail('WORKSPACE_RESTORE_CONFLICT');
        }
        if (hasDocumentCandidate) {
          documentCandidate = cloneRestoreDocument(documentRestoreHelpers().normalizeDocumentRecord(
            cloneRestoreDocument(input.document)));
          if (documentCandidate.documentId !== documentId) fail('WORKSPACE_RESTORE_CONFLICT');
        }
      }
      const assetInputs = input.assets === undefined ? [] : input.assets;
      const turnInputs = input.turns === undefined ? [] : input.turns;
      if (!Array.isArray(assetInputs)) fail('INVALID_WORKSPACE_RESTORE_ASSET');
      if (!Array.isArray(turnInputs)) fail('INVALID_TURN');
      if (assetInputs.length > 1000 || turnInputs.length > MAX_PAGE_SIZE) {
        fail('WORKSPACE_RESTORE_TOO_LARGE');
      }
      const assetPaths = new Set();
      const assets = Array.from(assetInputs, asset => {
        if (!isPlainObject(asset) || !Object.hasOwn(asset, 'content')) {
          fail('INVALID_WORKSPACE_RESTORE_ASSET');
        }
        const path = shared.normalizeWorkspaceRelativePath(asset.relativePath);
        if (path.startsWith(INTERNAL_FIGURE_RETRY_STAGING_PREFIX)) {
          fail('INVALID_WORKSPACE_RESTORE_ASSET');
        }
        if (assetPaths.has(path)) fail('DUPLICATE_WORKSPACE_ASSET');
        assetPaths.add(path);
        const content = safeValue(asset.content);
        return { relativePath: path, content,
          contentHash: String(asset.contentHash || contentFingerprint(content)) };
      });
      const turnIds = new Set();
      const turns = Array.from(turnInputs, turn => {
        if (!isPlainObject(turn)) fail('INVALID_TURN');
        const value = safeValue(turn);
        const turnId = boundedId(value.turnId, 'INVALID_TURN_ID');
        if (turnIds.has(turnId)) fail('TURN_ALREADY_EXISTS');
        turnIds.add(turnId);
        if ((value.workspaceId !== undefined && value.workspaceId !== id) ||
            (value.workspaceGeneration !== undefined &&
              Number(value.workspaceGeneration) !== normalized.workspaceGeneration) ||
            (value.turnKey !== undefined && value.turnKey !== turnKey(id, turnId))) {
          fail('WORKSPACE_RESTORE_CONFLICT');
        }
        return { ...value, turnId };
      });

      const stores = hasDocumentScope ? [...restoreStoreNames, DOCUMENT_STORE_NAME] : restoreStoreNames;
      const commit = () => run(stores, 'readwrite', async transaction => {
        const state = await readRestoreState(transaction, id, documentId);
        if (!contentEqual(comparableRestoreBaseline(restoreBaseline(state)),
          comparableRestoreBaseline(expected)) || (hasDocumentScope &&
            !sameRestoreDocument(state.document, expected.document))) fail('WORKSPACE_RESTORE_CONFLICT');
        const current = state.workspace;
        if (current?.deletionPending) fail('WORKSPACE_DELETION_PENDING');
        if (current && Number(current.workspaceGeneration || 1) !== normalized.workspaceGeneration) {
          fail('WORKSPACE_GENERATION_CONFLICT');
        }
        if (current && (current.canonicalUrl !== normalized.canonicalUrl ||
            current.contentHash !== normalized.contentHash)) fail('WORKSPACE_RESTORE_CONFLICT');
        if (!current && (state.assets.length || state.turns.length)) {
          fail('INVALID_WORKSPACE_RESTORE_STATE');
        }
        for (const tombstone of state.tombstones) {
          if (Number(tombstone.workspaceGeneration || 1) < normalized.workspaceGeneration) continue;
          if (tombstone.entityType === 'workspace') fail('WORKSPACE_GENERATION_CONFLICT');
          if ((tombstone.entityType === 'turn' && turnIds.has(String(tombstone.entityId))) ||
              (tombstone.entityType === 'asset' && assetPaths.has(String(tombstone.entityId)))) {
            fail('WORKSPACE_RESTORE_TOMBSTONE_CONFLICT');
          }
        }
        let savedDocument;
        if (hasDocumentCandidate) {
          const helpers = documentRestoreHelpers();
          const previousDocument = state.document === null ? null
            : helpers.normalizeDocumentRecord(state.document);
          savedDocument = cloneRestoreDocument(helpers.normalizeDocumentRecord(
            helpers.finalizeDocumentRecordForWrite(documentCandidate, previousDocument)));
        }
        const timestamp = now();
        const owner = current ? cloneValue(current) : {
          ...normalized, createdAt: timestamp, updatedAt: timestamp, lastAccessedAt: timestamp,
          summary: normalizeWorkspaceSummary(), assetSummaryByPath: {},
          nextTurnSequence: 0, storageRevision: 0, memoryNeedsRebuild: false, deletionPending: false
        };
        const existingAssets = new Map(state.assets.map(asset => [asset.relativePath, asset]));
        const existingTurns = new Map(state.turns.map(turn => [turn.turnId, turn]));
        const occupiedSequences = new Set(state.turns.map(turn => Number(turn.sequence)));
        if (existingAssets.size !== state.assets.length || existingTurns.size !== state.turns.length ||
            occupiedSequences.size !== state.turns.length) fail('INVALID_WORKSPACE_RESTORE_STATE');
        if (new Set([...existingAssets.keys(), ...assetPaths]).size > 1000 ||
            new Set([...existingTurns.keys(), ...turnIds]).size > MAX_PAGE_SIZE) {
          fail('WORKSPACE_RESTORE_TOO_LARGE');
        }
        const savedAssets = [];
        const savedTurns = [];
        const contributions = Object.assign(Object.create(null), owner.assetSummaryByPath || {});
        let summary = normalizeWorkspaceSummary(owner.summary);
        for (const asset of assets) {
          const previous = existingAssets.get(asset.relativePath);
          if (previous && Number(previous.workspaceGeneration || 1) !== normalized.workspaceGeneration) {
            fail('WORKSPACE_GENERATION_CONFLICT');
          }
          const saved = {
            assetKey: assetKey(id, asset.relativePath), workspaceId: id,
            workspaceGeneration: normalized.workspaceGeneration,
            relativePath: asset.relativePath, content: asset.content, contentHash: asset.contentHash,
            revision: nextRestoreCounter(previous?.revision),
            byteSize: byteSize(asset.content), createdAt: previous?.createdAt || timestamp,
            updatedAt: timestamp
          };
          contributions[saved.relativePath] = workspaceAssetContribution(
            saved.relativePath, saved.content, saved.byteSize);
          owner.storageRevision = nextRestoreCounter(owner.storageRevision);
          savedAssets.push(saved);
        }
        for (const turn of turns) {
          const previous = existingTurns.get(turn.turnId);
          if (previous && Number(previous.workspaceGeneration || 1) !== normalized.workspaceGeneration) {
            fail('WORKSPACE_GENERATION_CONFLICT');
          }
          const sequence = previous ? Number(previous.sequence) : nextRestoreCounter(owner.nextTurnSequence);
          if (!Number.isSafeInteger(sequence) || sequence < 1 ||
              (!previous && occupiedSequences.has(sequence))) {
            fail('INVALID_WORKSPACE_RESTORE_STATE');
          }
          const saved = {
            ...(previous || {}), ...turn, turnKey: turnKey(id, turn.turnId),
            workspaceId: id, workspaceGeneration: normalized.workspaceGeneration,
            turnId: turn.turnId, sequence, revision: nextRestoreCounter(previous?.revision),
            ...(!previous ? { createdAt: timestamp } : {}), updatedAt: timestamp
          };
          if (!previous) {
            occupiedSequences.add(sequence);
            owner.nextTurnSequence = sequence;
            owner.storageRevision = nextRestoreCounter(owner.storageRevision);
            summary.turnCount += 1;
          }
          summary.turnBytes = Math.max(0, summary.turnBytes - (previous ? byteSize(previous) : 0) + byteSize(saved));
          savedTurns.push(saved);
        }
        if (!current || savedAssets.length || savedTurns.length) {
          owner.assetSummaryByPath = contributions;
          owner.summary = summarizeWorkspaceContributions(contributions, summary);
          owner.updatedAt = timestamp;
          // Everything above is validation and pure construction. All record
          // writes below share this transaction, including owner summary/sequence.
          for (const asset of savedAssets) {
            await request(transaction.objectStore(WORKSPACE_ASSET_STORE_NAME).put(asset));
          }
          for (const turn of savedTurns) {
            await request(transaction.objectStore(WORKSPACE_TURN_STORE_NAME).put(turn));
          }
          await request(transaction.objectStore(WORKSPACE_STORE_NAME).put(owner));
        }
        if (hasDocumentCandidate) {
          await request(transaction.objectStore(DOCUMENT_STORE_NAME).put(savedDocument));
        }
        return { committed: true, workspace: cloneValue(owner),
          assets: savedAssets.map(cloneValue), turns: savedTurns.map(cloneValue),
          ...(hasDocumentCandidate ? { document: cloneRestoreDocument(savedDocument) } : {}) };
      });
      return hasDocumentScope
        ? documentRestoreHelpers().withDocumentArchiveLock(indexedDbRef, documentId, commit)
        : commit();
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
      const expectedWorkspaceGeneration = conflict.expectedWorkspaceGeneration;
      if (expectedWorkspaceGeneration !== undefined &&
          (!Number.isSafeInteger(expectedWorkspaceGeneration) || expectedWorkspaceGeneration < 1)) {
        fail('WORKSPACE_GENERATION_CONFLICT');
      }
      const safeContent = safeValue(content);
      const hasSummaryContent = Object.prototype.hasOwnProperty.call(
        conflict, 'summaryContent'
      );
      const summaryContent = hasSummaryContent
        ? safeValue(conflict.summaryContent) : safeContent;
      const requiredStaging = conflict.requiredStaging === undefined ? null : {
        relativePath: shared.normalizeWorkspaceRelativePath(
          conflict.requiredStaging?.relativePath
        ),
        revision: Number(conflict.requiredStaging?.revision),
        contentHash: String(conflict.requiredStaging?.contentHash || '')
      };
      if (requiredStaging &&
          (!requiredStaging.relativePath.startsWith(INTERNAL_FIGURE_RETRY_STAGING_PREFIX) ||
           !Number.isSafeInteger(requiredStaging.revision) || requiredStaging.revision < 1 ||
           !requiredStaging.contentHash)) {
        fail('STAGING_STALE');
      }
      const key = assetKey(id, path);
      return run([WORKSPACE_STORE_NAME, WORKSPACE_ASSET_STORE_NAME], 'readwrite',
        async transaction => {
          const workspaceStore = transaction.objectStore(WORKSPACE_STORE_NAME);
          const assets = transaction.objectStore(WORKSPACE_ASSET_STORE_NAME);
          const owner = await request(workspaceStore.get(id));
          if (!owner || owner.deletionPending) fail('WORKSPACE_NOT_FOUND');
          if (expectedWorkspaceGeneration !== undefined &&
              Number(owner.workspaceGeneration || 1) !== expectedWorkspaceGeneration) {
            fail('WORKSPACE_GENERATION_CONFLICT');
          }
          const current = await request(assets.get(key));
          let requiredStagingAsset = null;
          if (requiredStaging) {
            const staged = await request(assets.get(assetKey(id, requiredStaging.relativePath)));
            if (!staged || staged.workspaceId !== id ||
                Number(staged.workspaceGeneration || 0) !==
                  Number(owner.workspaceGeneration || 1) ||
                staged.relativePath !== requiredStaging.relativePath ||
                Number(staged.revision || 0) !== requiredStaging.revision ||
                String(staged.contentHash || '') !== requiredStaging.contentHash ||
                staged.content?.kind !== 'figure_retry_candidate' ||
                staged.content?.status !== 'pending_confirmation' ||
                String(staged.content?.target?.relativePath || '') !== path) {
              fail('STAGING_STALE');
            }
            requiredStagingAsset = staged;
          }
          if (conflict.createOnly === true && current) {
            fail('ASSET_REVISION_CONFLICT');
          }
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
          const assetSummaryByPath = { ...(owner.assetSummaryByPath || {}) };
          if (!path.startsWith(INTERNAL_FIGURE_RETRY_STAGING_PREFIX)) {
            assetSummaryByPath[path] = workspaceAssetContribution(
              path, summaryContent,
              hasSummaryContent ? byteSize(summaryContent) : saved.byteSize
            );
          }
          const updatedOwner = {
            ...owner,
            storageRevision: Number(owner.storageRevision || 0) + 1,
            updatedAt: timestamp,
            summary: summarizeWorkspaceContributions(assetSummaryByPath, owner.summary),
            assetSummaryByPath
          };
          await request(assets.put(saved));
          if (requiredStagingAsset) {
            await request(assets.put({
              ...requiredStagingAsset,
              figureRetryPromotion: {
                status: 'promoted_pending_confirmation',
                targetRelativePath: path,
                mainRevision: saved.revision,
                mainContentHash: saved.contentHash
              }
            }));
          }
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

    async function deleteAsset(value, relativePath, conflict = {}) {
      const id = workspaceId(value);
      const path = shared.normalizeWorkspaceRelativePath(relativePath);
      const refreshSummaryPath = conflict.refreshSummaryPath === undefined
        ? '' : shared.normalizeWorkspaceRelativePath(conflict.refreshSummaryPath);
      const deleteRelatedStagingForPath = conflict.deleteRelatedStagingForPath === undefined
        ? '' : shared.normalizeWorkspaceRelativePath(conflict.deleteRelatedStagingForPath);
      const key = assetKey(id, path);
      return run([WORKSPACE_STORE_NAME, WORKSPACE_ASSET_STORE_NAME], 'readwrite',
        async transaction => {
          const workspaceStore = transaction.objectStore(WORKSPACE_STORE_NAME);
          const assets = transaction.objectStore(WORKSPACE_ASSET_STORE_NAME);
          const owner = await request(workspaceStore.get(id));
          if (!owner || owner.deletionPending) fail('WORKSPACE_NOT_FOUND');
          const current = await request(assets.get(key));
          if (!current) {
            // A finalize request couples deletion of the staging record to a CAS
            // check of the promoted main asset.  Treat a missing staging record
            // as a conflict so a raced/obsolete finalize can never confirm or
            // mirror a candidate it no longer owns.
            if (deleteRelatedStagingForPath) fail('ASSET_REVISION_CONFLICT');
            return { deleted: false, alreadyMissing: true };
          }
          if (conflict.expectedRevision !== undefined &&
              Number(current.revision || 0) !== Number(conflict.expectedRevision)) {
            fail('ASSET_REVISION_CONFLICT');
          }
          if (conflict.expectedContentHash !== undefined &&
              String(current.contentHash || '') !== String(conflict.expectedContentHash)) {
            fail('ASSET_HASH_CONFLICT');
          }
          let relatedStaging = [];
          if (deleteRelatedStagingForPath) {
            const records = await request(assets.getAll());
            const relatedMain = records.find(record =>
              record.workspaceId === id &&
              record.relativePath === deleteRelatedStagingForPath);
            if (!relatedMain ||
                Number(relatedMain.revision || 0) !==
                  Number(conflict.relatedAssetExpectedRevision || 0)) {
              fail('ASSET_REVISION_CONFLICT');
            }
            if (String(relatedMain.contentHash || '') !==
                String(conflict.relatedAssetExpectedContentHash || '')) {
              fail('ASSET_HASH_CONFLICT');
            }
            relatedStaging = records.filter(record =>
              record.workspaceId === id &&
              String(record.relativePath || '')
                .startsWith(INTERNAL_FIGURE_RETRY_STAGING_PREFIX) &&
              record.content?.kind === 'figure_retry_candidate' &&
              record.content?.status === 'pending_confirmation' &&
              String(record.content?.target?.relativePath || '') ===
                deleteRelatedStagingForPath
            );
          }
          const timestamp = now();
          const assetSummaryByPath = { ...(owner.assetSummaryByPath || {}) };
          delete assetSummaryByPath[path];
          if (refreshSummaryPath) {
            const refreshAsset = await request(assets.get(assetKey(id, refreshSummaryPath)));
            if (!refreshAsset) fail('ASSET_REVISION_CONFLICT');
            assetSummaryByPath[refreshSummaryPath] = workspaceAssetContribution(
              refreshSummaryPath, refreshAsset.content, refreshAsset.byteSize
            );
          }
          await request(assets.delete(key));
          for (const related of relatedStaging) {
            if (related.assetKey !== key) await request(assets.delete(related.assetKey));
          }
          await request(workspaceStore.put({
            ...owner,
            storageRevision: Number(owner.storageRevision || 0) + 1,
            updatedAt: timestamp,
            summary: summarizeWorkspaceContributions(assetSummaryByPath, owner.summary),
            assetSummaryByPath
          }));
          return {
            deleted: true,
            relativePath: path,
            revision: Number(current.revision || 0),
            contentHash: String(current.contentHash || '')
          };
        });
    }

    async function reconcileFigureRetryWrite(value, relativePath, content, conflict = {}) {
      const id = workspaceId(value);
      const path = shared.normalizeWorkspaceRelativePath(relativePath);
      if (path.startsWith(INTERNAL_FIGURE_RETRY_STAGING_PREFIX)) {
        fail('ASSET_REVISION_CONFLICT');
      }
      const safeContent = safeValue(content);
      const expectedStages = Array.isArray(conflict.pendingStages)
        ? conflict.pendingStages.map(receipt => ({
          relativePath: shared.normalizeWorkspaceRelativePath(receipt?.relativePath),
          revision: Number(receipt?.revision || 0),
          contentHash: String(receipt?.contentHash || '')
        })) : [];
      if (expectedStages.length > 100 || expectedStages.some(receipt =>
        !receipt.relativePath.startsWith(INTERNAL_FIGURE_RETRY_STAGING_PREFIX) ||
        !Number.isSafeInteger(receipt.revision) || receipt.revision < 1 ||
        !receipt.contentHash)) {
        fail('ASSET_REVISION_CONFLICT');
      }
      const stage = conflict.stage === undefined ? null : {
        relativePath: shared.normalizeWorkspaceRelativePath(conflict.stage?.relativePath),
        candidateContent: safeValue(conflict.stage?.candidateContent),
        candidateContentHash: String(conflict.stage?.candidateContentHash || '')
      };
      if (stage && !stage.relativePath.startsWith(INTERNAL_FIGURE_RETRY_STAGING_PREFIX)) {
        fail('ASSET_REVISION_CONFLICT');
      }
      const key = assetKey(id, path);
      return run([WORKSPACE_STORE_NAME, WORKSPACE_ASSET_STORE_NAME], 'readwrite',
        async transaction => {
          const workspaceStore = transaction.objectStore(WORKSPACE_STORE_NAME);
          const assets = transaction.objectStore(WORKSPACE_ASSET_STORE_NAME);
          const [owner, current, allAssets] = await Promise.all([
            request(workspaceStore.get(id)),
            request(assets.get(key)),
            request(assets.getAll())
          ]);
          if (!owner || owner.deletionPending) fail('WORKSPACE_NOT_FOUND');
          if (Number(current?.revision || 0) !== Number(conflict.expectedRawRevision || 0)) {
            fail('ASSET_REVISION_CONFLICT');
          }
          if (String(current?.contentHash || '') !==
              String(conflict.expectedRawContentHash || '')) {
            fail('ASSET_HASH_CONFLICT');
          }
          const actualStages = allAssets.filter(asset =>
            asset?.workspaceId === id &&
            String(asset?.relativePath || '').startsWith(INTERNAL_FIGURE_RETRY_STAGING_PREFIX) &&
            asset?.content?.kind === 'figure_retry_candidate' &&
            asset?.content?.status === 'pending_confirmation' &&
            String(asset?.content?.target?.relativePath || '') === path
          ).map(asset => ({
            relativePath: String(asset.relativePath || ''),
            revision: Number(asset.revision || 0),
            contentHash: String(asset.contentHash || '')
          }));
          const receiptKey = receipt =>
            `${receipt.relativePath}\u0000${receipt.revision}\u0000${receipt.contentHash}`;
          const expectedKeys = expectedStages.map(receiptKey).sort();
          const actualKeys = actualStages.map(receiptKey).sort();
          if (expectedKeys.length !== actualKeys.length ||
              expectedKeys.some((receipt, index) => receipt !== actualKeys[index])) {
            fail('ASSET_REVISION_CONFLICT');
          }
          if (stage && allAssets.some(asset =>
            asset?.workspaceId === id && asset?.relativePath === stage.relativePath &&
            !actualStages.some(receipt => receipt.relativePath === stage.relativePath))) {
            fail('ASSET_REVISION_CONFLICT');
          }
          const timestamp = now();
          const shouldWriteMain = !stage || !current ||
            !contentEqual(current.content, safeContent);
          const saved = shouldWriteMain ? {
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
          } : current;
          const stagedContent = stage ? {
            schemaVersion: 1,
            kind: 'figure_retry_candidate',
            status: 'pending_confirmation',
            target: { relativePath: path },
            base: {
              revision: Number(saved.revision || 0),
              contentHash: String(saved.contentHash || ''),
              byteSize: Number(saved.byteSize || byteSize(saved.content)),
              updatedAt: String(saved.updatedAt || ''),
              content: cloneValue(saved.content)
            },
            candidate: {
              content: cloneValue(stage.candidateContent),
              contentHash: stage.candidateContentHash
            }
          } : null;
          const staged = stage ? {
            assetKey: assetKey(id, stage.relativePath),
            workspaceId: id,
            workspaceGeneration: Number(owner.workspaceGeneration || 1),
            relativePath: stage.relativePath,
            content: stagedContent,
            contentHash: contentFingerprint(stagedContent),
            revision: 1,
            byteSize: byteSize(stagedContent),
            createdAt: timestamp,
            updatedAt: timestamp
          } : null;
          for (const receipt of actualStages) {
            await request(assets.delete(assetKey(id, receipt.relativePath)));
          }
          if (shouldWriteMain) await request(assets.put(saved));
          if (staged) await request(assets.put(staged));
          const assetSummaryByPath = { ...(owner.assetSummaryByPath || {}) };
          assetSummaryByPath[path] = workspaceAssetContribution(
            path, saved.content, saved.byteSize
          );
          await request(workspaceStore.put({
            ...owner,
            storageRevision: Number(owner.storageRevision || 0) + 1,
            updatedAt: timestamp,
            summary: summarizeWorkspaceContributions(assetSummaryByPath, owner.summary),
            assetSummaryByPath
          }));
          return {
            asset: cloneValue(saved),
            ...(staged ? { staged: cloneValue(staged) } : {})
          };
        });
    }

    async function sweepExpiredFigureRetryStaging(options = {}) {
      const requestedTtl = Number(options.ttlMs);
      const ttlMs = Number.isFinite(requestedTtl)
        ? Math.max(60 * 60 * 1000, Math.min(requestedTtl, 30 * 24 * 60 * 60 * 1000))
        : 7 * 24 * 60 * 60 * 1000;
      const requestedBatch = Number(options.maxBatch);
      const maxBatch = Number.isSafeInteger(requestedBatch)
        ? Math.max(1, Math.min(requestedBatch, 100)) : 50;
      const nowMs = Date.parse(now());
      const cutoff = (Number.isFinite(nowMs) ? nowMs : Date.now()) - ttlMs;
      return run([WORKSPACE_STORE_NAME, WORKSPACE_ASSET_STORE_NAME], 'readwrite',
        async transaction => {
          const assets = transaction.objectStore(WORKSPACE_ASSET_STORE_NAME);
          const [workspaces, records] = await Promise.all([
            request(transaction.objectStore(WORKSPACE_STORE_NAME).getAll()),
            request(assets.getAll())
          ]);
          const workspaceById = new Map(workspaces.map(item => [item.workspaceId, item]));
          const assetByKey = new Map(records.map(item => [item.assetKey, item]));
          const candidates = records.filter(record => {
            if (!String(record?.relativePath || '')
              .startsWith(INTERNAL_FIGURE_RETRY_STAGING_PREFIX) ||
                record?.content?.kind !== 'figure_retry_candidate' ||
                record?.content?.status !== 'pending_confirmation') return false;
            // Promotion writes this receipt in the same transaction as the main
            // candidate. Its presence means deletion would expose unconfirmed
            // science, so bounded maintenance must leave it quarantined. Treat
            // malformed receipt metadata as promoted too and fail closed.
            if (Object.prototype.hasOwnProperty.call(record, 'figureRetryPromotion')) {
              return false;
            }
            // Receipt-less records may come from an older extension version.
            // Absence of a receipt is not proof that promotion never happened:
            // delete only when the target still has the exact recorded base CAS
            // inside this same transaction. Any missing/malformed/rebased state
            // remains quarantined.
            const owner = workspaceById.get(record.workspaceId);
            const targetPath = String(record.content?.target?.relativePath || '');
            const base = record.content?.base;
            const baseRevision = Number(base?.revision);
            const baseContentHash = String(base?.contentHash || '');
            let expectedStageKey = '';
            let targetAssetKey = '';
            try {
              expectedStageKey = assetKey(record.workspaceId, record.relativePath);
              targetAssetKey = targetPath && !targetPath.startsWith(
                INTERNAL_FIGURE_RETRY_STAGING_PREFIX
              ) ? assetKey(record.workspaceId, targetPath) : '';
            } catch (_) {
              return false;
            }
            const main = targetAssetKey ? assetByKey.get(targetAssetKey) : null;
            const exactUnpromotedBase = Boolean(
              owner && !owner.deletionPending && main &&
              record.assetKey === expectedStageKey &&
              main.workspaceId === record.workspaceId &&
              main.relativePath === targetPath &&
              Number(record.workspaceGeneration || 0) ===
                Number(owner.workspaceGeneration || 1) &&
              Number(main.workspaceGeneration || 0) ===
                Number(owner.workspaceGeneration || 1) &&
              Number.isSafeInteger(baseRevision) && baseRevision >= 1 &&
              baseContentHash && Number(main.revision || 0) === baseRevision &&
              String(main.contentHash || '') === baseContentHash
            );
            if (!exactUnpromotedBase) return false;
            const updatedAt = Date.parse(String(record.updatedAt || record.createdAt || ''));
            return !Number.isFinite(updatedAt) || updatedAt <= cutoff;
          }).sort((left, right) =>
            String(left.updatedAt || left.createdAt || '')
              .localeCompare(String(right.updatedAt || right.createdAt || '')));
          const expired = candidates.slice(0, maxBatch);
          for (const record of expired) {
            await request(assets.delete(record.assetKey));
          }
          return {
            deleted: expired.length,
            remainingExpired: candidates.length > expired.length,
            maxBatch,
            ttlMs
          };
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
      captureRestoreBaseline,
      commitRestoreIfUnchanged,
      getWorkspace,
      listWorkspaces,
      putAsset,
      reconcileFigureRetryWrite,
      sweepExpiredFigureRetryStaging,
      getAsset,
      listAssets,
      deleteAsset,
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
    workspaceContentFingerprint: contentFingerprint,
    createIndexedDbArticleWorkspaceStore
  };
});
