(function attach(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory() {
  const MIGRATION_BUNDLE_KIND = 'sci-logic-highlighter-migration';
  const MIGRATION_SCHEMA_VERSION = 1;
  const MAX_MIGRATION_BUNDLE_BYTES = 20 * 1024 * 1024;
  const BLOCKED_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

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

  function clonePortable(value, depth = 0) {
    if (depth > 50) fail('MIGRATION_BUNDLE_TOO_DEEP');
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (Array.isArray(value)) return value.map(item => clonePortable(item, depth + 1));
    if (!isPlainObject(value)) return null;
    return Object.fromEntries(Object.entries(value)
      .filter(([key]) => !BLOCKED_KEYS.has(key))
      .map(([key, item]) => [key, clonePortable(item, depth + 1)]));
  }

  function byteLength(value) {
    const serialized = JSON.stringify(value);
    if (typeof TextEncoder === 'function') return new TextEncoder().encode(serialized).byteLength;
    if (typeof Buffer !== 'undefined') return Buffer.byteLength(serialized, 'utf8');
    return serialized.length * 2;
  }

  function validateMigrationBundle(input) {
    if (!isPlainObject(input) || input.kind !== MIGRATION_BUNDLE_KIND ||
        input.schemaVersion !== MIGRATION_SCHEMA_VERSION) {
      fail('INVALID_MIGRATION_SCHEMA');
    }
    if (!isPlainObject(input.settings)) fail('INVALID_MIGRATION_SETTINGS');
    if (!isPlainObject(input.documents) || !Array.isArray(input.documents.documents)) {
      fail('INVALID_MIGRATION_DOCUMENTS');
    }
    if (!Array.isArray(input.feedbackSamples)) fail('INVALID_MIGRATION_FEEDBACK');
    const exportedAt = String(input.exportedAt || '');
    if (!exportedAt || !Number.isFinite(Date.parse(exportedAt))) {
      fail('INVALID_MIGRATION_TIMESTAMP');
    }
    const bundle = {
      schemaVersion: MIGRATION_SCHEMA_VERSION,
      kind: MIGRATION_BUNDLE_KIND,
      exportedAt,
      extensionVersion: String(input.extensionVersion || '').slice(0, 80),
      containsSecrets: true,
      directoryHandleExcluded: true,
      settings: clonePortable(input.settings),
      documents: clonePortable(input.documents),
      feedbackSamples: clonePortable(input.feedbackSamples)
    };
    if (byteLength(bundle) > MAX_MIGRATION_BUNDLE_BYTES) fail('MIGRATION_BUNDLE_TOO_LARGE');
    return bundle;
  }

  function createMigrationBundle(input = {}) {
    if (!isPlainObject(input.settings)) fail('INVALID_MIGRATION_SETTINGS');
    return validateMigrationBundle({
      schemaVersion: MIGRATION_SCHEMA_VERSION,
      kind: MIGRATION_BUNDLE_KIND,
      exportedAt: input.exportedAt || new Date().toISOString(),
      extensionVersion: input.extensionVersion || '',
      settings: input.settings,
      documents: input.documents || { schemaVersion: 1, index: [], documents: [] },
      feedbackSamples: input.feedbackSamples || []
    });
  }

  return {
    MIGRATION_BUNDLE_KIND,
    MIGRATION_SCHEMA_VERSION,
    MAX_MIGRATION_BUNDLE_BYTES,
    createMigrationBundle,
    validateMigrationBundle
  };
});
