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

  return {
    tokenizePrivacyKey,
    normalizePrivacyKey,
    isCredentialKey,
    isExportSensitiveKey
  };
});
