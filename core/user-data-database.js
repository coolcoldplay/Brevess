(function attach(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory() {
  const USER_DATA_DATABASE_NAME = 'sci-logic-highlighter-user-data';
  const USER_DATA_DATABASE_VERSION = 4;
  const USER_DATA_STORE_NAMES = Object.freeze([
    'documents',
    'meta',
    'directoryHandles',
    'syncQueue',
    'workspaces',
    'workspaceAssets',
    'workspaceTurns',
    'workspaceTombstones',
    'figureImages'
  ]);
  const STORE_DEFINITIONS = Object.freeze({
    documents: { keyPath: 'documentId', indexes: [['updatedAt', 'updatedAt']] },
    meta: { keyPath: 'key' },
    directoryHandles: { keyPath: 'key' },
    syncQueue: { keyPath: 'key' },
    workspaces: {
      keyPath: 'workspaceId',
      indexes: [['updatedAt', 'updatedAt'], ['canonicalUrl', 'canonicalUrl']]
    },
    workspaceAssets: {
      keyPath: 'assetKey',
      indexes: [['workspaceId', 'workspaceId'], ['updatedAt', 'updatedAt']]
    },
    workspaceTurns: {
      keyPath: 'turnKey',
      indexes: [
        ['workspaceId', 'workspaceId'],
        ['workspaceSequence', ['workspaceId', 'sequence'], { unique: true }],
        ['updatedAt', 'updatedAt']
      ]
    },
    workspaceTombstones: {
      keyPath: 'tombstoneKey',
      indexes: [['workspaceId', 'workspaceId'], ['deletedAt', 'deletedAt']]
    },
    figureImages: {
      keyPath: 'cacheKey',
      indexes: [
        ['sourceUrl', 'sourceUrl'],
        ['lastAccessedAt', 'lastAccessedAt'],
        ['byteLength', 'byteLength']
      ]
    }
  });
  const connections = new WeakMap();

  function fail(code, cause) {
    const error = new Error(code);
    error.code = code;
    if (cause !== undefined) error.cause = cause;
    return error;
  }

  function ensureUserDataStores(database) {
    for (const name of USER_DATA_STORE_NAMES) {
      if (database.objectStoreNames.contains(name)) continue;
      const definition = STORE_DEFINITIONS[name];
      const store = database.createObjectStore(name, { keyPath: definition.keyPath });
      for (const [indexName, keyPath, options] of definition.indexes || []) {
        store.createIndex(indexName, keyPath, options);
      }
    }
    return database;
  }

  function resetUserDataDatabaseConnection(indexedDbRef) {
    const connection = indexedDbRef && connections.get(indexedDbRef);
    connection?.database?.close?.();
    if (indexedDbRef && (typeof indexedDbRef === 'object' || typeof indexedDbRef === 'function')) {
      connections.delete(indexedDbRef);
    }
  }

  function openUserDataDatabase(indexedDbRef) {
    if (!indexedDbRef || typeof indexedDbRef.open !== 'function') {
      return Promise.reject(fail('INDEXEDDB_UNAVAILABLE'));
    }
    const existing = connections.get(indexedDbRef);
    if (existing?.promise) return existing.promise;

    const connection = { promise: null, database: null };
    connection.promise = new Promise((resolve, reject) => {
      let settled = false;
      let request;
      const rejectOnce = error => {
        if (settled) return;
        settled = true;
        connections.delete(indexedDbRef);
        reject(error);
      };
      try {
        request = indexedDbRef.open(USER_DATA_DATABASE_NAME, USER_DATA_DATABASE_VERSION);
      } catch (error) {
        rejectOnce(fail('INDEXEDDB_OPEN_FAILED', error));
        return;
      }
      request.onupgradeneeded = () => {
        try {
          ensureUserDataStores(request.result);
        } catch (error) {
          try { request.transaction?.abort?.(); } catch (_) {}
          rejectOnce(fail('INDEXEDDB_UPGRADE_FAILED', error));
        }
      };
      request.onsuccess = () => {
        const database = request.result;
        if (settled) {
          database?.close?.();
          return;
        }
        settled = true;
        connection.database = database;
        database.onversionchange = () => {
          database.close?.();
          if (connections.get(indexedDbRef) === connection) connections.delete(indexedDbRef);
        };
        resolve(database);
      };
      request.onerror = () => rejectOnce(fail('INDEXEDDB_OPEN_FAILED', request.error));
      request.onblocked = () => rejectOnce(fail('INDEXEDDB_UPGRADE_BLOCKED'));
    });
    connections.set(indexedDbRef, connection);
    return connection.promise;
  }

  function requestToPromise(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || fail('INDEXEDDB_REQUEST_FAILED'));
    });
  }

  function transactionDone(transaction) {
    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || fail('INDEXEDDB_TRANSACTION_FAILED'));
      transaction.onabort = () => reject(transaction.error || fail('INDEXEDDB_TRANSACTION_ABORTED'));
    });
  }

  async function runUserDataTransaction(indexedDbRef, storeNames, mode, operation) {
    const database = await openUserDataDatabase(indexedDbRef);
    const transaction = database.transaction(storeNames, mode);
    const done = transactionDone(transaction);
    try {
      const result = await operation(transaction);
      await done;
      return result;
    } catch (error) {
      try { transaction.abort?.(); } catch (_) {}
      await done.catch(() => undefined);
      throw error;
    }
  }

  return {
    USER_DATA_DATABASE_NAME,
    USER_DATA_DATABASE_VERSION,
    USER_DATA_STORE_NAMES,
    STORE_DEFINITIONS,
    ensureUserDataStores,
    openUserDataDatabase,
    resetUserDataDatabaseConnection,
    requestToPromise,
    transactionDone,
    runUserDataTransaction
  };
});
