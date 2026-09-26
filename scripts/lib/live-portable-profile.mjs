// Acceptance-only, read-only credential input. Never serialize the returned apiKey.
import { readFile, stat } from 'node:fs/promises';
import { createHash, webcrypto } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readSecretFromTty } from '../probe-deepseek-figure-recovery.mjs';

const require = createRequire(import.meta.url);
const codec = require('../../core/portable-config.js');
function fail(code) { const error = new Error(code); error.code = code; throw error; }
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

export async function loadLivePortableProfile(file, profileName, options = {}) {
  let bytes;
  try {
    const info = await stat(file);
    if (!info.isFile() || info.size > 2 * 1024 * 1024) fail('LIVE_CONFIG_SIZE');
    bytes = await readFile(file);
    if (bytes.length > 2 * 1024 * 1024) fail('LIVE_CONFIG_SIZE');
  } catch { fail('LIVE_CONFIG_READ_FAILED'); }
  let envelope;
  try { envelope = JSON.parse(bytes.toString('utf8')); codec.validatePortableEnvelope(envelope); }
  catch { fail('LIVE_CONFIG_ENVELOPE_INVALID'); }
  let passphrase = await (options.readPassphrase || (() => readSecretFromTty({
    prompt: 'Portable config password (hidden): '
  })))();
  let keyBytes;
  let payload;
  try {
    keyBytes = await codec.derivePortableConfigKey(passphrase, {
      salt: codec.fromBase64(envelope.encryption.salt),
      iterations: envelope.encryption.iterations, cryptoRef: webcrypto
    });
    ({ payload } = await codec.decryptPortableConfig(envelope, { keyBytes, cryptoRef: webcrypto }));
  } catch { fail('LIVE_CONFIG_UNLOCK_FAILED'); }
  finally { keyBytes?.fill(0); passphrase = ''; }
  const profiles = payload?.settings?.profiles;
  if (options.listOnly === true) {
    return { profiles: Object.entries(profiles && typeof profiles === 'object' ? profiles : {})
      .map(([id, p]) => ({ id, name: String(p?.name || ''),
        providerId: String(p?.providerId || ''), model: String(p?.config?.model || p?.model || '') })) };
  }
  const matches = Object.entries(profiles && typeof profiles === 'object' ? profiles : {})
    .filter(([id, profile]) => id === profileName || profile?.name === profileName);
  if (matches.length !== 1) fail('LIVE_PROFILE_NOT_UNIQUE');
  const [id, profile] = matches[0];
  const config = profile?.config || {};
  const model = String(config.model || profile.model || '').trim();
  const providerId = String(profile.providerId || '').trim();
  const apiKey = typeof config.apiKey === 'string' ? config.apiKey.trim() : '';
  if (!model || !providerId || !apiKey || /[\r\n]/u.test(apiKey)) fail('LIVE_PROFILE_INCOMPLETE');
  let baseUrl = String(config.baseUrl || '').trim();
  if (baseUrl) {
    let url;
    try { url = new URL(baseUrl); } catch { fail('LIVE_PROFILE_ENDPOINT_INVALID'); }
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
      fail('LIVE_PROFILE_ENDPOINT_INVALID');
    }
    baseUrl = url.href;
  }
  if (options.expectedModel && model !== options.expectedModel) fail('LIVE_PROFILE_MODEL_MISMATCH');
  const sourceSha256 = digest(bytes);
  if (digest(await readFile(file)) !== sourceSha256) fail('LIVE_CONFIG_CHANGED_DURING_READ');
  const result = { id, name: String(profile.name || id), providerId, model, baseUrl,
    sourceSha256, revision: envelope.revision };
  // Accidental JSON.stringify / Object spread must not expose the credential.
  Object.defineProperty(result, 'apiKey', { value: apiKey, enumerable: false });
  return result;
}

export function liveProfileMetadata(profile) {
  return { name: profile.name, providerId: profile.providerId, model: profile.model,
    baseUrl: profile.baseUrl, hasApiKey: Boolean(profile.apiKey),
    sourceSha256: profile.sourceSha256, revision: profile.revision };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const [file, profileName] = process.argv.slice(2);
  if (!file || !profileName) {
    process.stderr.write('Usage: node scripts/lib/live-portable-profile.mjs <encrypted-file> <profile-name>\n');
    process.exitCode = 1;
  } else {
    loadLivePortableProfile(file, profileName, { listOnly: profileName === '--list' }).then(profile => {
      process.stdout.write(`${JSON.stringify(profileName === '--list' ? profile : liveProfileMetadata(profile))}\n`);
    }).catch(error => {
      process.stderr.write(`${/^LIVE_[A-Z_]+$/u.test(error?.code) ? error.code : 'LIVE_PROFILE_FAILED'}\n`);
      process.exitCode = 1;
    });
  }
}
