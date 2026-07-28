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

  function utf8Bytes(value) {
    return new TextEncoder().encode(String(value || '')).length;
  }

  function zoteroError(code, message, details = {}) {
    const error = new Error(message || code);
    error.code = code;
    Object.assign(error, details);
    return error;
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
    const response = await fetchImpl(`${baseUrl}${endpoint}`, {
      method: data === undefined ? 'GET' : 'POST',
      headers,
      body: data === undefined ? undefined : JSON.stringify(data),
      cache: 'no-store',
      signal: options.signal
    }).catch(error => {
      throw zoteroError(
        'ZOTERO_UNAVAILABLE',
        'Zotero desktop is not reachable. Keep Zotero open and try again.',
        { cause: error }
      );
    });
    const body = await readResponse(response);
    if (!response.ok) {
      throw zoteroError(
        'ZOTERO_IMPORT_FAILED',
        `Zotero Connector ${endpoint} returned HTTP ${response.status}`,
        { status: response.status, response: body }
      );
    }
    return {
      status: response.status,
      body,
      zoteroVersion: response.headers?.get?.('X-Zotero-Version') || ''
    };
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
        utf8Bytes(chatNoteHtml) > MAX_NOTE_BYTES) {
      throw zoteroError('ZOTERO_NOTE_TOO_LARGE', 'A Zotero child note exceeds 8 MB');
    }
    return {
      title,
      url: parsed.href,
      snapshotContent,
      figureNoteHtml,
      chatNoteHtml
    };
  }

  function randomSessionId() {
    const id = globalThis.crypto?.randomUUID?.() ||
      `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    return `sci-reader-${id}`;
  }

  async function saveEnhancedSnapshotToZotero(input, options = {}) {
    const value = validateEnhancedSnapshot(input);
    const ping = await pingZotero(options);
    const target = await selectedZoteroTarget({
      ...options,
      zoteroVersion: ping.version || options.zoteroVersion
    });
    const sessionID = randomSessionId();
    const requestOptions = {
      ...options,
      zoteroVersion: ping.version || target.zoteroVersion || options.zoteroVersion
    };
    const itemKey = `sci-reader-item-${sessionID}`;
    const notes = [
      value.figureNoteHtml ? { note: value.figureNoteHtml } : null,
      value.chatNoteHtml ? { note: value.chatNoteHtml } : null
    ].filter(Boolean);
    await requestZotero('saveItems', {
      sessionID,
      uri: value.url,
      items: [{
        id: itemKey,
        itemType: 'webpage',
        title: value.title,
        url: value.url,
        accessDate: new Date().toISOString(),
        tags: [{ tag: 'Brevess' }, { tag: '增强网页快照' }],
        notes
      }]
    }, requestOptions);
    if (target.filesEditable) {
      await requestZotero('saveSingleFile', {
        sessionID,
        items: [{ id: itemKey }],
        snapshotContent: value.snapshotContent,
        url: value.url,
        title: `${value.title} — Brevess 增强快照`
      }, requestOptions);
    }
    return {
      imported: true,
      sessionID,
      zoteroVersion: ping.version || target.zoteroVersion,
      target: target.target,
      libraryName: target.libraryName,
      collectionName: target.collectionName,
      snapshotAttached: target.filesEditable,
      noteAttached: notes.length > 0,
      notesAttached: notes.length,
      figureNoteAttached: Boolean(value.figureNoteHtml),
      chatNoteAttached: Boolean(value.chatNoteHtml)
    };
  }

  return {
    DEFAULT_BASE_URL,
    MAX_SNAPSHOT_BYTES,
    MAX_NOTE_BYTES,
    normalizeBaseUrl,
    requestZotero,
    pingZotero,
    selectedZoteroTarget,
    validateEnhancedSnapshot,
    saveEnhancedSnapshotToZotero
  };
});
