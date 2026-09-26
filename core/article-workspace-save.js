(function attach(root, factory) {
  const api = factory(root.SciLLM || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory(shared) {
  'use strict';

  function fail(code) {
    const error = new Error(code);
    error.code = code;
    throw error;
  }

  function plain(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }

  function bounded(value, maximum = 400) {
    return String(value ?? '').normalize('NFKC').replace(/\s+/gu, ' ').trim()
      .slice(0, maximum);
  }

  function freeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.values(value).forEach(freeze);
    return Object.freeze(value);
  }

  function aliasValue(input, type) {
    const direct = type === 'doi' ? input?.doi : input?.siteId || input?.publisherId;
    const candidate = direct || (Array.isArray(input?.aliases)
      ? input.aliases.find(alias => alias?.type === type)?.value : '');
    try {
      if (type === 'doi' && typeof shared.normalizeWorkspaceDoi === 'function') {
        return shared.normalizeWorkspaceDoi(candidate, input?.canonicalUrl || input?.url);
      }
      if (type === 'site' && typeof shared.normalizeWorkspaceSiteId === 'function') {
        return shared.normalizeWorkspaceSiteId(candidate);
      }
    } catch (_) {}
    return bounded(candidate, 300).toLocaleLowerCase('en-US');
  }

  function normalizeWorkspacePublicationIdentity(value = {}) {
    if (!plain(value)) return freeze({ workspaceId: '', canonicalUrl: '', doi: '', siteId: '' });
    const rawWorkspaceId = bounded(value.workspaceId, 100).toLocaleLowerCase('en-US');
    const workspaceId = /^workspace:[a-f0-9]{64}$/u.test(rawWorkspaceId)
      ? rawWorkspaceId : '';
    let canonicalUrl = '';
    try {
      canonicalUrl = typeof shared.normalizeWorkspaceCanonicalUrl === 'function'
        ? shared.normalizeWorkspaceCanonicalUrl(value.canonicalUrl || value.url) : '';
    } catch (_) {}
    return freeze({
      workspaceId,
      canonicalUrl,
      doi: aliasValue(value, 'doi'),
      siteId: aliasValue(value, 'site')
    });
  }

  function sameWorkspacePublicationIdentity(left, right) {
    const a = normalizeWorkspacePublicationIdentity(left);
    const b = normalizeWorkspacePublicationIdentity(right);
    if (!a.workspaceId || a.workspaceId !== b.workspaceId) return false;
    if (!a.canonicalUrl || a.canonicalUrl !== b.canonicalUrl) return false;
    if (a.doi && b.doi && a.doi !== b.doi) return false;
    if (a.siteId && b.siteId && a.siteId !== b.siteId) return false;
    return true;
  }

  function classifyWorkspaceAssetConflict(assetKind) {
    const path = bounded(assetKind, 600).replace(/\\/gu, '/').toLocaleLowerCase('en-US');
    if (/^(?:figures\/workspace-draft\.json|figures\/supplemental\/|logic-maps\/)/u.test(path)) {
      return 'mergeable_state';
    }
    if (/^chat\/turns\//u.test(path) || path === 'chat-turn') return 'immutable_turn';
    if (/^(?:article\/|offline\/|ui\/|analysis\/|highlights\/)/u.test(path)) {
      return 'recapturable_snapshot';
    }
    return 'manual_resolution';
  }

  function normalizedContentRevision(value = {}) {
    const hash = bounded(value?.contentHash || value?.revision, 80)
      .replace(/^sha256:/u, '').toLocaleLowerCase('en-US');
    return {
      contentHash: /^[a-f0-9]{64}$/u.test(hash) ? hash : '',
      extractionRevision: Math.max(0, Number(value?.extractionRevision) || 0),
      bindingEpoch: Math.max(0, Number(value?.bindingEpoch) || 0)
    };
  }

  function createWorkspaceSaveTransactionContext(input = {}) {
    if (!plain(input)) fail('WORKSPACE_SAVE_TRANSACTION_INVALID');
    const publicationIdentity = normalizeWorkspacePublicationIdentity(
      input.publicationIdentity || input
    );
    const generation = Number(input.generation || input.workspaceGeneration);
    if (!publicationIdentity.workspaceId || !publicationIdentity.canonicalUrl ||
        !Number.isSafeInteger(generation) || generation < 1) {
      fail('WORKSPACE_SAVE_TRANSACTION_INVALID');
    }
    const assetInventory = (Array.isArray(input.assetInventory) ? input.assetInventory : [])
      .flatMap(asset => {
        if (!plain(asset)) return [];
        let path = '';
        try {
          path = typeof shared.normalizeWorkspaceRelativePath === 'function'
            ? shared.normalizeWorkspaceRelativePath(asset.path || asset.relativePath) : '';
        } catch (_) { return []; }
        const hash = bounded(asset.contentHash, 80).toLocaleLowerCase('en-US');
        return [{
          path,
          contentHash: /^[a-f0-9]{64}$/u.test(hash) ? hash : '',
          revision: Math.max(0, Number(asset.revision) || 0),
          conflictClass: classifyWorkspaceAssetConflict(path)
        }];
      }).slice(0, 2000);
    return freeze({
      schemaVersion: 1,
      operationId: bounded(input.operationId, 120),
      publicationIdentity,
      contentRevision: normalizedContentRevision(input.contentRevision),
      workspaceGeneration: generation,
      capturedAt: Math.max(0, Number(input.capturedAt) || Date.now()),
      assetInventory,
      retryLimit: 1
    });
  }

  function validateWorkspaceRestoreAuthorization(authorization, currentTarget, options = {}) {
    if (!plain(authorization) || !plain(currentTarget)) {
      fail('ARTICLE_WORKSPACE_RESTORE_AUTHORIZATION_INVALID');
    }
    const now = Number(options.now) || Date.now();
    const authorizedNonce = bounded(authorization.nonce || authorization.token, 160);
    const currentNonce = bounded(
      currentTarget.nonce || currentTarget.authorizationToken || options.nonce, 160
    );
    if (!authorizedNonce || authorizedNonce !== currentNonce ||
        Number(authorization.expiresAt) <= now) {
      fail('ARTICLE_WORKSPACE_RESTORE_AUTHORIZATION_INVALID');
    }
    const authorizedGeneration = Number(
      authorization.workspaceGeneration || authorization.identity?.workspaceGeneration
    );
    const currentGeneration = Number(currentTarget.workspaceGeneration);
    const authorizedIdentity = authorization.publicationIdentity || authorization.identity;
    if (!Number.isSafeInteger(authorizedGeneration) || authorizedGeneration < 1 ||
        authorizedGeneration !== currentGeneration ||
        !sameWorkspacePublicationIdentity(authorizedIdentity, currentTarget)) {
      fail('ARTICLE_WORKSPACE_RESTORE_TARGET_MISMATCH');
    }
    const before = normalizedContentRevision(
      authorization.contentRevision || authorization.identity
    );
    const after = normalizedContentRevision(currentTarget);
    return freeze({
      authorized: true,
      publicationIdentity: normalizeWorkspacePublicationIdentity(currentTarget),
      workspaceGeneration: currentGeneration,
      contentRevisionChanged: Boolean(
        before.contentHash && after.contentHash && before.contentHash !== after.contentHash
      ),
      contentRevision: after
    });
  }

  const LOCAL_LIBRARY_SAVE_EVENTS_ASSET_PATH = 'annotations/library-save-events.json';

  function saveEventOperationId(value) {
    return typeof value === 'string' && value.length <= 120 &&
      /^[A-Za-z0-9][A-Za-z0-9:._-]*$/u.test(value);
  }

  function saveEventInstant(value) {
    if (typeof value !== 'string' || value.length !== 24 ||
        !/^(?!0000)\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) return false;
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
  }

  function saveEventIdentity(value) {
    if (!plain(value) || typeof value.workspaceId !== 'string' ||
        !/^workspace:[a-f0-9]{64}$/u.test(value.workspaceId) ||
        !Number.isSafeInteger(value.workspaceGeneration) || value.workspaceGeneration < 1 ||
        typeof value.canonicalUrl !== 'string' || !value.canonicalUrl || value.canonicalUrl.length > 4000 ||
        /[\u0000-\u001f\u007f-\u009f\ud800-\udfff]/u.test(value.canonicalUrl)) return null;
    try {
      const url = new URL(value.canonicalUrl);
      if (url.username || url.password) return null;
      const identity = normalizeWorkspacePublicationIdentity({
        workspaceId: value.workspaceId, canonicalUrl: value.canonicalUrl
      });
      if (!identity.workspaceId || !identity.canonicalUrl) return null;
      return { workspaceId: identity.workspaceId, canonicalUrl: identity.canonicalUrl,
        workspaceGeneration: value.workspaceGeneration };
    } catch (_) { return null; }
  }

  // These are explicit browser-local completion records, not extraction,
  // workspace modification, archive capture or directory-flush timestamps.
  function normalizeLocalLibrarySaveEventsAsset(input, options = {}) {
    try {
      const target = saveEventIdentity(options);
      const identity = saveEventIdentity(input);
      if (!target || !identity || input.schemaVersion !== 1 || input.scope !== 'browser-local' ||
          identity.workspaceId !== target.workspaceId || identity.canonicalUrl !== target.canonicalUrl ||
          identity.workspaceGeneration !== target.workspaceGeneration) return null;
      const attempt = input.lastAttempt;
      if (!plain(attempt) || !saveEventOperationId(attempt.operationId) ||
          !['complete', 'partial'].includes(attempt.status) || !saveEventInstant(attempt.completedAt)) return null;
      const first = input.firstRecordedAt;
      const last = input.lastSavedAt;
      const operationId = input.operationId;
      const hasSuccess = saveEventInstant(first) && saveEventInstant(last) && saveEventOperationId(operationId);
      if (!hasSuccess) {
        if (first !== '' || last !== '' || operationId !== '' || attempt.status !== 'partial') return null;
      } else {
        if (first > last || last > attempt.completedAt) return null;
        if (attempt.status === 'complete' &&
            (last !== attempt.completedAt || operationId !== attempt.operationId)) return null;
        if (attempt.status === 'partial' &&
            (last >= attempt.completedAt || operationId === attempt.operationId)) return null;
      }
      return freeze({ schemaVersion: 1, ...identity, scope: 'browser-local',
        firstRecordedAt: first, lastSavedAt: last, operationId,
        lastAttempt: { operationId: attempt.operationId, status: attempt.status, completedAt: attempt.completedAt } });
    } catch (_) { return null; }
  }

  /**
   * Caller freezes completedAt at the actual end of one explicit save and
   * reuses the SAME payload for any CAS retry. A new save uses a new ID.
   * Only the retained latest success/attempt IDs are deduplicated; older
   * operations rely on their unchanged timestamp. This is not an unlimited
   * operation ledger and must not be used to promise directory persistence.
   */
  function recordLocalLibrarySaveEvent(previous, event) {
    const identity = saveEventIdentity(event);
    if (!identity || event.scope !== 'browser-local' ||
        !['complete', 'partial'].includes(event.status) ||
        !saveEventOperationId(event.operationId) || !saveEventInstant(event.completedAt)) {
      fail('LOCAL_LIBRARY_SAVE_EVENT_INVALID');
    }
    const current = previous === null || previous === undefined ? null
      : normalizeLocalLibrarySaveEventsAsset(previous, identity);
    if (previous !== null && previous !== undefined && !current) fail('LOCAL_LIBRARY_SAVE_EVENTS_ASSET_INVALID');
    if (current && (current.operationId === event.operationId || current.lastAttempt.operationId === event.operationId)) {
      return freeze({ asset: current, changed: false, reason: 'duplicate-operation' });
    }
    if (current && event.completedAt <= current.lastAttempt.completedAt) {
      return freeze({ asset: current, changed: false, reason: 'out-of-order' });
    }
    const complete = event.status === 'complete';
    const asset = freeze({ schemaVersion: 1, ...identity, scope: 'browser-local',
      firstRecordedAt: current?.firstRecordedAt || (complete ? event.completedAt : ''),
      lastSavedAt: complete ? event.completedAt : current?.lastSavedAt || '',
      operationId: complete ? event.operationId : current?.operationId || '',
      lastAttempt: { operationId: event.operationId, status: event.status, completedAt: event.completedAt } });
    return freeze({ asset, changed: true, reason: 'recorded' });
  }

  return {
    LOCAL_LIBRARY_SAVE_EVENTS_ASSET_PATH,
    normalizeLocalLibrarySaveEventsAsset,
    recordLocalLibrarySaveEvent,
    normalizeWorkspacePublicationIdentity,
    sameWorkspacePublicationIdentity,
    classifyWorkspaceAssetConflict,
    createWorkspaceSaveTransactionContext,
    validateWorkspaceRestoreAuthorization
  };
});
