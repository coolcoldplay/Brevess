(function attach(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory() {
  const TOKEN_METRIC_SUFFIXES = new Set([
    'budget', 'budgets', 'count', 'counts', 'estimate', 'estimates',
    'metric', 'metrics', 'stat', 'stats', 'usage'
  ]);
  const TOKEN_METRIC_PREFIXES = new Set([
    'cache', 'cached', 'completion', 'hit', 'input', 'max', 'output',
    'prompt', 'reasoning', 'total'
  ]);
  const TOKEN_CREDENTIAL_QUALIFIERS = new Set([
    'access', 'api', 'auth', 'authentication', 'bearer', 'client', 'github',
    'id', 'personal', 'private', 'provider', 'refresh', 'session', 'webhook'
  ]);
  const KEY_CREDENTIAL_QUALIFIERS = new Set([
    'access', 'api', 'auth', 'authentication', 'client', 'encryption',
    'personal', 'private', 'provider', 'secret', 'signing', 'webhook'
  ]);
  const MAX_OFFLINE_SNAPSHOT_BYTES = 64 * 1024 * 1024;
  const OFFLINE_SNAPSHOT_GLOBAL_ATTRIBUTES = new Set([
    'abbr', 'alt', 'class', 'colspan', 'datetime', 'dir', 'headers', 'height',
    'hidden', 'id', 'lang', 'open', 'rel', 'reversed', 'role', 'rowspan',
    'scope', 'span', 'start', 'title', 'type', 'value', 'width'
  ]);
  const OFFLINE_SNAPSHOT_SAFE_DATA_ATTRIBUTES = new Set([
    'data-sci-embedded-original',
    'data-sci-highlight-source',
    'data-sci-original-height',
    'data-sci-original-width'
  ]);
  const OFFLINE_SNAPSHOT_ARIA_ATTRIBUTES = new Set([
    'aria-controls', 'aria-current', 'aria-describedby', 'aria-expanded',
    'aria-hidden', 'aria-label', 'aria-labelledby', 'aria-level', 'aria-role'
  ]);

  function tokenizePrivacyKey(value) {
    const separated = String(value || '').normalize('NFKC')
      .replace(/([A-Z]+)([A-Z][a-z])/gu, '$1 $2')
      .replace(/([a-z0-9])([A-Z])/gu, '$1 $2')
      .replace(/[^A-Za-z0-9]+/gu, ' ')
      .trim()
      .toLowerCase();
    return separated ? separated.split(/\s+/u) : [];
  }

  function normalizePrivacyKey(value) {
    return tokenizePrivacyKey(value).join('');
  }

  function hasAdjacentPair(tokens, first, second) {
    return tokens.some((token, index) => token === first && tokens[index + 1] === second);
  }

  function isCredentialKey(value) {
    const tokens = tokenizePrivacyKey(value);
    if (!tokens.length) return false;
    if (tokens.some(token => [
      'authorization', 'bearer', 'credential', 'credentials', 'password', 'secret'
    ].includes(token))) return true;
    if (tokens.length === 1 && (tokens[0] === 'header' || tokens[0] === 'headers')) {
      return true;
    }
    if ((tokens.includes('header') || tokens.includes('headers')) &&
        tokens.some(token => [
          'auth', 'authentication', 'authorization', 'bearer', 'custom'
        ].includes(token))) return true;
    if (tokens.some((token, index) => token === 'key' &&
        KEY_CREDENTIAL_QUALIFIERS.has(tokens[index - 1]))) return true;
    if (tokens.some((token, index) => (token === 'token' || token === 'tokens') &&
        TOKEN_CREDENTIAL_QUALIFIERS.has(tokens[index - 1]))) return true;
    for (let index = 0; index < tokens.length; index += 1) {
      if (tokens[index] !== 'token' && tokens[index] !== 'tokens') continue;
      const prefixes = tokens.slice(0, index);
      if (prefixes.some(token => TOKEN_CREDENTIAL_QUALIFIERS.has(token))) return true;
      if (TOKEN_METRIC_SUFFIXES.has(tokens[index + 1])) continue;
      if (prefixes.some(token => TOKEN_METRIC_PREFIXES.has(token))) continue;
      return true;
    }
    if (hasAdjacentPair(tokens, 'custom', 'header') ||
        hasAdjacentPair(tokens, 'custom', 'headers')) return true;
    return false;
  }

  function isExportSensitiveKey(value) {
    const tokens = tokenizePrivacyKey(value);
    return isCredentialKey(value) || tokens.includes('provider') ||
      tokens.includes('providers');
  }

  function isAllowedOfflineSnapshotAttribute(tagName, attributeName, value) {
    const tag = String(tagName || '').trim().toLowerCase();
    const name = String(attributeName || '').trim().toLowerCase();
    const content = String(value || '').trim();
    if (!tag || !name || /^on/i.test(name)) return false;
    if (OFFLINE_SNAPSHOT_ARIA_ATTRIBUTES.has(name)) return true;
    if (OFFLINE_SNAPSHOT_SAFE_DATA_ATTRIBUTES.has(name)) return true;
    if (name === 'for') return tag === 'label';
    if (name === 'cite') return ['blockquote', 'q'].includes(tag) &&
      /^https?:\/\//i.test(content);
    if (name === 'href') {
      return ['a', 'area'].includes(tag) &&
        (/^#[^\s]*$/u.test(content) || /^https?:\/\//i.test(content));
    }
    if (name === 'src') {
      return tag === 'img' &&
        /^data:image\/(?:avif|gif|jpe?g|png|webp);base64,/i.test(content);
    }
    if (name === 'rel') return ['a', 'area'].includes(tag);
    if (!OFFLINE_SNAPSHOT_GLOBAL_ATTRIBUTES.has(name)) return false;
    if (name === 'value') return tag === 'li';
    if (name === 'type') return ['ol', 'ul', 'li'].includes(tag);
    return true;
  }

  function offlineSnapshotUtf8Bytes(value) {
    const text = String(value || '');
    if (typeof TextEncoder === 'function') return new TextEncoder().encode(text).byteLength;
    if (typeof Buffer === 'function') return Buffer.byteLength(text, 'utf8');
    return unescape(encodeURIComponent(text)).length;
  }

  function selectBoundedOfflineSnapshotHtml(
    htmlWithImages,
    fallbackHtmlFactory,
    maxBytes = MAX_OFFLINE_SNAPSHOT_BYTES
  ) {
    const boundedMaxBytes = Math.max(1, Math.floor(Number(maxBytes) || 0));
    const primaryHtml = String(htmlWithImages || '');
    const primaryByteSize = offlineSnapshotUtf8Bytes(primaryHtml);
    if (primaryByteSize <= boundedMaxBytes) {
      return {
        html: primaryHtml,
        byteSize: primaryByteSize,
        embeddedImagesRetained: true
      };
    }
    const fallbackHtml = String(
      typeof fallbackHtmlFactory === 'function' ? fallbackHtmlFactory() : ''
    );
    const fallbackByteSize = offlineSnapshotUtf8Bytes(fallbackHtml);
    if (fallbackByteSize <= boundedMaxBytes) {
      return {
        html: fallbackHtml,
        byteSize: fallbackByteSize,
        embeddedImagesRetained: false
      };
    }
    const error = Object.assign(
      new Error('离线快照在移除图片后仍超过 64 MiB，未保存；请缩短正文后重试。'),
      {
        code: 'OFFLINE_SNAPSHOT_TOO_LARGE_AFTER_IMAGE_FALLBACK',
        byteSize: fallbackByteSize,
        maxBytes: boundedMaxBytes
      }
    );
    throw error;
  }

  return {
    tokenizePrivacyKey,
    normalizePrivacyKey,
    isCredentialKey,
    isExportSensitiveKey,
    MAX_OFFLINE_SNAPSHOT_BYTES,
    isAllowedOfflineSnapshotAttribute,
    selectBoundedOfflineSnapshotHtml
  };
});
