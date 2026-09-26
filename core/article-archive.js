(function attach(root, factory) {
  const api = factory(root.SciLLM || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory(shared) {
  const ARTICLE_ARCHIVE_KIND = 'sci-logic-highlighter-article';
  const ARTICLE_ARCHIVE_SCHEMA_VERSION = 1;
  const MAX_ARTICLE_ARCHIVE_BYTES = 12 * 1024 * 1024;
  const EXTERNAL_IMPORT_ANSWER_PROVENANCE = Object.freeze({
    origin: 'external_import', verification: 'unverified'
  });
  const FIGURE_WORKSPACE_BINDING_KEYS = [
    'documentId', 'documentHash', 'canonicalUrl', 'workspaceId', 'workspaceGeneration'
  ];
  const OMIT = Symbol('omit');
  let privacy = shared;
  let figureWorkspace = shared;
  let webSources = shared;
  if (typeof privacy.isExportSensitiveKey !== 'function' && typeof require === 'function') {
    try { privacy = require('./privacy-sanitizer.js'); } catch (_) {}
  }
  if (typeof privacy.isExportSensitiveKey !== 'function') {
    const error = new Error('PRIVACY_SANITIZER_UNAVAILABLE');
    error.code = 'PRIVACY_SANITIZER_UNAVAILABLE';
    throw error;
  }
  if (typeof figureWorkspace.publicFigureWorkspaceDraft !== 'function' &&
      typeof require === 'function') {
    try { figureWorkspace = require('./figure-workspace.js'); } catch (_) {}
  }
  if (typeof webSources.normalizeArticleChatWebGroundingReceipt !== 'function' &&
      typeof require === 'function') {
    try { webSources = require('./article-chat-web-sources.js'); } catch (_) {}
  }

  function fail(code) {
    const error = new Error(code);
    error.code = code;
    throw error;
  }

  function isPlainObject(value) {
    if (!value || typeof value !== 'object') return false;
    try {
      if (Array.isArray(value)) return false;
      const prototype = Object.getPrototypeOf(value);
      return prototype === Object.prototype || prototype === null;
    } catch (_) {
      return false;
    }
  }

  function ownData(value, key) {
    if (!value || (typeof value !== 'object' && typeof value !== 'function')) {
      return undefined;
    }
    try {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return descriptor && Object.hasOwn(descriptor, 'value')
        ? descriptor.value : undefined;
    } catch (_) {
      return undefined;
    }
  }

  function normalizeDocumentId(value) {
    const documentId = String(value || '').trim();
    if (!documentId || documentId.length > 200 ||
        !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(documentId)) {
      fail('INVALID_DOCUMENT_ID');
    }
    return documentId;
  }

  function normalizeUrl(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    try {
      const parsed = new URL(raw);
      if (!/^https?:$/u.test(parsed.protocol)) return '';
      parsed.username = '';
      parsed.password = '';
      parsed.search = '';
      parsed.hash = '';
      return parsed.href.replace(/\/$/u, '');
    } catch (_) {
      return raw.split(/[?#]/u, 1)[0].slice(0, 2000);
    }
  }

  function forbiddenKey(value) {
    const key = String(value || '').toLowerCase().replace(/[^a-z0-9]/gu, '');
    return privacy.isExportSensitiveKey(value) ||
      /(dataurl|pagehtml|documenthtml|outerhtml|innerhtml|rawhtml|fullhtml)/u.test(key);
  }

  function stripPortableAuthorization(value) {
    if (typeof figureWorkspace.stripExplicitAuthorizationCredentials !== 'function') {
      fail('FIGURE_WORKSPACE_SANITIZER_UNAVAILABLE');
    }
    return figureWorkspace.stripExplicitAuthorizationCredentials(value);
  }

  function sanitizePortableValue(value, depth = 0) {
    if (depth > 40) fail('ARTICLE_ARCHIVE_TOO_DEEP');
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value === 'string') {
      if (/^data:/iu.test(value.trim())) return OMIT;
      return stripPortableAuthorization(value);
    }
    if (Array.isArray(value)) {
      let length = 0;
      try {
        const descriptor = Object.getOwnPropertyDescriptor(value, 'length');
        length = Number(descriptor?.value);
      } catch (_) {
        return OMIT;
      }
      if (!Number.isSafeInteger(length) || length < 0 || length > 100000) {
        fail('ARTICLE_ARCHIVE_TOO_LARGE');
      }
      const sanitized = [];
      for (let index = 0; index < length; index += 1) {
        let descriptor;
        try { descriptor = Object.getOwnPropertyDescriptor(value, String(index)); }
        catch (_) { return OMIT; }
        if (!descriptor || !Object.hasOwn(descriptor, 'value')) continue;
        const item = sanitizePortableValue(descriptor.value, depth + 1);
        if (item !== OMIT) sanitized.push(item);
      }
      return sanitized;
    }
    if (!isPlainObject(value)) return OMIT;
    const sanitized = {};
    let keys;
    try { keys = Object.keys(value); } catch (_) { return OMIT; }
    for (const key of keys) {
      if (forbiddenKey(key)) continue;
      let descriptor;
      try { descriptor = Object.getOwnPropertyDescriptor(value, key); }
      catch (_) { continue; }
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) continue;
      const item = sanitizePortableValue(descriptor.value, depth + 1);
      if (item !== OMIT) sanitized[key] = item;
    }
    return sanitized;
  }

  function invalidFigureWorkspaceDraft() {
    fail('INVALID_FIGURE_WORKSPACE_DRAFT');
  }

  function isCanonicalDataDescriptor(descriptor) {
    return Boolean(descriptor && Object.hasOwn(descriptor, 'value') &&
      descriptor.enumerable === true && descriptor.writable === true &&
      descriptor.configurable === true);
  }

  function snapshotCanonicalRuntimeBinding(value) {
    if (!isPlainObject(value)) return null;
    let prototype;
    let keys;
    try {
      prototype = Object.getPrototypeOf(value);
      keys = Reflect.ownKeys(value);
    } catch (_) {
      return null;
    }
    if (prototype !== Object.prototype ||
        keys.length !== FIGURE_WORKSPACE_BINDING_KEYS.length ||
        keys.some(key => typeof key !== 'string' ||
          !FIGURE_WORKSPACE_BINDING_KEYS.includes(key))) return null;
    const snapshot = {};
    for (const key of FIGURE_WORKSPACE_BINDING_KEYS) {
      let descriptor;
      try { descriptor = Object.getOwnPropertyDescriptor(value, key); }
      catch (_) { return null; }
      if (!isCanonicalDataDescriptor(descriptor) ||
          (key === 'workspaceGeneration'
            ? !Number.isSafeInteger(descriptor.value) || descriptor.value < 1
            : typeof descriptor.value !== 'string')) return null;
      snapshot[key] = descriptor.value;
    }
    return snapshot;
  }

  function assertRawFigureWorkspaceDraft(value, options = {}) {
    const omitRuntimeBinding = options.omitRuntimeBinding === true;
    let remaining = 1000000;
    const seen = new Set();
    const visit = (item, depth = 0) => {
      if (depth > 20 || remaining <= 0) invalidFigureWorkspaceDraft();
      if (item === null || typeof item === 'boolean' || typeof item === 'number') return item;
      if (typeof item === 'string') {
        remaining -= item.length;
        if (remaining < 0 ||
            /(?:^|[^\p{L}\p{N}_])(?:data|blob|javascript|https?|file):(?=\S)/iu.test(item)) {
          invalidFigureWorkspaceDraft();
        }
        return item;
      }
      if (!item || typeof item !== 'object' || seen.has(item)) {
        invalidFigureWorkspaceDraft();
      }
      seen.add(item);
      let prototype;
      let array;
      try { prototype = Object.getPrototypeOf(item); } catch (_) {
        invalidFigureWorkspaceDraft();
      }
      try { array = Array.isArray(item); } catch (_) {
        invalidFigureWorkspaceDraft();
      }
      let snapshot;
      if (array) {
        if (prototype !== Array.prototype) invalidFigureWorkspaceDraft();
        let lengthDescriptor;
        let ownKeys;
        try {
          lengthDescriptor = Object.getOwnPropertyDescriptor(item, 'length');
          ownKeys = Reflect.ownKeys(item);
        }
        catch (_) { invalidFigureWorkspaceDraft(); }
        const length = Number(lengthDescriptor?.value);
        if (!lengthDescriptor || !Object.hasOwn(lengthDescriptor, 'value') ||
            lengthDescriptor.enumerable !== false ||
            lengthDescriptor.configurable !== false || lengthDescriptor.writable !== true ||
            !Number.isSafeInteger(length) || length < 0 || length > 100000) {
          invalidFigureWorkspaceDraft();
        }
        for (const key of ownKeys) {
          if (key === 'length' || (typeof key === 'string' && /^(?:0|[1-9]\d*)$/u.test(key))) {
            continue;
          }
          invalidFigureWorkspaceDraft();
        }
        snapshot = new Array(length);
        for (let index = 0; index < length; index += 1) {
          let descriptor;
          try { descriptor = Object.getOwnPropertyDescriptor(item, String(index)); }
          catch (_) { invalidFigureWorkspaceDraft(); }
          if (!descriptor) continue;
          if (!isCanonicalDataDescriptor(descriptor)) invalidFigureWorkspaceDraft();
          snapshot[index] = visit(descriptor.value, depth + 1);
        }
      } else {
        if (prototype !== Object.prototype && prototype !== null) {
          invalidFigureWorkspaceDraft();
        }
        let keys;
        try {
          keys = Reflect.ownKeys(item);
        } catch (_) {
          invalidFigureWorkspaceDraft();
        }
        if (depth === 0 && !keys.includes('binding')) {
          let hiddenBindingDescriptor;
          try {
            hiddenBindingDescriptor = Object.getOwnPropertyDescriptor(item, 'binding');
          } catch (_) {
            invalidFigureWorkspaceDraft();
          }
          if (hiddenBindingDescriptor) invalidFigureWorkspaceDraft();
        }
        snapshot = Object.create(prototype);
        for (const key of keys) {
          if (typeof key !== 'string') invalidFigureWorkspaceDraft();
          if (depth === 0 && key === 'binding' && !omitRuntimeBinding) {
            invalidFigureWorkspaceDraft();
          }
          const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/gu, '');
          if (key === 'toJSON' || forbiddenKey(key) ||
              /^(?:rawparagraphs?|rawimages?|images?|urls?|providerconfig)$/u.test(normalizedKey)) {
            invalidFigureWorkspaceDraft();
          }
          remaining -= key.length;
          if (remaining < 0) invalidFigureWorkspaceDraft();
          let descriptor;
          try { descriptor = Object.getOwnPropertyDescriptor(item, key); }
          catch (_) { invalidFigureWorkspaceDraft(); }
          if (!isCanonicalDataDescriptor(descriptor)) {
            invalidFigureWorkspaceDraft();
          }
          if (depth === 0 && key === 'binding' && omitRuntimeBinding) {
            const binding = snapshotCanonicalRuntimeBinding(descriptor.value);
            if (!binding) invalidFigureWorkspaceDraft();
            Object.defineProperty(snapshot, key, {
              value: binding, enumerable: true, writable: true, configurable: true
            });
            continue;
          }
          Object.defineProperty(snapshot, key, {
            value: visit(descriptor.value, depth + 1),
            enumerable: true,
            writable: true,
            configurable: true
          });
        }
      }
      seen.delete(item);
      return snapshot;
    };
    const snapshot = visit(value);
    let schemaDescriptor;
    try { schemaDescriptor = Object.getOwnPropertyDescriptor(snapshot, 'schemaVersion'); }
    catch (_) { invalidFigureWorkspaceDraft(); }
    if (![1, 2, 3, 4, 5, 6, 7].includes(Number(schemaDescriptor?.value))) {
      invalidFigureWorkspaceDraft();
    }
    if (omitRuntimeBinding) {
      const bindingDescriptor = Object.getOwnPropertyDescriptor(snapshot, 'binding');
      if (bindingDescriptor) Reflect.deleteProperty(snapshot, 'binding');
      return {
        draft: snapshot,
        binding: bindingDescriptor?.value || null,
        bindingPresent: Boolean(bindingDescriptor)
      };
    }
    return snapshot;
  }

  function exactNormalizedRuntimeBinding(value, normalized) {
    if (!isPlainObject(value) || !isPlainObject(normalized)) return false;
    let prototype;
    let keys;
    try {
      prototype = Object.getPrototypeOf(value);
      keys = Reflect.ownKeys(value);
    } catch (_) {
      return false;
    }
    if (prototype !== Object.prototype ||
        keys.length !== FIGURE_WORKSPACE_BINDING_KEYS.length ||
        keys.some(key => typeof key !== 'string' ||
          !FIGURE_WORKSPACE_BINDING_KEYS.includes(key))) return false;
    for (const key of FIGURE_WORKSPACE_BINDING_KEYS) {
      let descriptor;
      let normalizedDescriptor;
      try {
        descriptor = Object.getOwnPropertyDescriptor(value, key);
        normalizedDescriptor = Object.getOwnPropertyDescriptor(normalized, key);
      } catch (_) {
        return false;
      }
      if (!isCanonicalDataDescriptor(descriptor) ||
          !normalizedDescriptor || !Object.hasOwn(normalizedDescriptor, 'value') ||
          descriptor.value !== normalizedDescriptor.value) return false;
    }
    return true;
  }

  function bindingMatchesArchiveIdentity(binding, identity) {
    return binding.documentId === identity.documentId &&
      binding.documentHash === identity.documentHash &&
      normalizeUrl(binding.canonicalUrl) === identity.canonicalUrl;
  }

  function workspaceWithFigureDraft(value, figureWorkspaceDraft) {
    if (!isPlainObject(value)) invalidFigureWorkspaceDraft();
    let prototype;
    let keys;
    try {
      prototype = Object.getPrototypeOf(value);
      keys = Reflect.ownKeys(value);
    } catch (_) {
      invalidFigureWorkspaceDraft();
    }
    const clone = Object.create(prototype);
    for (const key of keys) {
      let descriptor;
      try { descriptor = Object.getOwnPropertyDescriptor(value, key); }
      catch (_) { invalidFigureWorkspaceDraft(); }
      if (!descriptor) invalidFigureWorkspaceDraft();
      if (key === 'figureWorkspaceDraft') {
        if (!Object.hasOwn(descriptor, 'value')) invalidFigureWorkspaceDraft();
        descriptor = { ...descriptor, value: figureWorkspaceDraft };
      }
      try { Object.defineProperty(clone, key, descriptor); }
      catch (_) { invalidFigureWorkspaceDraft(); }
    }
    return clone;
  }

  function portableWorkspaceFromLiveFigureDraft(value, archiveIdentity) {
    if (!isPlainObject(value)) return value;
    let draftDescriptor;
    try { draftDescriptor = Object.getOwnPropertyDescriptor(value, 'figureWorkspaceDraft'); }
    catch (_) { invalidFigureWorkspaceDraft(); }
    if (!draftDescriptor) return value;
    if (!Object.hasOwn(draftDescriptor, 'value')) invalidFigureWorkspaceDraft();
    const draft = draftDescriptor.value;
    if (!isPlainObject(draft)) return value;
    const captured = assertRawFigureWorkspaceDraft(draft, {
      omitRuntimeBinding: true
    });
    if (!captured.bindingPresent) {
      return workspaceWithFigureDraft(value, captured.draft);
    }
    const schemaDescriptor = Object.getOwnPropertyDescriptor(
      captured.draft, 'schemaVersion'
    );
    if (schemaDescriptor?.value !== 7) invalidFigureWorkspaceDraft();
    Object.defineProperty(captured.draft, 'binding', {
      value: captured.binding, enumerable: true, writable: true, configurable: true
    });
    if (typeof figureWorkspace.publicFigureWorkspaceDraft !== 'function') {
      invalidFigureWorkspaceDraft();
    }
    let normalizedDraft;
    try { normalizedDraft = figureWorkspace.publicFigureWorkspaceDraft(captured.draft); }
    catch (_) { invalidFigureWorkspaceDraft(); }
    let normalizedBindingDescriptor;
    try {
      normalizedBindingDescriptor = Object.getOwnPropertyDescriptor(normalizedDraft, 'binding');
    } catch (_) {
      invalidFigureWorkspaceDraft();
    }
    if (!normalizedBindingDescriptor ||
        !Object.hasOwn(normalizedBindingDescriptor, 'value') ||
        !exactNormalizedRuntimeBinding(
          captured.binding, normalizedBindingDescriptor.value
        ) || !bindingMatchesArchiveIdentity(
          normalizedBindingDescriptor.value, archiveIdentity
        ) || !Reflect.deleteProperty(normalizedDraft, 'binding')) {
      invalidFigureWorkspaceDraft();
    }
    return workspaceWithFigureDraft(value, normalizedDraft);
  }

  function stablePortableAnswerBlocks(turn) {
    const rawBlocks = ownData(turn, 'answerBlocks');
    if (!Array.isArray(rawBlocks)) return [];
    const blocks = [];
    for (let index = 0; index < rawBlocks.length; index += 1) {
      const rawBlock = ownData(rawBlocks, String(index));
      if (!isPlainObject(rawBlock)) continue;
      const blockId = String(
        ownData(rawBlock, 'blockId') || ownData(rawBlock, 'id') || ''
      ).slice(0, 160);
      const markdown = String(
        ownData(rawBlock, 'markdown') || ownData(rawBlock, 'content') || ''
      ).slice(0, 65536);
      if (blockId && markdown) blocks.push({ blockId, markdown });
    }
    return blocks;
  }

  function unverifiedAnswerProvenance(value) {
    return isPlainObject(value) && ['external_import', 'provider_unverified'].includes(ownData(value, 'origin')) &&
      ownData(value, 'verification') === 'unverified'
      ? { origin: ownData(value, 'origin'), verification: 'unverified' } : null;
  }

  function hasReadablePortableAnswer(turn) {
    return stablePortableAnswerBlocks(turn).length > 0 ||
      Boolean(String(ownData(turn, 'answer') || '').trim()) ||
      Boolean(String(ownData(turn, 'summary') || '').trim());
  }

  function portableWebReceiptIdentity(turn) {
    if (!isPlainObject(turn)) return null;
    const route = ownData(turn, 'route');
    const webSearch = ownData(turn, 'webSearch');
    if (!isPlainObject(route) || !isPlainObject(webSearch) ||
        ownData(webSearch, 'enabled') !== true ||
        ownData(webSearch, 'searched') !== true) return null;
    const answerBlocks = stablePortableAnswerBlocks(turn);
    const identity = {
      providerId: String(ownData(route, 'providerId') || '').slice(0, 80),
      model: String(ownData(route, 'model') || ownData(turn, 'model') || '')
        .slice(0, 200),
      turnId: String(ownData(turn, 'turnId') || '').slice(0, 160),
      operationId: String(ownData(webSearch, 'completedOperationId') || '')
        .slice(0, 100),
      question: String(ownData(turn, 'question') || '').slice(0, 4000),
      answer: answerBlocks.map(block => block.markdown).join('\n\n'),
      answerBlocks
    };
    return identity.providerId && identity.model && identity.turnId &&
      identity.operationId && identity.question && identity.answer &&
      answerBlocks.length ? identity : null;
  }

  function canonicalPortableWebReceipt(turn) {
    const identity = portableWebReceiptIdentity(turn);
    if (!identity ||
        typeof webSources.normalizeArticleChatWebGroundingReceipt !== 'function') {
      return null;
    }
    try {
      return webSources.normalizeArticleChatWebGroundingReceipt(
        ownData(turn, 'webGrounding'), identity
      );
    } catch (_) {
      return null;
    }
  }

  function sanitizePortableArticleChatTurn(rawTurn) {
    const turn = sanitizePortableValue(rawTurn);
    if (!isPlainObject(turn)) return null;
    const answerProvenance = unverifiedAnswerProvenance(
      ownData(rawTurn, 'answerProvenance')
    );
    delete turn.answerProvenance;
    if (answerProvenance && hasReadablePortableAnswer(turn)) {
      turn.answerProvenance = answerProvenance;
    }
    const rawWebSearch = ownData(rawTurn, 'webSearch');
    const hadWebState = isPlainObject(rawWebSearch) ||
      ownData(rawTurn, 'webGrounding') !== undefined;
    const receipt = answerProvenance ? null : canonicalPortableWebReceipt(rawTurn);
    delete turn.webGrounding;
    if (!receipt) {
      if (hadWebState && ownData(rawWebSearch, 'enabled') === true) {
        turn.webSearch = {
          enabled: true,
          searched: false,
          completedOperationId: ''
        };
        turn.webGrounding = null;
        if (isPlainObject(turn.route)) delete turn.route.providerId;
      }
      return turn;
    }

    const portableRoute = {
      ...(isPlainObject(turn.route) ? turn.route : {}),
      providerId: receipt.grounding.providerId,
      model: receipt.grounding.model
    };
    const portableSearch = {
      enabled: true,
      searched: true,
      completedOperationId: receipt.binding.operationId
    };
    const sanitizedIdentity = portableWebReceiptIdentity({
      ...turn,
      route: portableRoute,
      webSearch: portableSearch
    });
    if (!sanitizedIdentity ||
        typeof webSources.createArticleChatWebGroundingReceipt !== 'function') {
      turn.webSearch = { enabled: true, searched: false, completedOperationId: '' };
      turn.webGrounding = null;
      if (isPlainObject(turn.route)) delete turn.route.providerId;
      return turn;
    }
    let portableReceipt;
    try {
      portableReceipt = webSources.createArticleChatWebGroundingReceipt({
        ...sanitizedIdentity,
        grounding: receipt.grounding
      });
    } catch (_) {
      turn.webSearch = { enabled: true, searched: false, completedOperationId: '' };
      turn.webGrounding = null;
      if (isPlainObject(turn.route)) delete turn.route.providerId;
      return turn;
    }
    turn.route = portableRoute;
    turn.webSearch = portableSearch;
    turn.webGrounding = portableReceipt;
    return turn;
  }

  function restoreCanonicalPortableArticleChatReceipts(rawWorkspace, workspace) {
    const rawChat = ownData(rawWorkspace, 'chat');
    const rawTurns = ownData(rawChat, 'turns');
    if (!Array.isArray(rawTurns)) return;
    const turns = [];
    for (let index = 0; index < rawTurns.length; index += 1) {
      const turn = sanitizePortableArticleChatTurn(
        ownData(rawTurns, String(index))
      );
      if (turn) turns.push(turn);
    }
    const chat = isPlainObject(workspace.chat) ? workspace.chat : {};
    chat.turns = turns;
    workspace.chat = chat;
  }

  function sanitizePortableWorkspace(value) {
    let draftDescriptor;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      try { draftDescriptor = Object.getOwnPropertyDescriptor(value, 'figureWorkspaceDraft'); }
      catch (_) { invalidFigureWorkspaceDraft(); }
    }
    let normalizedDraft;
    if (draftDescriptor) {
      if (!Object.hasOwn(draftDescriptor, 'value')) invalidFigureWorkspaceDraft();
      const draftSnapshot = assertRawFigureWorkspaceDraft(draftDescriptor.value);
      try {
        if (typeof figureWorkspace.publicFigureWorkspaceDraft !== 'function') {
          invalidFigureWorkspaceDraft();
        }
        normalizedDraft = figureWorkspace.publicFigureWorkspaceDraft(
          draftSnapshot
        );
      } catch (_) {
        invalidFigureWorkspaceDraft();
      }
    }
    const workspaceSource = draftDescriptor
      ? workspaceWithFigureDraft(value, normalizedDraft)
      : value;
    const workspace = sanitizePortableValue(workspaceSource || {});
    if (!isPlainObject(workspace)) return {};
    if (draftDescriptor) {
      workspace.figureWorkspaceDraft = sanitizePortableValue(normalizedDraft);
    }
    restoreCanonicalPortableArticleChatReceipts(value, workspace);
    return workspace;
  }

  function jsonBytes(value) {
    const serialized = JSON.stringify(value);
    if (typeof TextEncoder === 'function') return new TextEncoder().encode(serialized).byteLength;
    if (typeof Buffer !== 'undefined') return Buffer.byteLength(serialized, 'utf8');
    return serialized.length * 2;
  }

  function boundedString(value, maximum = 2000) {
    return String(value || '').normalize('NFKC').trim().slice(0, maximum);
  }

  function articleArchiveRelativePath(input) {
    const identity = isPlainObject(input) ? input : { documentId: input };
    const documentId = normalizeDocumentId(identity.documentId);
    const canonicalUrl = normalizeUrl(identity.canonicalUrl);
    const normalized = canonicalUrl || documentId;
    const hash = typeof shared.stableHash === 'function'
      ? shared.stableHash(normalized)
      : (() => {
          let result = 2166136261;
          for (let index = 0; index < normalized.length; index += 1) {
            result ^= normalized.charCodeAt(index);
            result = Math.imul(result, 16777619);
          }
          return (result >>> 0).toString(16).padStart(8, '0');
        })();
    return `articles/${hash}.json`;
  }

  function validateArticleArchive(input) {
    if (!isPlainObject(input) || input.kind !== ARTICLE_ARCHIVE_KIND ||
        input.schemaVersion !== ARTICLE_ARCHIVE_SCHEMA_VERSION) {
      fail('INVALID_ARCHIVE_SCHEMA');
    }
    const documentId = normalizeDocumentId(input.documentId);
    const documentRecord = sanitizePortableValue(input.documentRecord || {});
    if (!isPlainObject(documentRecord) ||
        normalizeDocumentId(documentRecord.documentId) !== documentId) {
      fail('ARCHIVE_IDENTITY_MISMATCH');
    }
    const revision = Number(input.revision);
    if (!Number.isSafeInteger(revision) || revision < 1) fail('INVALID_ARCHIVE_REVISION');
    const savedAt = String(input.savedAt || '');
    if (!savedAt || !Number.isFinite(Date.parse(savedAt))) fail('INVALID_ARCHIVE_TIMESTAMP');
    const archive = {
      schemaVersion: ARTICLE_ARCHIVE_SCHEMA_VERSION,
      kind: ARTICLE_ARCHIVE_KIND,
      revision,
      savedAt,
      extensionVersion: boundedString(input.extensionVersion, 80),
      documentId,
      documentHash: boundedString(input.documentHash, 200),
      canonicalUrl: normalizeUrl(input.canonicalUrl),
      title: boundedString(input.title, 1000),
      publisher: boundedString(input.publisher, 120),
      documentRecord,
      workspace: sanitizePortableWorkspace(input.workspace || {})
    };
    if (jsonBytes(archive) > MAX_ARTICLE_ARCHIVE_BYTES) fail('ARTICLE_ARCHIVE_TOO_LARGE');
    return archive;
  }

  function createArticleArchive(input = {}) {
    const identity = isPlainObject(input.identity) ? input.identity : {};
    const documentRecord = sanitizePortableValue(input.documentRecord || {});
    const documentId = normalizeDocumentId(identity.documentId || documentRecord.documentId);
    if (!isPlainObject(documentRecord) ||
        normalizeDocumentId(documentRecord.documentId) !== documentId) {
      fail('ARCHIVE_IDENTITY_MISMATCH');
    }
    const documentHash = boundedString(
      identity.documentHash || documentRecord.documentHash || '', 200
    );
    const canonicalUrl = normalizeUrl(
      identity.canonicalUrl || documentRecord.canonicalUrl || ''
    );
    return validateArticleArchive({
      schemaVersion: ARTICLE_ARCHIVE_SCHEMA_VERSION,
      kind: ARTICLE_ARCHIVE_KIND,
      revision: Number(input.revision) || 1,
      savedAt: input.savedAt || new Date().toISOString(),
      extensionVersion: input.extensionVersion || '',
      documentId,
      documentHash,
      canonicalUrl,
      title: identity.title || documentRecord.title || '',
      publisher: identity.publisher || '',
      documentRecord,
      workspace: portableWorkspaceFromLiveFigureDraft(input.workspace || {}, {
        documentId, documentHash, canonicalUrl
      })
    });
  }

  function markArticleArchiveAsExternalImport(input) {
    const archive = validateArticleArchive(input);
    const chat = archive.workspace?.chat;
    if (isPlainObject(chat) && Array.isArray(chat.turns)) {
      for (const turn of chat.turns) {
        if (isPlainObject(turn) && hasReadablePortableAnswer(turn)) {
          turn.answerProvenance = { ...EXTERNAL_IMPORT_ANSWER_PROVENANCE };
        }
      }
    }
    if (isPlainObject(chat) && Array.isArray(chat.messages)) {
      for (const message of chat.messages) {
        if (isPlainObject(message) && ownData(message, 'role') === 'assistant' &&
            String(ownData(message, 'content') || '').trim()) {
          message.answerProvenance = { ...EXTERNAL_IMPORT_ANSWER_PROVENANCE };
        }
      }
    }
    return validateArticleArchive(archive);
  }

  async function convertLegacyArticleArchiveToWorkspace(input) {
    const archive = validateArticleArchive(input);
    if (typeof shared.createArticleWorkspaceIdentity !== 'function' ||
        typeof shared.createWorkspaceManifest !== 'function') {
      fail('WORKSPACE_CONVERTER_UNAVAILABLE');
    }
    const workspace = await shared.createArticleWorkspaceIdentity({
      canonicalUrl: archive.canonicalUrl,
      doi: archive.documentRecord?.doi,
      siteId: archive.documentRecord?.siteId || archive.documentRecord?.publisherId,
      title: archive.title || archive.documentRecord?.title,
      content: JSON.stringify({
        documentHash: archive.documentHash,
        paragraphs: archive.workspace?.llm?.paragraphs || []
      })
    });
    workspace.storageRevision = archive.revision;
    workspace.workspaceGeneration = 1;
    workspace.createdAt = archive.savedAt;
    workspace.updatedAt = archive.savedAt;
    const relativePath = 'legacy/archive.json';
    const asset = {
      path: relativePath,
      type: 'json',
      revision: archive.revision,
      contentHash: typeof shared.stableHash === 'function'
        ? shared.stableHash(archive) : String(archive.revision),
      updatedAt: archive.savedAt,
      value: archive
    };
    return {
      workspace,
      manifest: shared.createWorkspaceManifest(workspace, [asset]),
      assets: [asset],
      legacy: {
        relativePath: articleArchiveRelativePath(archive),
        deleteAfterImport: false
      }
    };
  }

  return {
    ARTICLE_ARCHIVE_KIND,
    ARTICLE_ARCHIVE_SCHEMA_VERSION,
    MAX_ARTICLE_ARCHIVE_BYTES,
    articleArchiveRelativePath,
    createArticleArchive,
    validateArticleArchive,
    markArticleArchiveAsExternalImport,
    convertLegacyArticleArchiveToWorkspace
  };
});
