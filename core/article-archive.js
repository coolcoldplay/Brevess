(function attach(root, factory) {
  const api = factory(root.SciLLM || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory(shared) {
  const ARTICLE_ARCHIVE_KIND = 'sci-logic-highlighter-article';
  const ARTICLE_ARCHIVE_SCHEMA_VERSION = 1;
  const MAX_ARTICLE_ARCHIVE_BYTES = 12 * 1024 * 1024;
  const OMIT = Symbol('omit');

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
    return /(apikey|authorization|credential|secret|accesstoken|refreshtoken|headers?|dataurl|pagehtml|documenthtml|outerhtml|innerhtml|rawhtml|fullhtml)/u
      .test(key);
  }

  function sanitizePortableValue(value, depth = 0) {
    if (depth > 40) fail('ARTICLE_ARCHIVE_TOO_DEEP');
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value === 'string') {
      if (/^data:/iu.test(value.trim())) return OMIT;
      return value;
    }
    if (Array.isArray(value)) {
      return value.map(item => sanitizePortableValue(item, depth + 1))
        .filter(item => item !== OMIT);
    }
    if (!isPlainObject(value)) return OMIT;
    return Object.fromEntries(Object.entries(value).flatMap(([key, item]) => {
      if (forbiddenKey(key)) return [];
      const sanitized = sanitizePortableValue(item, depth + 1);
      return sanitized === OMIT ? [] : [[key, sanitized]];
    }));
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
      workspace: sanitizePortableValue(input.workspace || {})
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
    return validateArticleArchive({
      schemaVersion: ARTICLE_ARCHIVE_SCHEMA_VERSION,
      kind: ARTICLE_ARCHIVE_KIND,
      revision: Number(input.revision) || 1,
      savedAt: input.savedAt || new Date().toISOString(),
      extensionVersion: input.extensionVersion || '',
      documentId,
      documentHash: identity.documentHash || documentRecord.documentHash || '',
      canonicalUrl: identity.canonicalUrl || documentRecord.canonicalUrl || '',
      title: identity.title || documentRecord.title || '',
      publisher: identity.publisher || '',
      documentRecord,
      workspace: input.workspace || {}
    });
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
    convertLegacyArticleArchiveToWorkspace
  };
});
