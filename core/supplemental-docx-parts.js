(function attach(root, factory) {
  const api = factory(root.SciLLM || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory(shared) {
  'use strict';
  const REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
  const IMAGE_TYPES = new Set([
    'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image',
    'http://purl.oclc.org/ooxml/officeDocument/relationships/image'
  ]);
  const fail = code => { throw Object.assign(new Error(code), { code }); };
  const bytesOf = input => input instanceof Uint8Array ? input
    : input instanceof ArrayBuffer ? new Uint8Array(input) : fail('DOCX_BYTES_REQUIRED');
  const textDecoder = () => new TextDecoder('utf-8', { fatal: true });

  // Preflight prevents extractZipEntries' entry-count truncation from looking complete.
  function inspectDocxZipDirectory(input, options = {}) {
    const bytes = bytesOf(input);
    const maxBytes = options.maxBytes ?? 64 * 1024 * 1024;
    const maxEntries = options.maxEntries ?? 800;
    const maxExpandedBytes = options.maxExpandedBytes ?? 64 * 1024 * 1024;
    if (bytes.length < 22 || bytes.length > maxBytes) fail('DOCX_CONTAINER_SIZE');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const fits = (offset, size) => Number.isSafeInteger(offset) && Number.isSafeInteger(size) &&
      offset >= 0 && size >= 0 && offset + size <= bytes.length;
    let end = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
      if (view.getUint32(i, true) === 0x06054b50 &&
          fits(i, 22) && i + 22 + view.getUint16(i + 20, true) === bytes.length) {
        end = i; break;
      }
    }
    if (end < 0) fail('DOCX_ZIP_END');
    const count = view.getUint16(end + 10, true);
    const size = view.getUint32(end + 12, true);
    const start = view.getUint32(end + 16, true);
    if (view.getUint16(end + 4, true) || view.getUint16(end + 6, true) ||
        view.getUint16(end + 8, true) !== count || count === 65535 ||
        start === 0xffffffff || size === 0xffffffff) fail('DOCX_ZIP_LAYOUT_UNSUPPORTED');
    if (!count || count > maxEntries) fail('DOCX_ZIP_ENTRY_LIMIT');
    if (!fits(start, size) || start + size !== end) fail('DOCX_ZIP_DIRECTORY_BOUNDS');
    const entries = [], names = new Set();
    let cursor = start, expandedBytes = 0;
    for (let i = 0; i < count; i++) {
      if (!fits(cursor, 46) || view.getUint32(cursor, true) !== 0x02014b50) fail('DOCX_ZIP_DIRECTORY');
      const flags = view.getUint16(cursor + 8, true), method = view.getUint16(cursor + 10, true);
      const compressedSize = view.getUint32(cursor + 20, true);
      const uncompressedSize = view.getUint32(cursor + 24, true);
      const nameSize = view.getUint16(cursor + 28, true);
      const recordSize = 46 + nameSize + view.getUint16(cursor + 30, true) + view.getUint16(cursor + 32, true);
      if (!fits(cursor, recordSize) || cursor + recordSize > end) fail('DOCX_ZIP_DIRECTORY_BOUNDS');
      const nameBytes = bytes.subarray(cursor + 46, cursor + 46 + nameSize);
      const name = textDecoder().decode(nameBytes);
      if (!name || name.startsWith('/') || /[\\\x00-\x1f]/u.test(name) ||
          name.split('/').some(segment => segment === '..' || segment === '.') ||
          /^[a-z][a-z\d+.-]*:/iu.test(name)) fail('DOCX_PART_PATH');
      if (names.has(name)) fail('DOCX_DUPLICATE_PART');
      names.add(name);
      if (flags & 1 || ![0, 8].includes(method)) fail('DOCX_ZIP_METHOD_UNSUPPORTED');
      if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff) fail('DOCX_ZIP_LAYOUT_UNSUPPORTED');
      expandedBytes += uncompressedSize;
      if (expandedBytes > maxExpandedBytes) fail('DOCX_ZIP_EXPANDED_LIMIT');
      const local = view.getUint32(cursor + 42, true);
      if (!fits(local, 30) || view.getUint32(local, true) !== 0x04034b50 ||
          view.getUint16(local + 6, true) !== flags ||
          view.getUint16(local + 8, true) !== method) fail('DOCX_ZIP_LOCAL_HEADER');
      const localNameSize = view.getUint16(local + 26, true);
      const dataStart = local + 30 + localNameSize + view.getUint16(local + 28, true);
      if (!fits(local + 30, localNameSize) || !fits(dataStart, compressedSize) ||
          dataStart + compressedSize > start ||
          textDecoder().decode(bytes.subarray(local + 30, local + 30 + localNameSize)) !== name ||
          method === 0 && compressedSize !== uncompressedSize) fail('DOCX_ZIP_LOCAL_BOUNDS');
      entries.push({ name, method, compressedSize, uncompressedSize });
      cursor += recordSize;
    }
    if (cursor !== end) fail('DOCX_ZIP_DIRECTORY_BOUNDS');
    for (const part of ['[Content_Types].xml', 'word/document.xml', 'word/_rels/document.xml.rels']) {
      if (!names.has(part)) fail('DOCX_REQUIRED_PART_MISSING');
    }
    return { entries, expandedBytes, byteLength: bytes.length };
  }

  async function unpackSupplementalDocxParts(input, options = {}) {
    const bytes = bytesOf(input), directory = inspectDocxZipDirectory(bytes, options);
    const extract = options.extractZipEntries || shared.extractZipEntries;
    if (typeof extract !== 'function') fail('DOCX_ZIP_EXTRACTOR_UNAVAILABLE');
    const parts = await extract(bytes, {
      maxEntries: directory.entries.length,
      maxBytes: options.maxExpandedBytes ?? 64 * 1024 * 1024
    });
    if (!(parts instanceof Map)) fail('DOCX_PARTS_INVALID');
    const files = directory.entries.filter(entry => !entry.name.endsWith('/'));
    if (parts.size !== files.length) fail('DOCX_PARTS_INCOMPLETE');
    for (const entry of files) {
      if (!(parts.get(entry.name) instanceof Uint8Array) ||
          parts.get(entry.name).byteLength !== entry.uncompressedSize) fail('DOCX_PART_SIZE_MISMATCH');
    }
    const subtle = options.subtle || globalThis.crypto?.subtle;
    if (!subtle) fail('DOCX_HASH_UNAVAILABLE');
    const digest = await subtle.digest('SHA-256', bytes);
    const containerSha256 = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
    return { containerSha256, byteLength: bytes.length, parts, directory,
      complete: false, importRecords: [], missing: ['DOCX_CAPTION_IMAGE_ASSOCIATION_UNPROVEN'] };
  }

  function readDocxRelationshipRecords(xml, options = {}) {
    if (typeof xml !== 'string' || xml.length > 4 * 1024 * 1024) fail('DOCX_RELATIONSHIP_XML_SIZE');
    if (/<!DOCTYPE|<!ENTITY/iu.test(xml)) fail('DOCX_XML_DECLARATION_UNSUPPORTED');
    const Parser = options.DOMParser || globalThis.DOMParser;
    if (typeof Parser !== 'function') fail('DOCX_DOM_PARSER_UNAVAILABLE');
    const document = new Parser().parseFromString(xml, 'application/xml');
    const root = document.documentElement;
    if (!root || document.getElementsByTagName('parsererror').length ||
        root.localName !== 'Relationships' || root.namespaceURI !== REL_NS) fail('DOCX_RELATIONSHIP_XML_INVALID');
    return Array.from(root.children).map(node => {
      if (node.localName !== 'Relationship' || node.namespaceURI !== REL_NS) fail('DOCX_RELATIONSHIP_XML_INVALID');
      return { id: node.getAttribute('Id'), type: node.getAttribute('Type'),
        target: node.getAttribute('Target'), targetMode: node.getAttribute('TargetMode') || 'Internal' };
    });
  }

  // This establishes explicit rId -> embedded part links only; it never guesses a Figure label.
  function resolveDocxImageRelationships(records, partNames) {
    if (!Array.isArray(records)) fail('DOCX_RELATIONSHIPS_REQUIRED');
    const names = new Set(partNames), ids = new Set(), images = [], unresolved = [];
    for (const record of records) {
      if (!record || typeof record.id !== 'string' || !record.id || ids.has(record.id)) fail('DOCX_RELATIONSHIP_ID');
      ids.add(record.id);
      if (!IMAGE_TYPES.has(record.type)) continue;
      const pending = code => unresolved.push({ relationshipId: record.id, target: record.target || '', code });
      if (record.targetMode && record.targetMode !== 'Internal') { pending('DOCX_EXTERNAL_IMAGE'); continue; }
      const target = record.target;
      if (typeof target !== 'string' || !target || /[\\\x00-\x1f?#]/u.test(target) ||
          target.startsWith('/') || /^[a-z][a-z\d+.-]*:/iu.test(target)) { pending('DOCX_IMAGE_TARGET_INVALID'); continue; }
      let decoded;
      try { decoded = decodeURIComponent(target); } catch (_) { pending('DOCX_IMAGE_TARGET_INVALID'); continue; }
      if (/[\\\x00-\x1f?#]/u.test(decoded) || decoded.startsWith('/')) { pending('DOCX_IMAGE_TARGET_INVALID'); continue; }
      const segments = ['word'];
      let escaped = false;
      for (const segment of decoded.split('/')) {
        if (segment === '..') { if (!segments.length) { escaped = true; break; } segments.pop(); }
        else if (segment && segment !== '.') segments.push(segment);
      }
      const partName = segments.join('/');
      if (escaped || !partName) { pending('DOCX_IMAGE_TARGET_INVALID'); continue; }
      if (!names.has(partName)) { pending('DOCX_IMAGE_PART_MISSING'); continue; }
      images.push({ relationshipId: record.id, partName });
    }
    return { images, unresolved, relationshipTargetsComplete: unresolved.length === 0,
      complete: false, importRecords: [], missing: ['DOCX_CAPTION_IMAGE_ASSOCIATION_UNPROVEN'] };
  }

  return { inspectDocxZipDirectory, unpackSupplementalDocxParts,
    readDocxRelationshipRecords, resolveDocxImageRelationships };
});
