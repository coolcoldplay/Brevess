(function attach(root, factory) {
  const common = typeof module === 'object' && module.exports;
  const api = factory(common ? require('./library-catalog-model.js') : root.BrevessLibraryCatalog,
    common ? require('./pdf-source-store.js') : root.SciLLM,
    common ? require('./pdf-workspace.js') : root.SciLLM);
  if (common) module.exports = api;
  root.BrevessLibraryAttachments = Object.assign(root.BrevessLibraryAttachments || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory(model, defaultPdfSources, pdfWorkspace) {
  'use strict';
  const LIBRARY_ATTACHMENT_DATABASE_NAME = 'brevess-library-attachments-v1';
  const LIBRARY_ATTACHMENT_DATABASE_VERSION = 1;
  const LIBRARY_ATTACHMENT_STORE_NAME = 'blobs';
  const MAX_BYTES = 300 * 1024 * 1024, MAX_HTML_BYTES = 20 * 1024 * 1024;
  const HTML_PREVIEW_CSP = "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
  const previewObjects = new WeakSet();
  const pdfWriteQueues = new Map();
  const fail = code => { throw Object.assign(new Error(code), { code }); };
  const check = (condition, code) => { if (!condition) fail(code); };
  const validHash = hash => typeof hash === 'string' && /^[a-f0-9]{64}$/u.test(hash);
  function attachmentName(value) {
    check(typeof value === 'string' && value.length <= 240 && value.trim() &&
      !/[\\/:*?"<>|\u0000-\u001f\u007f\ud800-\udfff]/u.test(value) && !['.', '..'].includes(value.trim()), 'LIBRARY_ATTACHMENT_NAME_INVALID');
    return value.normalize('NFC').trim();
  }
  async function libraryAttachmentSha256(blob, crypto = globalThis.crypto) {
    check(blob instanceof Blob && crypto?.subtle?.digest, 'LIBRARY_ATTACHMENT_BYTES_INVALID');
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())), byte => byte.toString(16).padStart(2, '0')).join('');
  }
  async function validateBytes(blob, kind) {
    check(blob instanceof Blob && ['pdf', 'html', 'other'].includes(kind) && blob.size <= (kind === 'html' ? MAX_HTML_BYTES : MAX_BYTES), 'LIBRARY_ATTACHMENT_BYTES_INVALID');
    if (kind === 'pdf') check(await blob.slice(0, 5).text() === '%PDF-', 'LIBRARY_ATTACHMENT_PDF_HEADER_INVALID');
  }

  function createLibraryAttachmentStore({ indexedDB = globalThis.indexedDB, crypto = globalThis.crypto,
    databaseName = LIBRARY_ATTACHMENT_DATABASE_NAME, pdfSources = defaultPdfSources,
    readWorkspaceAsset, now = () => new Date().toISOString(), locks = globalThis.navigator?.locks } = {}) {
    let databasePromise = null;
    function open() {
      check(indexedDB?.open, 'LIBRARY_ATTACHMENT_STORE_UNAVAILABLE');
      if (databasePromise) return databasePromise;
      databasePromise = new Promise((resolve, reject) => {
        let blocked = false;
        const request = indexedDB.open(databaseName, LIBRARY_ATTACHMENT_DATABASE_VERSION);
        request.onupgradeneeded = () => {
          if (!request.result.objectStoreNames.contains(LIBRARY_ATTACHMENT_STORE_NAME)) request.result.createObjectStore(LIBRARY_ATTACHMENT_STORE_NAME);
        };
        request.onsuccess = () => {
          const db = request.result;
          if (blocked) { db.close(); return; }
          db.onversionchange = () => { db.close(); databasePromise = null; };
          resolve(db);
        };
        request.onerror = () => { databasePromise = null; reject(request.error || new Error('LIBRARY_ATTACHMENT_STORE_OPEN_FAILED')); };
        request.onblocked = () => { blocked = true; databasePromise = null; reject(new Error('LIBRARY_ATTACHMENT_STORE_BLOCKED')); };
      });
      return databasePromise;
    }
    async function storedBlob(hash, putIfMissing) {
      check(validHash(hash), 'LIBRARY_ATTACHMENT_HASH_INVALID');
      const db = await open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction([LIBRARY_ATTACHMENT_STORE_NAME], putIfMissing ? 'readwrite' : 'readonly');
        const store = tx.objectStore(LIBRARY_ATTACHMENT_STORE_NAME);
        let value, failure;
        function abort(error) { failure = error; try { tx.abort(); } catch (_) { reject(error); } }
        tx.onabort = () => reject(failure || tx.error || new Error('LIBRARY_ATTACHMENT_STORE_ABORTED'));
        tx.onerror = () => { failure = failure || tx.error; };
        tx.oncomplete = () => resolve(value || null);
        const read = store.get(hash);
        read.onerror = () => abort(read.error);
        read.onsuccess = () => {
          value = read.result;
          if (!value && putIfMissing) {
            value = putIfMissing;
            const write = store.put(value, hash);
            write.onerror = () => abort(write.error);
          }
        };
      });
    }
    async function checkedBlob(record, hash, { size = null, kind = null } = {}) {
      check(record && record.hash === hash && record.blob instanceof Blob, 'LIBRARY_ATTACHMENT_BYTES_MISSING');
      check(size === null || record.blob.size === size, 'LIBRARY_ATTACHMENT_SIZE_MISMATCH');
      check(await libraryAttachmentSha256(record.blob, crypto) === hash, 'LIBRARY_ATTACHMENT_HASH_MISMATCH');
      if (kind) await validateBytes(record.blob, kind);
      return record.blob;
    }
    async function withPdfWriteLock(hash, operation) {
      if (typeof locks?.request === 'function') return locks.request(`brevess-library-attachments:pdf:${hash}`, operation);
      // Same-context fallback; browser Web Locks provide the cross-tab exclusion above.
      const before = pdfWriteQueues.get(hash) || Promise.resolve();
      const pending = before.catch(() => {}).then(operation);
      pdfWriteQueues.set(hash, pending);
      try { return await pending; } finally { if (pdfWriteQueues.get(hash) === pending) pdfWriteQueues.delete(hash); }
    }
    async function save({ blob, name, kind, attachmentId } = {}) {
      const safeName = attachmentName(name);
      await validateBytes(blob, kind);
      const hash = await libraryAttachmentSha256(blob, crypto);
      const mime = kind === 'pdf' ? 'application/pdf' : kind === 'html' ? 'text/html' : 'application/octet-stream';
      const descriptor = model.normalizeCatalogAttachment({ id: attachmentId, assetId: `sha256:${hash}`, name: safeName,
        mime, size: blob.size, sha256: hash, kind, availability: 'available',
        locator: { type: kind === 'pdf' ? 'pdf-source' : 'catalog-blob', sha256: hash }, removedAt: null });
      if (kind === 'pdf') {
        check(typeof pdfSources?.loadOriginalPdfSource === 'function' && typeof pdfSources?.saveOriginalPdfSource === 'function', 'LIBRARY_ATTACHMENT_PDF_STORE_UNAVAILABLE');
        await withPdfWriteLock(hash, async () => {
          let existing = await pdfSources.loadOriginalPdfSource(hash);
          if (!existing) {
            await pdfSources.saveOriginalPdfSource(hash, blob, safeName);
            existing = await pdfSources.loadOriginalPdfSource(hash);
          }
          await checkedBlob(existing, hash, { size: blob.size, kind });
        });
      } else {
        // A conditional put preserves the first stored filename/time for shared bytes.
        const existing = await storedBlob(hash, { hash, blob, name: safeName, mime, savedAt: now() });
        await checkedBlob(existing, hash, { size: blob.size, kind });
      }
      return descriptor;
    }
    async function load(descriptor, { forVerification = false } = {}) {
      const attachment = model.normalizeCatalogAttachment(descriptor);
      check(!attachment.removedAt, 'LIBRARY_ATTACHMENT_ASSOCIATION_REMOVED');
      check(forVerification || ['available', 'partial'].includes(attachment.availability), 'LIBRARY_ATTACHMENT_NOT_AVAILABLE');
      const locator = attachment.locator;
      let record;
      if (locator.type === 'pdf-source') {
        check(typeof pdfSources?.loadOriginalPdfSource === 'function', 'LIBRARY_ATTACHMENT_PDF_STORE_UNAVAILABLE');
        record = await pdfSources.loadOriginalPdfSource(locator.sha256);
      } else if (locator.type === 'catalog-blob') record = await storedBlob(locator.sha256);
      else if (locator.type === 'workspace-asset') {
        check(typeof readWorkspaceAsset === 'function', 'LIBRARY_ATTACHMENT_WORKSPACE_READER_REQUIRED');
        const response = await readWorkspaceAsset({ ...locator });
        check(response && response.workspaceId === locator.workspaceId && response.workspaceGeneration === locator.workspaceGeneration &&
          response.relativePath === locator.relativePath && response.blob instanceof Blob, 'LIBRARY_ATTACHMENT_WORKSPACE_MISMATCH');
        check(attachment.size === null || response.blob.size === attachment.size, 'LIBRARY_ATTACHMENT_SIZE_MISMATCH');
        if (attachment.sha256) check(await libraryAttachmentSha256(response.blob, crypto) === attachment.sha256, 'LIBRARY_ATTACHMENT_HASH_MISMATCH');
        await validateBytes(response.blob, attachment.kind);
        return response.blob;
      } else fail('LIBRARY_ATTACHMENT_INVENTORY_ONLY');
      return checkedBlob(record, attachment.sha256, { size: attachment.size, kind: attachment.kind });
    }
    async function verify(descriptor) {
      await load(descriptor, { forVerification: true });
      return { ...model.normalizeCatalogAttachment(descriptor), availability: 'available' };
    }
    async function exportBytes(descriptor) {
      const blob = await load(descriptor);
      // Downloads retain exact bytes; HTML is never exposed as an executable top-level Blob URL.
      return { blob: new Blob([await blob.arrayBuffer()], { type: 'application/octet-stream' }), name: attachmentName(descriptor.name), size: blob.size, sha256: descriptor.sha256 };
    }
    async function prepareOpen(descriptor, { getURL, document = globalThis.document } = {}) {
      const blob = await load(descriptor);
      if (descriptor.kind === 'pdf') {
        check(typeof getURL === 'function', 'LIBRARY_ATTACHMENT_PDF_READER_REQUIRED');
        const pdfDescriptor = descriptor.locator.type === 'pdf-source' ? descriptor :
          await save({ blob, name: descriptor.name, kind: 'pdf', attachmentId: descriptor.id });
        const sourceUrl = pdfWorkspace.buildLocalPdfWorkspaceUrl(pdfDescriptor.name, pdfDescriptor.sha256);
        const url = pdfWorkspace.withLocalPdfWorkspaceSource(getURL('pdf-reader.html'), sourceUrl);
        check(url, 'LIBRARY_ATTACHMENT_PDF_READER_REQUIRED');
        return { kind: 'pdf', url, name: descriptor.name };
      }
      if (descriptor.kind === 'html') return { kind: 'html', preview: await prepareLibraryHtmlAttachmentPreview(blob, { document }), name: descriptor.name };
      return { kind: 'download', ...(await exportBytes(descriptor)) };
    }
    async function close() { if (databasePromise) { const db = await databasePromise; db.close(); databasePromise = null; } }
    return { save, load, verify, exportBytes, prepareOpen, close, databaseName, version: LIBRARY_ATTACHMENT_DATABASE_VERSION };
  }

  async function prepareLibraryHtmlAttachmentPreview(blob, { document = globalThis.document } = {}) {
    await validateBytes(blob, 'html');
    check(document?.implementation?.createHTMLDocument, 'LIBRARY_ATTACHMENT_DOM_REQUIRED');
    const inert = document.implementation.createHTMLDocument('');
    const template = inert.createElement('template');
    check(template.content?.querySelectorAll, 'LIBRARY_ATTACHMENT_DOM_REQUIRED');
    // Template contents remain inert during parsing, before any source URL reaches a live document.
    template.innerHTML = await blob.text();
    const nodes = [...template.content.querySelectorAll('*')];
    check(nodes.length <= 50_000, 'LIBRARY_ATTACHMENT_HTML_TOO_COMPLEX');
    const allowedTags = new Set('article section main header footer aside nav div span p br hr h1 h2 h3 h4 h5 h6 ul ol li dl dt dd blockquote pre code kbd samp strong b em i u s sub sup small mark table caption thead tbody tfoot tr th td colgroup col figure figcaption img a style time abbr cite q address details summary'.split(' '));
    const removeTrees = new Set('script iframe frame frameset object embed applet link meta base form input textarea button select option svg math template video audio source track canvas portal noscript'.split(' '));
    const safeAttributes = new Set('class id title lang dir style colspan rowspan scope width height alt open start reversed value datetime'.split(' '));
    for (const node of nodes) {
      const tag = String(node.localName || node.tagName || '').toLowerCase();
      if (removeTrees.has(tag)) { node.remove(); continue; }
      if (!allowedTags.has(tag)) { node.replaceWith(...node.childNodes); continue; }
      for (const attribute of [...node.attributes]) {
        const attributeName = attribute.name.toLowerCase();
        if (tag === 'img' && attributeName === 'src' && /^data:image\/(?:png|jpeg|gif|webp);base64,[a-z0-9+/=\s]+$/iu.test(attribute.value)) continue;
        if (!safeAttributes.has(attributeName)) node.removeAttribute(attribute.name);
      }
    }
    const output = inert.createElement('div');
    output.appendChild(template.content);
    const preview = { srcdoc: `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${HTML_PREVIEW_CSP}"></head><body>${output.innerHTML}</body></html>` };
    previewObjects.add(preview);
    return Object.freeze(preview);
  }
  function mountLibraryHtmlAttachmentPreview(container, preview, { document = globalThis.document, title = '文献 HTML 附件' } = {}) {
    check(container?.appendChild && document?.createElement && previewObjects.has(preview), 'LIBRARY_ATTACHMENT_PREVIEW_INVALID');
    const frame = document.createElement('iframe');
    frame.setAttribute('sandbox', '');
    frame.setAttribute('referrerpolicy', 'no-referrer');
    frame.setAttribute('title', String(title).slice(0, 240));
    frame.srcdoc = preview.srcdoc;
    container.appendChild(frame);
    return { frame, dispose() { frame.remove(); } };
  }
  return { LIBRARY_ATTACHMENT_DATABASE_NAME, LIBRARY_ATTACHMENT_DATABASE_VERSION, LIBRARY_ATTACHMENT_STORE_NAME,
    HTML_PREVIEW_CSP, libraryAttachmentSha256, createLibraryAttachmentStore,
    prepareLibraryHtmlAttachmentPreview, mountLibraryHtmlAttachmentPreview };
});
