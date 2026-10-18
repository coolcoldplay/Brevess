(function attach(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.BrevessTranslationCheckpoint = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory() {
  'use strict';
  const VERSION = 1;
  const LOCAL_SIGNATURE = 'browser-translator:en:zh:validated-prefix-v2';
  function navigationIdentity(value) {
    try { const url = new URL(value); url.hash = ''; return url.href; }
    catch { return String(value || '').replace(/#.*/, ''); }
  }
  function stableBinding(value) {
    const url = navigationIdentity(value?.pageUrl || value?.navigationIdentity || value?.url);
    if (!/^https?:\/\//u.test(url)) return null;
    return { url, ...(typeof value?.documentHash === 'string' && value.documentHash
      ? { documentHash: value.documentHash } : {}) };
  }
  function sourceKey(element) {
    const path = [];
    for (let node = element; node?.nodeType === 1; node = node.parentElement) {
      const tag = String(node.tagName || '').toLowerCase();
      if (!tag) return null;
      // Plugin output never changes paragraph positions in this anchor.
      const siblings = [...(node.parentElement?.children || node.parentElement?.childNodes || [])]
        .filter(item => item.nodeType === 1 && item.tagName === node.tagName &&
          !item.matches?.('[data-sci-plugin-ui],[data-sci-translation]'));
      path.unshift(`${tag}:${Math.max(0, siblings.indexOf(node))}`);
      if (path.length > 64) return null;
    }
    return path.length ? `dom:${path.join('/')}` : null;
  }
  function normalizeEntry(value) {
    if (!value || typeof value.sourceKey !== 'string' || !value.sourceKey ||
        typeof value.sourceText !== 'string' || !value.sourceText || value.sourceText.length > 200000 ||
        typeof value.translatedText !== 'string' || !value.translatedText.trim() || value.translatedText.length > 200000 ||
        value.sourceStart !== 0 || !Number.isInteger(value.sourceEnd) || value.sourceEnd <= 0 || value.sourceEnd > value.sourceText.length ||
        typeof value.engineSignature !== 'string' || !value.engineSignature ||
        value.sourceLanguage !== 'en' || value.targetLanguage !== 'zh' || value.confirmed !== true) return null;
    const partial = value.sourceEnd < value.sourceText.length;
    // Manual edits remain valid confirmed output but never become native-model prefixes.
    return { sourceKey: value.sourceKey, sourceText: value.sourceText, translatedText: value.translatedText,
      sourceStart: 0, sourceEnd: value.sourceEnd, partial, sourceLanguage: 'en', targetLanguage: 'zh',
      engineSignature: value.engineSignature, confirmed: true, manuallyEdited: value.manuallyEdited === true };
  }
  function error(code) { return Object.assign(new Error(code), { code }); }
  async function sha256(value, cryptoApi = globalThis.crypto) {
    if (!cryptoApi?.subtle?.digest) throw error('TRANSLATION_CHECKPOINT_DIGEST_UNAVAILABLE');
    const bytes = await cryptoApi.subtle.digest('SHA-256', new TextEncoder().encode(value));
    return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  }
  // Instantiate once in the background. Serialization must span every tab, not
  // just one content script. No schema migration or deletion of older data.
  function createStore({ storage, crypto: cryptoApi = globalThis.crypto } = {}) {
    let tail = Promise.resolve();
    function serialize(run) {
      const next = tail.then(run, run); tail = next.catch(() => {}); return next;
    }
    async function keyFor(binding, engineSignature) {
      const documentBinding = stableBinding(binding);
      if (!documentBinding || typeof engineSignature !== 'string' || !engineSignature) throw error('TRANSLATION_CHECKPOINT_IDENTITY_REQUIRED');
      return { documentBinding, key: 'brevess.translation.checkpoint.v1.' + await sha256(JSON.stringify([documentBinding, engineSignature]), cryptoApi) };
    }
    function read(binding, engineSignature) { return serialize(async () => {
      const { key, documentBinding } = await keyFor(binding, engineSignature);
      const saved = (await storage.get(key))?.[key];
      if (!saved) return { version: VERSION, documentBinding, engineSignature, revision: 0, translations: [] };
      if (saved.version !== VERSION || JSON.stringify(saved.documentBinding) !== JSON.stringify(documentBinding) || saved.engineSignature !== engineSignature) {
        throw error('TRANSLATION_CHECKPOINT_IDENTITY_MISMATCH');
      }
      return { version: VERSION, documentBinding, engineSignature, revision: Number(saved.revision) || 0,
        translations: (Array.isArray(saved.translations) ? saved.translations : []).map(normalizeEntry).filter(Boolean) };
    }); }
    function write(binding, engineSignature, incoming, { expectedRevision } = {}) { return serialize(async () => {
      const { key, documentBinding } = await keyFor(binding, engineSignature);
      const saved = (await storage.get(key))?.[key];
      if (saved && (saved.version !== VERSION || JSON.stringify(saved.documentBinding) !== JSON.stringify(documentBinding) || saved.engineSignature !== engineSignature)) {
        throw error('TRANSLATION_CHECKPOINT_IDENTITY_MISMATCH');
      }
      if (expectedRevision !== undefined && expectedRevision !== (Number(saved?.revision) || 0)) throw error('TRANSLATION_CHECKPOINT_REVISION_STALE');
      const identity = entry => JSON.stringify([entry.sourceKey, entry.sourceText]);
      const entries = new Map((saved?.translations || []).map(normalizeEntry).filter(Boolean).map(entry => [identity(entry), entry]));
      for (const value of incoming || []) {
        const entry = normalizeEntry(value);
        if (!entry || entry.engineSignature !== engineSignature) continue;
        const old = entries.get(identity(entry));
        // Automatic writes cannot replace manual output or regress a prefix.
        if (old?.sourceText === entry.sourceText && ((old.manuallyEdited && !(entry.manuallyEdited && expectedRevision !== undefined)) ||
            (!entry.manuallyEdited && old.sourceEnd > entry.sourceEnd))) continue;
        entries.set(identity(entry), entry);
      }
      const translations = [...entries.values()];
      if (translations.length > 2000 || JSON.stringify(translations).length > 2000000) throw error('TRANSLATION_CHECKPOINT_LIMIT');
      const result = { version: VERSION, documentBinding, engineSignature,
        revision: (Number(saved?.revision) || 0) + 1, translations };
      await storage.set({ [key]: result }); return result;
    }); }
    return { read, write };
  }
  return { VERSION, LOCAL_SIGNATURE, stableBinding, sourceKey, normalizeEntry, createStore };
});
