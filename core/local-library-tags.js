(function attach(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory() {
  'use strict';

  const LOCAL_LIBRARY_TAGS_ASSET_PATH = 'annotations/library-tags.json';
  const MAX_TAGS = 32;
  const MAX_TAG_CODE_POINTS = 80;
  const MAX_RAW_TAG_CODE_UNITS = 4096;

  function fail(code) {
    const error = new Error(code);
    error.code = code;
    throw error;
  }

  // NFC preserves compatibility characters, scientific symbols and case.
  // Deduplication and filters use the resulting exact string as identity.
  function normalizeLocalLibraryTags(tags) {
    if (!Array.isArray(tags) || tags.length > MAX_TAGS) fail('LOCAL_LIBRARY_TAGS_INVALID');
    const result = [];
    const seen = new Set();
    for (const raw of tags) {
      if (typeof raw !== 'string' || raw.length > MAX_RAW_TAG_CODE_UNITS ||
          /[\u0000-\u001f\u007f-\u009f\u2028\u2029\ud800-\udfff]/u.test(raw)) {
        fail('LOCAL_LIBRARY_TAGS_INVALID');
      }
      const tag = raw.normalize('NFC').trim();
      if (!tag || [...tag].length > MAX_TAG_CODE_POINTS) fail('LOCAL_LIBRARY_TAGS_INVALID');
      if (!seen.has(tag)) {
        seen.add(tag);
        result.push(tag);
      }
    }
    return Object.freeze(result);
  }

  function normalizeLocalLibraryTagsAsset(value, options = {}) {
    const workspaceId = options?.workspaceId;
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
        typeof workspaceId !== 'string' || !/^workspace:[a-f0-9]{64}$/u.test(workspaceId) ||
        value.schemaVersion !== 1 || value.workspaceId !== workspaceId ||
        Object.keys(value).length !== 3 ||
        Object.keys(value).some(key => !['schemaVersion', 'workspaceId', 'tags'].includes(key)) ||
        !['schemaVersion', 'workspaceId', 'tags'].every(key => Object.hasOwn(value, key))) {
      fail('LOCAL_LIBRARY_TAGS_ASSET_INVALID');
    }
    let tags;
    try { tags = normalizeLocalLibraryTags(value.tags); } catch (_) {
      fail('LOCAL_LIBRARY_TAGS_ASSET_INVALID');
    }
    return Object.freeze({ schemaVersion: 1, workspaceId, tags });
  }

  return {
    LOCAL_LIBRARY_TAGS_ASSET_PATH,
    normalizeLocalLibraryTags,
    normalizeLocalLibraryTagsAsset
  };
});
