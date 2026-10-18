(function attach(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory() {
  const DEFAULT_BASE_URL = 'http://127.0.0.1:23119/connector/';
  // A self-contained scientific article can legitimately exceed the old
  // 28 MB ceiling once several publisher-original Figure files are embedded.
  const MAX_SNAPSHOT_BYTES = 192 * 1024 * 1024;
  const MAX_NOTE_BYTES = 8 * 1024 * 1024;
  const DEFAULT_REQUEST_TIMEOUT_MS = 120000;
  // Retain compact terminal outcomes for this worker lifetime. Evicting a
  // written operation and replaying its POST would create duplicate items.
  const operations = new Map();
  const MAX_OPERATIONS = 128;
  const POST_START = Symbol('zotero-post-start');

  function utf8Bytes(value) {
    return new TextEncoder().encode(String(value || '')).length;
  }

  function zoteroError(code, message, details = {}) {
    const error = new Error(message || code);
    error.code = code;
    Object.assign(error, details);
    return error;
  }

  function assertNotCancelled(signal) {
    if (signal?.aborted) throw zoteroError('ZOTERO_CANCELLED', 'Zotero export was cancelled');
  }

  function normalizeBaseUrl(value) {
    const parsed = new URL(String(value || DEFAULT_BASE_URL));
    if (!['127.0.0.1', 'localhost'].includes(parsed.hostname) ||
        parsed.protocol !== 'http:') {
      throw zoteroError('ZOTERO_INVALID_ENDPOINT', 'Invalid Zotero Connector endpoint');
    }
    parsed.pathname = parsed.pathname.replace(/\/+$/, '') + '/';
    parsed.search = '';
    parsed.hash = '';
    return parsed.href;
  }

  async function readResponse(response) {
    const text = await response.text();
    if (!text) return null;
    if (/application\/json/i.test(response.headers?.get?.('content-type') || '')) {
      try {
        return JSON.parse(text);
      } catch (_) {}
    }
    return text;
  }

  async function requestZotero(method, data, options = {}) {
    assertNotCancelled(options.signal);
    const fetchImpl = options.fetchImpl || globalThis.fetch;
    if (typeof fetchImpl !== 'function') {
      throw zoteroError('ZOTERO_UNAVAILABLE', 'Fetch is unavailable');
    }
    const baseUrl = normalizeBaseUrl(options.baseUrl);
    const endpoint = String(method || '').replace(/^\/+|\/+$/g, '');
    const headers = {
      'X-Zotero-Version': String(options.zoteroVersion || '9.0'),
      'X-Zotero-Connector-API-Version': '3'
    };
    if (data !== undefined) headers['Content-Type'] = 'application/json';
    const controller = new AbortController();
    const configured = Number(options.requestTimeoutMs);
    const timeoutMs = Number.isFinite(configured) && configured > 0
      ? Math.min(DEFAULT_REQUEST_TIMEOUT_MS, configured) : DEFAULT_REQUEST_TIMEOUT_MS;
    let timer; let listener;
    const interrupted = new Promise((_, reject) => {
      listener = () => { reject(zoteroError('ZOTERO_CANCELLED', 'Zotero export was cancelled')); controller.abort(); };
      options.signal?.addEventListener?.('abort', listener, { once: true });
      timer = setTimeout(() => { reject(zoteroError('ZOTERO_REQUEST_TIMEOUT', `Zotero Connector ${endpoint} timed out`)); controller.abort(); }, timeoutMs);
    });
    try {
      return await Promise.race([Promise.resolve().then(async () => {
        assertNotCancelled(options.signal);
        const body = data === undefined ? undefined : JSON.stringify(data);
        assertNotCancelled(options.signal);
        // No observer callback or await may sit between marking an attempted
        // write and invoking fetch. Cancellation/serialization before this
        // point is known not to have sent the POST.
        if (data !== undefined) options[POST_START]?.();
        const response = await fetchImpl(`${baseUrl}${endpoint}`, {
          method: data === undefined ? 'GET' : 'POST', headers,
          body,
          cache: 'no-store', signal: controller.signal
        });
        const responseBody = await readResponse(response);
        if (!response.ok) throw zoteroError('ZOTERO_IMPORT_FAILED',
          `Zotero Connector ${endpoint} returned HTTP ${response.status}`,
          { status: response.status, response: responseBody });
        return { status: response.status, body: responseBody, zoteroVersion: response.headers?.get?.('X-Zotero-Version') || '' };
      }), interrupted]);
    } catch (error) {
      if (error?.code) throw error;
      throw zoteroError('ZOTERO_UNAVAILABLE', 'Zotero desktop is not reachable. Keep Zotero open and try again.', { cause: error });
    } finally {
      clearTimeout(timer); options.signal?.removeEventListener?.('abort', listener);
    }
  }

  async function pingZotero(options = {}) {
    const response = await requestZotero('ping', undefined, options);
    return {
      online: true,
      version: response.zoteroVersion,
      body: response.body
    };
  }

  async function selectedZoteroTarget(options = {}) {
    const response = await requestZotero('getSelectedCollection', {
      switchToReadableLibrary: true
    }, options);
    const value = response.body && typeof response.body === 'object'
      ? response.body : {};
    const target = value.id ? `C${Number(value.id)}` : `L${Number(value.libraryID)}`;
    if (!/^[CL]\d+$/.test(target) || value.libraryEditable === false) {
      throw zoteroError('ZOTERO_LIBRARY_READ_ONLY', 'The selected Zotero library is read-only');
    }
    if (value.filesEditable === false) {
      throw zoteroError(
        'ZOTERO_FILES_READ_ONLY',
        'The selected Zotero library does not allow snapshot attachments'
      );
    }
    return {
      target,
      libraryID: Number(value.libraryID) || 0,
      libraryName: String(value.libraryName || ''),
      collectionID: value.id === null ? null : Number(value.id),
      collectionName: String(value.name || ''),
      filesEditable: true,
      zoteroVersion: response.zoteroVersion
    };
  }

  function validateEnhancedSnapshot(input = {}) {
    const title = String(input.title || '').normalize('NFKC').trim().slice(0, 1000);
    const url = String(input.url || '').trim();
    const snapshotContent = String(input.snapshotContent || '');
    const figureNoteHtml = String(input.figureNoteHtml || input.noteHtml || '');
    const chatNoteHtml = String(input.chatNoteHtml || '');
    const readingNoteHtml = String(input.readingNoteHtml || '');
    let parsed;
    try {
      parsed = new URL(url);
    } catch (_) {
      throw zoteroError('ZOTERO_INVALID_PAYLOAD', 'The article URL is invalid');
    }
    if (!title || !['http:', 'https:'].includes(parsed.protocol) ||
        !snapshotContent.includes('<html')) {
      throw zoteroError('ZOTERO_INVALID_PAYLOAD', 'The enhanced snapshot is incomplete');
    }
    if (utf8Bytes(snapshotContent) > MAX_SNAPSHOT_BYTES) {
      throw zoteroError(
        'ZOTERO_SNAPSHOT_TOO_LARGE',
        'The enhanced snapshot exceeds the 192 MB offline snapshot limit'
      );
    }
    if (utf8Bytes(figureNoteHtml) > MAX_NOTE_BYTES ||
        utf8Bytes(chatNoteHtml) > MAX_NOTE_BYTES || utf8Bytes(readingNoteHtml) > MAX_NOTE_BYTES) {
      throw zoteroError('ZOTERO_NOTE_TOO_LARGE', 'A Zotero child note exceeds 8 MB');
    }
    return {
      title,
      url: parsed.href,
      snapshotContent,
      figureNoteHtml,
      chatNoteHtml,
      readingNoteHtml
    };
  }

  function randomSessionId() {
    const id = globalThis.crypto?.randomUUID?.() ||
      `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    return `sci-reader-${id}`;
  }

  async function payloadIdentity(value) {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) throw zoteroError('ZOTERO_OPERATION_IDENTITY_UNAVAILABLE', 'Secure Zotero operation identity is unavailable', { retrySafe: true });
    const parts = [];
    // Hash one field at a time; never retain a second concatenated article or
    // entire payload in the terminal operation cache.
    for (const key of ['title', 'url', 'snapshotContent', 'figureNoteHtml', 'chatNoteHtml', 'readingNoteHtml']) {
      const digest = await subtle.digest('SHA-256', new TextEncoder().encode(value[key]));
      parts.push(Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join(''));
    }
    return parts.join(':');
  }

  async function performEnhancedSnapshotSave(value, options, operationId) {
    const startedAt = Date.now();
    const notes = [value.figureNoteHtml, value.chatNoteHtml, value.readingNoteHtml].filter(Boolean).map(note => ({ note }));
    const state = { operationId, stage: 'validate', sessionID: '', itemState: 'not_started', snapshotState: 'not_started', notesAttached: 0 };
    const writeOutcome = () => ({ itemSaved: state.itemState === 'confirmed', snapshotAttached: state.snapshotState === 'confirmed',
      partial: state.itemState === 'confirmed' && state.snapshotState !== 'confirmed',
      writeOutcomeUnknown: state.itemState === 'unknown' || state.snapshotState === 'unknown',
      retrySafe: state.itemState === 'not_started' && state.snapshotState === 'not_started' });
    const emit = (phase, status) => { try { options.onProgress?.({ ...state, ...writeOutcome(), phase, status, elapsedMs: Math.max(0, Date.now() - startedAt) }); } catch (_) {} };
    const phase = async (name, callback, writeState) => {
      assertNotCancelled(options.signal);
      state.stage = name;
      emit(name, 'started');
      const result = await callback(() => { if (writeState) state[writeState] = 'unknown'; });
      if (writeState) state[writeState] = 'confirmed';
      if (writeState === 'itemState') state.notesAttached = notes.length;
      emit(name, 'completed'); return result;
    };
    try {
      assertNotCancelled(options.signal);
      normalizeBaseUrl(options.baseUrl);
      const ping = await phase('ping', () => pingZotero(options));
      const target = await phase('target', () => selectedZoteroTarget({ ...options, zoteroVersion: ping.version || options.zoteroVersion }));
      state.sessionID = randomSessionId();
      const requestOptions = { ...options, zoteroVersion: ping.version || target.zoteroVersion || options.zoteroVersion };
      const itemKey = `sci-reader-item-${state.sessionID}`;
      await phase('items', postStarted => requestZotero('saveItems', {
        sessionID: state.sessionID, uri: value.url,
        items: [{ id: itemKey, itemType: 'webpage', title: value.title, url: value.url,
          accessDate: new Date().toISOString(), tags: [{ tag: 'Brevess' }, { tag: '增强网页快照' }], notes }]
      }, { ...requestOptions, [POST_START]: postStarted }), 'itemState');
      await phase('snapshot', postStarted => requestZotero('saveSingleFile', {
        sessionID: state.sessionID, items: [{ id: itemKey }], snapshotContent: value.snapshotContent,
        url: value.url, title: `${value.title} — Brevess 增强快照`
      }, { ...requestOptions, [POST_START]: postStarted }), 'snapshotState');
      state.stage = 'complete'; emit('complete', 'completed');
      return { imported: true, ...state, zoteroVersion: ping.version || target.zoteroVersion,
        target: target.target, libraryName: target.libraryName, collectionName: target.collectionName,
        snapshotAttached: true, noteAttached: notes.length > 0, notesAttached: notes.length,
        figureNoteAttached: Boolean(value.figureNoteHtml), chatNoteAttached: Boolean(value.chatNoteHtml), readingNoteAttached: Boolean(value.readingNoteHtml) };
    } catch (error) {
      Object.assign(error, state, writeOutcome());
      emit(state.stage, error.code === 'ZOTERO_CANCELLED' ? 'cancelled' : 'failed'); throw error;
    }
  }

  async function saveEnhancedSnapshotToZotero(input, options = {}) {
    const value = validateEnhancedSnapshot(input);
    const operationId = String(options.operationId || '');
    if (operationId && !/^[a-zA-Z0-9:._-]{1,160}$/.test(operationId)) {
      throw zoteroError('ZOTERO_INVALID_OPERATION', 'Invalid Zotero export operation ID', { retrySafe: true });
    }
    if (!operationId) return performEnhancedSnapshotSave(value, options, '');
    const existing = operations.get(operationId);
    if (existing) {
      if (existing.title !== value.title || existing.url !== value.url || (existing.input &&
          ['snapshotContent', 'figureNoteHtml', 'chatNoteHtml', 'readingNoteHtml'].some(key => existing.input[key] !== value[key])) ||
          (!existing.input && await payloadIdentity(value) !== await existing.identity)) {
        throw zoteroError('ZOTERO_OPERATION_CONFLICT', 'A Zotero operation cannot be reused for different material', { retrySafe: false, operationId });
      }
      return existing.promise;
    }
    if (operations.size >= MAX_OPERATIONS) throw zoteroError('ZOTERO_OPERATION_LIMIT', 'Too many Zotero operations in this worker session', { retrySafe: true });
    const record = { title: value.title, url: value.url, input: value, promise: null, identity: null };
    operations.set(operationId, record);
    // Register before hashing/emitting progress, including reentrant callbacks.
    record.identity = payloadIdentity(value);
    record.promise = record.identity.then(() => performEnhancedSnapshotSave(value, options, operationId));
    record.promise.then(() => { record.input = null; }, () => { record.input = null; });
    return record.promise;
  }

  return {
    DEFAULT_BASE_URL,
    MAX_SNAPSHOT_BYTES,
    MAX_NOTE_BYTES,
    DEFAULT_REQUEST_TIMEOUT_MS,
    normalizeBaseUrl,
    requestZotero,
    pingZotero,
    selectedZoteroTarget,
    validateEnhancedSnapshot,
    saveEnhancedSnapshotToZotero
  };
});
