(function attach(root, factory) {
  const api = factory(root.SciLLM || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory(shared) {
  const USER_DATA_DATABASE_NAME = shared.USER_DATA_DATABASE_NAME || 'sci-logic-highlighter-user-data';
  const USER_DATA_DATABASE_VERSION = shared.USER_DATA_DATABASE_VERSION || 4;
  const DOCUMENT_STORE_NAME = 'documents';
  const META_STORE_NAME = 'meta';
  const DIRECTORY_HANDLE_STORE_NAME = 'directoryHandles';
  const SYNC_QUEUE_STORE_NAME = 'syncQueue';
  const ROOT_DIRECTORY_NAME = 'Brevess';
  // Keep reading the pre-1.0 directory so an upgrade never strands existing workspaces.
  const LEGACY_ROOT_DIRECTORY_NAME = 'SCI-Highlighter';
  const WORKSPACE_INDEX_PATH = 'workspace-index.json';
  const WORKSPACE_ROOT_PATH = 'workspaces';
  const PORTABLE_CONFIG_PATH = shared.PORTABLE_CONFIG_PATH ||
    'settings/portable-config.enc.json';
  const HANDLE_KEY = 'selected-directory';
  const META_KEY = 'meta';
  const MAX_ERROR_LENGTH = 240;
  const MAX_CONFLICTS = 50;
  let privacy = shared;
  if (typeof privacy.isExportSensitiveKey !== 'function' && typeof require === 'function') {
    try { privacy = require('./privacy-sanitizer.js'); } catch (_) {}
  }
  if (typeof privacy.isExportSensitiveKey !== 'function') {
    const error = new Error('PRIVACY_SANITIZER_UNAVAILABLE');
    error.code = 'PRIVACY_SANITIZER_UNAVAILABLE';
    throw error;
  }
  const FORBIDDEN_EXPORT_KEYS = new Set([
    'analysiscache', 'directoryhandle', 'directoryhandles', 'syncqueue',
    'cachestore', 'handlestore'
  ]);

  function forbiddenExportKey(value) {
    const key = String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    return privacy.isExportSensitiveKey(value) ||
      FORBIDDEN_EXPORT_KEYS.has(key) ||
      key.endsWith('cache') || key.endsWith('caches') ||
      key.endsWith('handle') || key.endsWith('handles') ||
      key.includes('syncqueue');
  }

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

  function cloneJsonLike(value) {
    if (Array.isArray(value)) return value.map(cloneJsonLike);
    if (!isPlainObject(value)) return value;
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, cloneJsonLike(item)])
    );
  }

  function sanitizeValue(value) {
    if (Array.isArray(value)) return value.map(sanitizeValue);
    if (!isPlainObject(value)) return value;
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !forbiddenExportKey(key))
        .map(([key, item]) => [key, sanitizeValue(item)])
    );
  }

  function stableValue(value) {
    if (Array.isArray(value)) return value.map(stableValue);
    if (!isPlainObject(value)) return value;
    return Object.fromEntries(
      Object.keys(value).sort().map(key => [key, stableValue(value[key])])
    );
  }

  function stableStringify(value) {
    return JSON.stringify(stableValue(value));
  }

  function contentHash(content) {
    let hash = 2166136261;
    const text = String(content || '');
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }

  function normalizeRelativePath(value, { internal = false } = {}) {
    const raw = String(value || '').normalize('NFKC').trim().replace(/\\/g, '/');
    if (!raw || raw.length > 500 || raw.startsWith('/') ||
        /^[a-z][a-z0-9+.-]*:/i.test(raw) || /[\u0000-\u001f]/u.test(raw)) {
      fail('INVALID_RELATIVE_PATH');
    }
    const parts = raw.split('/').filter(Boolean);
    if (!parts.length || parts.some(part =>
      part === '.' || part === '..' || part.length > 180 || /[:*?"<>|]/u.test(part)
    )) fail('INVALID_RELATIVE_PATH');
    const normalized = parts.join('/');
    if (!internal && (
      normalized === 'index.json' || normalized.startsWith('backups/') ||
      normalized.startsWith('conflicts/')
    )) fail('INVALID_RELATIVE_PATH');
    return normalized;
  }

  function assertOrdinaryQueuePath(relativePath) {
    if (relativePath === PORTABLE_CONFIG_PATH) {
      fail('PORTABLE_CONFIG_REQUIRES_CAS');
    }
    return relativePath;
  }

  function validateRevision(value) {
    const revision = Number(value);
    if (!Number.isSafeInteger(revision) || revision < 0) fail('INVALID_REVISION');
    return revision;
  }

  function validateJsonAsset(value) {
    if (!isPlainObject(value) || value.schemaVersion !== 1) fail('INVALID_SCHEMA_VERSION');
    validateRevision(value.revision);
    return value;
  }

  function parseValidJson(content) {
    if (typeof content !== 'string' || !content.trim()) return null;
    try {
      return validateJsonAsset(JSON.parse(content));
    } catch (_) {
      return null;
    }
  }

  function defaultMeta() {
    return {
      pendingSequence: 0,
      conflictCount: 0,
      conflicts: [],
      lastConflict: null,
      lastError: '',
      lastErrorCode: '',
      lastErrorName: '',
      lastErrorPath: '',
      requiresReauthorization: false,
      requiresReselection: false,
      lastSyncAt: ''
    };
  }

  function createMemoryDirectoryHandleStore(initialHandle = null) {
    let handle = initialHandle;
    return {
      async load() { return handle; },
      async save(nextHandle) { handle = nextHandle || null; return handle; }
    };
  }

  function createMemorySyncQueue() {
    const pending = new Map();
    let meta = defaultMeta();
    let mutationTail = Promise.resolve();
    const serialize = operation => {
      const result = mutationTail.then(operation, operation);
      mutationTail = result.catch(() => undefined);
      return result;
    };
    return {
      async put(input) {
        return serialize(async () => {
          meta.pendingSequence += 1;
          const item = {
            ...cloneJsonLike(input),
            relativePath: String(input.relativePath),
            queueRevision: meta.pendingSequence
          };
          pending.set(item.relativePath, item);
          return cloneJsonLike(item);
        });
      },
      async get(relativePath) {
        await mutationTail;
        const item = pending.get(String(relativePath));
        return item ? cloneJsonLike(item) : null;
      },
      async getAll() {
        await mutationTail;
        return [...pending.values()].map(cloneJsonLike)
          .sort((first, second) => first.queueRevision - second.queueRevision);
      },
      async remove(relativePath, expectedQueueRevision) {
        return serialize(async () => {
          const current = pending.get(String(relativePath));
          if (!current || current.queueRevision !== expectedQueueRevision) return false;
          pending.delete(String(relativePath));
          return true;
        });
      },
      async getMeta() {
        await mutationTail;
        return cloneJsonLike(meta);
      },
      async setMeta(patch) {
        return serialize(async () => {
          meta = { ...meta, ...cloneJsonLike(patch) };
          return cloneJsonLike(meta);
        });
      }
    };
  }

  function requestToPromise(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function transactionDone(transaction) {
    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error('IndexedDB transaction failed'));
      transaction.onabort = () => reject(transaction.error || new Error('IndexedDB transaction aborted'));
    });
  }

  function createDatabaseOpener(indexedDbRef) {
    return function openDatabase() {
      if (typeof shared.openUserDataDatabase !== 'function') {
        return Promise.reject(new Error('USER_DATA_DATABASE_UNAVAILABLE'));
      }
      return shared.openUserDataDatabase(indexedDbRef);
    };
  }

  function createIndexedDbDirectoryHandleStore(indexedDbRef) {
    const openDatabase = createDatabaseOpener(indexedDbRef);
    async function load() {
      const database = await openDatabase();
      const transaction = database.transaction(DIRECTORY_HANDLE_STORE_NAME, 'readonly');
      const record = await requestToPromise(
        transaction.objectStore(DIRECTORY_HANDLE_STORE_NAME).get(HANDLE_KEY)
      );
      await transactionDone(transaction);
      return record?.handle || null;
    }
    async function save(handle) {
      const database = await openDatabase();
      const transaction = database.transaction(DIRECTORY_HANDLE_STORE_NAME, 'readwrite');
      transaction.objectStore(DIRECTORY_HANDLE_STORE_NAME).put({ key: HANDLE_KEY, handle });
      await transactionDone(transaction);
      return handle;
    }
    return { load, save };
  }

  function createIndexedDbSyncQueue(indexedDbRef) {
    const openDatabase = createDatabaseOpener(indexedDbRef);
    let mutationTail = Promise.resolve();
    const serialize = operation => {
      const result = mutationTail.then(operation, operation);
      mutationTail = result.catch(() => undefined);
      return result;
    };
    async function readRecord(key) {
      await mutationTail;
      const database = await openDatabase();
      const transaction = database.transaction(SYNC_QUEUE_STORE_NAME, 'readonly');
      const record = await requestToPromise(transaction.objectStore(SYNC_QUEUE_STORE_NAME).get(key));
      await transactionDone(transaction);
      return record || null;
    }
    async function put(input) {
      return serialize(async () => {
        const database = await openDatabase();
        const transaction = database.transaction(SYNC_QUEUE_STORE_NAME, 'readwrite');
        const store = transaction.objectStore(SYNC_QUEUE_STORE_NAME);
        const meta = (await requestToPromise(store.get(META_KEY))) || { key: META_KEY, ...defaultMeta() };
        meta.pendingSequence += 1;
        const item = {
          ...cloneJsonLike(input),
          key: `pending:${input.relativePath}`,
          kind: 'pending',
          relativePath: String(input.relativePath),
          queueRevision: meta.pendingSequence
        };
        store.put(item);
        store.put(meta);
        await transactionDone(transaction);
        return cloneJsonLike(item);
      });
    }
    async function get(relativePath) {
      return cloneJsonLike(await readRecord(`pending:${relativePath}`));
    }
    async function getAll() {
      await mutationTail;
      const database = await openDatabase();
      const transaction = database.transaction(SYNC_QUEUE_STORE_NAME, 'readonly');
      const records = await requestToPromise(transaction.objectStore(SYNC_QUEUE_STORE_NAME).getAll());
      await transactionDone(transaction);
      return records.filter(item => item.kind === 'pending').map(cloneJsonLike)
        .sort((first, second) => first.queueRevision - second.queueRevision);
    }
    async function remove(relativePath, expectedQueueRevision) {
      return serialize(async () => {
        const database = await openDatabase();
        const transaction = database.transaction(SYNC_QUEUE_STORE_NAME, 'readwrite');
        const store = transaction.objectStore(SYNC_QUEUE_STORE_NAME);
        const key = `pending:${relativePath}`;
        const current = await requestToPromise(store.get(key));
        if (!current || current.queueRevision !== expectedQueueRevision) {
          await transactionDone(transaction);
          return false;
        }
        store.delete(key);
        await transactionDone(transaction);
        return true;
      });
    }
    async function getMeta() {
      const record = await readRecord(META_KEY);
      return { ...defaultMeta(), ...(record || {}) };
    }
    async function setMeta(patch) {
      return serialize(async () => {
        const database = await openDatabase();
        const transaction = database.transaction(SYNC_QUEUE_STORE_NAME, 'readwrite');
        const store = transaction.objectStore(SYNC_QUEUE_STORE_NAME);
        const current = (await requestToPromise(store.get(META_KEY))) || {
          key: META_KEY, ...defaultMeta()
        };
        const next = { ...current, ...cloneJsonLike(patch), key: META_KEY };
        store.put(next);
        await transactionDone(transaction);
        return cloneJsonLike(next);
      });
    }
    return { put, get, getAll, remove, getMeta, setMeta };
  }

  function saveDirectoryHandle(indexedDbRef, handle) {
    return createIndexedDbDirectoryHandleStore(indexedDbRef).save(handle);
  }

  function loadDirectoryHandle(indexedDbRef) {
    return createIndexedDbDirectoryHandleStore(indexedDbRef).load();
  }

  function backupRelativePath(relativePath) {
    const path = normalizeRelativePath(relativePath, { internal: true });
    const slash = path.lastIndexOf('/');
    const directory = slash >= 0 ? `${path.slice(0, slash + 1)}` : '';
    const filename = slash >= 0 ? path.slice(slash + 1) : path;
    const dot = filename.lastIndexOf('.');
    const stem = dot > 0 ? filename.slice(0, dot) : filename;
    const extension = dot > 0 ? filename.slice(dot) : '.txt';
    return `backups/${directory}${stem}.previous${extension}`;
  }

  function conflictRelativePath(relativePath, revision, sourceId) {
    const path = normalizeRelativePath(relativePath, { internal: true });
    const slash = path.lastIndexOf('/');
    const directory = slash >= 0 ? `${path.slice(0, slash + 1)}` : '';
    const filename = slash >= 0 ? path.slice(slash + 1) : path;
    const dot = filename.lastIndexOf('.');
    const stem = dot > 0 ? filename.slice(0, dot) : filename;
    const extension = dot > 0 ? filename.slice(dot) : '.txt';
    const safeSource = String(sourceId || 'unknown').replace(/[^a-z0-9_-]/gi, '_').slice(0, 40);
    return `conflicts/${directory}${stem}.r${revision}.${safeSource}${extension}`;
  }

  async function getRootDirectory(handle, create) {
    try {
      return await handle.getDirectoryHandle(ROOT_DIRECTORY_NAME, { create: false });
    } catch (error) {
      if (error?.name !== 'NotFoundError') throw error;
    }
    try {
      return await handle.getDirectoryHandle(LEGACY_ROOT_DIRECTORY_NAME, { create: false });
    } catch (error) {
      if (error?.name !== 'NotFoundError') throw error;
    }
    return handle.getDirectoryHandle(ROOT_DIRECTORY_NAME, { create });
  }

  async function getFileHandle(root, relativePath, create) {
    const parts = normalizeRelativePath(relativePath, { internal: true }).split('/');
    const filename = parts.pop();
    let directory = root;
    for (const part of parts) {
      directory = await directory.getDirectoryHandle(part, { create });
    }
    return directory.getFileHandle(filename, { create });
  }

  async function getDirectoryAtPath(root, relativePath) {
    const parts = normalizeRelativePath(relativePath, { internal: true }).split('/');
    let directory = root;
    for (const part of parts) {
      directory = await directory.getDirectoryHandle(part, { create: false });
    }
    return directory;
  }

  async function readText(root, relativePath) {
    try {
      const handle = await getFileHandle(root, relativePath, false);
      return await (await handle.getFile()).text();
    } catch (error) {
      if (error?.name === 'NotFoundError') return null;
      throw error;
    }
  }

  async function writeText(root, relativePath, content) {
    const retryableNames = new Set([
      'AbortError', 'InvalidStateError', 'NoModificationAllowedError',
      'OperationError', 'UnknownError'
    ]);
    let lastError = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      let writable = null;
      try {
        const handle = await getFileHandle(root, relativePath, true);
        writable = await handle.createWritable();
        await writable.write(String(content));
        await writable.close();
        return;
      } catch (error) {
        lastError = error;
        await writable?.abort?.().catch?.(() => undefined);
        if (!retryableNames.has(String(error?.name || '')) || attempt >= 2) {
          throw error;
        }
        await new Promise(resolve => setTimeout(resolve, 40 * (attempt + 1)));
      }
    }
    throw lastError || new Error('DIRECTORY_WRITE_FAILED');
  }

  function workspaceManifest(input, assets) {
    if (typeof shared.validateWorkspaceManifest !== 'function' ||
        typeof shared.createWorkspaceManifest !== 'function') {
      fail('WORKSPACE_SCHEMA_UNAVAILABLE');
    }
    if (input?.kind === shared.WORKSPACE_MANIFEST_KIND) {
      return shared.validateWorkspaceManifest(input);
    }
    return shared.createWorkspaceManifest(input, assets || []);
  }

  function workspaceDirectory(input) {
    const manifest = workspaceManifest(input);
    return {
      manifest,
      rootPath: `${WORKSPACE_ROOT_PATH}/${manifest.directoryName}`,
      manifestPath: `${WORKSPACE_ROOT_PATH}/${manifest.directoryName}/manifest.json`
    };
  }

  function workspaceAssetPath(input, relativePath) {
    const location = workspaceDirectory(input);
    const assetPath = shared.normalizeWorkspaceRelativePath(relativePath);
    if (assetPath === 'manifest.json') fail('INVALID_WORKSPACE_ASSET_PATH');
    return { ...location, assetPath, fullPath: `${location.rootPath}/${assetPath}` };
  }

  function workspaceIndexWithManifest(indexInput, manifestInput, revision) {
    const manifest = shared.validateWorkspaceManifest(manifestInput);
    const current = indexInput && Array.isArray(indexInput.workspaces)
      ? shared.validateWorkspaceIndex(indexInput)
      : shared.createWorkspaceIndex([]);
    const entry = shared.createWorkspaceIndex([manifest]).workspaces[0];
    const workspaces = current.workspaces.filter(item => item.workspaceId !== manifest.workspaceId);
    workspaces.push(entry);
    workspaces.sort((first, second) => first.workspaceId.localeCompare(second.workspaceId));
    return shared.validateWorkspaceIndex({
      schemaVersion: 1,
      kind: shared.WORKSPACE_INDEX_KIND,
      revision: Math.max(Number(current.revision || 0) + 1, Number(revision || 0)),
      updatedAt: manifest.updatedAt || new Date().toISOString(),
      workspaces
    });
  }

  function compareWorkspaceIndexEntries(left, right) {
    const fields = ['workspaceGeneration', 'revision'];
    for (const field of fields) {
      const difference = (Number(left?.[field]) || 0) - (Number(right?.[field]) || 0);
      if (difference) return difference;
    }
    const updatedDifference = String(left?.updatedAt || '')
      .localeCompare(String(right?.updatedAt || ''));
    if (updatedDifference) return updatedDifference;
    return String(left?.contentHash || '').localeCompare(String(right?.contentHash || ''));
  }

  function mergeWorkspaceIndexes(existingInput, incomingInput) {
    const existing = shared.validateWorkspaceIndex(existingInput);
    const incoming = shared.validateWorkspaceIndex(incomingInput);
    const entries = new Map();
    for (const entry of [...existing.workspaces, ...incoming.workspaces]) {
      const current = entries.get(entry.workspaceId);
      if (!current || compareWorkspaceIndexEntries(entry, current) >= 0) {
        entries.set(entry.workspaceId, entry);
      }
    }
    return shared.validateWorkspaceIndex({
      schemaVersion: 1,
      kind: shared.WORKSPACE_INDEX_KIND,
      revision: Math.max(existing.revision, incoming.revision) + 1,
      updatedAt: new Date().toISOString(),
      workspaces: [...entries.values()]
    });
  }

  function validIndex(value) {
    if (!isPlainObject(value) || value.schemaVersion !== 1 || !Array.isArray(value.assets)) {
      fail('INVALID_INDEX');
    }
    const assets = [];
    let invalidAssets = 0;
    value.assets.forEach(asset => {
      try {
        if (!isPlainObject(asset)) fail('INVALID_INDEX_ASSET');
        const path = normalizeRelativePath(asset.path);
        const allowed = path === 'categories.json' ||
          /^annotations\/[^/]+\.json$/u.test(path) ||
          /^articles\/[a-f0-9]{8}\.json$/u.test(path) ||
          path === WORKSPACE_INDEX_PATH ||
          /^workspaces\/[^/]+\/.+/u.test(path) ||
          path === 'corpus/feedback.jsonl';
        if (!allowed) fail('INVALID_INDEX_ASSET');
        assets.push({
          path,
          revision: validateRevision(asset.revision),
          type: asset.type === 'text' ? 'text' : 'json',
          sourceId: String(asset.sourceId || ''),
          contentHash: String(asset.contentHash || '')
        });
      } catch (_) {
        invalidAssets += 1;
      }
    });
    const revision = value.revision === undefined ? 0 : validateRevision(value.revision);
    return { schemaVersion: 1, revision, assets, invalidAssets };
  }

  function createDirectorySync({
    handleStore = createMemoryDirectoryHandleStore(),
    queueStore = createMemorySyncQueue(),
    sourceId = 'extension',
    assetImporter = async () => ({ imported: false, reason: 'unsupported' }),
    bundleExporter = async () => ({ schemaVersion: 1 })
  } = {}) {
    let activeFlush = null;
    let rerunRequested = false;
    let rerunImporter = null;
    let workspaceMutationTail = Promise.resolve();
    const directJsonMutationTails = new Map();

    function serializeWorkspaceMutation(operation) {
      const result = workspaceMutationTail.then(operation, operation);
      workspaceMutationTail = result.catch(() => undefined);
      return result;
    }

    function serializeDirectJsonMutation(relativePath, operation) {
      const previous = directJsonMutationTails.get(relativePath) || Promise.resolve();
      const result = previous.then(operation, operation);
      const settled = result.catch(() => undefined);
      directJsonMutationTails.set(relativePath, settled);
      settled.then(() => {
        if (directJsonMutationTails.get(relativePath) === settled) {
          directJsonMutationTails.delete(relativePath);
        }
      });
      return result;
    }

    function directoryError(code, details = {}) {
      const error = new Error(code);
      error.code = code;
      Object.assign(error, details);
      return error;
    }

    async function discardQueuedPortableConfig() {
      while (true) {
        const queued = await queueStore.get(PORTABLE_CONFIG_PATH);
        if (!queued) return false;
        if (await queueStore.remove(PORTABLE_CONFIG_PATH, queued.queueRevision)) {
          return true;
        }
      }
    }

    function validatePortableCasEnvelope(input) {
      if (typeof shared.validatePortableEnvelope !== 'function') {
        fail('PORTABLE_CONFIG_SCHEMA_UNAVAILABLE');
      }
      try {
        return shared.validatePortableEnvelope(cloneJsonLike(input));
      } catch (error) {
        if (error?.code === 'PORTABLE_CONFIG_ENVELOPE_FIELDS_INVALID') {
          fail('PORTABLE_CONFIG_ENVELOPE_UNSAFE');
        }
        throw error;
      }
    }

    async function compareAndSwapJson(relativePath, input, options = {}) {
      const normalizedPath = normalizeRelativePath(relativePath);
      if (normalizedPath !== PORTABLE_CONFIG_PATH) {
        fail('DIRECTORY_CAS_PATH_UNSUPPORTED');
      }
      const mode = options.mode === 'create' ? 'create' :
        (options.mode === 'update' ? 'update' : '');
      if (!mode) fail('DIRECTORY_CAS_MODE_INVALID');
      const incoming = validatePortableCasEnvelope(input);
      const expected = mode === 'update'
        ? validatePortableCasEnvelope(options.expected) : null;
      if (mode === 'update' && (
        incoming.backupId !== expected.backupId ||
        incoming.revision !== expected.revision + 1
      )) fail('DIRECTORY_CAS_UPDATE_INVALID');

      return serializeDirectJsonMutation(normalizedPath, async () => {
        await discardQueuedPortableConfig();
        const handle = await handleStore.load();
        const permission = await permissionState(handle);
        if (!handle || permission !== 'granted') {
          throw directoryError('DIRECTORY_PERMISSION_REQUIRED', { permission });
        }
        let root = null;
        try {
          root = await getRootDirectory(handle, mode === 'create');
        } catch (error) {
          if (error?.name !== 'NotFoundError') throw error;
        }
        let content = null;
        if (root) content = await readText(root, normalizedPath);

        if (mode === 'create') {
          if (content !== null) {
            throw directoryError('DIRECTORY_CAS_CONFLICT', {
              mode, expectedRevision: null, actualRevision: null
            });
          }
          if (!root) root = await getRootDirectory(handle, true);
        } else {
          if (content === null) {
            throw directoryError('DIRECTORY_CAS_CONFLICT', {
              mode, expectedRevision: expected.revision, actualRevision: null
            });
          }
          let current;
          try {
            current = validatePortableCasEnvelope(JSON.parse(content));
          } catch (_) {
            throw directoryError('DIRECTORY_CAS_CURRENT_INVALID', {
              mode, expectedRevision: expected.revision
            });
          }
          if (stableStringify(current) !== stableStringify(expected)) {
            throw directoryError('DIRECTORY_CAS_CONFLICT', {
              mode,
              expectedRevision: expected.revision,
              actualRevision: current.revision
            });
          }
          await writeText(root, backupRelativePath(normalizedPath),
            `${JSON.stringify(stableValue(current), null, 2)}\n`);
        }

        await writeText(root, normalizedPath,
          `${JSON.stringify(stableValue(incoming), null, 2)}\n`);
        return {
          committed: true,
          permission: 'granted',
          mode,
          revision: incoming.revision,
          previousRevision: expected ? expected.revision : null
        };
      });
    }

    async function permissionState(handle) {
      if (!handle) return 'unconfigured';
      try {
        return await handle.queryPermission({ mode: 'readwrite' });
      } catch (_) {
        return 'unknown';
      }
    }

    async function saveDirectoryHandleMethod(handle) {
      if (!handle || typeof handle.getDirectoryHandle !== 'function') fail('INVALID_DIRECTORY_HANDLE');
      await handleStore.save(handle);
      return { name: String(handle.name || ''), permission: await permissionState(handle) };
    }

    async function getDirectoryHandleMethod() {
      return handleStore.load();
    }

    async function requestDirectoryPermission() {
      const handle = await handleStore.load();
      if (!handle) return { permission: 'unconfigured', granted: false };
      let permission = await permissionState(handle);
      if (permission !== 'granted' && typeof handle.requestPermission === 'function') {
        try {
          permission = await handle.requestPermission({ mode: 'readwrite' });
        } catch (_) {
          permission = await permissionState(handle);
        }
      }
      return { permission, granted: permission === 'granted' };
    }

    async function enqueueJson(relativePath, input) {
      const path = assertOrdinaryQueuePath(normalizeRelativePath(relativePath));
      const sanitized = sanitizeValue(cloneJsonLike(input));
      validateJsonAsset(sanitized);
      if (!sanitized.sourceId) sanitized.sourceId = sourceId;
      const content = `${JSON.stringify(stableValue(sanitized), null, 2)}\n`;
      return queueStore.put({
        relativePath: path,
        type: 'json',
        content,
        revision: sanitized.revision,
        sourceId: String(sanitized.sourceId),
        contentHash: contentHash(stableStringify(sanitized))
      });
    }

    async function enqueueText(relativePath, value) {
      const path = assertOrdinaryQueuePath(normalizeRelativePath(relativePath));
      const previous = await queueStore.get(path);
      const revision = Math.max(Date.now(), Number(previous?.revision || 0) + 1);
      const content = String(value ?? '');
      return queueStore.put({
        relativePath: path,
        type: 'text',
        content,
        revision,
        sourceId,
        contentHash: contentHash(content)
      });
    }

    async function enqueueWorkspaceJson(relativePath, input) {
      const path = assertOrdinaryQueuePath(normalizeRelativePath(relativePath));
      if (typeof shared.assertWorkspaceSafeValue !== 'function') {
        fail('WORKSPACE_SCHEMA_UNAVAILABLE');
      }
      shared.assertWorkspaceSafeValue(input);
      const value = cloneJsonLike(input);
      validateJsonAsset(value);
      const content = `${JSON.stringify(stableValue(value), null, 2)}\n`;
      return queueStore.put({
        relativePath: path,
        type: 'json',
        content,
        revision: value.revision,
        sourceId: String(value.sourceId || sourceId),
        contentHash: contentHash(stableStringify(value))
      });
    }

    async function readQueuedOrDiskJson(relativePath) {
      const queued = await queueStore.get(relativePath);
      if (queued?.content) {
        try { return JSON.parse(queued.content); } catch (_) { fail('INVALID_JSON_ASSET'); }
      }
      const handle = await handleStore.load();
      if (!handle || await permissionState(handle) !== 'granted') return null;
      let root;
      try { root = await getRootDirectory(handle, false); } catch (error) {
        if (error?.name === 'NotFoundError') return null;
        throw error;
      }
      const content = await readText(root, relativePath);
      if (content === null) return null;
      try { return JSON.parse(content); } catch (_) { fail('INVALID_JSON_ASSET'); }
    }

    async function enqueueWorkspaceAssetNow(workspaceInput, relativePath, input, metadata = {}) {
      const location = workspaceAssetPath(workspaceInput, relativePath);
      const baseManifest = location.manifest;
      if (baseManifest.workspaceGeneration !== (metadata.workspaceGeneration ??
          baseManifest.workspaceGeneration)) fail('WORKSPACE_GENERATION_CONFLICT');
      if (typeof shared.assertWorkspaceSafeValue !== 'function') {
        fail('WORKSPACE_SCHEMA_UNAVAILABLE');
      }
      shared.assertWorkspaceSafeValue(input);
      const data = cloneJsonLike(input);
      const requestedRevision = validateRevision(metadata.revision ?? Date.now());
      const existingAsset = await readQueuedOrDiskJson(location.fullPath);
      const existingAssetMatches = existingAsset &&
        existingAsset.kind === 'sci-logic-highlighter-workspace-asset' &&
        existingAsset.workspaceId === baseManifest.workspaceId &&
        existingAsset.relativePath === location.assetPath;
      const existingGenerationMatches = existingAssetMatches &&
        Number(existingAsset.workspaceGeneration) ===
          Number(baseManifest.workspaceGeneration);
      const existingDataMatches = existingAssetMatches &&
        stableStringify(existingAsset.data) === stableStringify(data);
      const reuseExistingEnvelope = existingGenerationMatches && existingDataMatches;
      const advanceFromDirectory = metadata.advanceFromDirectory === true;
      // A directory restore may import content without preserving the envelope
      // revision in IndexedDB. Any subsequent real local mutation must advance
      // beyond the newest queued/disk envelope; otherwise flush sees a newer
      // primary and leaves the save permanently stuck as
      // DIRECTORY_VERSION_NEWER.
      const revision = reuseExistingEnvelope
        ? validateRevision(existingAsset.revision)
        : existingAssetMatches && advanceFromDirectory
        ? Math.max(requestedRevision, validateRevision(existingAsset.revision) + 1)
        : requestedRevision;
      const timestamp = String(reuseExistingEnvelope
        ? existingAsset.updatedAt
        : metadata.updatedAt || new Date().toISOString());
      const dataHash = String(reuseExistingEnvelope
        ? existingAsset.contentHash
        : metadata.contentHash || contentHash(stableStringify(data)));
      const envelope = {
        schemaVersion: 1,
        kind: 'sci-logic-highlighter-workspace-asset',
        revision,
        updatedAt: timestamp,
        contentHash: dataHash,
        sourceId: String(reuseExistingEnvelope
          ? existingAsset.sourceId
          : metadata.sourceId || sourceId),
        workspaceId: baseManifest.workspaceId,
        workspaceGeneration: baseManifest.workspaceGeneration,
        relativePath: location.assetPath,
        data
      };
      const assetQueued = await enqueueWorkspaceJson(location.fullPath, envelope);

      let existingManifest = null;
      const manifestValue = await readQueuedOrDiskJson(location.manifestPath);
      if (manifestValue) existingManifest = shared.validateWorkspaceManifest(manifestValue);
      if (existingManifest && (existingManifest.workspaceId !== baseManifest.workspaceId ||
          existingManifest.workspaceGeneration !== baseManifest.workspaceGeneration)) {
        fail('WORKSPACE_MANIFEST_CONFLICT');
      }
      const assets = (existingManifest?.assets || baseManifest.assets)
        .filter(asset => asset.path !== location.assetPath);
      assets.push({
        path: location.assetPath,
        type: 'json',
        revision,
        contentHash: dataHash,
        updatedAt: timestamp
      });
      const manifestRevision = Math.max(
        Number(existingManifest?.revision || 0) + 1,
        Number(baseManifest.revision || 0), revision
      );
      const manifest = shared.createWorkspaceManifest({
        ...(existingManifest || baseManifest),
        ...baseManifest,
        storageRevision: manifestRevision,
        updatedAt: timestamp
      }, assets);
      const manifestQueued = await enqueueWorkspaceJson(location.manifestPath, manifest);

      const indexValue = await readQueuedOrDiskJson(WORKSPACE_INDEX_PATH);
      let index = null;
      if (indexValue) index = shared.validateWorkspaceIndex(indexValue);
      const workspaceIndex = workspaceIndexWithManifest(index, manifest, manifestRevision);
      const indexQueued = await enqueueWorkspaceJson(WORKSPACE_INDEX_PATH, workspaceIndex);
      return {
        queued: true,
        relativePath: location.fullPath,
        manifestPath: location.manifestPath,
        revision,
        queueRevisions: [
          assetQueued.queueRevision, manifestQueued.queueRevision, indexQueued.queueRevision
        ]
      };
    }

    function enqueueWorkspaceAsset(workspaceInput, relativePath, input, metadata = {}) {
      return serializeWorkspaceMutation(() =>
        enqueueWorkspaceAssetNow(workspaceInput, relativePath, input, metadata));
    }

    async function readWorkspaceAsset(workspaceInput, relativePath) {
      const location = workspaceAssetPath(workspaceInput, relativePath);
      const result = await readJson(location.fullPath);
      if (!result.found) return result;
      const value = result.value;
      if (value.kind !== 'sci-logic-highlighter-workspace-asset' ||
          value.workspaceId !== location.manifest.workspaceId ||
          value.relativePath !== location.assetPath ||
          value.workspaceGeneration !== location.manifest.workspaceGeneration) {
        fail('WORKSPACE_ASSET_IDENTITY_MISMATCH');
      }
      return result;
    }

    async function listWorkspaceChatAssets(workspaceInput) {
      const location = workspaceDirectory(workspaceInput);
      const handle = await handleStore.load();
      const permission = await permissionState(handle);
      if (!handle || permission !== 'granted') {
        return { permission, assets: [], invalidAssets: 0 };
      }
      let root;
      try {
        root = await getRootDirectory(handle, false);
      } catch (error) {
        if (error?.name === 'NotFoundError') {
          return { permission, assets: [], invalidAssets: 0 };
        }
        throw error;
      }
      const assets = [];
      let invalidAssets = 0;
      let recoveredGenerationMismatches = 0;
      const manifestGeneration = Number(location.manifest.workspaceGeneration) || 1;
      const timestamp = value => {
        if (Number.isFinite(Number(value)) && Number(value) > 1_000_000_000_000) {
          return Number(value);
        }
        const parsed = Date.parse(String(value || ''));
        return Number.isFinite(parsed) ? parsed : 0;
      };
      const manifestUpdatedAt = timestamp(location.manifest.updatedAt);
      const acceptEnvelope = (envelope, relativePath) => {
        const envelopeGeneration = Number(envelope?.workspaceGeneration) || 1;
        const envelopeUpdatedAt = Math.max(
          timestamp(envelope?.updatedAt),
          timestamp(envelope?.data?.updatedAt)
        );
        const generationMatches = envelopeGeneration === manifestGeneration;
        // Older builds could keep writing a live chat with generation N after
        // the manifest had already advanced to N+1. Recover only records that
        // are demonstrably newer than that manifest; genuinely stale,
        // pre-clear records remain rejected.
        const recoverableGenerationLag = envelopeGeneration < manifestGeneration &&
          envelopeUpdatedAt > manifestUpdatedAt;
        if (!isPlainObject(envelope) ||
            envelope.kind !== 'sci-logic-highlighter-workspace-asset' ||
            envelope.workspaceId !== location.manifest.workspaceId ||
            (!generationMatches && !recoverableGenerationLag) ||
            envelope.relativePath !== relativePath ||
            envelope.data === undefined) {
          fail('WORKSPACE_ASSET_IDENTITY_MISMATCH');
        }
        shared.assertWorkspaceSafeValue?.(envelope.data);
        if (recoverableGenerationLag) recoveredGenerationMismatches += 1;
        assets.push({
          relativePath,
          content: cloneJsonLike(envelope.data),
          revision: Number(envelope.revision) || 0,
          contentHash: String(envelope.contentHash || ''),
          updatedAt: String(envelope.updatedAt || ''),
          sourceWorkspaceGeneration: envelopeGeneration,
          recoveredGenerationMismatch: recoverableGenerationLag
        });
      };
      try {
        const relativePath = 'chat/index.json';
        const content = await readText(root, `${location.rootPath}/${relativePath}`);
        if (content !== null) acceptEnvelope(JSON.parse(content || ''), relativePath);
      } catch (_) {
        invalidAssets += 1;
      }
      for (const prefix of ['chat/turns', 'chat/tombstones']) {
        let directory;
        try {
          directory = await getDirectoryAtPath(root, `${location.rootPath}/${prefix}`);
        } catch (error) {
          if (error?.name === 'NotFoundError') continue;
          throw error;
        }
        if (typeof directory?.entries !== 'function') continue;
        for await (const [filename, entry] of directory.entries()) {
          if (assets.length >= 10_000) break;
          if (entry?.kind && entry.kind !== 'file') continue;
          if (!/^[^/\\]{1,180}\.json$/iu.test(String(filename || ''))) {
            invalidAssets += 1;
            continue;
          }
          const relativePath = `${prefix}/${filename}`;
          try {
            const content = await readText(
              root, `${location.rootPath}/${relativePath}`
            );
            const envelope = JSON.parse(content || '');
            acceptEnvelope(envelope, relativePath);
          } catch (_) {
            invalidAssets += 1;
          }
        }
      }
      assets.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
      return { permission, assets, invalidAssets, recoveredGenerationMismatches };
    }

    async function loadWorkspaceIndexForRead(root) {
      const content = await readText(root, WORKSPACE_INDEX_PATH);
      if (content === null) return shared.createWorkspaceIndex([]);
      try { return shared.validateWorkspaceIndex(JSON.parse(content)); } catch (_) {
        fail('INVALID_WORKSPACE_INDEX');
      }
    }

    async function listWorkspaceManifests(identity = {}) {
      const handle = await handleStore.load();
      const permission = await permissionState(handle);
      if (!handle || permission !== 'granted') {
        return { permission, manifests: [], matches: [] };
      }
      let root;
      try { root = await getRootDirectory(handle, false); } catch (error) {
        if (error?.name === 'NotFoundError') return { permission, manifests: [], matches: [] };
        throw error;
      }
      const index = await loadWorkspaceIndexForRead(root);
      const manifests = [];
      let invalidManifests = 0;
      for (const entry of index.workspaces) {
        const content = await readText(root, entry.manifestPath);
        try {
          const manifest = shared.validateWorkspaceManifest(JSON.parse(content || ''));
          if (manifest.workspaceId !== entry.workspaceId) fail('WORKSPACE_INDEX_IDENTITY_MISMATCH');
          manifests.push(manifest);
        } catch (_) {
          invalidManifests += 1;
        }
      }
      return {
        permission,
        manifests,
        matches: shared.matchWorkspaceManifests(identity, manifests),
        invalidManifests
      };
    }

    async function status() {
      const [handle, pending, meta] = await Promise.all([
        handleStore.load(), queueStore.getAll(), queueStore.getMeta()
      ]);
      return {
        directoryName: String(handle?.name || ''),
        permission: await permissionState(handle),
        pendingCount: pending.length,
        conflictCount: Number(meta.conflictCount) || 0,
        lastConflict: meta.lastConflict || null,
        lastError: String(meta.lastError || '').slice(0, MAX_ERROR_LENGTH),
        lastErrorCode: String(meta.lastErrorCode || '').slice(0, 80),
        lastErrorName: String(meta.lastErrorName || '').slice(0, 80),
        lastErrorPath: String(meta.lastErrorPath || '').slice(0, 240),
        requiresReauthorization: meta.requiresReauthorization === true,
        requiresReselection: meta.requiresReselection === true,
        lastSyncAt: String(meta.lastSyncAt || '')
      };
    }

    async function readJson(relativePath) {
      const path = normalizeRelativePath(relativePath);
      const handle = await handleStore.load();
      const permission = await permissionState(handle);
      if (!handle || permission !== 'granted') {
        return { permission, found: false, value: null };
      }
      let root;
      try {
        root = await getRootDirectory(handle, false);
      } catch (error) {
        if (error?.name === 'NotFoundError') return { permission, found: false, value: null };
        throw error;
      }
      const content = await readText(root, path);
      if (content === null) return { permission, found: false, value: null };
      try {
        const value = JSON.parse(content);
        if (!isPlainObject(value)) fail('INVALID_JSON_ASSET');
        return { permission, found: true, value };
      } catch (error) {
        if (error?.code === 'INVALID_JSON_ASSET') throw error;
        fail('INVALID_JSON_ASSET');
      }
    }

    async function loadIndex(root) {
      const content = await readText(root, 'index.json');
      if (!content) return { schemaVersion: 1, revision: 0, assets: [], invalidAssets: 0 };
      try {
        return validIndex(JSON.parse(content));
      } catch (_) {
        fail('INVALID_INDEX');
      }
    }

    function indexWithAsset(index, item) {
      const assets = index.assets.filter(asset => asset.path !== item.relativePath);
      assets.push({
        path: item.relativePath,
        revision: item.revision,
        type: item.type,
        sourceId: item.sourceId,
        contentHash: item.contentHash
      });
      assets.sort((first, second) => first.path.localeCompare(second.path));
      return {
        schemaVersion: 1,
        revision: Math.max(Number(index.revision) || 0, item.revision),
        sourceId,
        assets
      };
    }

    async function recordFailure(error, relativePath = '') {
      const message = String(error?.message || error || 'Directory sync failed')
        .replace(/[\r\n]+/g, ' ').slice(0, MAX_ERROR_LENGTH);
      const name = String(error?.name || 'Error')
        .replace(/[^A-Za-z0-9_$-]/gu, '').slice(0, 80) || 'Error';
      const code = String(error?.code || name)
        .replace(/[^A-Za-z0-9_$-]/gu, '').slice(0, 80) || 'DIRECTORY_SYNC_FAILED';
      const requiresReauthorization = [
        'NotAllowedError', 'SecurityError', 'PermissionDeniedError'
      ].includes(name);
      const requiresReselection = ['NotFoundError', 'InvalidStateError'].includes(name);
      const failedPath = String(relativePath || '').slice(0, 240);
      await queueStore.setMeta({
        lastError: message,
        lastErrorCode: code,
        lastErrorName: name,
        lastErrorPath: failedPath,
        requiresReauthorization,
        requiresReselection
      });
      return {
        message, code, name, failedPath, requiresReauthorization, requiresReselection
      };
    }

    async function recordConflict(item, conflictPath) {
      const meta = await queueStore.getMeta();
      const entry = {
        path: String(item.relativePath).slice(0, 160),
        conflictPath: String(conflictPath).slice(0, 240),
        revision: item.revision,
        createdAt: new Date().toISOString()
      };
      const conflicts = [...(Array.isArray(meta.conflicts) ? meta.conflicts : []), entry]
        .slice(-MAX_CONFLICTS);
      await queueStore.setMeta({
        conflictCount: (Number(meta.conflictCount) || 0) + 1,
        conflicts,
        lastConflict: entry
      });
    }

    async function runFlush(importer) {
      const result = {
        permission: 'unconfigured', written: 0, imported: 0,
        conflicts: 0, failed: 0, pendingCount: 0,
        errorCode: '', errorName: '',
        failedPath: '',
        requiresReauthorization: false, requiresReselection: false
      };
      await discardQueuedPortableConfig();
      const handle = await handleStore.load();
      result.permission = await permissionState(handle);
      if (!handle || result.permission !== 'granted') {
        result.pendingCount = (await queueStore.getAll()).length;
        return result;
      }
      let root;
      try {
        root = await getRootDirectory(handle, true);
      } catch (error) {
        result.failed = 1;
        Object.assign(result, await recordFailure(error));
        result.errorCode = result.code;
        result.errorName = result.name;
        result.pendingCount = (await queueStore.getAll()).length;
        return result;
      }
      let index;
      try {
        index = await loadIndex(root);
      } catch (error) {
        result.failed = 1;
        Object.assign(result, await recordFailure(error));
        result.errorCode = result.code;
        result.errorName = result.name;
        result.pendingCount = (await queueStore.getAll()).length;
        return result;
      }
      const items = await queueStore.getAll();
      for (const item of items) {
        try {
          if (item.relativePath === PORTABLE_CONFIG_PATH) {
            await queueStore.remove(item.relativePath, item.queueRevision);
            continue;
          }
          const latestQueued = await queueStore.get(item.relativePath);
          if (!latestQueued || latestQueued.queueRevision !== item.queueRevision) continue;
          const existingContent = await readText(root, item.relativePath);
          if (item.type === 'json' && existingContent) {
            const existing = parseValidJson(existingContent);
            if (!existing) fail('INVALID_PRIMARY_JSON');
            const incoming = parseValidJson(item.content);
            if (!incoming) fail('INVALID_QUEUED_JSON');
            if (item.relativePath === WORKSPACE_INDEX_PATH &&
                stableStringify(existing) !== stableStringify(incoming)) {
              const merged = mergeWorkspaceIndexes(existing, incoming);
              const mergedContent = `${JSON.stringify(merged, null, 2)}\n`;
              await writeText(root, item.relativePath, mergedContent);
              result.written += 1;
              result.imported += existing.revision > incoming.revision ? 1 : 0;
              index = indexWithAsset(index, {
                ...item,
                revision: merged.revision,
                contentHash: contentHash(stableStringify(merged))
              });
              await writeText(root, 'index.json', `${JSON.stringify(index, null, 2)}\n`);
              await queueStore.remove(item.relativePath, item.queueRevision);
              continue;
            }
            if (existing.revision > incoming.revision) {
              const imported = await importer(item.relativePath, cloneJsonLike(existing));
              if (!imported?.imported) fail('DIRECTORY_VERSION_NEWER');
              result.imported += 1;
              index = indexWithAsset(index, {
                ...item,
                revision: existing.revision,
                sourceId: String(existing.sourceId || ''),
                contentHash: contentHash(stableStringify(existing))
              });
              await writeText(root, 'index.json', `${JSON.stringify(index, null, 2)}\n`);
              await queueStore.remove(item.relativePath, item.queueRevision);
              continue;
            }
            if (existing.revision === incoming.revision) {
              if (stableStringify(existing) !== stableStringify(incoming)) {
                const conflictPath = conflictRelativePath(
                  item.relativePath, item.revision, item.sourceId
                );
                await writeText(root, conflictPath, item.content);
                await recordConflict(item, conflictPath);
                result.conflicts += 1;
                const match = /^workspaces\/([^/]+)\/(?!manifest\.json$).+/u
                  .exec(item.relativePath);
                if (match) {
                  const pendingManifest = await queueStore.get(
                    `workspaces/${match[1]}/manifest.json`
                  );
                  if (pendingManifest?.content) {
                    try {
                      const manifest = shared.validateWorkspaceManifest(
                        JSON.parse(pendingManifest.content)
                      );
                      await queueStore.remove(pendingManifest.relativePath,
                        pendingManifest.queueRevision);
                      const pendingWorkspaceIndex = await queueStore.get(WORKSPACE_INDEX_PATH);
                      if (pendingWorkspaceIndex?.content) {
                        const queuedIndex = shared.validateWorkspaceIndex(
                          JSON.parse(pendingWorkspaceIndex.content)
                        );
                        const diskIndexContent = await readText(root, WORKSPACE_INDEX_PATH);
                        const diskIndex = diskIndexContent
                          ? shared.validateWorkspaceIndex(JSON.parse(diskIndexContent)) : null;
                        const primaryEntry = diskIndex?.workspaces.find(entry =>
                          entry.workspaceId === manifest.workspaceId);
                        const entries = queuedIndex.workspaces.filter(entry =>
                          entry.workspaceId !== manifest.workspaceId);
                        if (primaryEntry) entries.push(primaryEntry);
                        const corrected = shared.validateWorkspaceIndex({
                          ...queuedIndex,
                          revision: queuedIndex.revision + 1,
                          updatedAt: new Date().toISOString(),
                          workspaces: entries
                        });
                        await queueStore.remove(WORKSPACE_INDEX_PATH,
                          pendingWorkspaceIndex.queueRevision);
                        await enqueueWorkspaceJson(WORKSPACE_INDEX_PATH, corrected);
                      }
                    } catch (_) {}
                  }
                }
              }
              index = indexWithAsset(index, {
                ...item,
                revision: existing.revision,
                sourceId: String(existing.sourceId || ''),
                contentHash: contentHash(stableStringify(existing))
              });
              await writeText(root, 'index.json', `${JSON.stringify(index, null, 2)}\n`);
              await queueStore.remove(item.relativePath, item.queueRevision);
              continue;
            }
            await writeText(root, backupRelativePath(item.relativePath), existingContent);
          } else if (item.type === 'text' && existingContent !== null && existingContent !== item.content) {
            await writeText(root, backupRelativePath(item.relativePath), existingContent);
          }
          if (existingContent !== item.content) {
            await writeText(root, item.relativePath, item.content);
            result.written += 1;
          }
          index = indexWithAsset(index, item);
          await writeText(root, 'index.json', `${JSON.stringify(index, null, 2)}\n`);
          await queueStore.remove(item.relativePath, item.queueRevision);
        } catch (error) {
          result.failed += 1;
          Object.assign(result, await recordFailure(error, item.relativePath));
          result.errorCode = result.code;
          result.errorName = result.name;
          break;
        }
      }
      result.pendingCount = (await queueStore.getAll()).length;
      if (!result.failed) {
        await queueStore.setMeta({
          lastError: '',
          lastErrorCode: '',
          lastErrorName: '',
          lastErrorPath: '',
          requiresReauthorization: false,
          requiresReselection: false,
          lastSyncAt: new Date().toISOString()
        });
      }
      return result;
    }

    function flush(importerOverride) {
      const importer = typeof importerOverride === 'function'
        ? importerOverride : assetImporter;
      if (activeFlush) {
        rerunRequested = true;
        rerunImporter = importer;
        return activeFlush;
      }
      activeFlush = runFlush(importer);
      activeFlush.then(result => {
        activeFlush = null;
        const shouldRerun = rerunRequested && !result.failed && result.pendingCount > 0;
        const nextImporter = rerunImporter || importer;
        rerunRequested = false;
        rerunImporter = null;
        if (shouldRerun) void flush(nextImporter).catch(() => undefined);
      }, () => {
        activeFlush = null;
        rerunRequested = false;
        rerunImporter = null;
      });
      return activeFlush;
    }

    async function rebuildIndex(importerOverride) {
      const importer = typeof importerOverride === 'function'
        ? importerOverride : assetImporter;
      const handle = await handleStore.load();
      const permission = await permissionState(handle);
      if (!handle || permission !== 'granted') {
        return { permission, imported: 0, stale: 0, restoredBackups: 0, invalidAssets: 0 };
      }
      const root = await getRootDirectory(handle, false);
      const indexContent = await readText(root, 'index.json');
      let index;
      try {
        index = validIndex(JSON.parse(indexContent || ''));
      } catch (_) {
        fail('INVALID_INDEX');
      }
      const result = {
        permission, imported: 0, stale: 0,
        restoredBackups: 0, invalidAssets: index.invalidAssets
      };
      for (const asset of index.assets) {
        let content = await readText(root, asset.path);
        let value;
        let restoredBackup = false;
        if (asset.type === 'json') value = parseValidJson(content);
        else value = typeof content === 'string' ? content : null;
        if (value === null) {
          const backupContent = await readText(root, backupRelativePath(asset.path));
          const backupValue = asset.type === 'json'
            ? parseValidJson(backupContent)
            : (typeof backupContent === 'string' ? backupContent : null);
          if (backupValue === null) {
            result.invalidAssets += 1;
            continue;
          }
          value = backupValue;
          restoredBackup = true;
          result.restoredBackups += 1;
        }
        try {
          const imported = await importer(asset.path, cloneJsonLike(value), {
            indexedRevision: asset.revision,
            restoredBackup
          });
          if (imported?.imported) result.imported += 1;
          else if (imported?.reason === 'stale') result.stale += 1;
          else result.invalidAssets += 1;
        } catch (_) {
          result.invalidAssets += 1;
        }
      }
      return result;
    }

    async function rebuildWorkspaceIndex() {
      const handle = await handleStore.load();
      const permission = await permissionState(handle);
      if (!handle || permission !== 'granted') {
        return { permission, workspaceCount: 0, quarantined: 0, invalidManifests: 0 };
      }
      let root;
      try { root = await getRootDirectory(handle, false); } catch (error) {
        if (error?.name === 'NotFoundError') {
          return { permission, workspaceCount: 0, quarantined: 0, invalidManifests: 0 };
        }
        throw error;
      }
      let workspacesDirectory;
      try {
        workspacesDirectory = await root.getDirectoryHandle(WORKSPACE_ROOT_PATH, { create: false });
      } catch (error) {
        if (error?.name !== 'NotFoundError') throw error;
      }
      const manifests = [];
      let quarantined = 0;
      if (workspacesDirectory && typeof workspacesDirectory.entries === 'function') {
        for await (const [directoryName, entry] of workspacesDirectory.entries()) {
          if (entry?.kind && entry.kind !== 'directory') continue;
          const manifestPath = `${WORKSPACE_ROOT_PATH}/${directoryName}/manifest.json`;
          const content = await readText(root, manifestPath);
          if (content === null) continue;
          try {
            const manifest = shared.validateWorkspaceManifest(JSON.parse(content));
            if (manifest.directoryName !== directoryName) fail('WORKSPACE_DIRECTORY_MISMATCH');
            manifests.push(manifest);
          } catch (_) {
            const safeName = String(directoryName).replace(/[^a-z0-9._-]/giu, '_').slice(0, 120);
            await writeText(root,
              `conflicts/quarantine/${safeName || 'unknown'}.manifest.invalid.json`,
              content.slice(0, 2 * 1024 * 1024));
            quarantined += 1;
          }
        }
      }
      const previousContent = await readText(root, WORKSPACE_INDEX_PATH);
      let previousRevision = 0;
      if (previousContent) {
        try { previousRevision = shared.validateWorkspaceIndex(JSON.parse(previousContent)).revision; }
        catch (_) {}
      }
      const index = shared.createWorkspaceIndex(manifests, {
        revision: previousRevision + 1,
        updatedAt: new Date().toISOString()
      });
      await writeText(root, WORKSPACE_INDEX_PATH, `${JSON.stringify(index, null, 2)}\n`);
      return {
        permission,
        workspaceCount: manifests.length,
        quarantined,
        invalidManifests: quarantined,
        indexRevision: index.revision
      };
    }

    async function cancelWorkspaceQueue(workspaceInput) {
      const location = workspaceDirectory(workspaceInput);
      const prefix = `${location.rootPath}/`;
      const pending = await queueStore.getAll();
      const pendingIndex = pending.find(item => item.relativePath === WORKSPACE_INDEX_PATH);
      let cancelled = 0;
      for (const item of pending) {
        if (!item.relativePath.startsWith(prefix)) continue;
        if (await queueStore.remove(item.relativePath, item.queueRevision)) cancelled += 1;
      }
      if (pendingIndex) {
        let index;
        try { index = shared.validateWorkspaceIndex(JSON.parse(pendingIndex.content)); }
        catch (_) { index = null; }
        if (index) {
          const workspaces = index.workspaces.filter(item =>
            item.workspaceId !== location.manifest.workspaceId);
          const next = shared.validateWorkspaceIndex({
            ...index,
            revision: index.revision + 1,
            updatedAt: new Date().toISOString(),
            workspaces
          });
          if (await queueStore.remove(WORKSPACE_INDEX_PATH, pendingIndex.queueRevision)) cancelled += 1;
          await enqueueWorkspaceJson(WORKSPACE_INDEX_PATH, next);
        }
      }
      return { cancelled, workspaceId: location.manifest.workspaceId };
    }

    async function removeWorkspaceTree(workspaceInput) {
      const location = workspaceDirectory(workspaceInput);
      const handle = await handleStore.load();
      const permission = await permissionState(handle);
      if (!handle || permission !== 'granted') {
        return { permission, removed: false, pending: true };
      }
      let root;
      try { root = await getRootDirectory(handle, false); } catch (error) {
        if (error?.name === 'NotFoundError') return { permission, removed: true, missing: true };
        throw error;
      }
      const workspaceParents = [
        WORKSPACE_ROOT_PATH,
        `backups/${WORKSPACE_ROOT_PATH}`,
        `conflicts/${WORKSPACE_ROOT_PATH}`
      ];
      for (const parentPath of workspaceParents) {
        try {
          let parent = root;
          for (const segment of parentPath.split('/')) {
            parent = await parent.getDirectoryHandle(segment, { create: false });
          }
          await parent.removeEntry(location.manifest.directoryName, { recursive: true });
        } catch (error) {
          if (error?.name !== 'NotFoundError') throw error;
        }
      }
      const meta = await queueStore.getMeta();
      const conflicts = Array.isArray(meta.conflicts) ? meta.conflicts : [];
      const workspacePrefix = `${location.rootPath}/`;
      const conflictPrefix = `conflicts/${workspacePrefix}`;
      const retainedConflicts = conflicts.filter(entry =>
        !String(entry?.path || '').startsWith(workspacePrefix) &&
        !String(entry?.conflictPath || '').startsWith(conflictPrefix)
      );
      const removedConflicts = conflicts.length - retainedConflicts.length;
      if (removedConflicts > 0) {
        const lastConflict = retainedConflicts.at(-1) || null;
        await queueStore.setMeta({
          conflictCount: Math.max(0,
            (Number(meta.conflictCount) || 0) - removedConflicts),
          conflicts: retainedConflicts,
          lastConflict
        });
      }
      const content = await readText(root, WORKSPACE_INDEX_PATH);
      if (content) {
        try {
          const current = shared.validateWorkspaceIndex(JSON.parse(content));
          const next = shared.validateWorkspaceIndex({
            ...current,
            revision: current.revision + 1,
            updatedAt: new Date().toISOString(),
            workspaces: current.workspaces.filter(item =>
              item.workspaceId !== location.manifest.workspaceId)
          });
          await writeText(root, WORKSPACE_INDEX_PATH, `${JSON.stringify(next, null, 2)}\n`);
        } catch (_) {
          await rebuildWorkspaceIndex();
        }
      }
      return {
        permission,
        removed: true,
        removedConflicts,
        workspaceId: location.manifest.workspaceId
      };
    }

    async function exportBundle(bundleOverride) {
      const snapshot = bundleOverride === undefined
        ? await bundleExporter() : bundleOverride;
      const bundle = sanitizeValue(snapshot);
      if (!isPlainObject(bundle)) fail('INVALID_EXPORT_BUNDLE');
      return { ...bundle, schemaVersion: 1 };
    }

    return {
      saveDirectoryHandle: saveDirectoryHandleMethod,
      getDirectoryHandle: getDirectoryHandleMethod,
      requestDirectoryPermission,
      enqueueJson,
      enqueueText,
      compareAndSwapJson,
      flush,
      status,
      readJson,
      enqueueWorkspaceAsset,
      readWorkspaceAsset,
      listWorkspaceChatAssets,
      listWorkspaceManifests,
      rebuildIndex,
      rebuildWorkspaceIndex,
      cancelWorkspaceQueue,
      removeWorkspaceTree,
      exportBundle
    };
  }

  return {
    USER_DATA_DATABASE_NAME,
    USER_DATA_DATABASE_VERSION,
    DIRECTORY_HANDLE_STORE_NAME,
    SYNC_QUEUE_STORE_NAME,
    ROOT_DIRECTORY_NAME,
    LEGACY_ROOT_DIRECTORY_NAME,
    WORKSPACE_INDEX_PATH,
    createMemoryDirectoryHandleStore,
    createMemorySyncQueue,
    createIndexedDbDirectoryHandleStore,
    createIndexedDbSyncQueue,
    saveDirectoryHandle,
    loadDirectoryHandle,
    createDirectorySync
  };
});
