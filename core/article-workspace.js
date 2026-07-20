(function attach(root, factory) {
  const api = factory(root.SciLLM || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory(shared) {
  const ARTICLE_WORKSPACE_SCHEMA_VERSION = 1;
  const WINDOWS_RESERVED_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu;
  const CREDENTIAL_KEY = /(?:api.?key|authorization|credential|secret|access.?token|refresh.?token|password|bearer|custom.?headers?)/iu;

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

  function normalizeText(value, maximum = 2000) {
    return String(value ?? '').normalize('NFKC').replace(/\s+/gu, ' ').trim().slice(0, maximum);
  }

  function normalizeWorkspaceCanonicalUrl(value) {
    const raw = normalizeText(value, 4000);
    if (!raw) return '';
    try {
      const parsed = new URL(raw);
      if (!/^https?:$/u.test(parsed.protocol)) fail('INVALID_WORKSPACE_URL');
      parsed.username = '';
      parsed.password = '';
      parsed.search = '';
      parsed.hash = '';
      parsed.hostname = parsed.hostname.toLocaleLowerCase('en-US');
      parsed.pathname = parsed.pathname.replace(/\/{2,}/gu, '/').replace(/\/+$/u, '') || '/';
      return `${parsed.origin}${parsed.pathname === '/' ? '' : parsed.pathname}`;
    } catch (error) {
      if (error?.code === 'INVALID_WORKSPACE_URL') throw error;
      fail('INVALID_WORKSPACE_URL');
    }
  }

  function normalizeDoi(value, canonicalUrl = '') {
    let doi = normalizeText(value, 500);
    if (!doi && canonicalUrl) {
      try {
        const parsed = new URL(canonicalUrl);
        if (/^(?:dx\.)?doi\.org$/iu.test(parsed.hostname)) {
          doi = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''));
        }
      } catch (_) {}
    }
    return doi.replace(/^https?:\/\/(?:dx\.)?doi\.org\//iu, '')
      .replace(/^doi\s*:\s*/iu, '').split(/[?#]/u, 1)[0].trim()
      .toLocaleLowerCase('en-US').slice(0, 500);
  }

  function normalizeSiteId(value) {
    return normalizeText(value, 500).toLocaleLowerCase('en-US');
  }

  function assertWorkspaceSafeValue(value, depth = 0, seen = new Set()) {
    if (depth > 40) fail('WORKSPACE_VALUE_TOO_DEEP');
    if (value === null || value === undefined || typeof value !== 'object') return value;
    if (seen.has(value)) fail('WORKSPACE_VALUE_CYCLIC');
    seen.add(value);
    if (Array.isArray(value)) {
      value.forEach(item => assertWorkspaceSafeValue(item, depth + 1, seen));
    } else {
      for (const [key, item] of Object.entries(value)) {
        if (CREDENTIAL_KEY.test(key.replace(/[^a-z0-9]/giu, ''))) {
          fail('WORKSPACE_CONTAINS_CREDENTIALS');
        }
        assertWorkspaceSafeValue(item, depth + 1, seen);
      }
    }
    seen.delete(value);
    return value;
  }

  function normalizeWorkspaceRelativePath(value) {
    const raw = String(value ?? '').normalize('NFKC').trim().replace(/\\/gu, '/');
    if (!raw || raw.length > 500 || raw.startsWith('/') || /^[a-z]:/iu.test(raw) ||
        /^[a-z][a-z0-9+.-]*:/iu.test(raw) || /[\u0000-\u001f\u007f]/u.test(raw)) {
      fail('INVALID_WORKSPACE_PATH');
    }
    const parts = raw.split('/');
    if (!parts.length || parts.some(part => !part || part === '.' || part === '..' ||
        part.length > 180 || WINDOWS_RESERVED_NAME.test(part) || /[:*?"<>|]/u.test(part))) {
      fail('INVALID_WORKSPACE_PATH');
    }
    return parts.join('/');
  }

  function workspaceHash(value) {
    const normalized = String(value || '').replace(/^workspace:/iu, '').toLocaleLowerCase('en-US');
    if (!/^[a-f0-9]{12,}$/u.test(normalized)) fail('INVALID_WORKSPACE_ID');
    return normalized;
  }

  function createWorkspaceDirectoryName(title, workspaceId) {
    const hash = workspaceHash(workspaceId);
    const rawTitle = normalizeText(title, 400);
    if (WINDOWS_RESERVED_NAME.test(rawTitle)) fail('INVALID_WORKSPACE_DIRECTORY');
    const safeTitle = rawTitle
      .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/gu, ' ')
      .replace(/[. ]+$/gu, '').replace(/\s+/gu, ' ').trim().slice(0, 92);
    if (!safeTitle || safeTitle === '.' || safeTitle === '..' || WINDOWS_RESERVED_NAME.test(safeTitle)) {
      fail('INVALID_WORKSPACE_DIRECTORY');
    }
    return `${safeTitle}--${hash.slice(0, 16)}`;
  }

  function bytesToHex(buffer) {
    return [...new Uint8Array(buffer)].map(value => value.toString(16).padStart(2, '0')).join('');
  }

  async function sha256Hex(value) {
    if (typeof shared.sha256Hex === 'function') {
      const result = String(await shared.sha256Hex(String(value))).replace(/^sha256:/iu, '').toLowerCase();
      if (/^[a-f0-9]{64}$/u.test(result)) return result;
      fail('INVALID_SHA256_DIGEST');
    }
    let subtle = globalThis.crypto?.subtle;
    if (!subtle && typeof require === 'function') subtle = require('node:crypto').webcrypto.subtle;
    if (!subtle) fail('SHA256_UNAVAILABLE');
    return bytesToHex(await subtle.digest('SHA-256', new TextEncoder().encode(String(value))));
  }

  async function createArticleWorkspaceIdentity(input = {}) {
    if (!isPlainObject(input)) fail('INVALID_WORKSPACE');
    const canonicalUrl = normalizeWorkspaceCanonicalUrl(input.canonicalUrl || input.url);
    const doi = normalizeDoi(input.doi, canonicalUrl);
    const siteId = normalizeSiteId(input.siteId || input.publisherId || input.pii);
    if (!canonicalUrl && !doi && !siteId) fail('WORKSPACE_IDENTITY_REQUIRED');
    const primaryIdentity = canonicalUrl || (doi ? `doi:${doi}` : `site:${siteId}`);
    const identityHash = await sha256Hex(primaryIdentity);
    const suppliedHash = String(input.contentHash || input.documentHash || '')
      .replace(/^sha256:/iu, '').toLocaleLowerCase('en-US');
    const contentHash = suppliedHash
      ? (/^[a-f0-9]{64}$/u.test(suppliedHash) ? suppliedHash : fail('INVALID_CONTENT_HASH'))
      : await sha256Hex(String(input.content || input.text || primaryIdentity)
        .normalize('NFKC').replace(/\s+/gu, ' ').trim());
    const workspaceId = `workspace:${identityHash}`;
    const title = normalizeText(input.title || 'Untitled article', 1000);
    const aliases = [];
    if (doi) aliases.push({ type: 'doi', value: doi });
    if (siteId) aliases.push({ type: 'site', value: siteId });
    return {
      schemaVersion: ARTICLE_WORKSPACE_SCHEMA_VERSION,
      workspaceId,
      canonicalUrl,
      aliases,
      title,
      directoryName: createWorkspaceDirectoryName(title, workspaceId),
      revision: contentHash,
      contentHash
    };
  }

  return {
    ARTICLE_WORKSPACE_SCHEMA_VERSION,
    normalizeWorkspaceCanonicalUrl,
    normalizeWorkspaceRelativePath,
    normalizeWorkspaceDoi: normalizeDoi,
    normalizeWorkspaceSiteId: normalizeSiteId,
    assertWorkspaceSafeValue,
    createWorkspaceDirectoryName,
    createArticleWorkspaceIdentity
  };
});
