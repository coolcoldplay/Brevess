(function attach(root, factory) {
  const api = factory(root.SciLLM || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory(shared) {
  const MAX_RESPONSE_CHARS = 512 * 1024;
  const MAX_SOURCE_URL_CHARS = 2048;
  const MAX_SOURCE_TITLE_CHARS = 300;
  const MAX_SOURCES = 16;
  const MAX_CITATIONS = 64;
  const MAX_NDJSON_LINES = 512;
  const MAX_ANSWER_MARKDOWN_CHARS = 64 * 1024;
  const RECEIPT_VERSION = 1;
  const BLOCKED_DOMAIN_SUFFIXES = Object.freeze([
    'local', 'internal', 'lan', 'onion', 'test', 'example', 'invalid'
  ]);
  const SHA256_CONSTANTS = Object.freeze([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
    0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
    0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
    0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
    0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
    0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ]);

  function webError(code, message) {
    if (typeof shared.ProviderRequestError === 'function') {
      return new shared.ProviderRequestError(code, message, {
        retryable: false, diagnosticStage: 'parse', diagnosticType: 'WebGroundingError'
      });
    }
    const error = new Error(message);
    error.code = code;
    error.retryable = false;
    error.diagnosticStage = 'parse';
    error.diagnosticType = 'WebGroundingError';
    return error;
  }

  function invalidResponse() {
    return webError('INVALID_RESPONSE', 'Provider web grounding response is invalid');
  }

  function groundingMissing() {
    return webError(
      'WEB_SEARCH_GROUNDING_MISSING',
      'Provider response did not contain verified web grounding'
    );
  }

  function ownData(value, key) {
    if (!value || (typeof value !== 'object' && typeof value !== 'function')) return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && Object.prototype.hasOwnProperty.call(descriptor, 'value')
      ? descriptor.value : undefined;
  }

  function isPlainRecord(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }

  function hasOnlyKeys(value, allowed) {
    return isPlainRecord(value) && Object.keys(value).every(key => allowed.includes(key));
  }

  function normalizeIdentifier(value, maximum = 160) {
    if (typeof value !== 'string') return '';
    const normalized = value.normalize('NFKC').trim();
    if (!normalized || normalized.length > maximum ||
        !/^[A-Za-z0-9][A-Za-z0-9:._/-]*$/u.test(normalized)) return '';
    return normalized;
  }

  function normalizeTitle(value) {
    if (typeof value !== 'string') return '';
    return value.normalize('NFC').replace(/[\u0000-\u001f\u007f]/gu, ' ')
      .replace(/\s+/gu, ' ').trim().slice(0, MAX_SOURCE_TITLE_CHARS);
  }

  function isBlockedIpv4(hostname) {
    if (!/^\d{1,3}(?:\.\d{1,3}){3}$/u.test(hostname)) return false;
    const octets = hostname.split('.').map(Number);
    if (octets.some(value => !Number.isInteger(value) || value < 0 || value > 255)) return true;
    const [a, b] = octets;
    return a === 0 || a === 10 || a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0) ||
      (a === 192 && b === 88 && octets[2] === 99) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 198 && b === 51 && octets[2] === 100) ||
      (a === 203 && b === 0 && octets[2] === 113) ||
      a >= 224;
  }

  function isBlockedIpv6(hostname) {
    const value = hostname.replace(/^\[|\]$/gu, '').toLocaleLowerCase('en-US');
    if (!value.includes(':')) return false;
    if (value === '::' || value === '::1' || value.startsWith('::ffff:')) return true;
    const first = value.split(':', 1)[0];
    return /^(?:fc|fd)[0-9a-f]{0,2}$/u.test(first) ||
      /^fe[89ab][0-9a-f]?$/u.test(first) ||
      /^ff[0-9a-f]{0,2}$/u.test(first) ||
      value.startsWith('100:') || value.startsWith('2001:db8:') ||
      value === '2001:db8::' || value.startsWith('2001::') ||
      /^2001:(?:[0-9a-f]{1,2}|1[0-9a-f]{2}):/u.test(value) ||
      value.startsWith('2002:') || value.startsWith('64:ff9b:');
  }

  function normalizePublicWebUrl(value, requiredProtocol) {
    if (typeof value !== 'string' || !value || value.length > MAX_SOURCE_URL_CHARS) return null;
    let parsed;
    try { parsed = new URL(value); } catch { return null; }
    if (parsed.protocol !== requiredProtocol || parsed.username || parsed.password) return null;
    const rawHostname = parsed.hostname.toLocaleLowerCase('en-US');
    const hostname = rawHostname.endsWith('.') ? rawHostname.slice(0, -1) : rawHostname;
    if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost')) return null;
    const unbracketed = hostname.replace(/^\[|\]$/gu, '');
    const isIpLiteral = unbracketed.includes(':') || /^\d{1,3}(?:\.\d{1,3}){3}$/u.test(unbracketed);
    if (!isIpLiteral && (!hostname.includes('.') || BLOCKED_DOMAIN_SUFFIXES.some(suffix =>
      hostname === suffix || hostname.endsWith(`.${suffix}`)))) return null;
    if (isBlockedIpv4(unbracketed) || isBlockedIpv6(unbracketed)) return null;
    if (hostname !== rawHostname) parsed.hostname = hostname;
    const href = parsed.href;
    return href.length <= MAX_SOURCE_URL_CHARS ? href : null;
  }

  function normalizeWebSourceUrl(value) {
    return normalizePublicWebUrl(value, 'https:');
  }

  function normalizeUnusedHttpCandidate(value) {
    if (typeof value !== 'string' || !/^http:\/\//iu.test(value) || /[\s<>\\]/u.test(value)) return null;
    return normalizePublicWebUrl(value, 'http:');
  }

  function isSafeWebSourceUrl(value) {
    return normalizeWebSourceUrl(value) !== null;
  }

  function jsonStringEnd(source, start) {
    if (source[start] !== '"') return -1;
    for (let index = start + 1; index < source.length; index += 1) {
      if (source[index] === '\\') {
        index += 1;
        continue;
      }
      if (source[index] === '"') return index;
      if (source.charCodeAt(index) < 0x20) return -1;
    }
    return -1;
  }

  function skipJsonWhitespace(source, start) {
    let index = start;
    while (index < source.length && /\s/u.test(source[index])) index += 1;
    return index;
  }

  function jsonValueEnd(source, start) {
    if (source[start] === '"') {
      const end = jsonStringEnd(source, start);
      return end < 0 ? -1 : end + 1;
    }
    if (source[start] === '{' || source[start] === '[') {
      const stack = [source[start] === '{' ? '}' : ']'];
      for (let index = start + 1; index < source.length; index += 1) {
        if (source[index] === '"') {
          index = jsonStringEnd(source, index);
          if (index < 0) return -1;
        } else if (source[index] === '{') {
          stack.push('}');
        } else if (source[index] === '[') {
          stack.push(']');
        } else if (source[index] === stack.at(-1)) {
          stack.pop();
          if (!stack.length) return index + 1;
        }
      }
      return -1;
    }
    let index = start;
    while (index < source.length && source[index] !== ',' && source[index] !== '}') {
      index += 1;
    }
    return index;
  }

  function topLevelStringValueRange(source, propertyName) {
    let index = skipJsonWhitespace(source, 0);
    if (source[index] !== '{') return null;
    index += 1;
    let found = null;
    while (index < source.length) {
      index = skipJsonWhitespace(source, index);
      if (source[index] === '}') break;
      const keyStart = index;
      const keyEnd = jsonStringEnd(source, keyStart);
      if (keyEnd < 0) return null;
      let key;
      try { key = JSON.parse(source.slice(keyStart, keyEnd + 1)); }
      catch { return null; }
      index = skipJsonWhitespace(source, keyEnd + 1);
      if (source[index] !== ':') return null;
      const valueStart = skipJsonWhitespace(source, index + 1);
      const valueEnd = jsonValueEnd(source, valueStart);
      if (valueEnd < 0) return null;
      if (key === propertyName) {
        if (found || source[valueStart] !== '"') return null;
        const stringEnd = jsonStringEnd(source, valueStart);
        if (stringEnd < 0 || stringEnd + 1 !== valueEnd) return null;
        found = { start: valueStart + 1, end: stringEnd };
      }
      index = skipJsonWhitespace(source, valueEnd);
      if (source[index] === ',') {
        index += 1;
        continue;
      }
      if (source[index] === '}') break;
      return null;
    }
    return found;
  }

  function parseAnswerBlockLines(text) {
    if (typeof text !== 'string' || !text || text.length > MAX_RESPONSE_CHARS) {
      throw invalidResponse();
    }
    const records = [];
    const seen = new Set();
    let finalized = false;
    let cursor = 0;
    let lineCount = 0;
    while (cursor <= text.length) {
      if (lineCount >= MAX_NDJSON_LINES) throw invalidResponse();
      lineCount += 1;
      const newline = text.indexOf('\n', cursor);
      const rawEnd = newline < 0 ? text.length : newline;
      const end = rawEnd > cursor && text[rawEnd - 1] === '\r' ? rawEnd - 1 : rawEnd;
      const line = text.slice(cursor, end);
      if (line.trim()) {
        if (finalized) throw invalidResponse();
        let value;
        try { value = JSON.parse(line); } catch { throw invalidResponse(); }
        if (!isPlainRecord(value)) throw invalidResponse();
        if (ownData(value, 'type') === 'final') {
          if (!records.length || ownData(value, 'status') !== 'completed') {
            throw invalidResponse();
          }
          finalized = true;
        }
        if (ownData(value, 'type') === 'answer_block') {
          const blockId = normalizeIdentifier(
            ownData(value, 'block_id') ?? ownData(value, 'blockId')
          );
          if (!blockId || seen.has(blockId)) throw invalidResponse();
          const markdownProperty = typeof ownData(value, 'markdown') === 'string'
            ? 'markdown' : typeof ownData(value, 'content') === 'string' ? 'content' : '';
          const markdownRange = markdownProperty
            ? topLevelStringValueRange(line, markdownProperty) : null;
          if (!markdownRange || markdownRange.end <= markdownRange.start) {
            throw invalidResponse();
          }
          const displayedMarkdown = ownData(value, markdownProperty).normalize('NFC')
            .replace(/\0/g, '').trim();
          if (displayedMarkdown.length > MAX_ANSWER_MARKDOWN_CHARS) {
            throw invalidResponse();
          }
          seen.add(blockId);
          records.push({
            blockId,
            start: cursor + markdownRange.start,
            end: cursor + markdownRange.end
          });
        }
      }
      if (newline < 0) break;
      cursor = newline + 1;
    }
    if (!records.length || !finalized) throw invalidResponse();
    return records;
  }

  function utf8Bytes(text) {
    if (typeof TextEncoder === 'function') return new TextEncoder().encode(text);
    const encoded = unescape(encodeURIComponent(text));
    return Uint8Array.from(encoded, character => character.charCodeAt(0));
  }

  function rotateRight(value, amount) {
    return (value >>> amount) | (value << (32 - amount));
  }

  function sha256Hex(text) {
    const bytes = utf8Bytes(String(text));
    const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
    const message = new Uint8Array(paddedLength);
    message.set(bytes);
    message[bytes.length] = 0x80;
    const bitLength = bytes.length * 8;
    const highLength = Math.floor(bitLength / 0x100000000);
    const lowLength = bitLength >>> 0;
    for (let index = 0; index < 4; index += 1) {
      message[paddedLength - 8 + index] = (highLength >>> (24 - index * 8)) & 0xff;
      message[paddedLength - 4 + index] = (lowLength >>> (24 - index * 8)) & 0xff;
    }
    const state = [
      0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
      0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
    ];
    const words = new Uint32Array(64);
    for (let block = 0; block < message.length; block += 64) {
      for (let index = 0; index < 16; index += 1) {
        const offset = block + index * 4;
        words[index] = ((message[offset] << 24) | (message[offset + 1] << 16) |
          (message[offset + 2] << 8) | message[offset + 3]) >>> 0;
      }
      for (let index = 16; index < 64; index += 1) {
        const left = words[index - 15];
        const right = words[index - 2];
        const sigma0 = rotateRight(left, 7) ^ rotateRight(left, 18) ^ (left >>> 3);
        const sigma1 = rotateRight(right, 17) ^ rotateRight(right, 19) ^ (right >>> 10);
        words[index] = (words[index - 16] + sigma0 + words[index - 7] + sigma1) >>> 0;
      }
      let [a, b, c, d, e, f, g, h] = state;
      for (let index = 0; index < 64; index += 1) {
        const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
        const choose = (e & f) ^ (~e & g);
        const temporary1 = (h + sum1 + choose + SHA256_CONSTANTS[index] +
          words[index]) >>> 0;
        const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
        const majority = (a & b) ^ (a & c) ^ (b & c);
        const temporary2 = (sum0 + majority) >>> 0;
        h = g;
        g = f;
        f = e;
        e = (d + temporary1) >>> 0;
        d = c;
        c = b;
        b = a;
        a = (temporary1 + temporary2) >>> 0;
      }
      state[0] = (state[0] + a) >>> 0;
      state[1] = (state[1] + b) >>> 0;
      state[2] = (state[2] + c) >>> 0;
      state[3] = (state[3] + d) >>> 0;
      state[4] = (state[4] + e) >>> 0;
      state[5] = (state[5] + f) >>> 0;
      state[6] = (state[6] + g) >>> 0;
      state[7] = (state[7] + h) >>> 0;
    }
    return state.map(value => value.toString(16).padStart(8, '0')).join('');
  }

  function stableSerialize(value, depth = 0) {
    if (depth > 32) throw invalidResponse();
    if (value === null || typeof value === 'string' || typeof value === 'boolean') {
      return JSON.stringify(value);
    }
    if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
    if (Array.isArray(value)) {
      if (value.length > 4096) throw invalidResponse();
      return `[${value.map(item => stableSerialize(item, depth + 1)).join(',')}]`;
    }
    if (!isPlainRecord(value)) throw invalidResponse();
    const keys = Object.keys(value).sort();
    if (keys.length > 4096 || keys.some(key =>
      key === '__proto__' || key === 'prototype' || key === 'constructor')) throw invalidResponse();
    return `{${keys.map(key => `${JSON.stringify(key)}:${stableSerialize(
      ownData(value, key), depth + 1
    )}`).join(',')}}`;
  }

  function normalizeGrounding(value, expected = {}) {
    if (!hasOnlyKeys(value, [
      'schemaVersion', 'providerId', 'model', 'providerResponseId', 'searched', 'sources'
    ]) || ownData(value, 'schemaVersion') !== RECEIPT_VERSION ||
        ownData(value, 'searched') !== true) throw invalidResponse();
    const providerId = normalizeIdentifier(ownData(value, 'providerId'), 80);
    const model = normalizeIdentifier(ownData(value, 'model'), 200);
    const providerResponseId = normalizeIdentifier(ownData(value, 'providerResponseId'), 200);
    if (!providerId || !model || !providerResponseId ||
        (expected.providerId && providerId !== expected.providerId) ||
        (expected.model && model !== expected.model)) throw invalidResponse();
    const rawSources = ownData(value, 'sources');
    if (!Array.isArray(rawSources) || !rawSources.length || rawSources.length > MAX_SOURCES) {
      throw invalidResponse();
    }
    const urls = new Set();
    const ids = new Set();
    const sources = rawSources.map(raw => {
      if (!hasOnlyKeys(raw, ['sourceId', 'url', 'title', 'hostname', 'blockIds'])) {
        throw invalidResponse();
      }
      const url = normalizeWebSourceUrl(ownData(raw, 'url'));
      if (!url || urls.has(url)) throw invalidResponse();
      urls.add(url);
      const expectedSourceId = `web-source-${sha256Hex(url).slice(0, 16)}`;
      const sourceId = normalizeIdentifier(ownData(raw, 'sourceId'), 80);
      if (sourceId !== expectedSourceId || ids.has(sourceId)) throw invalidResponse();
      ids.add(sourceId);
      const parsed = new URL(url);
      const hostname = String(ownData(raw, 'hostname') || '').toLocaleLowerCase('en-US');
      if (hostname !== parsed.hostname.toLocaleLowerCase('en-US')) throw invalidResponse();
      const rawBlockIds = ownData(raw, 'blockIds');
      if (!Array.isArray(rawBlockIds) || !rawBlockIds.length || rawBlockIds.length > 64) {
        throw invalidResponse();
      }
      const blockIds = [...new Set(rawBlockIds.map(item => normalizeIdentifier(item)))];
      if (blockIds.length !== rawBlockIds.length || blockIds.some(item => !item)) {
        throw invalidResponse();
      }
      return {
        sourceId,
        url,
        title: normalizeTitle(ownData(raw, 'title')),
        hostname,
        blockIds
      };
    });
    return {
      schemaVersion: RECEIPT_VERSION,
      providerId,
      model,
      providerResponseId,
      searched: true,
      sources
    };
  }

  function normalizeArticleChatWebGroundingResponse(raw, identity = {}) {
    if (!isPlainRecord(raw) || ownData(raw, 'status') !== 'completed') throw invalidResponse();
    const providerId = normalizeIdentifier(identity.providerId, 80);
    const model = normalizeIdentifier(identity.model, 200);
    const providerResponseId = normalizeIdentifier(ownData(raw, 'id'), 200);
    if (!providerId || !model || !providerResponseId) throw invalidResponse();
    const output = ownData(raw, 'output');
    if (!Array.isArray(output) || output.length > 64) throw invalidResponse();
    const searched = output.some(item => isPlainRecord(item) &&
      ownData(item, 'type') === 'web_search_call' && ownData(item, 'status') === 'completed');
    if (!searched) throw groundingMissing();

    const textItems = [];
    for (const item of output) {
      if (!isPlainRecord(item) || ownData(item, 'type') !== 'message' ||
          ownData(item, 'status') !== 'completed') continue;
      const content = ownData(item, 'content');
      if (!Array.isArray(content) || content.length > 64) throw invalidResponse();
      for (const part of content) {
        if (isPlainRecord(part) && ownData(part, 'type') === 'output_text') textItems.push(part);
      }
    }
    if (textItems.length !== 1) throw invalidResponse();
    const text = ownData(textItems[0], 'text');
    if (typeof text !== 'string' || !text || text.length > MAX_RESPONSE_CHARS) {
      throw invalidResponse();
    }
    const aggregateText = ownData(raw, 'output_text');
    if (aggregateText !== undefined && aggregateText !== text) throw invalidResponse();
    const answerBlocks = parseAnswerBlockLines(text);
    const annotations = ownData(textItems[0], 'annotations');
    if (!Array.isArray(annotations) || annotations.length > MAX_CITATIONS) {
      throw invalidResponse();
    }
    const citations = annotations.filter(item =>
      isPlainRecord(item) && ownData(item, 'type') === 'url_citation');
    if (!citations.length) throw groundingMissing();

    const sourcesByUrl = new Map();
    for (const citation of citations) {
      const start = ownData(citation, 'start_index');
      const end = ownData(citation, 'end_index');
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) ||
          start < 0 || end <= start || end > text.length) throw invalidResponse();
      const target = answerBlocks.find(block => start >= block.start && end <= block.end);
      if (!target || !text.slice(start, end).trim()) throw invalidResponse();
      const url = normalizeWebSourceUrl(ownData(citation, 'url'));
      if (!url) throw invalidResponse();
      let source = sourcesByUrl.get(url);
      if (!source) {
        if (sourcesByUrl.size >= MAX_SOURCES) throw invalidResponse();
        const parsed = new URL(url);
        source = {
          sourceId: `web-source-${sha256Hex(url).slice(0, 16)}`,
          url,
          title: normalizeTitle(ownData(citation, 'title')),
          hostname: parsed.hostname.toLocaleLowerCase('en-US'),
          blockIds: []
        };
        sourcesByUrl.set(url, source);
      }
      if (!source.blockIds.includes(target.blockId)) source.blockIds.push(target.blockId);
    }
    const grounding = normalizeGrounding({
      schemaVersion: RECEIPT_VERSION,
      providerId,
      model,
      providerResponseId,
      searched: true,
      sources: [...sourcesByUrl.values()]
    }, { providerId, model });
    return {
      text,
      answerBlocks,
      grounding,
      usage: isPlainRecord(ownData(raw, 'usage')) ? ownData(raw, 'usage') : {}
    };
  }

  function normalizeUnverifiedWebAnswerText(messageText) {
    try { parseAnswerBlockLines(messageText); return messageText; } catch (_) {}
    const start = messageText.indexOf('{');
    if (start < 0 || start > 8192) throw invalidResponse();
    const prefix = messageText.slice(0, start);
    // Never search past a broken record/array for a later usable answer.
    if (/[\[\{]/.test(prefix)) throw invalidResponse();
    const fenced = /(?:^|\n)```(?:jsonl?|ndjson)?\s*$/i.test(prefix);
    let source = messageText.slice(start).trimEnd();
    if (fenced) {
      if (!source.endsWith('```')) throw invalidResponse();
      source = source.slice(0, -3).trimEnd();
    }
    const records = [];
    let record = '';
    let depth = 0;
    let quoted = false;
    let escaped = false;
    for (const char of source) {
      if (!depth) {
        if (/\s/.test(char)) continue;
        if (char !== '{' || records.length >= MAX_NDJSON_LINES) throw invalidResponse();
        record = '{';
        depth = 1;
        continue;
      }
      if (quoted) {
        if (escaped) { record += char; escaped = false; continue; }
        if (char === '\\') { record += char; escaped = true; continue; }
        if (char === '"') quoted = false;
        // Only encode literal string whitespace. Do not invent missing quotes,
        // braces, fields or terminal records, or change the answer's content.
        record += char === '\n' ? '\\n' : char === '\r' ? '\\r' : char === '\t' ? '\\t' : char;
        continue;
      }
      record += char;
      if (char === '"') quoted = true;
      else if (char === '{' || char === '[') depth += 1;
      else if (char === '}' || char === ']') {
        depth -= 1;
        if (!depth) {
          let value;
          try { value = JSON.parse(record); } catch (_) { throw invalidResponse(); }
          if (!records.length && value?.type !== 'answer_block') throw invalidResponse();
          records.push(JSON.stringify(value));
        }
      }
    }
    if (depth || quoted || escaped || !records.length) throw invalidResponse();
    const text = records.join('\n');
    parseAnswerBlockLines(text);
    return text;
  }

  // A readable final answer and verifiable source grounding are separate outcomes.
  // Keep the strict receipt path intact; never manufacture sources from answer text.
  function normalizeNativeMarkdownGrounding(raw, identity, markdown, annotations) {
    if (!hasCompletedWebSearch(raw)) return null;
    if (!Array.isArray(annotations) || !annotations.length ||
        annotations.length > MAX_CITATIONS) return null;
    const citations = annotations.filter(item =>
      isPlainRecord(item) && ownData(item, 'type') === 'url_citation');
    if (!citations.length) return null;
    try {
      const sourcesByUrl = new Map();
      for (const citation of citations) {
        const start = ownData(citation, 'start_index');
        const end = ownData(citation, 'end_index');
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) ||
            start < 0 || end <= start || end > markdown.length ||
            !markdown.slice(start, end).trim()) throw invalidResponse();
        const url = normalizeWebSourceUrl(ownData(citation, 'url'));
        if (!url) throw invalidResponse();
        let source = sourcesByUrl.get(url);
        if (!source) {
          if (sourcesByUrl.size >= MAX_SOURCES) throw invalidResponse();
          const parsed = new URL(url);
          source = {
            sourceId: `web-source-${sha256Hex(url).slice(0, 16)}`,
            url,
            title: normalizeTitle(ownData(citation, 'title')),
            hostname: parsed.hostname.toLocaleLowerCase('en-US'),
            blockIds: ['block-1']
          };
          sourcesByUrl.set(url, source);
        }
      }
      return normalizeGrounding({
        schemaVersion: RECEIPT_VERSION,
        providerId: normalizeIdentifier(identity.providerId, 80),
        model: normalizeIdentifier(identity.model, 200),
        providerResponseId: normalizeIdentifier(ownData(raw, 'id'), 200),
        searched: true,
        sources: [...sourcesByUrl.values()]
      }, {
        providerId: normalizeIdentifier(identity.providerId, 80),
        model: normalizeIdentifier(identity.model, 200)
      });
    } catch (_) {
      return null;
    }
  }

  function normalizeNativeMarkdownWebResponse(raw, identity = {}, options = {}) {
    if (!isPlainRecord(raw) || ownData(raw, 'status') !== 'completed' ||
        !normalizeIdentifier(identity.providerId, 80) ||
        !normalizeIdentifier(identity.model, 200) ||
        !normalizeIdentifier(ownData(raw, 'id'), 200)) throw invalidResponse();
    const output = ownData(raw, 'output');
    if (!Array.isArray(output) || !output.length || output.length > 64) {
      throw invalidResponse();
    }
    const messages = output.filter(item =>
      isPlainRecord(item) && ownData(item, 'type') === 'message');
    const finalMessage = messages.at(-1);
    const phase = ownData(finalMessage, 'phase');
    if (!finalMessage || (phase !== 'final_answer' &&
        !(options.requireGrounding === true && phase === undefined)) ||
        ownData(finalMessage, 'role') !== 'assistant' ||
        ownData(finalMessage, 'status') !== 'completed') throw invalidResponse();
    const content = ownData(finalMessage, 'content');
    if (!Array.isArray(content) || content.length !== 1) throw invalidResponse();
    const textItem = content[0];
    if (!isPlainRecord(textItem) || ownData(textItem, 'type') !== 'output_text') {
      throw invalidResponse();
    }
    const markdown = ownData(textItem, 'text');
    if (typeof markdown !== 'string' || !markdown.trim() ||
        markdown.length > MAX_ANSWER_MARKDOWN_CHARS || markdown.includes('\0')) {
      throw invalidResponse();
    }
    const text = [
      JSON.stringify({
        type: 'answer_block', block_id: 'block-1', markdown, evidence: []
      }),
      JSON.stringify({ type: 'final', status: 'completed' })
    ].join('\n');
    const grounding = normalizeNativeMarkdownGrounding(
      raw, identity, markdown, ownData(textItem, 'annotations')
    );
    return {
      text,
      answerBlocks: parseAnswerBlockLines(text),
      grounding,
      ...(grounding ? {} : {
        answerProvenance: { origin: 'provider_unverified', verification: 'unverified' }
      }),
      usage: isPlainRecord(ownData(raw, 'usage')) ? ownData(raw, 'usage') : {}
    };
  }

  function hasCompletedWebSearch(raw) {
    const output = ownData(raw, 'output');
    return ownData(raw, 'status') === 'completed' && !ownData(raw, 'error') &&
      !ownData(raw, 'incomplete_details') && Array.isArray(output) &&
      output.some(item => isPlainRecord(item) &&
        ownData(item, 'type') === 'web_search_call' && ownData(item, 'status') === 'completed');
  }

  // New web requests must never silently turn into unsourced model answers.
  // The permissive path below remains only for explicitly unverified legacy data.
  function normalizeVerifiedWebResponse(raw, identity, options) {
    if (!isPlainRecord(raw) || ownData(raw, 'status') !== 'completed' ||
        ownData(raw, 'error') || ownData(raw, 'incomplete_details')) throw invalidResponse();
    const output = ownData(raw, 'output');
    if (!Array.isArray(output) || !output.length || output.length > 64) throw invalidResponse();
    const finalMessage = output.at(-1);
    if (!isPlainRecord(finalMessage) || ownData(finalMessage, 'type') !== 'message' ||
        ownData(finalMessage, 'role') !== 'assistant' ||
        ownData(finalMessage, 'status') !== 'completed' ||
        ![undefined, 'final_answer'].includes(ownData(finalMessage, 'phase'))) throw invalidResponse();
    const content = ownData(finalMessage, 'content');
    if (!Array.isArray(content) || content.length !== 1 ||
        !isPlainRecord(content[0]) || ownData(content[0], 'type') !== 'output_text' ||
        typeof ownData(content[0], 'text') !== 'string') throw invalidResponse();
    const messages = output.filter(item => ownData(item, 'type') === 'message');
    const text = ownData(content[0], 'text');
    const aggregateText = ownData(raw, 'output_text');
    if (messages.length === 1 && aggregateText !== undefined && aggregateText !== text) {
      throw invalidResponse();
    }
    if (!hasCompletedWebSearch(raw)) throw groundingMissing();
    let result;
    if (ownData(options, 'answerFormat') === 'markdown') {
      result = normalizeNativeMarkdownWebResponse(raw, identity, options);
    } else {
      // Citation offsets belong to the final output_text, not SDK aggregate text
      // containing earlier search narration. Keep the final text byte-for-byte.
      result = normalizeArticleChatWebGroundingResponse({
        id: ownData(raw, 'id'), status: 'completed', usage: ownData(raw, 'usage'),
        output_text: text,
        output: [...output.filter(item => ownData(item, 'type') === 'web_search_call'), finalMessage]
      }, identity);
    }
    if (!result.grounding) throw groundingMissing();
    return result;
  }

  function normalizeArticleChatWebResponse(raw, identity = {}, options = {}) {
    if (ownData(options, 'requireGrounding') === true) {
      return normalizeVerifiedWebResponse(raw, identity, options);
    }
    if (ownData(options, 'answerFormat') === 'markdown') {
      return normalizeNativeMarkdownWebResponse(raw, identity);
    }
    try {
      return normalizeArticleChatWebGroundingResponse(raw, identity);
    } catch (error) {
      if (!['INVALID_RESPONSE', 'WEB_SEARCH_GROUNDING_MISSING'].includes(error?.code)) throw error;
    }
    if (!isPlainRecord(raw) || ownData(raw, 'status') !== 'completed' ||
        !normalizeIdentifier(identity.providerId, 80) ||
        !normalizeIdentifier(identity.model, 200) ||
        !normalizeIdentifier(ownData(raw, 'id'), 200)) throw invalidResponse();
    const output = ownData(raw, 'output');
    if (!Array.isArray(output) || !output.length || output.length > 64) throw invalidResponse();
    const messages = output.filter(item => isPlainRecord(item) && ownData(item, 'type') === 'message');
    const finalMessage = messages.at(-1);
    if (!finalMessage || ownData(finalMessage, 'status') !== 'completed' ||
        ![undefined, 'assistant'].includes(ownData(finalMessage, 'role'))) throw invalidResponse();
    const content = ownData(finalMessage, 'content');
    if (!Array.isArray(content) || !content.length || content.length > 64) throw invalidResponse();
    const parts = content.map(part => {
      if (!isPlainRecord(part) || ownData(part, 'type') !== 'output_text' ||
          typeof ownData(part, 'text') !== 'string') throw invalidResponse();
      return ownData(part, 'text');
    });
    const messageText = parts.join('');
    const aggregateText = ownData(raw, 'output_text');
    // Multi-message Responses may aggregate search narration as well as the final
    // answer. Consume the final message only, and reject a conflicting single one.
    if (messages.length === 1 && aggregateText !== undefined && aggregateText !== messageText) throw invalidResponse();
    if (!messageText || messageText.length > MAX_RESPONSE_CHARS) throw invalidResponse();
    const text = normalizeUnverifiedWebAnswerText(messageText);
    const answerBlocks = parseAnswerBlockLines(text);
    return {
      text,
      answerBlocks,
      grounding: null,
      answerProvenance: { origin: 'provider_unverified', verification: 'unverified' },
      usage: isPlainRecord(ownData(raw, 'usage')) ? ownData(raw, 'usage') : {}
    };
  }

  // Messages search returns a source table, not OpenAI citation offsets. Accept
  // only explicit inline Markdown links bound to that table. Code examples do
  // not count as citations; unsupported link syntax fails closed.
  function messagesMarkdownLinks(markdown) {
    let fence = null;
    const visible = markdown.split('\n').map(line => {
      const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/u.exec(line);
      if (fence) {
        if (marker && marker[1][0] === fence[0] &&
            marker[1].length >= fence.length && !marker[2].trim()) fence = null;
        return '';
      }
      if (marker) { fence = marker[1]; return ''; }
      // Indentation may be code or a continuation of a Markdown list/paragraph.
      // Do not certify a link through that ambiguous syntax.
      if (/^(?: {4}|\t)/u.test(line)) {
        if (/\]\s*\(/u.test(line)) throw invalidResponse();
        return '';
      }
      return line;
    }).join('\n');
    if (fence) throw invalidResponse();
    let readable = '';
    for (let index = 0; index < visible.length;) {
      if (visible[index] === '\\') { readable += '  '; index += 2; continue; }
      if (visible[index] !== '`') { readable += visible[index++]; continue; }
      const start = index;
      while (visible[index] === '`') index += 1;
      const delimiter = visible.slice(start, index);
      let end = visible.indexOf(delimiter, index);
      while (end >= 0 && (visible[end - 1] === '`' || visible[end + delimiter.length] === '`')) {
        end = visible.indexOf(delimiter, end + delimiter.length);
      }
      if (end < 0) throw invalidResponse();
      readable += ' '; index = end + delimiter.length;
    }
    if (/<\/?[a-z]|<https?:|\[[^\]\n]+\]:\s*\S|\]\s*\[/iu.test(readable)) throw invalidResponse();
    const urls = [];
    const link = /(!?\[[^\]\n]+\])\(/gu;
    let remaining = '', previousEnd = 0;
    let match;
    while ((match = link.exec(readable))) {
      if (match[1].startsWith('!')) throw invalidResponse();
      const start = link.lastIndex;
      let end = start, depth = 1;
      for (; end < readable.length && depth; end += 1) {
        if (readable[end] === '(') depth += 1;
        else if (readable[end] === ')') depth -= 1;
        if (depth > 8) throw invalidResponse();
      }
      if (depth) throw invalidResponse();
      const destination = readable.slice(start, end - 1);
      // Keep fragments and query strings intact. Do not unescape, infer,
      // canonicalize away locators, or recover a different destination.
      if (!destination || /[\s<>\\]/u.test(destination)) throw invalidResponse();
      const url = normalizeWebSourceUrl(destination);
      if (!url) throw invalidResponse();
      urls.push(url);
      if (urls.length > MAX_CITATIONS) throw invalidResponse();
      remaining += readable.slice(previousEnd, match.index);
      previousEnd = end;
      link.lastIndex = end;
    }
    remaining += readable.slice(previousEnd);
    if (/\]\s*\(/u.test(remaining)) throw invalidResponse();
    return urls;
  }

  // The official Search API returns a flat result list. Its URLs are the
  // authority for this turn; the model receives short S handles instead of
  // being asked to reproduce long, fragment-bearing URLs byte for byte.
  function normalizeDeepSeekSearchResults(raw) {
    if (!isPlainRecord(raw) || !Array.isArray(ownData(raw, 'results'))) {
      throw invalidResponse();
    }
    const results = ownData(raw, 'results');
    if (!results.length) throw groundingMissing();
    if (results.length > 50) throw invalidResponse();
    const sources = [];
    const seen = new Set();
    for (const item of results) {
      if (!isPlainRecord(item)) throw invalidResponse();
      const url = normalizeWebSourceUrl(ownData(item, 'url'));
      if (!url) throw invalidResponse();
      if (seen.has(url)) continue;
      seen.add(url);
      const hostname = new URL(url).hostname.toLocaleLowerCase('en-US');
      const text = (value, maximum) => typeof value === 'string'
        ? value.normalize('NFKC').trim().slice(0, maximum) : '';
      sources.push({
        sourceId: `web-source-${sha256Hex(url).slice(0, 16)}`,
        url,
        title: normalizeTitle(ownData(item, 'title')),
        hostname,
        blockIds: ['block-1'],
        summary: text(ownData(item, 'summary'), 1200),
        content: text(ownData(item, 'content'), 2500),
        snippet: text(ownData(item, 'snippet'), 600),
        siteName: text(ownData(item, 'site_name'), 200),
        date: text(ownData(item, 'date'), 80)
      });
      if (sources.length >= MAX_SOURCES) break;
    }
    if (!sources.length) throw groundingMissing();
    return sources;
  }

  function maskMarkdownCode(markdown) {
    let fence = null;
    const lines = markdown.split('\n').map(line => {
      const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/u.exec(line);
      if (fence) {
        if (marker && marker[1][0] === fence[0] &&
            marker[1].length >= fence.length && !marker[2].trim()) fence = null;
        return ' '.repeat(line.length);
      }
      if (marker) {
        fence = marker[1];
        return ' '.repeat(line.length);
      }
      if (/^(?: {4}|\t)/u.test(line)) return ' '.repeat(line.length);
      const visible = line.split('');
      for (let index = 0; index < line.length;) {
        if (line[index] !== '`') { index += 1; continue; }
        const start = index;
        while (line[index] === '`') index += 1;
        const delimiter = line.slice(start, index);
        let end = line.indexOf(delimiter, index);
        while (end >= 0 && (line[end - 1] === '`' || line[end + delimiter.length] === '`')) {
          end = line.indexOf(delimiter, end + delimiter.length);
        }
        if (end < 0) throw invalidResponse();
        for (let cursor = start; cursor < end + delimiter.length; cursor += 1) {
          visible[cursor] = ' ';
        }
        index = end + delimiter.length;
      }
      return visible.join('');
    });
    if (fence) throw invalidResponse();
    return lines.join('\n');
  }

  // Chat Completions cannot emit provider-native grounding blocks. Bind its
  // answer to the exact Search API result table by requiring [S1] handles and
  // replacing them with the authoritative URL ourselves.
  function normalizeDeepSeekSearchAnswer(raw, identity = {}, rawSources = []) {
    const providerId = normalizeIdentifier(identity.providerId, 80);
    const model = normalizeIdentifier(identity.model, 200);
    if (!isPlainRecord(raw) || ownData(raw, 'object') !== 'chat.completion' ||
        providerId !== 'deepseek' || model !== 'deepseek-flash' ||
        ownData(raw, 'model') !== model ||
        !normalizeIdentifier(ownData(raw, 'id'), 200)) throw invalidResponse();
    const choices = ownData(raw, 'choices');
    if (!Array.isArray(choices) || choices.length !== 1 ||
        !isPlainRecord(choices[0])) throw invalidResponse();
    const choice = choices[0];
    const finishReason = ownData(choice, 'finish_reason');
    if (finishReason === 'length') {
      throw webError('OUTPUT_TRUNCATED', 'Model output reached its token limit');
    }
    if (finishReason !== 'stop') {
      throw webError('WEB_SEARCH_RESPONSE_INCOMPLETE',
        'Provider web-search response did not complete');
    }
    const message = ownData(choice, 'message');
    if (!isPlainRecord(message) || ownData(message, 'role') !== 'assistant') {
      throw invalidResponse();
    }
    const content = ownData(message, 'content');
    if (typeof content !== 'string' || !content.trim() ||
        content.includes('\0') || content.length > MAX_ANSWER_MARKDOWN_CHARS) {
      throw invalidResponse();
    }
    if (!Array.isArray(rawSources) || !rawSources.length ||
        rawSources.length > MAX_SOURCES) throw invalidResponse();
    const sourcesByUrl = new Map();
    rawSources.forEach(source => {
      if (!isPlainRecord(source) || typeof source.url !== 'string') throw invalidResponse();
      sourcesByUrl.set(source.url, source);
    });
    if (sourcesByUrl.size !== rawSources.length) throw invalidResponse();

    const visible = maskMarkdownCode(content);
    const cited = new Map();
    let transformed = '';
    let previousEnd = 0;
    const token = /\[S(\d{1,2})\](?:\([^()\s]*\))?/gu;
    let match;
    while ((match = token.exec(visible))) {
      const index = Number(match[1]);
      if (!Number.isSafeInteger(index) || index < 1 || index > rawSources.length) {
        throw groundingMissing();
      }
      const source = rawSources[index - 1];
      if (!sourcesByUrl.has(source.url)) throw invalidResponse();
      transformed += content.slice(previousEnd, match.index) +
        `[S${index}](${source.url})`;
      previousEnd = match.index + match[0].length;
      cited.set(source.url, source);
    }
    transformed += content.slice(previousEnd);
    // Reject malformed or invented Markdown links after canonicalizing the
    // source handles. Code examples do not count as citations.
    const urls = messagesMarkdownLinks(transformed);
    if (!urls.length) throw groundingMissing();
    for (const url of urls) {
      if (!sourcesByUrl.has(url)) throw groundingMissing();
      cited.set(url, sourcesByUrl.get(url));
    }
    if (!cited.size) throw groundingMissing();
    const sources = [...cited.values()].map(source => ({
      sourceId: source.sourceId,
      url: source.url,
      title: source.title,
      hostname: source.hostname,
      blockIds: source.blockIds
    }));
    const grounding = normalizeGrounding({
      schemaVersion: RECEIPT_VERSION,
      providerId,
      model,
      providerResponseId: normalizeIdentifier(ownData(raw, 'id'), 200),
      searched: true,
      sources
    }, { providerId, model });
    const text = [
      JSON.stringify({ type: 'answer_block', block_id: 'block-1',
        markdown: transformed, evidence: [] }),
      JSON.stringify({ type: 'final', status: 'completed' })
    ].join('\n');
    return {
      text,
      answerBlocks: parseAnswerBlockLines(text),
      grounding,
      usage: isPlainRecord(ownData(raw, 'usage')) ? ownData(raw, 'usage') : {}
    };
  }

  function normalizeDeepSeekAnthropicWebResponse(raw, identity = {}) {
    const providerId = normalizeIdentifier(identity.providerId, 80);
    const model = normalizeIdentifier(identity.model, 200);
    if (!isPlainRecord(raw) || ownData(raw, 'type') !== 'message' ||
        ownData(raw, 'role') !== 'assistant' || providerId !== 'deepseek' ||
        model !== 'deepseek-flash' || ownData(raw, 'model') !== model ||
        !normalizeIdentifier(ownData(raw, 'id'), 200)) throw invalidResponse();
    if (ownData(raw, 'stop_reason') === 'max_tokens') {
      throw webError('OUTPUT_TRUNCATED', 'Model output reached its token limit');
    }
    if (ownData(raw, 'error') || ownData(raw, 'stop_reason') !== 'end_turn') {
      throw webError('WEB_SEARCH_RESPONSE_INCOMPLETE', 'Provider web-search response did not complete');
    }
    const content = ownData(raw, 'content');
    if (!Array.isArray(content) || !content.length || content.length > 64 ||
        ownData(content.at(-1), 'type') !== 'text') throw invalidResponse();
    const calls = new Set();
    const results = new Set();
    const sourceTable = new Map();
    const deferredHttpCandidates = new Map();
    let lastResult = -1, textCharacters = 0;
    for (let index = 0; index < content.length; index += 1) {
      const block = content[index];
      if (!isPlainRecord(block)) throw invalidResponse();
      const type = ownData(block, 'type');
      if (type === 'text') {
        const text = ownData(block, 'text');
        if (typeof text !== 'string' || text.includes('\0')) throw invalidResponse();
        textCharacters += text.length;
        if (textCharacters > MAX_RESPONSE_CHARS) throw invalidResponse();
      } else if (type === 'server_tool_use') {
        const id = normalizeIdentifier(ownData(block, 'id'), 200);
        const input = ownData(block, 'input');
        const query = ownData(input, 'query');
        if (!id || calls.size || ownData(block, 'name') !== 'web_search' ||
            !isPlainRecord(input) || typeof query !== 'string' || !query.trim() ||
            query.length > 8192) throw invalidResponse();
        calls.add(id);
      } else if (type === 'web_search_tool_result') {
        const id = ownData(block, 'tool_use_id');
        if (!calls.has(id)) throw groundingMissing();
        if (results.has(id)) throw invalidResponse();
        const items = ownData(block, 'content');
        if (ownData(block, 'is_error') === true || !Array.isArray(items) || !items.length) {
          throw groundingMissing();
        }
        if (items.length > 64) throw invalidResponse();
        for (const item of items) {
          if (!isPlainRecord(item) || ownData(item, 'type') !== 'web_search_result') throw invalidResponse();
          const rawUrl = ownData(item, 'url');
          const httpsUrl = normalizeWebSourceUrl(rawUrl);
          const url = httpsUrl || normalizeUnusedHttpCandidate(rawUrl);
          if (!url) throw invalidResponse();
          if (!httpsUrl) {
            const originals = deferredHttpCandidates.get(url) || new Set();
            originals.add(rawUrl);
            deferredHttpCandidates.set(url, originals);
          }
          if (!sourceTable.has(url)) sourceTable.set(url, {
            sourceId: `web-source-${sha256Hex(url).slice(0, 16)}`,
            url, title: normalizeTitle(ownData(item, 'title')),
            hostname: new URL(url).hostname.toLocaleLowerCase('en-US'), blockIds: ['block-1']
          });
          if (sourceTable.size > MAX_SOURCES) throw invalidResponse();
        }
        results.add(id); lastResult = index;
      } else throw invalidResponse();
    }
    if (calls.size !== 1 || results.size !== calls.size || lastResult < 0) throw groundingMissing();
    const finalBlocks = content.slice(lastResult + 1);
    if (!finalBlocks.length || finalBlocks.some(block => ownData(block, 'type') !== 'text')) throw invalidResponse();
    const markdown = finalBlocks.map(block => ownData(block, 'text')).join('\n');
    if (!markdown.trim() || markdown.length > MAX_ANSWER_MARKDOWN_CHARS) throw invalidResponse();
    const links = messagesMarkdownLinks(markdown);
    // Only discard unused public HTTP candidates after inspecting the final
    // answer. Explicit HTTP links already fail the HTTPS-only citation parser;
    // literal mentions also remain fail-closed. Never upgrade a candidate URL.
    for (const [url, originals] of deferredHttpCandidates) {
      if (markdown.includes(url) || [...originals].some(value => markdown.includes(value))) throw invalidResponse();
      sourceTable.delete(url);
    }
    if (!links.length || links.some(url => !sourceTable.has(url))) throw groundingMissing();
    const grounding = normalizeGrounding({
      schemaVersion: RECEIPT_VERSION, providerId, model,
      providerResponseId: normalizeIdentifier(ownData(raw, 'id'), 200), searched: true,
      sources: [...new Set(links)].map(url => sourceTable.get(url))
    }, { providerId, model });
    const text = [JSON.stringify({ type: 'answer_block', block_id: 'block-1', markdown, evidence: [] }),
      JSON.stringify({ type: 'final', status: 'completed' })].join('\n');
    return { text, answerBlocks: parseAnswerBlockLines(text), grounding,
      usage: isPlainRecord(ownData(raw, 'usage')) ? ownData(raw, 'usage') : {} };
  }

  // Harness exposes a local SDK turn and structured tool/result sources. This
  // is deliberately a separate contract from the official Messages response.
  function normalizeHarnessWebResponse(raw, identity = {}) {
    const providerId = normalizeIdentifier(identity.providerId, 80);
    const model = normalizeIdentifier(identity.model, 200);
    if (!isPlainRecord(raw) || ownData(raw, 'status') !== 'completed') {
      throw webError('WEB_SEARCH_RESPONSE_INCOMPLETE', 'Harness search turn did not complete');
    }
    if (providerId !== 'deepseek-harness' || !model || ownData(raw, 'model') !== model) {
      throw invalidResponse();
    }
    const search = ownData(raw, 'webSearch');
    if (!isPlainRecord(search) || ownData(search, 'searched') !== true) throw groundingMissing();
    if (!hasOnlyKeys(search, ['schemaVersion', 'searched', 'responseId', 'callId', 'sources']) ||
        ownData(search, 'schemaVersion') !== RECEIPT_VERSION ||
        !normalizeIdentifier(ownData(search, 'callId'), 200)) throw invalidResponse();
    const responseId = normalizeIdentifier(ownData(search, 'responseId'), 200);
    const sessionId = normalizeIdentifier(identity.sessionId, 180);
    if (!responseId || !sessionId || !responseId.startsWith(sessionId + ':') ||
        !/^[1-9]\d{0,8}$/u.test(responseId.slice(sessionId.length + 1))) throw invalidResponse();
    const rawSources = ownData(search, 'sources');
    if (!Array.isArray(rawSources) || !rawSources.length) throw groundingMissing();
    if (rawSources.length > 8) throw invalidResponse();
    const sourceTable = new Map(), deferredHttpCandidates = new Map();
    for (const item of rawSources) {
      if (!hasOnlyKeys(item, ['url', 'title'])) throw invalidResponse();
      const rawUrl = ownData(item, 'url');
      const httpsUrl = normalizeWebSourceUrl(rawUrl);
      const url = httpsUrl || normalizeUnusedHttpCandidate(rawUrl);
      if (!url || sourceTable.has(url)) throw invalidResponse();
      if (!httpsUrl) deferredHttpCandidates.set(url, rawUrl);
      sourceTable.set(url, { sourceId: `web-source-${sha256Hex(url).slice(0, 16)}`,
        url, title: normalizeTitle(ownData(item, 'title')),
        hostname: new URL(url).hostname.toLocaleLowerCase('en-US'), blockIds: ['block-1'] });
    }
    const markdown = ownData(raw, 'text');
    if (typeof markdown !== 'string' || !markdown.trim() || markdown.includes('\0') ||
        markdown.length > MAX_ANSWER_MARKDOWN_CHARS) throw invalidResponse();
    const links = messagesMarkdownLinks(markdown);
    for (const [url, original] of deferredHttpCandidates) {
      if (markdown.includes(url) || markdown.includes(original)) throw invalidResponse();
      sourceTable.delete(url);
    }
    if (!links.length || links.some(url => !sourceTable.has(url))) throw groundingMissing();
    const grounding = normalizeGrounding({ schemaVersion: RECEIPT_VERSION,
      providerId, model, providerResponseId: responseId, searched: true,
      sources: [...new Set(links)].map(url => sourceTable.get(url)) }, { providerId, model });
    const text = [JSON.stringify({ type: 'answer_block', block_id: 'block-1', markdown, evidence: [] }),
      JSON.stringify({ type: 'final', status: 'completed' })].join('\n');
    return { text, answerBlocks: parseAnswerBlockLines(text), grounding };
  }

  function receiptBinding(input) {
    const providerId = normalizeIdentifier(input?.providerId, 80);
    const model = normalizeIdentifier(input?.model, 200);
    const turnId = normalizeIdentifier(input?.turnId, 200);
    const operationId = normalizeIdentifier(input?.operationId, 200);
    if (!providerId || !model || !turnId || !operationId ||
        typeof input?.question !== 'string' || typeof input?.answer !== 'string' ||
        input.question.length > 128 * 1024 || input.answer.length > MAX_RESPONSE_CHARS) {
      throw invalidResponse();
    }
    const blocksJson = stableSerialize(input.answerBlocks);
    if (blocksJson.length > MAX_RESPONSE_CHARS) throw invalidResponse();
    return {
      providerId,
      model,
      turnId,
      operationId,
      questionHash: `sha256:${sha256Hex(input.question)}`,
      answerHash: `sha256:${sha256Hex(input.answer)}`,
      answerBlocksHash: `sha256:${sha256Hex(blocksJson)}`
    };
  }

  function createArticleChatWebGroundingReceipt(input) {
    const binding = receiptBinding(input);
    const grounding = normalizeGrounding(input?.grounding, binding);
    const payload = { schemaVersion: RECEIPT_VERSION, binding, grounding };
    return {
      ...payload,
      receiptId: `web-source-receipt-v1-sha256-${sha256Hex(stableSerialize(payload))}`
    };
  }

  function normalizeArticleChatWebGroundingReceipt(receipt, expected) {
    try {
      if (!hasOnlyKeys(receipt, ['schemaVersion', 'binding', 'grounding', 'receiptId']) ||
          ownData(receipt, 'schemaVersion') !== RECEIPT_VERSION) return null;
      const rebuilt = createArticleChatWebGroundingReceipt({
        ...expected,
        grounding: ownData(receipt, 'grounding')
      });
      return stableSerialize(receipt) === stableSerialize(rebuilt) ? rebuilt : null;
    } catch {
      return null;
    }
  }

  return {
    isSafeWebSourceUrl,
    validateArticleChatWebResponseText: parseAnswerBlockLines,
    normalizeArticleChatWebGroundingResponse,
    normalizeArticleChatWebResponse,
    normalizeDeepSeekAnthropicWebResponse,
    normalizeDeepSeekSearchResults,
    normalizeDeepSeekSearchAnswer,
    normalizeHarnessWebResponse,
    createArticleChatWebGroundingReceipt,
    normalizeArticleChatWebGroundingReceipt
  };
});
