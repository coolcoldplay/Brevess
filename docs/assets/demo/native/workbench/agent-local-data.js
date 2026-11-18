(function(root, factory) {
  const common = typeof module === 'object' && module.exports;
  const api = factory(common ? require('../core/local-library-tags.js') : root.SciLLM,
    common ? require('node:crypto') : root.crypto);
  if (common) module.exports = api;
  Object.assign(root.Workbench ||= {}, api);
})(globalThis, function(tags, crypto) {
  'use strict';

  const SCOPES = new Set(['all', 'title', 'notes', 'fulltext', 'abstract', 'method', 'caption']);
  const OPERATIONS = Object.freeze([
    { operation: 'query_library', requiresApproval: false },
    { operation: 'read_workspace', requiresApproval: false },
    { operation: 'read_asset', requiresApproval: false },
    { operation: 'read_export', requiresApproval: false },
    { operation: 'patch_asset', requiresApproval: true, atomicAssetCas: true },
    { operation: 'set_tags', requiresApproval: true, atomicAssetCas: true },
    { operation: 'delete_workspace', requiresApproval: true, requiresDeletionApprovalCas: true, requiresDeletionApprovalSnapshotCas: true }
  ]);
  // These routes need additional server owner bindings or atomic conflict guards.
  // Advertising a raw message sender here would bypass both review and those guards.
  const UNAVAILABLE = Object.freeze([
    { operation: 'update_turn', reason: 'SERVER_TURN_CAS_UNAVAILABLE' },
    { operation: 'delete_turn', reason: 'SERVER_TURN_CAS_UNAVAILABLE' },
    { operation: 'delete_asset', reason: 'SERVER_DELETE_ASSET_ROUTE_UNAVAILABLE' },
    { operation: 'write_pdf_bibliography', reason: 'PDF_DOCUMENT_OWNER_BINDING_REQUIRED' },
    { operation: 'write_binary_asset', reason: 'BINARY_OWNER_BINDING_REQUIRED' }
  ]);
  const IMMUTABLE = new Set(['schemaVersion', 'workspaceId', 'workspaceGeneration', 'id',
    'figureId', 'panelId', 'paragraphId', 'blockId', 'resourceId', 'turnId', 'documentId',
    'relativePath', 'revision', 'contentHash', 'writeToken', 'source', 'sources',
    'provenance', 'bindings', 'sourceDocuments', 'sourceSnapshot', 'canonicalUrl',
    'documentHash', 'origin', 'createdAt']);
  const BAD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
  const COMMON_KEYS = ['operation', 'expectedProjectId', 'expectedRevision'];
  const OWNER_KEYS = ['workspaceId', 'workspaceGeneration'];
  const ASSET_BASE_KEYS = ['expectedAssetRevision', 'expectedAssetContentHash'];
  const ARGS = {
    query_library: ['query', 'scope', 'page', 'pageSize', 'tags', 'tagMode'],
    read_workspace: OWNER_KEYS, read_export: OWNER_KEYS, delete_workspace: OWNER_KEYS,
    read_asset: [...OWNER_KEYS, 'relativePath'],
    patch_asset: [...OWNER_KEYS, ...ASSET_BASE_KEYS, 'relativePath', 'changes'],
    set_tags: [...OWNER_KEYS, ...ASSET_BASE_KEYS, 'tags']
  };
  const MUTATIONS = new Set(['patch_asset', 'set_tags', 'delete_workspace']);
  const fail = code => { throw Object.assign(new Error(code), { code }); };
  const plain = value => value && typeof value === 'object' && !Array.isArray(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value));
  const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function freeze(value) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
      for (const child of Object.values(value)) freeze(child);
      Object.freeze(value);
    }
    return value;
  }
  function json(value, depth = 0, seen = new Set()) {
    if (depth > 40) fail('AGENT_LOCAL_DATA_ARGUMENT_INVALID');
    if (value === null || ['string', 'boolean'].includes(typeof value)) return;
    if (typeof value === 'number' && Number.isFinite(value)) return;
    if (!Array.isArray(value) && !plain(value) || seen.has(value)) fail('AGENT_LOCAL_DATA_ARGUMENT_INVALID');
    seen.add(value);
    for (const [key, child] of Object.entries(value)) {
      if (BAD_KEYS.has(key)) fail('AGENT_LOCAL_DATA_ARGUMENT_INVALID');
      json(child, depth + 1, seen);
    }
    seen.delete(value);
  }
  function relativePath(value) {
    if (typeof value !== 'string' || !value || value.length > 240 ||
        value.startsWith('/') || /[\\\u0000-\u001f]/u.test(value) ||
        value.split('/').some(part => !part || part === '.' || part === '..') ||
        /[:]/u.test(value)) fail('AGENT_LOCAL_DATA_ARGUMENT_INVALID');
    return value;
  }
  function identity(args) {
    if (!/^workspace:[a-f0-9]{64}$/u.test(args.workspaceId || '') ||
        !Number.isSafeInteger(args.workspaceGeneration) || args.workspaceGeneration < 1) {
      fail('AGENT_LOCAL_DATA_ARGUMENT_INVALID');
    }
    return { workspaceId: args.workspaceId, workspaceGeneration: args.workspaceGeneration };
  }
  function normalizeArgs(input) {
    if (!plain(input) || typeof input.operation !== 'string' || !Object.hasOwn(ARGS, input.operation)) {
      fail('AGENT_LOCAL_DATA_OPERATION_UNSUPPORTED');
    }
    const allowed = new Set([...COMMON_KEYS, ...ARGS[input.operation]]);
    if (Object.keys(input).some(key => !allowed.has(key))) fail('AGENT_LOCAL_DATA_ARGUMENT_INVALID');
    json(input);
    if (JSON.stringify(input).length > 2_000_000) fail('AGENT_LOCAL_DATA_ARGUMENT_INVALID');
    const args = clone(input);
    if (args.operation !== 'query_library') identity(args);
    if (args.operation === 'read_asset' || args.operation === 'patch_asset') relativePath(args.relativePath);
    if (args.operation === 'patch_asset' || args.operation === 'set_tags') {
      if (!Number.isSafeInteger(args.expectedAssetRevision) || args.expectedAssetRevision < 0 ||
          typeof args.expectedAssetContentHash !== 'string' || args.expectedAssetContentHash.length > 200 ||
          (args.expectedAssetRevision > 0 && !args.expectedAssetContentHash) ||
          (args.expectedAssetRevision === 0 && args.expectedAssetContentHash !== '')) {
        fail('AGENT_LOCAL_DATA_ARGUMENT_INVALID');
      }
    }
    return args;
  }
  function token(asset) {
    if (!asset) return null;
    return { relativePath: asset.relativePath, revision: asset.revision, contentHash: asset.contentHash,
      ...(asset.writeToken ? { writeToken: asset.writeToken } : {}), content: asset.content };
  }
  function checkAssetEnvelope(value, owner, path) {
    if (!plain(value) || value.workspaceGeneration !== owner.workspaceGeneration) fail('AGENT_LOCAL_DATA_VERSION_CHANGED');
    if (value.found !== true) return null;
    const asset = value.asset;
    if (!plain(asset) || asset.relativePath !== path || !Number.isSafeInteger(asset.revision) ||
        asset.revision < 1 || typeof asset.contentHash !== 'string' || !asset.contentHash ||
        (asset.workspaceId !== undefined && asset.workspaceId !== owner.workspaceId)) {
      fail('AGENT_LOCAL_DATA_IDENTITY_MISMATCH');
    }
    return clone(asset);
  }
  function checkExport(value, owner) {
    if (!plain(value) || value.workspace?.workspaceId !== owner.workspaceId) fail('AGENT_LOCAL_DATA_IDENTITY_MISMATCH');
    const workspace = value.workspace;
    if (workspace.workspaceGeneration !== owner.workspaceGeneration || workspace.deletionPending) fail('AGENT_LOCAL_DATA_VERSION_CHANGED');
    if (!Number.isSafeInteger(workspace.storageRevision) || workspace.storageRevision < 0 ||
        typeof workspace.contentHash !== 'string' || !workspace.contentHash ||
        typeof workspace.title !== 'string' || typeof workspace.canonicalUrl !== 'string' ||
        !Array.isArray(value.assets) || !Array.isArray(value.turns)) fail('AGENT_LOCAL_DATA_IDENTITY_MISMATCH');
    const paths = new Set(), turns = new Set();
    for (const asset of value.assets) {
      relativePath(asset.relativePath);
      if (paths.has(asset.relativePath) || !Number.isSafeInteger(asset.revision) || asset.revision < 1 ||
          typeof asset.contentHash !== 'string' || !asset.contentHash ||
          (asset.workspaceId !== undefined && asset.workspaceId !== owner.workspaceId)) fail('AGENT_LOCAL_DATA_IDENTITY_MISMATCH');
      paths.add(asset.relativePath);
    }
    for (const turn of value.turns) {
      if (!plain(turn) || typeof turn.turnId !== 'string' || !turn.turnId || turns.has(turn.turnId) ||
          (turn.workspaceId !== undefined && turn.workspaceId !== owner.workspaceId)) fail('AGENT_LOCAL_DATA_IDENTITY_MISMATCH');
      turns.add(turn.turnId);
    }
    if (value.deletionApprovalSnapshot !== undefined || value.deletionApprovalSnapshotCas === true) {
      const snapshot = value.deletionApprovalSnapshot;
      if (!plain(snapshot) || !plain(snapshot.workspaceMetadata) || !Array.isArray(snapshot.turnRevisions)) fail('AGENT_LOCAL_DATA_IDENTITY_MISMATCH');
      const metadata = snapshot.workspaceMetadata;
      const expected = { title: workspace.title, canonicalUrl: workspace.canonicalUrl,
        directoryName: workspace.directoryName, aliases: workspace.aliases,
        revision: workspace.revision, memoryNeedsRebuild: workspace.memoryNeedsRebuild };
      if (Object.keys(metadata).length !== Object.keys(expected).length ||
          Object.entries(expected).some(([key, value]) => !Object.hasOwn(metadata, key) || !same(metadata[key], value))) fail('AGENT_LOCAL_DATA_IDENTITY_MISMATCH');
      const revisions = new Set();
      for (const entry of snapshot.turnRevisions) {
        if (!plain(entry) || Object.keys(entry).length !== 2 || !turns.has(entry.turnId) ||
            revisions.has(entry.turnId) || !Number.isSafeInteger(entry.revision) || entry.revision < 1) fail('AGENT_LOCAL_DATA_IDENTITY_MISMATCH');
        revisions.add(entry.turnId);
      }
      if (revisions.size !== turns.size) fail('AGENT_LOCAL_DATA_IDENTITY_MISMATCH');
    }
    return clone(value);
  }
  function workspaceToken(snapshot) {
    const w = snapshot.workspace;
    return { workspaceId: w.workspaceId, workspaceGeneration: w.workspaceGeneration,
      storageRevision: w.storageRevision, contentHash: w.contentHash, title: w.title,
      canonicalUrl: w.canonicalUrl, directoryName: w.directoryName,
      assets: snapshot.assets.map(token).sort((a, b) => a.relativePath.localeCompare(b.relativePath)),
      turns: snapshot.turns.slice().sort((a, b) => a.turnId.localeCompare(b.turnId)),
      ...(snapshot.deletionApprovalSnapshot ? { deletionApprovalSnapshot: snapshot.deletionApprovalSnapshot } : {}) };
  }
  function writable(path) {
    return path.endsWith('.json') && !path.startsWith('chat/') &&
      !path.startsWith('internal/') && !path.includes('staging') &&
      !['pdf/bibliography.json', 'pdf/document.json', 'article/structure.json',
        'figures/inventory.json', 'pdf/figures/manifest.json'].includes(path);
  }
  function pointer(path) {
    if (typeof path !== 'string' || !path.startsWith('/') || path.length > 1000 || /~(?![01])/u.test(path)) fail('AGENT_LOCAL_DATA_PATCH_FORBIDDEN');
    const keys = path.slice(1).split('/').map(key => key.replace(/~1/gu, '/').replace(/~0/gu, '~'));
    if (keys.some(key => !key || BAD_KEYS.has(key) || IMMUTABLE.has(key))) fail('AGENT_LOCAL_DATA_PATCH_FORBIDDEN');
    return keys;
  }
  function preserveIdentity(before, after) {
    if (!before || typeof before !== 'object') return;
    for (const [key, value] of Object.entries(before)) {
      if (IMMUTABLE.has(key) && !same(value, after?.[key])) fail('AGENT_LOCAL_DATA_PATCH_FORBIDDEN');
      if (value && typeof value === 'object') preserveIdentity(value, after?.[key]);
    }
    if (after && typeof after === 'object') {
      for (const [key, value] of Object.entries(after)) {
        if (IMMUTABLE.has(key) && !same(value, before?.[key])) fail('AGENT_LOCAL_DATA_PATCH_FORBIDDEN');
        if (value && typeof value === 'object' && (!before?.[key] || typeof before[key] !== 'object')) {
          preserveIdentity({}, value);
        }
      }
    }
  }
  function patchContent(before, changes) {
    if (!plain(before) && !Array.isArray(before) || !Array.isArray(changes) || !changes.length || changes.length > 64) fail('AGENT_LOCAL_DATA_PATCH_FORBIDDEN');
    const after = clone(before), preview = [];
    for (const change of changes) {
      if (!plain(change) || !['set', 'remove'].includes(change.op) ||
          Object.keys(change).some(key => !['op', 'path', 'value'].includes(key)) ||
          (change.op === 'set' && !Object.hasOwn(change, 'value')) ||
          (change.op === 'remove' && Object.hasOwn(change, 'value'))) fail('AGENT_LOCAL_DATA_PATCH_FORBIDDEN');
      const keys = pointer(change.path), key = keys.at(-1);
      let parent = after;
      for (const part of keys.slice(0, -1)) {
        if (!parent || typeof parent !== 'object' || !Object.hasOwn(parent, part)) fail('AGENT_LOCAL_DATA_PATCH_FORBIDDEN');
        parent = parent[part];
      }
      if (!parent || typeof parent !== 'object') fail('AGENT_LOCAL_DATA_PATCH_FORBIDDEN');
      if (Array.isArray(parent) && (!/^(?:0|[1-9][0-9]*)$/u.test(key) || Number(key) >= parent.length || change.op === 'remove')) fail('AGENT_LOCAL_DATA_PATCH_FORBIDDEN');
      const exists = Object.hasOwn(parent, key);
      if (!exists && change.op === 'remove') fail('AGENT_LOCAL_DATA_PATCH_FORBIDDEN');
      const row = { path: change.path, beforePresent: exists, before: exists ? clone(parent[key]) : null,
        afterPresent: change.op === 'set', after: change.op === 'set' ? clone(change.value) : null };
      if (change.op === 'set') parent[key] = clone(change.value);
      else delete parent[key];
      preview.push(row);
    }
    preserveIdentity(before, after);
    return { content: after, changes: preview };
  }

  function createAgentLocalData({ call, requestApproval, now = Date.now, approvalTimeoutMs = 120000 } = {}) {
    if (typeof call !== 'function') fail('AGENT_LOCAL_DATA_BRIDGE_UNAVAILABLE');
    if (typeof now !== 'function' || !Number.isFinite(approvalTimeoutMs) || approvalTimeoutMs < 1 || approvalTimeoutMs > 600000) fail('AGENT_LOCAL_DATA_ARGUMENT_INVALID');
    let mutationBusy = false;
    const usedApprovals = new Set();
    const cancelled = signal => { if (signal?.aborted) fail('AGENT_LOCAL_DATA_CANCELLED'); };
    async function invoke(message, signal) {
      cancelled(signal);
      const result = await call(clone(message));
      cancelled(signal);
      if (result?.success !== true) fail(result?.error?.code || 'AGENT_LOCAL_DATA_ROUTE_UNAVAILABLE');
      return clone(result.data);
    }
    const readExport = async (owner, signal) => checkExport(await invoke({ type: 'ARTICLE_WORKSPACE_EXPORT', workspaceId: owner.workspaceId }, signal), owner);
    const readAsset = async (owner, path, signal) => checkAssetEnvelope(await invoke({ type: 'ARTICLE_WORKSPACE_GET_ASSET', ...owner, relativePath: path }, signal), owner, path);
    async function approve(details, signal) {
      cancelled(signal);
      if (typeof requestApproval !== 'function') fail('AGENT_LOCAL_DATA_APPROVAL_REQUIRED');
      const createdAt = now(), approvalId = 'local-data-' + crypto.randomUUID();
      const preview = freeze({ ...clone(details), approvalId, createdAt, expiresAt: createdAt + approvalTimeoutMs });
      const approvalController = new AbortController();
      let timer, onAbort;
      try {
        const response = await Promise.race([
          Promise.resolve().then(() => requestApproval(preview, { signal: approvalController.signal })),
          new Promise((_, reject) => {
            timer = setTimeout(() => reject(Object.assign(new Error('AGENT_LOCAL_DATA_APPROVAL_EXPIRED'), { code: 'AGENT_LOCAL_DATA_APPROVAL_EXPIRED' })), approvalTimeoutMs);
            onAbort = () => { approvalController.abort(); reject(Object.assign(new Error('AGENT_LOCAL_DATA_CANCELLED'), { code: 'AGENT_LOCAL_DATA_CANCELLED' })); };
            signal?.addEventListener('abort', onAbort, { once: true });
            if (signal?.aborted) onAbort();
          })
        ]);
        cancelled(signal);
        if (now() > preview.expiresAt) fail('AGENT_LOCAL_DATA_APPROVAL_EXPIRED');
        if (response?.approved !== true || response.approvalId !== approvalId || usedApprovals.has(response.approvalId)) fail('AGENT_LOCAL_DATA_APPROVAL_DENIED');
        usedApprovals.add(approvalId);
        return preview;
      } finally { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); approvalController.abort(); }
    }
    async function saveAsset(args, signal) {
      const owner = identity(args), path = args.operation === 'set_tags' ? 'annotations/library-tags.json' : args.relativePath;
      if (!writable(path)) fail('AGENT_LOCAL_DATA_WRITE_UNSUPPORTED');
      const before = await readAsset(owner, path, signal);
      if ((before?.revision || 0) !== args.expectedAssetRevision || (before?.contentHash || '') !== args.expectedAssetContentHash) fail('AGENT_LOCAL_DATA_VERSION_CHANGED');
      if (!before && args.operation !== 'set_tags') fail('AGENT_LOCAL_DATA_ASSET_NOT_FOUND');
      const snapshot = await readExport(owner, signal);
      let candidate;
      if (args.operation === 'set_tags') {
        if (typeof tags?.normalizeLocalLibraryTagsAsset !== 'function') fail('AGENT_LOCAL_DATA_TAGS_UNAVAILABLE');
        if (before) tags.normalizeLocalLibraryTagsAsset(before.content, owner);
        const content = tags.normalizeLocalLibraryTagsAsset({ schemaVersion: 1, workspaceId: owner.workspaceId, tags: args.tags }, owner);
        candidate = { content: clone(content), changes: [{ path: '/tags', beforePresent: Boolean(before), before: before?.content.tags || null, afterPresent: true, after: clone(content.tags) }] };
      } else candidate = patchContent(before.content, args.changes);
      const preview = await approve({ operation: args.operation, permanent: false, workspace: snapshot.workspace,
        relativePath: path, assetRevision: before?.revision || 0, assetContentHash: before?.contentHash || '',
        changes: candidate.changes,
        summary: `修改论文《${snapshot.workspace.title}》的本地数据 ${path}：${candidate.changes.length} 处修改。仅写入预览中批准的字段，保留来源与身份。`
      }, signal);
      // The human approves a concrete version. New edits require another preview;
      // the receiver still performs atomic CAS if a write races this final read.
      const currentSnapshot = await readExport(owner, signal), current = await readAsset(owner, path, signal);
      if (!same(workspaceToken(snapshot), workspaceToken(currentSnapshot)) || !same(token(before), token(current))) fail('AGENT_LOCAL_DATA_VERSION_CHANGED');
      if (now() > preview.expiresAt) fail('AGENT_LOCAL_DATA_APPROVAL_EXPIRED');
      cancelled(signal);
      const receipt = await invoke({ type: 'ARTICLE_WORKSPACE_SAVE_ASSET', ...owner, relativePath: path,
        content: candidate.content, expectedRevision: before?.revision || 0,
        expectedContentHash: before?.contentHash || '', ...(before?.writeToken ? { writeToken: before.writeToken } : {}),
        ...(!before ? { createOnly: true } : {})
      });
      // A projected pre-crash Figure may have a lower public revision than the
      // raw already-promoted row. Its bound writeToken reconciles that row, so a
      // valid receiver receipt can advance by more than one public revision.
      if (receipt.saved !== true || receipt.asset?.relativePath !== path ||
          !Number.isSafeInteger(receipt.asset?.revision) || receipt.asset.revision <= (before?.revision || 0) ||
          typeof receipt.asset?.contentHash !== 'string' || !receipt.asset.contentHash) fail('AGENT_LOCAL_DATA_WRITE_RECEIPT_MISMATCH');
      return receipt;
    }
    async function deleteWorkspace(args, signal) {
      const owner = identity(args), snapshot = await readExport(owner, signal);
      if (snapshot.deletionApprovalCas !== true || snapshot.deletionApprovalSnapshotCas !== true) fail('AGENT_LOCAL_DATA_DELETE_CAS_UNAVAILABLE');
      const assets = snapshot.assets.map(asset => ({ relativePath: asset.relativePath, revision: asset.revision, contentHash: asset.contentHash }));
      const approvalSnapshot = snapshot.deletionApprovalSnapshot;
      const revisions = new Map(approvalSnapshot.turnRevisions.map(turn => [turn.turnId, turn.revision]));
      const turns = snapshot.turns.map(turn => ({ turnId: turn.turnId, revision: revisions.get(turn.turnId), role: turn.role || '' }));
      const preview = await approve({ operation: 'delete_workspace', workspace: snapshot.workspace, permanent: true,
        assets, assetsInventory: 'public_projection', turns,
        diskCleanup: { directoryName: snapshot.workspace.directoryName || '', scope: ['workspace', 'backups', 'conflicts'] },
        summary: `永久删除论文《${snapshot.workspace.title}》的此文档版本（${owner.workspaceId}，generation ${owner.workspaceGeneration}，storageRevision ${snapshot.workspace.storageRevision}）：${assets.length} 项公开资源、${turns.length} 条对话，及该文档的其他内部保存记录，以及目录主本、backups 备份和 conflicts 冲突副本。此操作不进入回收站，不能撤销；其他论文不在批准范围。`
      }, signal);
      const current = await readExport(owner, signal);
      if (current.deletionApprovalCas !== true || current.deletionApprovalSnapshotCas !== true) fail('AGENT_LOCAL_DATA_DELETE_CAS_UNAVAILABLE');
      if (!same(workspaceToken(snapshot), workspaceToken(current))) fail('AGENT_LOCAL_DATA_VERSION_CHANGED');
      if (now() > preview.expiresAt) fail('AGENT_LOCAL_DATA_APPROVAL_EXPIRED');
      cancelled(signal);
      const started = await invoke({ type: 'ARTICLE_WORKSPACE_BEGIN_DELETE', ...owner,
        expectedStorageRevision: snapshot.workspace.storageRevision,
        expectedWorkspaceContentHash: snapshot.workspace.contentHash, coordinateOpenTabs: true,
        expectedWorkspaceMetadata: approvalSnapshot.workspaceMetadata,
        expectedTurnRevisions: approvalSnapshot.turnRevisions.slice().sort((a, b) => a.turnId.localeCompare(b.turnId))
      });
      if (started.workspaceId !== owner.workspaceId || started.workspaceGeneration !== owner.workspaceGeneration ||
          started.entityType !== 'workspace' || started.entityId !== owner.workspaceId ||
          typeof started.tombstoneId !== 'string' || !started.tombstoneId ||
          typeof started.tombstoneKey !== 'string' || !started.tombstoneKey) fail('AGENT_LOCAL_DATA_DELETE_RECEIPT_MISMATCH');
      // BEGIN has durably frozen the approved version. Finish that exact receipt
      // even if the model loop is cancelled now; leaving a pending tombstone is
      // neither an undo nor cancellation of the already-approved deletion.
      const receipt = await invoke({ type: 'ARTICLE_WORKSPACE_FINALIZE_DELETE', ...owner,
        tombstoneId: started.tombstoneId, coordinateOpenTabs: true
      });
      if (receipt.deleted !== true || (!receipt.alreadyMissing && receipt.workspaceGeneration !== owner.workspaceGeneration + 1)) fail('AGENT_LOCAL_DATA_DELETE_RECEIPT_MISMATCH');
      return receipt;
    }
    return {
      capabilities: () => clone({ operations: OPERATIONS, unavailable: UNAVAILABLE, approvalRequiredForAllMutations: true }),
      async execute(input, { signal } = {}) {
        const args = normalizeArgs(input); cancelled(signal);
        if (MUTATIONS.has(args.operation)) {
          if (mutationBusy) fail('AGENT_LOCAL_DATA_APPROVAL_BUSY');
          mutationBusy = true;
          try { return args.operation === 'delete_workspace' ? await deleteWorkspace(args, signal) : await saveAsset(args, signal); }
          finally { mutationBusy = false; }
        }
        if (args.operation === 'query_library') {
          const query = args.query ?? '', scope = args.scope ?? 'all', page = args.page ?? 1, pageSize = args.pageSize ?? 12, tagMode = args.tagMode ?? 'any';
          if (typeof query !== 'string' || query.length > 4000 || !SCOPES.has(scope) ||
              !Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100 || !['any', 'all'].includes(tagMode)) fail('AGENT_LOCAL_DATA_ARGUMENT_INVALID');
          if (typeof tags?.normalizeLocalLibraryTags !== 'function') fail('AGENT_LOCAL_DATA_TAGS_UNAVAILABLE');
          return invoke({ type: 'LOCAL_READING_LIBRARY_QUERY', kind: 'articles', query, scope, page, pageSize,
            tags: [...tags.normalizeLocalLibraryTags(args.tags ?? [])], tagMode }, signal);
        }
        const owner = identity(args);
        if (args.operation === 'read_export') return readExport(owner, signal);
        if (args.operation === 'read_asset') {
          const asset = await readAsset(owner, args.relativePath, signal);
          return { ...owner, found: Boolean(asset), asset };
        }
        const before = await invoke({ type: 'ARTICLE_WORKSPACE_LIST_ASSETS', ...owner }, signal);
        const after = await invoke({ type: 'ARTICLE_WORKSPACE_LIST_ASSETS', ...owner }, signal);
        if (before.workspaceGeneration !== owner.workspaceGeneration || after.workspaceGeneration !== owner.workspaceGeneration ||
            !Array.isArray(before.assets) || !same(before, after)) fail('AGENT_LOCAL_DATA_VERSION_CHANGED');
        return { ...owner, assets: clone(before.assets) };
      }
    };
  }
  return { createAgentLocalData };
});
