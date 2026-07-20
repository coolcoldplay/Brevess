(function attach(root, factory) {
  const api = factory(root.SciLLM || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory() {
  const USER_DATA_DATABASE_NAME = 'sci-logic-highlighter-user-data';
  const USER_DATA_DATABASE_VERSION = 2;
  const DOCUMENT_STORE_NAME = 'documents';
  const META_STORE_NAME = 'meta';
  const DIRECTORY_HANDLE_STORE_NAME = 'directoryHandles';
  const SYNC_QUEUE_STORE_NAME = 'syncQueue';
  const ROOT_DIRECTORY_NAME = 'SCI-Highlighter';
  const HANDLE_KEY = 'selected-directory';
  const META_KEY = 'meta';
  const MAX_ERROR_LENGTH = 240;
  const MAX_CONFLICTS = 50;
  const FORBIDDEN_EXPORT_KEYS = new Set([
    'apikey', 'authorization', 'headers', 'providers', 'analysiscache',
    'directoryhandle', 'directoryhandles', 'syncqueue', 'cachestore', 'handlestore'
  ]);

  function forbiddenExportKey(value) {
    const key = String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    return FORBIDDEN_EXPORT_KEYS.has(key) ||
      /(apikey|authorization|credential|secret|token|header|provider|cache|handle|syncqueue)/u
        .test(key);
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

  function ensureUserDataStores(database) {
    if (!database.objectStoreNames.contains(DOCUMENT_STORE_NAME)) {
      const documents = database.createObjectStore(DOCUMENT_STORE_NAME, { keyPath: 'documentId' });
      documents.createIndex('updatedAt', 'updatedAt');
    }
    if (!database.objectStoreNames.contains(META_STORE_NAME)) {
      database.createObjectStore(META_STORE_NAME, { keyPath: 'key' });
    }
    if (!database.objectStoreNames.contains(DIRECTORY_HANDLE_STORE_NAME)) {
      database.createObjectStore(DIRECTORY_HANDLE_STORE_NAME, { keyPath: 'key' });
    }
    if (!database.objectStoreNames.contains(SYNC_QUEUE_STORE_NAME)) {
      database.createObjectStore(SYNC_QUEUE_STORE_NAME, { keyPath: 'key' });
    }
  }

  function createDatabaseOpener(indexedDbRef) {
    let databasePromise;
    return function openDatabase() {
      if (!databasePromise) {
        databasePromise = new Promise((resolve, reject) => {
          const request = indexedDbRef.open(USER_DATA_DATABASE_NAME, USER_DATA_DATABASE_VERSION);
          request.onupgradeneeded = () => ensureUserDataStores(request.result);
          request.onsuccess = () => {
            const database = request.result;
            database.onversionchange = () => {
              database.close?.();
              databasePromise = undefined;
            };
            resolve(database);
          };
          request.onerror = () => reject(request.error);
          request.onblocked = () => reject(new Error('IndexedDB upgrade blocked'));
        });
      }
      return databasePromise;
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
    const handle = await getFileHandle(root, relativePath, true);
    const writable = await handle.createWritable();
    try {
      await writable.write(String(content));
      await writable.close();
    } catch (error) {
      await writable.abort?.().catch?.(() => undefined);
      throw error;
    }
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

    async function enqueueJson(relativePath, input) {
      const path = normalizeRelativePath(relativePath);
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
      const path = normalizeRelativePath(relativePath);
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

    async function recordFailure(error) {
      const message = String(error?.message || error || 'Directory sync failed')
        .replace(/[\r\n]+/g, ' ').slice(0, MAX_ERROR_LENGTH);
      await queueStore.setMeta({ lastError: message });
      return message;
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
        conflicts: 0, failed: 0, pendingCount: 0
      };
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
        await recordFailure(error);
        result.pendingCount = (await queueStore.getAll()).length;
        return result;
      }
      let index;
      try {
        index = await loadIndex(root);
      } catch (error) {
        result.failed = 1;
        await recordFailure(error);
        result.pendingCount = (await queueStore.getAll()).length;
        return result;
      }
      const items = await queueStore.getAll();
      for (const item of items) {
        try {
          const existingContent = await readText(root, item.relativePath);
          if (item.type === 'json' && existingContent) {
            const existing = parseValidJson(existingContent);
            if (!existing) fail('INVALID_PRIMARY_JSON');
            const incoming = parseValidJson(item.content);
            if (!incoming) fail('INVALID_QUEUED_JSON');
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
          await recordFailure(error);
          break;
        }
      }
      result.pendingCount = (await queueStore.getAll()).length;
      if (!result.failed) {
        await queueStore.setMeta({ lastError: '', lastSyncAt: new Date().toISOString() });
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
      enqueueJson,
      enqueueText,
      flush,
      status,
      readJson,
      rebuildIndex,
      exportBundle
    };
  }

  return {
    USER_DATA_DATABASE_NAME,
    USER_DATA_DATABASE_VERSION,
    DIRECTORY_HANDLE_STORE_NAME,
    SYNC_QUEUE_STORE_NAME,
    createMemoryDirectoryHandleStore,
    createMemorySyncQueue,
    createIndexedDbDirectoryHandleStore,
    createIndexedDbSyncQueue,
    saveDirectoryHandle,
    loadDirectoryHandle,
    createDirectorySync
  };
});
