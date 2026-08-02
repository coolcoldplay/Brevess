(function attach(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory() {
  const EXACT_CREDENTIAL_KEYS = new Set([
    'authorization', 'bearer', 'bearertoken', 'credential', 'credentials',
    'header', 'headers', 'password', 'secret', 'token',
    'authtoken', 'accesstoken', 'refreshtoken', 'providertoken',
    'sessiontoken', 'idtoken'
  ]);

  function normalizePrivacyKey(value) {
    return String(value || '').normalize('NFKC').toLowerCase()
      .replace(/[^a-z0-9]/gu, '');
  }

  function isCredentialKey(value) {
    const key = normalizePrivacyKey(value);
    if (!key) return false;
    if (EXACT_CREDENTIAL_KEYS.has(key)) return true;
    if (key.endsWith('apikey') || key.endsWith('apisecret') ||
        key.endsWith('clientsecret') || key.endsWith('providersecret') ||
        key.endsWith('customheader') || key.endsWith('customheaders') ||
        key.endsWith('authorization') || key.endsWith('credential') ||
        key.endsWith('credentials') || key.endsWith('password')) return true;
    return false;
  }

  function isExportSensitiveKey(value) {
    const key = normalizePrivacyKey(value);
    return isCredentialKey(key) || key === 'provider' || key === 'providers' ||
      key === 'selectedprovider' || key.startsWith('provider');
  }

  return {
    normalizePrivacyKey,
    isCredentialKey,
    isExportSensitiveKey
  };
});
