(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.BrevessLocalSnapshot = api;
})(globalThis, function () {
  'use strict';
  const FORMAT = 'brevess-local-snapshot', VERSION = 1;
  const fail = code => { throw Object.assign(new Error(code), {code}); };
  const bytes = value => new TextEncoder().encode(value);
  const b64 = data => {
    let result = ''; const u = new Uint8Array(data);
    for (let i = 0; i < u.length; i += 32768) result += String.fromCharCode(...u.subarray(i, i + 32768));
    return btoa(result);
  };
  function un64(value) {
    if (typeof value !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) fail('SNAPSHOT_BASE64_INVALID');
    return Uint8Array.from(atob(value), c => c.charCodeAt(0));
  }
  async function hash(value) {
    const data = typeof value === 'string' ? bytes(value) : value;
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', data)), x => x.toString(16).padStart(2, '0')).join('');
  }
  // Tagged nodes, including ordinary objects, avoid collisions with user field names.
  // Unsupported data fails closed instead of silently losing an unknown field.
  async function encode(value, ancestors = new Set(), depth = 0, seen = new Set()) {
    if (depth > 150) fail('SNAPSHOT_TOO_DEEP');
    if (value === null) return ['null'];
    if (value === undefined) return ['undefined'];
    if (typeof value === 'string' || typeof value === 'boolean') return [typeof value, value];
    if (typeof value === 'number') return ['number', Object.is(value, -0) ? '-0' : String(value)];
    if (typeof value === 'bigint') return ['bigint', String(value)];
    if (typeof value !== 'object') fail('SNAPSHOT_UNSUPPORTED_TYPE');
    if (ancestors.has(value)) fail('SNAPSHOT_CYCLIC_VALUE');
    if (seen.has(value)) fail('SNAPSHOT_SHARED_REFERENCE_UNSUPPORTED');
    seen.add(value);
    const next = new Set(ancestors).add(value), child = v => encode(v, next, depth + 1, seen);
    if (value instanceof Date) return ['date', value.toISOString()];
    if (value instanceof Blob) {
      const data = await value.arrayBuffer(), meta = {type:value.type,sha256:await hash(data)};
      if (typeof File !== 'undefined' && value instanceof File) Object.assign(meta, {name:value.name,lastModified:value.lastModified});
      return ['blob', meta, b64(data)];
    }
    if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
      const data = value instanceof ArrayBuffer ? value : value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
      return ['binary', value.constructor.name, b64(data), await hash(data)];
    }
    if (Array.isArray(value)) {
      if(Object.keys(value).some(k=>!/^(?:0|[1-9]\d*)$/.test(k)||Number(k)>=value.length))fail('SNAPSHOT_ARRAY_PROPERTIES_UNSUPPORTED');
      const entries = [];
      for (let i = 0; i < value.length; i++) if (Object.hasOwn(value, i)) entries.push([i, await child(value[i])]);
      // Sparse arrays preserve absent indexes separately from undefined.
      return ['array', value.length, entries];
    }
    if (value instanceof Map) return ['map', await Promise.all([...value].map(async ([k,v]) => [await child(k),await child(v)]))];
    if (value instanceof Set) return ['set', await Promise.all([...value].map(child))];
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) fail('SNAPSHOT_UNSUPPORTED_TYPE');
    const pairs = [];
    for (const k of Object.keys(value).sort()) pairs.push([k, await child(value[k])]);
    return ['object', pairs];
  }
  async function decode(node, depth = 0) {
    if (depth > 150 || !Array.isArray(node)) fail('SNAPSHOT_NODE_INVALID');
    const [type, value, extra] = node, child = n => decode(n, depth + 1);
    switch (type) {
      case 'null': return null;
      case 'undefined': return undefined;
      case 'string': case 'boolean': if (typeof value !== type) fail('SNAPSHOT_NODE_INVALID'); return value;
      case 'number': {
        if (typeof value !== 'string' || !/^(?:-?Infinity|NaN|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:e[+-]?\d+)?)$/.test(value)) fail('SNAPSHOT_NODE_INVALID');
        return Number(value);
      }
      case 'bigint': return BigInt(value);
      case 'date': return new Date(value);
      case 'array': {
        if (!Number.isSafeInteger(value) || value < 0 || value > 10000000 || !Array.isArray(extra)) fail('SNAPSHOT_NODE_INVALID');
        const out = new Array(value), used = new Set();
        for (const [i,n] of extra) {
          if (!Number.isSafeInteger(i) || i < 0 || i >= value || used.has(i)) fail('SNAPSHOT_NODE_INVALID');
          used.add(i); out[i] = await child(n);
        }
        return out;
      }
      case 'object': {
        const out = {}, used = new Set();
        if (!Array.isArray(value)) fail('SNAPSHOT_NODE_INVALID');
        for (const [k,n] of value) {
          if (typeof k !== 'string' || used.has(k)) fail('SNAPSHOT_NODE_INVALID');
          used.add(k); Object.defineProperty(out, k, {value:await child(n),enumerable:true,writable:true,configurable:true});
        }
        return out;
      }
      case 'map': return new Map(await Promise.all(value.map(async ([k,v]) => [await child(k), await child(v)])));
      case 'set': return new Set(await Promise.all(value.map(child)));
      case 'blob': {
        const data = un64(extra); if (await hash(data) !== value.sha256) fail('SNAPSHOT_BINARY_HASH_MISMATCH');
        return Object.hasOwn(value, 'name') ? new File([data], value.name, {type:value.type,lastModified:value.lastModified}) : new Blob([data], {type:value.type});
      }
      case 'binary': {
        const data = un64(extra); if (await hash(data) !== node[3]) fail('SNAPSHOT_BINARY_HASH_MISMATCH');
        if (value === 'ArrayBuffer') return data.buffer;
        const allowed = {Uint8Array,Uint8ClampedArray,Int8Array,Uint16Array,Int16Array,Uint32Array,Int32Array,Float32Array,Float64Array,BigInt64Array,BigUint64Array,DataView};
        if (!Object.hasOwn(allowed, value)) fail('SNAPSHOT_BINARY_TYPE_INVALID');
        return new allowed[value](data.buffer);
      }
      default: fail('SNAPSHOT_UNKNOWN_TYPE');
    }
  }
  async function fingerprint(value) { return hash(JSON.stringify(await encode(value))); }
  async function create(content, metadata = {}) {
    const payload = await encode(content);
    return {format:FORMAT,version:VERSION,createdAt:new Date().toISOString(),metadata,payload,sha256:await hash(JSON.stringify(payload))};
  }
  async function read(snapshot) {
    if (snapshot?.format !== FORMAT || snapshot.version !== VERSION) fail('SNAPSHOT_VERSION_UNSUPPORTED');
    if (snapshot.sha256 !== await hash(JSON.stringify(snapshot.payload))) fail('SNAPSHOT_HASH_MISMATCH');
    return decode(snapshot.payload);
  }
  async function derive(password, salt, usage) {
    if (typeof password !== 'string' || password.length < 12) fail('SNAPSHOT_PASSPHRASE_TOO_SHORT');
    const key = await crypto.subtle.importKey('raw', bytes(password), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({name:'PBKDF2',hash:'SHA-256',salt,iterations:600000}, key, {name:'AES-GCM',length:256}, false, [usage]);
  }
  async function encrypt(snapshot, password) {
    await read(snapshot);
    const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
    const header = {format:FORMAT + '-encrypted',version:VERSION,kdf:'PBKDF2-SHA256',iterations:600000,cipher:'AES-256-GCM',salt:b64(salt),iv:b64(iv)};
    const key = await derive(password, salt, 'encrypt');
    const ciphertext = await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:bytes(JSON.stringify(header))}, key, bytes(JSON.stringify(snapshot)));
    return {...header,ciphertext:b64(ciphertext)};
  }
  async function decrypt(envelope, password) {
    if (envelope?.format !== FORMAT + '-encrypted' || envelope.version !== VERSION || envelope.iterations !== 600000 || envelope.kdf !== 'PBKDF2-SHA256' || envelope.cipher !== 'AES-256-GCM') fail('SNAPSHOT_ENCRYPTION_UNSUPPORTED');
    const {ciphertext,...header} = envelope, salt = un64(header.salt), iv = un64(header.iv);
    if (salt.length !== 16 || iv.length !== 12) fail('SNAPSHOT_ENCRYPTION_INVALID');
    const key = await derive(password, salt, 'decrypt');
    let result;
    try { result = JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv,additionalData:bytes(JSON.stringify(header))}, key, un64(ciphertext)))); }
    catch { fail('SNAPSHOT_DECRYPT_FAILED'); }
    await read(result); return result;
  }
  return {FORMAT,VERSION,encode,decode,hash,fingerprint,create,read,encrypt,decrypt};
});
