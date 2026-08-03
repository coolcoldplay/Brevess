(function attach(root, factory) {
  const api = factory(root.SciLLM || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory(shared) {
  const ARTICLE_WORKSPACE_SCHEMA_VERSION = 1;
  const WORKSPACE_MANIFEST_KIND = 'sci-logic-highlighter-workspace';
  const WORKSPACE_INDEX_KIND = 'sci-logic-highlighter-workspace-index';
  const WINDOWS_RESERVED_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu;
  let privacy = shared;
  if (typeof privacy.isCredentialKey !== 'function' && typeof require === 'function') {
    try { privacy = require('./privacy-sanitizer.js'); } catch (_) {}
  }
  if (typeof privacy.isCredentialKey !== 'function') {
    const error = new Error('PRIVACY_SANITIZER_UNAVAILABLE');
    error.code = 'PRIVACY_SANITIZER_UNAVAILABLE';
    throw error;
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
        if (privacy.isCredentialKey(key)) {
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

  function validateNonNegativeInteger(value, code) {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < 0) fail(code);
    return number;
  }

  function normalizeAliases(value) {
    const aliases = [];
    for (const alias of Array.isArray(value) ? value : []) {
      if (!isPlainObject(alias) || !['doi', 'site'].includes(alias.type)) continue;
      const normalized = alias.type === 'doi'
        ? normalizeDoi(alias.value) : normalizeSiteId(alias.value);
      if (normalized && !aliases.some(item => item.type === alias.type && item.value === normalized)) {
        aliases.push({ type: alias.type, value: normalized });
      }
    }
    return aliases;
  }

  function normalizeManifestAsset(input) {
    if (!isPlainObject(input)) fail('INVALID_WORKSPACE_MANIFEST_ASSET');
    return {
      path: normalizeWorkspaceRelativePath(input.path),
      type: input.type === 'text' ? 'text' : 'json',
      revision: validateNonNegativeInteger(input.revision ?? 0, 'INVALID_WORKSPACE_ASSET_REVISION'),
      contentHash: normalizeText(input.contentHash, 300),
      updatedAt: normalizeText(input.updatedAt, 80)
    };
  }

  function normalizeManifest(input) {
    if (!isPlainObject(input) || input.schemaVersion !== ARTICLE_WORKSPACE_SCHEMA_VERSION ||
        input.kind !== WORKSPACE_MANIFEST_KIND) fail('INVALID_WORKSPACE_MANIFEST');
    assertWorkspaceSafeValue(input);
    const id = `workspace:${workspaceHash(input.workspaceId)}`;
    const directoryName = normalizeText(input.directoryName, 180);
    const suffix = directoryName.split('--').at(-1)?.toLocaleLowerCase('en-US') || '';
    if (!directoryName || suffix.length < 12 || !workspaceHash(id).startsWith(suffix)) {
      fail('INVALID_WORKSPACE_DIRECTORY');
    }
    const contentHash = String(input.contentHash || input.contentRevision || '')
      .replace(/^sha256:/iu, '').toLocaleLowerCase('en-US');
    if (!/^[a-f0-9]{64}$/u.test(contentHash)) fail('INVALID_CONTENT_HASH');
    const assets = (Array.isArray(input.assets) ? input.assets : []).map(normalizeManifestAsset)
      .sort((first, second) => first.path.localeCompare(second.path));
    if (new Set(assets.map(asset => asset.path)).size !== assets.length) {
      fail('DUPLICATE_WORKSPACE_ASSET');
    }
    return {
      schemaVersion: ARTICLE_WORKSPACE_SCHEMA_VERSION,
      kind: WORKSPACE_MANIFEST_KIND,
      workspaceId: id,
      directoryName,
      canonicalUrl: normalizeWorkspaceCanonicalUrl(input.canonicalUrl),
      aliases: normalizeAliases(input.aliases),
      title: normalizeText(input.title, 1000),
      contentHash,
      revision: validateNonNegativeInteger(input.revision, 'INVALID_WORKSPACE_MANIFEST_REVISION'),
      workspaceGeneration: validateNonNegativeInteger(
        input.workspaceGeneration ?? 1, 'INVALID_WORKSPACE_GENERATION'
      ),
      createdAt: normalizeText(input.createdAt, 80),
      updatedAt: normalizeText(input.updatedAt, 80),
      assets
    };
  }

  function createWorkspaceManifest(workspace, assets = []) {
    if (!isPlainObject(workspace)) fail('INVALID_WORKSPACE');
    return normalizeManifest({
      schemaVersion: ARTICLE_WORKSPACE_SCHEMA_VERSION,
      kind: WORKSPACE_MANIFEST_KIND,
      workspaceId: workspace.workspaceId,
      directoryName: workspace.directoryName,
      canonicalUrl: workspace.canonicalUrl,
      aliases: workspace.aliases,
      title: workspace.title,
      contentHash: workspace.contentHash || workspace.revision,
      revision: Number.isSafeInteger(workspace.storageRevision)
        ? workspace.storageRevision : 1,
      workspaceGeneration: Number.isSafeInteger(workspace.workspaceGeneration)
        ? workspace.workspaceGeneration : 1,
      createdAt: workspace.createdAt || '',
      updatedAt: workspace.updatedAt || '',
      assets
    });
  }

  function validateWorkspaceManifest(input) {
    return normalizeManifest(input);
  }

  function manifestIndexEntry(manifestInput) {
    const manifest = validateWorkspaceManifest(manifestInput);
    return {
      workspaceId: manifest.workspaceId,
      directoryName: manifest.directoryName,
      manifestPath: `workspaces/${manifest.directoryName}/manifest.json`,
      canonicalUrl: manifest.canonicalUrl,
      aliases: manifest.aliases,
      title: manifest.title,
      contentHash: manifest.contentHash,
      revision: manifest.revision,
      workspaceGeneration: manifest.workspaceGeneration,
      createdAt: manifest.createdAt,
      updatedAt: manifest.updatedAt,
      assetCount: manifest.assets.length
    };
  }

  function createWorkspaceIndex(manifests, input = {}) {
    const entries = (Array.isArray(manifests) ? manifests : []).map(manifestIndexEntry)
      .sort((first, second) => first.workspaceId.localeCompare(second.workspaceId));
    if (new Set(entries.map(entry => entry.workspaceId)).size !== entries.length) {
      fail('DUPLICATE_WORKSPACE_INDEX_ENTRY');
    }
    return {
      schemaVersion: ARTICLE_WORKSPACE_SCHEMA_VERSION,
      kind: WORKSPACE_INDEX_KIND,
      revision: Number.isSafeInteger(input.revision)
        ? input.revision : Math.max(0, ...entries.map(entry => entry.revision)),
      updatedAt: normalizeText(input.updatedAt ||
        entries.map(entry => entry.updatedAt).filter(Boolean).sort().at(-1), 80),
      workspaces: entries
    };
  }

  function validateWorkspaceIndex(input) {
    if (!isPlainObject(input) || input.schemaVersion !== ARTICLE_WORKSPACE_SCHEMA_VERSION ||
        input.kind !== WORKSPACE_INDEX_KIND || !Array.isArray(input.workspaces)) {
      fail('INVALID_WORKSPACE_INDEX');
    }
    assertWorkspaceSafeValue(input);
    const workspaces = input.workspaces.map(entry => {
      if (!isPlainObject(entry)) fail('INVALID_WORKSPACE_INDEX_ENTRY');
      const manifest = normalizeManifest({
        schemaVersion: ARTICLE_WORKSPACE_SCHEMA_VERSION,
        kind: WORKSPACE_MANIFEST_KIND,
        ...entry,
        assets: []
      });
      const expectedPath = `workspaces/${manifest.directoryName}/manifest.json`;
      const manifestPath = normalizeWorkspaceRelativePath(entry.manifestPath);
      if (manifestPath !== expectedPath) fail('INVALID_WORKSPACE_INDEX_ENTRY');
      return {
        workspaceId: manifest.workspaceId,
        directoryName: manifest.directoryName,
        manifestPath,
        canonicalUrl: manifest.canonicalUrl,
        aliases: manifest.aliases,
        title: manifest.title,
        contentHash: manifest.contentHash,
        revision: manifest.revision,
        workspaceGeneration: manifest.workspaceGeneration,
        createdAt: manifest.createdAt,
        updatedAt: manifest.updatedAt,
        assetCount: validateNonNegativeInteger(
          entry.assetCount ?? 0, 'INVALID_WORKSPACE_INDEX_ENTRY'
        )
      };
    }).sort((first, second) => first.workspaceId.localeCompare(second.workspaceId));
    if (new Set(workspaces.map(entry => entry.workspaceId)).size !== workspaces.length) {
      fail('DUPLICATE_WORKSPACE_INDEX_ENTRY');
    }
    return {
      schemaVersion: ARTICLE_WORKSPACE_SCHEMA_VERSION,
      kind: WORKSPACE_INDEX_KIND,
      revision: validateNonNegativeInteger(input.revision, 'INVALID_WORKSPACE_INDEX_REVISION'),
      updatedAt: normalizeText(input.updatedAt, 80),
      workspaces
    };
  }

  function queryAliases(identity) {
    const aliases = normalizeAliases(identity?.aliases);
    const doi = normalizeDoi(identity?.doi, identity?.canonicalUrl || identity?.url);
    const site = normalizeSiteId(identity?.siteId || identity?.publisherId || identity?.pii);
    if (doi && !aliases.some(item => item.type === 'doi' && item.value === doi)) {
      aliases.push({ type: 'doi', value: doi });
    }
    if (site && !aliases.some(item => item.type === 'site' && item.value === site)) {
      aliases.push({ type: 'site', value: site });
    }
    return aliases;
  }

  function matchWorkspaceManifests(identity, manifestInputs) {
    if (!isPlainObject(identity)) return [];
    let canonicalUrl = '';
    try { canonicalUrl = normalizeWorkspaceCanonicalUrl(identity.canonicalUrl || identity.url); } catch (_) {}
    const aliases = queryAliases(identity);
    const id = /^workspace:[a-f0-9]{64}$/iu.test(String(identity.workspaceId || ''))
      ? String(identity.workspaceId).toLocaleLowerCase('en-US') : '';
    if (!canonicalUrl && !aliases.length && !id) return [];
    const contentHash = String(identity.contentHash || identity.documentHash || '')
      .replace(/^sha256:/iu, '').toLocaleLowerCase('en-US');
    return (Array.isArray(manifestInputs) ? manifestInputs : []).flatMap(input => {
      let manifest;
      try { manifest = validateWorkspaceManifest(input); } catch (_) { return []; }
      const identityMatches = (id && manifest.workspaceId === id) ||
        (canonicalUrl && manifest.canonicalUrl === canonicalUrl) ||
        aliases.some(alias => manifest.aliases.some(candidate =>
          candidate.type === alias.type && candidate.value === alias.value));
      if (!identityMatches) return [];
      return [{
        match: contentHash && contentHash !== manifest.contentHash ? 'content-changed' : 'exact',
        manifest
      }];
    }).sort((first, second) => {
      if (first.match !== second.match) return first.match === 'exact' ? -1 : 1;
      return String(second.manifest.updatedAt).localeCompare(String(first.manifest.updatedAt));
    });
  }

  return {
    ARTICLE_WORKSPACE_SCHEMA_VERSION,
    WORKSPACE_MANIFEST_KIND,
    WORKSPACE_INDEX_KIND,
    normalizeWorkspaceCanonicalUrl,
    normalizeWorkspaceRelativePath,
    normalizeWorkspaceDoi: normalizeDoi,
    normalizeWorkspaceSiteId: normalizeSiteId,
    assertWorkspaceSafeValue,
    createWorkspaceDirectoryName,
    createArticleWorkspaceIdentity,
    createWorkspaceManifest,
    validateWorkspaceManifest,
    createWorkspaceIndex,
    validateWorkspaceIndex,
    matchWorkspaceManifests
  };
});
