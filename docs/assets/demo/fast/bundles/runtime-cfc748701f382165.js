
;/* native/core/library-source-actions.js */
(function(root,factory){const api=factory(typeof module==='object'&&module.exports?require('./pdf-workspace.js'):root.SciLLM||{});if(typeof module==='object'&&module.exports)module.exports=api;Object.assign(root.SciLLM||={},api);})(globalThis,function(pdf){
  'use strict';
  function libraryOnlineUrl(value){
    try{const url=new URL(String(value||''));return ['http:','https:'].includes(url.protocol)&&!url.username&&!url.password?url.href:'';}catch{return '';}
  }
  function libraryOriginalReaderUrl(value,{getURL}={}){
    if(typeof getURL!=='function')return libraryOnlineUrl(value);
    try{
      const source=new URL(String(value||''));
      if(source.username||source.password)return '';
      const local=pdf.withLocalPdfWorkspaceSource?.(getURL('pdf-reader.html'),source.href);
      if(local)return local;
      let pathname=source.pathname;try{pathname=decodeURIComponent(pathname);}catch{return '';}
      const ordinaryPdf=source.protocol==='file:'&&!source.host&&!source.search&&!source.hash&&!/[\u0000-\u001f\u007f]/u.test(pathname)&&/\.pdf$/iu.test(pathname);
      if(ordinaryPdf||libraryOnlineUrl(source.href)&&pdf.isLikelyPdfUrl?.(source.href))return pdf.createPdfReaderUrl?.(getURL,source.href)||'';
      return libraryOnlineUrl(source.href);
    }catch{return '';}
  }
  function describeLibrarySource(source={},options={}){
    const imported=source.inventoryOnly===true,kind=source.sourceKind==='pdf'?'pdf':'html';
    const raw=source.url||source.canonicalUrl||source.sourceUrl||'';
    const localPdf=!imported&&kind==='pdf'?libraryOriginalReaderUrl(raw,options):'';
    const offline=!imported&&source.hasOfflineSnapshot===true&&typeof source.workspaceId==='string'&&source.workspaceId&&typeof options.getURL==='function'
      ?options.getURL('offline-reader.html?workspaceId='+encodeURIComponent(source.workspaceId)):'';
    const online=libraryOnlineUrl(raw)||libraryOnlineUrl(source.publisherUrl)||'';
    const links=[];
    if(offline)links.push({kind:'offline-html',label:'本地 HTML',url:offline});
    if(localPdf&&new URL(raw).protocol==='file:')links.push({kind:'local-pdf',label:'本地 PDF',url:localPdf});
    if(online)links.push({kind:'online',label:'在线原文',url:kind==='pdf'?libraryOriginalReaderUrl(online,options):online});
    const state=imported?'inventory-only':offline?(source.offlineSnapshotStatus==='complete'?'complete':source.offlineSnapshotStatus==='partial'?'partial':'unknown'):links.some(link=>link.kind==='local-pdf')?'local-pdf':'missing';
    const status={
      'inventory-only':'来源设备的附件清单，原件未导入本机',complete:'本地 HTML 与阅读图片已保存',partial:'本地 HTML 部分资源未保存',unknown:'本地 HTML 的资源完整度未记录','local-pdf':'本地 PDF 入口；打开时核验原件是否可用',missing:'尚无本机原件，可使用在线原文或添加附件'
    }[state];
    const latestAttempt=state==='complete'&&source.lastSaveAttemptStatus==='partial'?'；最近一次保存未完成，当前打开的是此前完整快照':'';
    return {kind,state,status:status+latestAttempt,links,workspaceId:imported?'':source.workspaceId||'',workspaceGeneration:imported?null:source.workspaceGeneration??null};
  }
  return {libraryOnlineUrl,libraryOriginalReaderUrl,describeLibrarySource};
});


;/* native/core/pdf-source-store.js */
(function attach(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory() {
  function localPdfSourceHash(url) {
    try {
      const value = new URL(url);
      return value.protocol === 'file:' && !value.host
        ? /^\/brevess-local-pdf\/([a-f0-9]{64})\//u.exec(value.pathname)?.[1] || '' : '';
    } catch (_) { return ''; }
  }
  function requestResult(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('PDF_SOURCE_STORE_FAILED'));
    });
  }
  async function openStore() {
    const request = indexedDB.open('brevess-original-pdf-sources-v1', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('sources', { keyPath: 'hash' });
    return requestResult(request);
  }
  async function saveOriginalPdfSource(hash, blob, name) {
    if (!/^[a-f0-9]{64}$/u.test(hash) || !(blob instanceof Blob) || blob.size > 300 * 1024 * 1024) {
      throw new Error('PDF_SOURCE_INVALID');
    }
    const db = await openStore();
    try {
      await new Promise((resolve, reject) => {
        const transaction = db.transaction('sources', 'readwrite');
        transaction.oncomplete = resolve;
        transaction.onabort = transaction.onerror = () => reject(transaction.error || new Error('PDF_SOURCE_SAVE_FAILED'));
        transaction.objectStore('sources').put({ hash, blob, name: String(name || 'article.pdf').slice(0, 240), savedAt: Date.now() });
      });
    } finally { db.close(); }
  }
  async function loadOriginalPdfSource(hash) {
    if (!/^[a-f0-9]{64}$/u.test(hash)) return null;
    const db = await openStore();
    try { return await requestResult(db.transaction('sources', 'readonly').objectStore('sources').get(hash)) || null; }
    finally { db.close(); }
  }
  async function deleteOriginalPdfSource(hash) {
    if (!/^[a-f0-9]{64}$/u.test(hash)) return;
    const db = await openStore();
    try {
      await new Promise((resolve, reject) => {
        const transaction = db.transaction('sources', 'readwrite');
        transaction.oncomplete = resolve;
        transaction.onabort = transaction.onerror = () => reject(transaction.error || new Error('PDF_SOURCE_DELETE_FAILED'));
        transaction.objectStore('sources').delete(hash);
      });
    } finally { db.close(); }
  }
  return { localPdfSourceHash, saveOriginalPdfSource, loadOriginalPdfSource, deleteOriginalPdfSource };
});


;/* native/core/library-attachment-store.js */
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


;/* native/workbench/library-catalog-actions.js */
(function attach(root, factory) {
  const common = typeof module === 'object' && module.exports;
  const api = factory(common ? require('../core/library-catalog-model.js') : root.BrevessLibraryCatalog,
    common ? require('../core/library-attachment-store.js') : root.BrevessLibraryAttachments);
  if (common) module.exports = api;
  root.BrevessLibraryCatalogActions = Object.assign(root.BrevessLibraryCatalogActions || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory(model, attachmentApi) {
  'use strict';
  const fail = code => { throw Object.assign(new Error(code), { code }); };
  const check = (condition, code) => { if (!condition) fail(code); };
  const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  function createCatalogActions({ catalogStore, attachmentStore, getURL, document = globalThis.document, crypto = globalThis.crypto } = {}) {
    check(catalogStore?.read && catalogStore?.execute && catalogStore?.restoreBackup, 'LIBRARY_CATALOG_ACTION_STORE_REQUIRED');
    const read = () => catalogStore.read();
    function envelope(options, command) {
      check(Number.isSafeInteger(options.expectedRevision) && options.expectedRevision >= 0 && typeof options.idempotencyKey === 'string' &&
        options.idempotencyKey.length > 0 && options.idempotencyKey.length <= 200, 'LIBRARY_CATALOG_REQUEST_INVALID');
      return { expectedRevision: options.expectedRevision, idempotencyKey: options.idempotencyKey, command };
    }
    // No authorization is minted here: caller UI/MCP must enforce its own existing approval scope.
    function execute(request, runtimeOptions) {
      check(!['attachment.add', 'attachment.setAvailability'].includes(request?.command?.type), 'LIBRARY_CATALOG_ATTACHMENT_VERIFICATION_REQUIRED');
      return catalogStore.execute(request, runtimeOptions);
    }
    function run(command, options) { return execute(envelope(options, command)); }
    async function keyHash(key) {
      check(typeof key === 'string' && key.length > 0 && key.length <= 200, 'LIBRARY_CATALOG_REQUEST_INVALID');
      return attachmentApi.libraryAttachmentSha256(new Blob([key]), crypto);
    }
    async function createEntry(options) {
      envelope(options, { type: 'entry.create' });
      const fields = own(options, 'fields') ? options.fields : {};
      check(!own(options, 'aliases') || Array.isArray(options.aliases), 'LIBRARY_CATALOG_ALIASES_INVALID');
      const aliases = [...new Set([...model.libraryCatalogIdentityAliases(fields || {}), ...(options.aliases || [])])];
      if (!aliases.length) aliases.push(`source:manual:${await keyHash(options.idempotencyKey)}`);
      return run({ type: 'entry.create', aliases, fields,
        ...(own(options, 'addedAt') ? { addedAt: options.addedAt } : {}) }, options);
    }
    const updateEntry = options => run({ type: 'entry.update', entryId: options.entryId,
      ...Object.fromEntries(['fields', 'clearOverrides', 'addedAt'].filter(key => own(options, key)).map(key => [key, options[key]])) }, options);
    const entryAction = type => options => run({ type, entryId: options.entryId }, options);
    const groupAction = type => options => run({ type, groupId: options.groupId,
      ...Object.fromEntries(['name', 'mode'].filter(key => own(options, key)).map(key => [key, options[key]])) }, options);
    const tagAction = type => options => run({ type, groupId: options.groupId, tagId: options.tagId,
      ...(own(options, 'name') ? { name: options.name } : {}) }, options);
    const setTags = options => run({ type: 'entry.tags.set', entryId: options.entryId, groupId: options.groupId, tagIds: options.tagIds }, options);
    const createGroup = options => run({ type: 'group.create', name: options.name, mode: options.mode }, options);
    const createTag = options => run({ type: 'tag.create', groupId: options.groupId, name: options.name }, options);
    const setPreferences = options => run({ type: 'preferences.set', preferences: options.preferences }, options);
    function findEntry(state, entryId, { includeRemoved = false } = {}) {
      check(typeof entryId === 'string' && /^entry:[A-Za-z0-9_-]{1,100}$/u.test(entryId), 'LIBRARY_CATALOG_ID_INVALID');
      const entry = state.entries.find(item => item.id === entryId);
      check(entry, 'LIBRARY_CATALOG_ENTRY_NOT_FOUND');
      check(includeRemoved || !entry.removedAt, 'LIBRARY_CATALOG_ENTRY_REMOVED');
      return entry;
    }
    async function entryAttachment(options, { includeRemoved = false } = {}) {
      const state = await read(), entry = findEntry(state, options.entryId);
      const attachment = entry.attachments.find(item => item.id === options.attachmentId);
      check(attachment, 'LIBRARY_CATALOG_ATTACHMENT_NOT_FOUND');
      check(includeRemoved || !attachment.removedAt, 'LIBRARY_ATTACHMENT_ASSOCIATION_REMOVED');
      return { state, entry, attachment };
    }
    function checkRevisionOrReplay(state, options) {
      envelope(options, {});
      check(state.revision === options.expectedRevision || state.receipts.some(receipt => receipt.key === options.idempotencyKey), 'LIBRARY_CATALOG_REVISION_CONFLICT');
    }
    async function addAttachment(options) {
      check(attachmentStore?.save, 'LIBRARY_CATALOG_ATTACHMENT_STORE_REQUIRED');
      envelope(options, {});
      const state = await read(); findEntry(state, options.entryId); checkRevisionOrReplay(state, options);
      const previous = state.receipts.find(receipt => receipt.key === options.idempotencyKey);
      if (previous) {
        let original; try { original = JSON.parse(previous.command); } catch (_) { fail('LIBRARY_CATALOG_IDEMPOTENCY_CONFLICT'); }
        check(original.type === 'attachment.add' && original.entryId === options.entryId && options.blob instanceof Blob &&
          original.attachment.kind === options.kind && original.attachment.name === String(options.name || '').normalize('NFC').trim() &&
          original.attachment.size === options.blob.size && original.attachment.sha256 === await attachmentApi.libraryAttachmentSha256(options.blob, crypto),
        'LIBRARY_CATALOG_IDEMPOTENCY_CONFLICT');
        return catalogStore.execute(envelope(options, original));
      }
      const descriptor = await attachmentStore.save({ blob: options.blob, name: options.name, kind: options.kind,
        attachmentId: `attachment:${await keyHash(options.idempotencyKey)}` });
      return catalogStore.execute(envelope(options, { type: 'attachment.add', entryId: options.entryId, attachment: descriptor }));
    }
    async function registerSourceAttachment(options) {
      // Read the exact existing source through its original identity guards before registration.
      check(attachmentStore?.verify, 'LIBRARY_CATALOG_ATTACHMENT_STORE_REQUIRED');
      const state = await read(); findEntry(state, options.entryId); checkRevisionOrReplay(state, options);
      const verified = await attachmentStore.verify(options.attachment);
      return catalogStore.execute(envelope(options, { type: 'attachment.add', entryId: options.entryId, attachment: verified }));
    }
    const removeAttachment = options => run({ type: 'attachment.remove', entryId: options.entryId, attachmentId: options.attachmentId }, options);
    const restoreAttachment = options => run({ type: 'attachment.restore', entryId: options.entryId, attachmentId: options.attachmentId }, options);
    async function verifyAttachment(options) {
      check(attachmentStore?.verify, 'LIBRARY_CATALOG_ATTACHMENT_STORE_REQUIRED');
      const { state, attachment } = await entryAttachment(options); checkRevisionOrReplay(state, options);
      await attachmentStore.verify(attachment);
      return catalogStore.execute(envelope(options, { type: 'attachment.setAvailability', entryId: options.entryId,
        attachmentId: options.attachmentId, availability: 'available' }));
    }
    async function openAttachment(options) {
      check(attachmentStore?.prepareOpen, 'LIBRARY_CATALOG_ATTACHMENT_STORE_REQUIRED');
      const { attachment } = await entryAttachment(options);
      if (attachment.kind === 'html' && attachment.locator?.type === 'catalog-blob' && typeof getURL === 'function') {
        await attachmentStore.load(attachment);
        const current = await entryAttachment(options);
        check(JSON.stringify(current.attachment) === JSON.stringify(attachment), 'LIBRARY_HTML_CONTEXT_STALE');
        const url = new URL(getURL('library-html-reader.html'));
        url.searchParams.set('entryId', options.entryId); url.searchParams.set('attachmentId', options.attachmentId);
        url.searchParams.set('documentHash', attachment.sha256);
        return { kind: 'html-reader', url: url.href, name: attachment.name };
      }
      const opened = await attachmentStore.prepareOpen(attachment, { getURL, document });
      if (opened.kind === 'html' && options.container) return { kind: 'html',
        ...attachmentApi.mountLibraryHtmlAttachmentPreview(options.container, opened.preview, { document, title: opened.name }) };
      return opened;
    }
    async function exportAttachment(options) {
      check(attachmentStore?.exportBytes, 'LIBRARY_CATALOG_ATTACHMENT_STORE_REQUIRED');
      const { attachment } = await entryAttachment(options);
      return attachmentStore.exportBytes(attachment);
    }
    async function exportMetadata() { return model.exportLibraryCatalog(await read()); }
    function previewMetadataImport(serialized) {
      const imported = model.importLibraryCatalog(serialized);
      let downgradedAttachments = 0;
      for (const entry of imported.entries) for (const attachment of entry.attachments) {
        if (attachment.locator.type !== 'external') {
          if (attachment.availability !== 'inventory-only') downgradedAttachments += 1;
          attachment.availability = 'inventory-only';
        }
      }
      // A receipt captured elsewhere cannot replay a local write or assert byte availability.
      imported.receipts = [];
      const catalog = model.normalizeLibraryCatalog(imported);
      return { catalog, serialized: model.exportLibraryCatalog(catalog), summary: {
        papers: catalog.entries.length, groups: catalog.groups.length,
        attachments: catalog.entries.reduce((count, entry) => count + entry.attachments.length, 0), downgradedAttachments,
        mode: 'replace-metadata-only', includesOriginalBytes: false } };
    }
    async function importMetadata({ serialized, expectedRevision, mode } = {}) {
      check(mode === 'replace', 'LIBRARY_CATALOG_IMPORT_MODE_REQUIRED');
      const preview = previewMetadataImport(serialized);
      return catalogStore.restoreBackup(preview.serialized, { expectedRevision });
    }
    return { read, execute, createEntry, updateEntry, removeEntry: entryAction('entry.remove'), restoreEntry: entryAction('entry.restore'),
      createGroup, updateGroup: groupAction('group.update'), removeGroup: groupAction('group.remove'), restoreGroup: groupAction('group.restore'),
      createTag, updateTag: tagAction('tag.update'), removeTag: tagAction('tag.remove'), restoreTag: tagAction('tag.restore'), setTags, setPreferences,
      addAttachment, registerSourceAttachment, removeAttachment, restoreAttachment, verifyAttachment, openAttachment, exportAttachment,
      exportMetadata, previewMetadataImport, importMetadata };
  }
  return { createCatalogActions };
});


;/* native/workbench/library-attachments-ui.js */
(() => {
  'use strict';
  const rt=()=>window.__workbenchRuntime;
  const E=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let detailEpoch=0;
  const run=fn=>Promise.resolve().then(fn).catch(error=>rt()?.toast(error.code==='LIBRARY_CATALOG_REVISION_CONFLICT'?'资料已被其他窗口修改，请刷新后重试。':error.message||error.code));
  function save(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),5000);}
  function request(extra={}){return {expectedRevision:rt().ui.catalogRevision,idempotencyKey:crypto.randomUUID(),...extra};}
  async function render(entry){
    const epoch=++detailEpoch,host=document.getElementById('catalog-attachments');if(!host||!rt()?.catalogActions)return;
    const catalog=await rt().catalogActions.read();if(epoch!==detailEpoch||!host.isConnected)return;
    const registered=catalog.entries.find(item=>item.id===entry.entryId)?.attachments||[];
    host.innerHTML=registered.map(attachment=>`<article class="catalog-source"><strong>${E(attachment.name)}</strong><p>${E(attachment.kind.toUpperCase())} · ${attachment.size===null?'大小未记录':Math.ceil(attachment.size/1024)+' KB'} · ${attachment.removedAt?'已移除':attachment.availability==='inventory-only'?'仅清单，需核验本机原件':attachment.availability==='available'?'本机已保存':'原件待核验'}</p><div class="actions" data-catalog-attachment="${E(attachment.id)}">${attachment.removedAt?'<button data-attachment-action="restore">恢复关联</button>':`<button data-attachment-action="open" ${attachment.availability==='inventory-only'?'disabled':''}>打开</button><button data-attachment-action="export" ${attachment.availability==='inventory-only'?'disabled':''}>导出原件</button><button data-attachment-action="verify">核验本机原件</button><button data-attachment-action="remove">移除关联</button>`}</div></article>`).join('');
    host.onclick=event=>{const button=event.target.closest('[data-attachment-action]');if(!button)return;const action=button.dataset.attachmentAction,attachmentId=button.closest('[data-catalog-attachment]').dataset.catalogAttachment,entryId=entry.entryId,options=request({entryId,attachmentId});button.disabled=true;
      run(async()=>{try{
        if(action==='open'){
          rt().modal('原文附件','<div id="catalog-preview"><p>正在核验附件…</p></div>');
          const container=document.getElementById('catalog-preview'),opened=await rt().catalogActions.openAttachment({entryId,attachmentId,container});
          container.querySelector('p')?.remove();
          if(opened.kind==='pdf'||opened.kind==='html-reader'){container.replaceChildren();const a=document.createElement('a');a.href=opened.url;a.target='_blank';a.rel='noopener';a.textContent=opened.kind==='pdf'?'在 PDF 阅读器打开 ↗':'在 HTML 阅读器打开 ↗';container.append(a);}
          else if(opened.kind==='download'){container.textContent='此附件请使用“导出原件”下载后打开。';}
        }else if(action==='export'){const result=await rt().catalogActions.exportAttachment({entryId,attachmentId});save(result.blob,result.name);}
        else {await rt().catalogActions[action==='verify'?'verifyAttachment':action==='restore'?'restoreAttachment':'removeAttachment'](options);await rt().loadGlobalLibrary();}
      }finally{button.disabled=false;}});
    };
  }
  window.addEventListener('brevess-catalog-detail',event=>run(()=>render(event.detail.entry)));
  window.addEventListener('brevess-catalog-action',event=>{
    const {action,entry}=event.detail;if(!rt()?.catalogActions)return;
    if(action==='add-attachment'&&entry){
      const revision=rt().ui.catalogRevision;
      rt().modal('添加原文附件','<label class="field"><span>选择 PDF 或 HTML 文件</span><input id="catalog-attachment-file" type="file" accept=".pdf,.html,.htm,application/pdf,text/html"></label><p class="muted">原件保存在本机。HTML 可在本机阅读器研读；移除关联不会删除原件。</p><p id="catalog-attachment-error" role="alert"></p><div class="modal-actions"><button id="catalog-attachment-save">添加</button></div>',dialog=>{
        dialog.querySelector('#catalog-attachment-save').onclick=()=>run(async()=>{
          const file=dialog.querySelector('input').files?.[0];if(!file)return;
          const button=dialog.querySelector('#catalog-attachment-save');button.disabled=true;
          try{const kind=/\.pdf$/i.test(file.name)?'pdf':/\.html?$/i.test(file.name)?'html':null;if(!kind)throw Error('请选择 PDF 或 HTML 文件。');
            const owner=await window.BrevessLibraryCatalogUI.ensureEntry(entry,revision);
            await rt().catalogActions.addAttachment({expectedRevision:owner.revision,idempotencyKey:crypto.randomUUID(),entryId:owner.entryId,blob:file,name:file.name,kind});dialog.close();await rt().loadGlobalLibrary();
          }catch(error){dialog.querySelector('#catalog-attachment-error').textContent=error.code||error.message;}finally{button.disabled=false;}
        });
      });
    }else if(action==='export-metadata')run(async()=>save(new Blob([await rt().catalogActions.exportMetadata()],{type:'application/json'}),'BREVESS-library-catalog-'+new Date().toISOString().slice(0,10)+'.json'));
    else if(action==='import-metadata'){
      const revision=rt().ui.catalogRevision;
      rt().modal('导入资料备份','<input id="catalog-metadata-file" type="file" accept=".json,application/json"><div id="catalog-import-preview"></div><p class="muted">此操作替换标签组、人工资料和附件清单，不包含原件字节。来源文库和课题引用保留。建议先导出当前备份。</p><p data-import-error role="alert"></p><button id="catalog-import-confirm" disabled>确认替换资料</button>',dialog=>{
        let serialized=null,selection=0,readySelection=0,readyFile=null,busy=false;
        const input=dialog.querySelector('input'),confirm=dialog.querySelector('#catalog-import-confirm'),previewHost=dialog.querySelector('#catalog-import-preview'),errorHost=dialog.querySelector('[data-import-error]');
        input.onchange=()=>{const token=++selection,file=input.files?.[0];serialized=null;readyFile=null;confirm.disabled=true;previewHost.textContent='';errorHost.textContent='';
          run(async()=>{try{if(!file)return;const content=await file.text();if(token!==selection||input.files?.[0]!==file)return;const preview=rt().catalogActions.previewMetadataImport(content);serialized=content;readySelection=token;readyFile=file;previewHost.textContent=`${file.name}：${preview.summary.papers} 篇人工资料，${preview.summary.groups} 个标签组，${preview.summary.attachments} 个附件清单。导入后附件须重新核验。`;confirm.disabled=false;}catch(error){if(token!==selection)return;serialized=null;errorHost.textContent=error.code||error.message;confirm.disabled=true;}});
        };
        confirm.onclick=()=>{if(busy||!serialized||readySelection!==selection||input.files?.[0]!==readyFile)return;busy=true;confirm.disabled=true;input.disabled=true;const content=serialized;
          run(async()=>{try{await rt().catalogActions.importMetadata({serialized:content,expectedRevision:revision,mode:'replace'});dialog.close();await rt().loadGlobalLibrary();}finally{busy=false;input.disabled=false;confirm.disabled=readySelection!==selection||!serialized;}});
        };
      });
    }
  });
})();


;/* native/workbench/library-catalog-reader.js */
(function(root,factory){const common=typeof module==='object'&&module.exports;const api=factory(common?require('../core/library-catalog-model.js'):root.BrevessLibraryCatalog,common?require('./global-library.js'):root.BrevessWorkbenchLibrary);if(common)module.exports=api;Object.assign(root.BrevessWorkbenchLibrary||={},api);})(globalThis,function(catalogModel,legacy){
  'use strict';
  const fail=code=>Object.assign(new Error(code),{code});
  const key=(prefix,value)=>value?prefix+encodeURIComponent(String(value)):'';
  const localId=paper=>key('local:',paper.paperId||paper.id||paper.workspaceId);
  const textScopes=new Set(['notes','fulltext','abstract','method','caption']);
  const authors=value=>Array.isArray(value)?value.map(author=>typeof author==='string'?author:author?.literal||author?.name||author?.fullName||author?.displayName||author?.collectiveName||'').filter(Boolean).join(', '):String(value||'');
  function sourceRecord(paper,kind){
    const inventoryOnly=kind==='import',sourceId=kind==='local'?localId(paper):kind==='radar'?key('radar:',paper.radarId+':'+paper.id):key('import:',paper.stableId||paper.id);
    const addedAt=Object.hasOwn(paper,'addedAt')?paper.addedAt:kind==='local'&&typeof paper.createdAt==='string'&&Number.isFinite(Date.parse(paper.createdAt))?new Date(paper.createdAt).toISOString():null;
    return {...paper,sourceId,sourceKind:kind,inventoryOnly,authors:authors(paper.authors),addedAt,
      sourceDocuments:(paper.sourceDocuments||[]).map(source=>({...source,...(inventoryOnly?{inventoryOnly:true}:{})}))};
  }
  function decorateRow(row){
    const sources={local:row.sourceRecords.some(source=>source.sourceKind==='local'&&!source.inventoryOnly),radar:row.sourceRecords.some(source=>source.sourceKind==='radar')};
    const localDocuments=row.sourceRecords.filter(source=>source.sourceKind==='local'&&!source.inventoryOnly).flatMap(source=>source.sourceDocuments||[]).filter(source=>!source.inventoryOnly);
    const localAttachments=(row.attachments||[]).filter(attachment=>!attachment.removedAt&&attachment.availability==='available'&&attachment.locator?.type!=='external');
    const hasLocalAttachment=localAttachments.length>0;
    let status=sources.local&&localDocuments.some(source=>source.hasOfflineSnapshot===true)?legacy.localStatus({sourceDocuments:localDocuments}):'missing';
    if(status==='missing'&&hasLocalAttachment)status=localAttachments.some(attachment=>attachment.kind==='pdf')?'complete':'unknown';
    return {...row,contentType:localDocuments.some(d=>d.contentType==='web')?'web':'literature',id:row.viewId,stableId:row.aliases.find(alias=>alias.startsWith('doi:'))||row.aliases.find(alias=>alias.startsWith('pmid:'))||row.viewId,
      tags:row.legacyTags,sources,radarRead:sources.radar,sourceKind:sources.local&&sources.radar?'mixed':sources.radar?'radar':'local',status,
      availability:sources.local||hasLocalAttachment?'local':'metadata-only',hasLocalAttachment,inventoryOnly:row.inventoryOnly&&!hasLocalAttachment,
      url:row.sourceRecords.find(source=>source.url)?.url||'',abstract:row.searchText.abstract.join('\n'),year:String(row.publicationDate||'').slice(0,4)};
  }
  function inScope(row,scope){
    if(!scope||scope==='all')return true;
    const entry=decorateRow(row);
    if(scope==='local')return entry.availability==='local';if(scope==='radar')return entry.sources.radar;
    if(scope==='literature'||scope==='web')return entry.contentType===scope;
    if(scope==='metadata-only')return entry.availability==='metadata-only';
    if(['complete','partial','unknown','missing'].includes(scope))return entry.status===scope;
    throw fail('LIBRARY_CATALOG_SCOPE_INVALID');
  }
  function createCatalogLibraryReader({adapter,radarStore,importStore,catalogStore}={}){
    if(!adapter?.queryLibrary||!catalogModel?.queryLibraryCatalog)throw fail('LIBRARY_CATALOG_READER_UNAVAILABLE');
    async function scanLocal(query='',scope='all',filters={}){
      const rows=[];let pages=1;
      for(let page=1;page<=pages;page++){
        const result=await adapter.queryLibrary({query,scope,page,pageSize:100,...filters});
        pages=Math.max(1,Number(result.pageCount||result.pages)||1);
        if(!Number.isSafeInteger(pages)||pages>1000)throw fail('LIBRARY_CATALOG_SOURCE_LIMIT');
        rows.push(...(result.items||[]));
      }
      return rows;
    }
    async function snapshot({includeRadarRead=true}={}){
      const [local,imported,catalog]=await Promise.all([scanLocal(),importStore?.readAll?.()||[],catalogStore?.read?.()||catalogModel.createEmptyLibraryCatalog()]);
      const warnings=[];let radar=[];
      if(includeRadarRead&&radarStore)try{radar=legacy.radarReadPapers(await radarStore.read());}catch(error){warnings.push({code:'RADAR_LIBRARY_UNAVAILABLE',message:error.code||error.message});}
      const records=[...local.map(paper=>sourceRecord(paper,'local')),...radar.map(paper=>sourceRecord(paper,'radar')),...imported.map(paper=>sourceRecord(paper,'import'))];
      return {records,catalog,warnings};
    }
    async function query(options={}){
      if(options.scope&&!['all','literature','web','local','radar','metadata-only','complete','partial','missing','unknown'].includes(options.scope))throw fail('LIBRARY_CATALOG_SCOPE_INVALID');
      if(options.tags!==undefined&&(!Array.isArray(options.tags)||options.tags.some(tag=>typeof tag!=='string'))||options.tagMode&&!['any','all'].includes(options.tagMode))throw fail('LIBRARY_CATALOG_QUERY_INVALID');
      const {records,catalog,warnings}=await snapshot(options),conditions=options.conditions?structuredClone(options.conditions):[];
      const queryText=String(options.query||'').trim(),field=options.field||'all',operator=options.operator||'contains';
      if(queryText)conditions.push({field,operator,value:queryText,...(options.groupId?{groupId:options.groupId}:{})});
      // Validate before issuing any auxiliary content query. External matches never
      // become fake document text, and all filtering stays before pagination.
      catalogModel.queryLibraryCatalog(records,{catalog,conditions,page:1,pageSize:1});
      const tagFilters=options.tags?.length?{tags:options.tags,tagMode:options.tagMode||'any'}:{};
      const taggedLocalIds=options.tags?.length?new Set((await scanLocal('','all',tagFilters)).map(localId)):null;
      const matchesLegacyTags=row=>!taggedLocalIds||row.sourceRecords.some(source=>source.sourceKind==='local'?taggedLocalIds.has(source.sourceId):
        options.tagMode==='all'?options.tags.every(tag=>source.legacyTags.includes(tag)):options.tags.some(tag=>source.legacyTags.includes(tag)));
      const external=new Map(),contentHits=new Map();
      for(const condition of conditions){
        if(condition.operator!=='contains'||!(condition.field==='all'||textScopes.has(condition.field)))continue;
        const hits=await scanLocal(condition.value,condition.field==='all'?'all':condition.field,tagFilters);
        external.set(condition,new Set(hits.map(localId).filter(Boolean)));
        for(const hit of hits){const id=localId(hit);if(id)contentHits.set(id,hit);}
      }
      const result=catalogModel.queryLibraryCatalog(records,{catalog,conditions,match:options.match||'all',
        sort:options.sort||catalog.preferences.sort,page:Math.max(1,Math.floor(Number(options.page)||1)),pageSize:Math.max(1,Math.min(100,Math.floor(Number(options.pageSize)||40))),includeRemoved:options.includeRemoved===true,
        includeRow:row=>inScope(row,options.scope)&&matchesLegacyTags(row),
        evaluateCondition:(row,condition,defaultMatch)=>{
          const hits=external.get(condition),sourceMatch=hits&&row.sourceRecords.some(source=>hits.has(source.sourceId));
          return defaultMatch||Boolean(sourceMatch);
        }});
      const allRows=catalogModel.buildLibraryCatalogRows(records,catalog).rows.filter(row=>options.includeRemoved===true||!row.removedAt);
      const legacyTagOptions=[...new Set(allRows.flatMap(row=>row.legacyTags))].sort((a,b)=>a.localeCompare(b));
      const scopeCounts=Object.fromEntries(['all','literature','web','local','radar','metadata-only','partial','missing'].map(scope=>[scope,allRows.filter(row=>inScope(row,scope)).length]));
      const sourceCoverage=new Map(records.filter(record=>record.sourceKind==='local'&&!record.inventoryOnly).map(record=>[record.sourceId,record.coverage||{}]));
      const items=result.items.map(row=>{
        const entry=decorateRow(row),hits=row.sourceRecords.map(source=>contentHits.get(source.sourceId)).filter(Boolean);
        const coverage=Object.fromEntries(['title',...textScopes].map(scope=>[scope,
          (scope==='title'?Boolean(row.title):row.searchText[scope]?.some(Boolean))||row.sourceRecords.some(source=>sourceCoverage.get(source.sourceId)?.[scope]===true)]));
        return {...entry,coverage,hitScopes:[...new Set(hits.flatMap(hit=>hit.hitScopes||[]))],snippets:hits.flatMap(hit=>hit.snippets||[]).slice(0,12)};
      });
      return {...result,items,scopeCounts,legacyTagOptions,counts:{...result.counts,inventoryOnly:allRows.filter(row=>decorateRow(row).inventoryOnly).length},catalogRevision:catalog.revision,groups:catalog.groups,preferences:catalog.preferences,warnings:[...warnings,...result.warnings]};
    }
    return {query,snapshot};
  }
  return {createCatalogLibraryReader,libraryCatalogSourceRecord:sourceRecord,decorateLibraryCatalogRow:decorateRow};
});


;/* native/workbench/library-catalog-ui.js */
/* Optional catalog UI; metadata edits never change the original reading workspace. */
(() => {
  'use strict';
  const E=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const labels={title:'标题',authors:'作者',journal:'期刊',publicationDate:'发表日期',addedAt:'添加日期',doi:'DOI',pmid:'PMID',legacyTags:'旧标签',attachments:'附件'};
  const fields=['title','authors','journal','publicationDate','doi','pmid'];
  const rt=()=>window.__workbenchRuntime;
  const run=fn=>Promise.resolve().then(fn).catch(error=>rt()?.toast(error.code==='LIBRARY_CATALOG_REVISION_CONFLICT'?'总库已被其他窗口修改，请刷新后重试。':error.message||error.code));
  const active=()=>rt()?.ui.libraryEntries.find(entry=>entry.id===rt().ui.librarySelected);
  const groups=()=>rt()?.ui.libraryGroups||[];
  const requestKey=()=>crypto.randomUUID();
  const scopeLabels={title:'标题',notes:'笔记',fulltext:'全文',abstract:'摘要',method:'方法',caption:'图注'};
  function addedDate(value){
    if(typeof value!=='string'||!value||!Number.isFinite(Date.parse(value)))return '';
    return new Intl.DateTimeFormat(window.SciLLM?.getInterfaceLanguage?.()==='en'?'en':'zh-CN',{year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));
  }
  function coverageText(entry){
    const scopes=Object.keys(scopeLabels),covered=scopes.filter(scope=>entry.coverage?.[scope]).map(scope=>scopeLabels[scope]),missing=scopes.filter(scope=>!entry.coverage?.[scope]).map(scope=>scopeLabels[scope]);
    return `<p class="muted catalog-search-coverage">可检索内容：${covered.join('、')||'尚无已知覆盖'}${missing.length?'；未覆盖：'+missing.join('、'):''}。</p>`;
  }
  function legacyTagFilters(ui){
    const selected=ui.libraryLegacyTags||[],options=ui.libraryLegacyTagOptions||[];
    if(!selected.length&&!options.length)return '';
    return `<div class="catalog-legacy-filter"><label>来源旧标签 <select data-library-legacy-choice aria-label="添加来源旧标签筛选"><option value="">${options.length?'选择旧标签…':'暂无来源旧标签'}</option>${options.filter(tag=>!selected.includes(tag)).map(tag=>`<option value="${E(tag)}">${E(tag)}</option>`).join('')}</select></label><label>匹配方式 <select data-library-legacy-mode aria-label="旧标签匹配方式"><option value="any" ${ui.libraryLegacyTagMode!=='all'?'selected':''}>任一标签</option><option value="all" ${ui.libraryLegacyTagMode==='all'?'selected':''}>全部标签</option></select></label><button data-library-legacy-clear ${selected.length?'':'disabled'}>清除旧标签筛选</button><div class="actions" aria-label="当前来源旧标签筛选">${selected.map(tag=>`<button data-library-legacy-remove="${E(tag)}" aria-label="移除筛选标签 ${E(tag)}">${E(tag)} ×</button>`).join('')}</div><small class="muted">仅筛选原有来源标签；新标签组请使用上方“标签”检索。</small></div>`;
  }
  function changeLegacyTags(){rt().ui.libraryPage=1;run(rt().loadGlobalLibrary);}
  function searchEvidence(entry){
    const scopes=entry.hitScopes||[],snippets=entry.snippets||[];
    if(!scopes.length&&!snippets.length)return '';
    return `<details class="catalog-search-evidence" open><summary>查询命中</summary>${scopes.length?`<p>命中范围：${scopes.map(scope=>E(scopeLabels[scope]||scope)).join('、')}</p>`:''}${snippets.map(hit=>`<article><small>${E(scopeLabels[hit.scope]||hit.scope||'已保存内容')}${hit.sourceLabel?' · '+E(hit.sourceLabel):''}${hit.label?' · '+E(hit.label):''}</small><p data-i18n-ignore>${E(hit.text)}</p></article>`).join('')}</details>`;
  }
  async function execute(command,revision=rt().ui.catalogRevision){
    const result=await rt().catalogStore.execute({expectedRevision:revision,idempotencyKey:requestKey(),command});
    rt().ui.catalogRevision=result.revision;
    return result;
  }
  async function ensureEntry(entry,revision=rt().ui.catalogRevision){
    if(entry.entryId)return {entryId:entry.entryId,revision};
    if(entry.conflicts?.length)throw Error('该条目存在身份冲突，请先核对 DOI / PMID 来源。');
    const result=await execute({type:'entry.create',aliases:entry.aliases,addedAt:entry.addedAt??null},revision);
    rt().ui.librarySelected=result.targetId;
    return {entryId:result.targetId,revision:result.revision};
  }
  function table(entries,ui){
    const groupSelect=document.getElementById('library-query-group');if(groupSelect){const value=ui.libraryQueryGroup||'';groupSelect.innerHTML='<option value="">全部标签组</option>'+groups().filter(g=>!g.removedAt).map(g=>`<option value="${E(g.id)}">${E(g.name)}</option>`).join('');groupSelect.value=value;groupSelect.hidden=(ui.libraryQueryField||'all')!=='tags';}
    ui.catalogSelection ||= new Map();
    const available=new Map(groups().filter(g=>!g.removedAt).map(g=>[g.id,g]));
    const columns=(ui.libraryPreferences?.columns||['title','publicationDate','journal','addedAt']).filter(key=>labels[key]||available.has(key));
    if(!columns.includes('title'))columns.unshift('title');
    const cell=(entry,key)=>{
      if(available.has(key))return (entry.tagGroups?.find(group=>group.id===key)?.tags||[]).map(tag=>`<span class="catalog-tag">${E(tag.name)}</span>`).join('')||'<span class="muted">—</span>';
      if(key==='attachments')return String(entry.attachments?.length||0);
      if(key==='legacyTags')return E((entry.legacyTags||[]).join(' · '));
      const value=key==='addedAt'?addedDate(entry.addedAt):entry[key];
      return key==='title'?`<button class="catalog-title" type="button" title="${E(value||'未命名文献')}">${E(value||'未命名文献')}</button>${entry.removedAt?'<small>已移除</small>':''}`:`<span title="${E(value||'')}">${E(value||'—')}</span>`;
    };
    const exactNote=ui.libraryQueryOperator==='exact'&&['all','notes','fulltext','abstract','method','caption'].includes(ui.libraryQueryField||'all')?'<p class="muted catalog-search-coverage">正文等内容的精确匹配仅检查已取得的索引文本；旧来源仅提供包含检索，未覆盖内容不会作为精确命中。可改用“包含”继续检索。</p>':'';
    return `${legacyTagFilters(ui)}${exactNote}<div class="catalog-summary" role="status"><span>${ui.libraryMatchedCount??entries.length} / ${ui.libraryTotalCount??entries.length} 篇${ui.libraryIncludeRemoved?' · 含已移除条目':''}</span>${ui.catalogSelection.size?`<button type="button" data-catalog-batch-remove>移除选中（${ui.catalogSelection.size}）</button>`:''}</div><div class="catalog-table-scroll"><table class="catalog-table"><thead><tr><th class="catalog-pick"><input type="checkbox" data-catalog-select-all aria-label="选择本页全部条目" ${entries.length&&entries.every(e=>ui.catalogSelection.has(e.id))?'checked':''}></th>${columns.map(key=>`<th scope="col" aria-sort="${ui.catalogHeaderSort?.field===key?(ui.catalogHeaderSort.direction==='asc'?'ascending':'descending'):'none'}"><button type="button" data-catalog-sort="${E(key)}">${E(labels[key]||available.get(key)?.name)}${ui.catalogHeaderSort?.field===key?(ui.catalogHeaderSort.direction==='asc'?' ↑':' ↓'):''}</button></th>`).join('')}</tr></thead><tbody>${entries.map(entry=>`<tr data-library-entry="${E(entry.id)}" aria-selected="${entry.id===ui.librarySelected}" class="${entry.id===ui.librarySelected?'selected':''}"><td class="catalog-pick"><input type="checkbox" data-catalog-pick="${E(entry.id)}" aria-label="选择 ${E(entry.title)}" ${ui.catalogSelection.has(entry.id)?'checked':''}></td>${columns.map(key=>`<td class="catalog-col-${labels[key]?key:'tags'}" data-i18n-ignore>${cell(entry,key)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }
  function detail(entry){
    const getURL=path=>window.chrome?.runtime?.getURL?.(path)||new URL('../'+path,location.href).href;
    const online=window.SciLLM.libraryOnlineUrl(entry.url)||(entry.doi?`https://doi.org/${encodeURIComponent(entry.doi)}`:'');
    const canonical=value=>{try{return new URL(value).href;}catch{return '';}};
    const primaryLinks=new Set([online,entry.pmid?'https://pubmed.ncbi.nlm.nih.gov/'+entry.pmid+'/':''].map(canonical).filter(Boolean));
    const sources=(entry.sourceDocuments||[]).map((source,index)=>{
      const description=window.SciLLM.describeLibrarySource(source,{getURL});
      return `<article class="catalog-source" data-catalog-source-index="${index}">${String(source.title||source.fileName||'').trim()===String(entry.title||'').trim()?'':`<strong>${E(source.title||source.fileName||'原文版本')}</strong>`}<p>${E(description.status)}</p><div class="actions">${source.contentType==='web'&&source.hasSavedWebContent&&/^workspace:[a-f0-9]{64}$/.test(source.workspaceId)?`<a class="btn" href="../web-reading-archive.html?workspace=${encodeURIComponent(source.workspaceId)}" target="_blank" rel="noopener noreferrer">已存网页内容 ↗</a>`:''}${description.links.filter(link=>!primaryLinks.has(canonical(link.url))).map(link=>`<a class="btn" href="${E(link.url)}" target="_blank" rel="noopener noreferrer">${E(link.label)} ↗</a>`).join('')}</div>${source.hasOfflineSnapshot&&source.workspaceId?`<button type="button" data-action-icon="none" data-reading-pack="${E(source.workspaceId)}" data-generation="${Number(source.workspaceGeneration)||1}">导出完整阅读包</button>`:''}<div data-library-source-controls></div></article>`;
    }).join('');
    const tags=groups().filter(group=>!group.removedAt).map(group=>`<label class="field"><span>${E(group.name)}</span><select data-catalog-tags="${E(group.id)}" ${group.mode==='multiple'?'multiple':''} ${entry.removedAt?'disabled':''} aria-label="${E(group.name)}">${group.mode==='single'?'<option value="">未标记</option>':''}${group.tags.filter(tag=>!tag.removedAt).map(tag=>`<option value="${E(tag.id)}" ${entry.tagIds.includes(tag.id)?'selected':''}>${E(tag.name)}</option>`).join('')}</select>${group.mode==='multiple'?'<small>可按 Ctrl / Command 多选</small>':''}</label>`).join('');
    return `<section class="catalog-detail-actions"><div data-library-source-editor></div>${searchEvidence(entry)}<div class="actions"><button data-catalog-action="edit">编辑资料</button><button data-catalog-action="${entry.removedAt?'restore':'remove'}">${entry.removedAt?'恢复条目':'移除条目'}</button>${online?`<a class="btn" href="${E(online)}" target="_blank" rel="noopener noreferrer">在线原文 ↗</a>`:''}</div><p class="muted">添加日期：${E(addedDate(entry.addedAt)||'旧记录未记载')}</p>${tags}<details class="catalog-coverage-details"><summary>检索覆盖情况</summary>${coverageText(entry)}</details><details open><summary>原文与附件</summary>${sources||'<p class="muted">没有原文版本，可添加 PDF / HTML 附件。</p>'}<div id="catalog-attachments"></div><button data-catalog-action="add-attachment" ${entry.removedAt?'disabled':''}>添加 PDF / HTML 附件</button></details></section>`;
  }
  function editDialog(entry){
    const runtime=rt(),revision=runtime.ui.catalogRevision;
    runtime.modal(entry?'编辑文献资料':'新增文献',`<form id="catalog-edit-form">${fields.map(key=>`<label class="field"><span>${labels[key]}</span><input name="${key}" value="${E(entry?.[key]??'')}" ${key==='title'?'required':''}></label>`).join('')}<p class="muted">清空字段会保留为空；旧来源和原文保持原样。</p><p data-catalog-error role="alert"></p><div class="modal-actions"><button type="submit">保存</button></div></form>`,dialog=>{
      dialog.querySelector('form').onsubmit=event=>{event.preventDefault();const save=event.submitter;save.disabled=true;run(async()=>{
        try{
          const values=Object.fromEntries(new FormData(event.target));
          if(entry){const owner=await ensureEntry(entry,revision);await execute({type:'entry.update',entryId:owner.entryId,fields:values},owner.revision);}
          else {const aliases=window.BrevessLibraryCatalog.libraryCatalogIdentityAliases({...values,sourceId:'manual:'+crypto.randomUUID()});const result=await execute({type:'entry.create',aliases,fields:values},revision);runtime.ui.librarySelected=result.targetId;}
          dialog.close();await runtime.loadGlobalLibrary();
        }catch(error){dialog.querySelector('[data-catalog-error]').textContent=error.code||error.message;}finally{save.disabled=false;}
      });};
    });
  }
  function columnsDialog(){
    const runtime=rt(),revision=runtime.ui.catalogRevision,options=[...Object.entries(labels),...groups().filter(g=>!g.removedAt).map(g=>[g.id,g.name])],current=runtime.ui.libraryPreferences?.columns||[];
    runtime.modal('显示列',`<form id="catalog-columns">${options.map(([key,name])=>`<label class="catalog-check"><input type="checkbox" name="column" value="${E(key)}" ${current.includes(key)||key==='title'?'checked':''} ${key==='title'?'disabled':''}>${E(name)}</label>`).join('')}<div class="modal-actions"><button>保存显示列</button></div></form>`,dialog=>{
      dialog.querySelector('form').onsubmit=event=>{event.preventDefault();run(async()=>{const columns=['title',...new FormData(event.target).getAll('column').filter(key=>key!=='title')];await execute({type:'preferences.set',preferences:{columns}},revision);dialog.close();await runtime.loadGlobalLibrary();});};
    });
  }
  function groupsDialog(){
    const runtime=rt(),revision=runtime.ui.catalogRevision;
    runtime.modal('标签组与标签',`<div class="catalog-group-editor">${groups().map(group=>`<section data-catalog-group="${E(group.id)}"><div class="actions"><input data-group-name aria-label="标签组名称" value="${E(group.name)}"><select data-group-mode aria-label="标签选择方式"><option value="single" ${group.mode==='single'?'selected':''}>单选</option><option value="multiple" ${group.mode==='multiple'?'selected':''}>多选</option></select><button data-group-save>保存组</button><button data-group-toggle>${group.removedAt?'恢复组':'移除组'}</button></div>${group.tags.map(tag=>`<div class="actions" data-catalog-tag="${E(tag.id)}"><input data-tag-name aria-label="标签名称" value="${E(tag.name)}"><button data-tag-save>保存标签</button><button data-tag-toggle>${tag.removedAt?'恢复':'移除'}</button></div>`).join('')}<div class="actions"><input data-new-tag placeholder="新标签名称" aria-label="新标签名称"><button data-tag-add ${group.removedAt?'disabled':''}>添加标签</button></div></section>`).join('')}<section><input id="catalog-new-group" placeholder="新标签组名称" aria-label="新标签组名称"><button data-group-add>新增标签组</button></section><p data-catalog-error role="alert"></p></div>`,dialog=>{
      dialog.onclick=event=>{const button=event.target.closest('button');if(!button||button.hasAttribute('data-close'))return;const section=button.closest('[data-catalog-group]'),group=groups().find(g=>g.id===section?.dataset.catalogGroup),tag=group?.tags.find(t=>t.id===button.closest('[data-catalog-tag]')?.dataset.catalogTag);let command;
        if(button.hasAttribute('data-group-add'))command={type:'group.create',name:dialog.querySelector('#catalog-new-group').value,mode:'single'};
        if(button.hasAttribute('data-group-save'))command={type:'group.update',groupId:group.id,name:section.querySelector('[data-group-name]').value,mode:section.querySelector('[data-group-mode]').value};
        if(button.hasAttribute('data-group-toggle'))command={type:group.removedAt?'group.restore':'group.remove',groupId:group.id};
        if(button.hasAttribute('data-tag-add'))command={type:'tag.create',groupId:group.id,name:section.querySelector('[data-new-tag]').value};
        if(button.hasAttribute('data-tag-save'))command={type:'tag.update',groupId:group.id,tagId:tag.id,name:button.closest('[data-catalog-tag]').querySelector('[data-tag-name]').value};
        if(button.hasAttribute('data-tag-toggle'))command={type:tag.removedAt?'tag.restore':'tag.remove',groupId:group.id,tagId:tag.id};
        if(command){button.disabled=true;run(async()=>{try{await execute(command,revision);await runtime.loadGlobalLibrary();groupsDialog();}catch(error){dialog.querySelector('[data-catalog-error]').textContent=error.code||error.message;button.disabled=false;}});}
      };
    });
  }
  // Capture only catalog controls so row navigation cannot consume a checkbox click.
  document.addEventListener('click',event=>{
    const target=event.target.closest?.('[data-catalog-pick],[data-catalog-select-all],[data-catalog-sort],[data-catalog-batch-remove]');
    if(!target||!rt())return;
    event.stopImmediatePropagation();const runtime=rt(),ui=runtime.ui;ui.catalogSelection ||= new Map();
    if(target.hasAttribute('data-catalog-pick')){const id=target.dataset.catalogPick,entry=ui.libraryEntries.find(e=>e.id===id);if(target.checked&&entry)ui.catalogSelection.set(id,entry);else ui.catalogSelection.delete(id);runtime.renderLibraryView();}
    else if(target.hasAttribute('data-catalog-select-all')){for(const entry of ui.libraryEntries){if(target.checked)ui.catalogSelection.set(entry.id,entry);else ui.catalogSelection.delete(entry.id);}runtime.renderLibraryView();}
    else if(target.hasAttribute('data-catalog-sort')){const field=target.dataset.catalogSort;ui.catalogHeaderSort={field,direction:ui.catalogHeaderSort?.field===field&&ui.catalogHeaderSort.direction==='asc'?'desc':'asc'};ui.libraryPage=1;run(runtime.loadGlobalLibrary);}
    else if(!ui.catalogBatchBusy){const selected=[...ui.catalogSelection.values()];if(!selected.length||!confirm('从总库删除选中的 '+selected.length+' 个条目？原文和已有课题引用保留，可在“含已移除”中恢复。'))return;
      ui.catalogBatchBusy=true;target.disabled=true;run(async()=>{let completed=0;try{for(const entry of selected){const owner=await ensureEntry(entry);await execute({type:'entry.remove',entryId:owner.entryId},owner.revision);ui.catalogSelection.delete(entry.id);completed++;}runtime.toast('已删除 '+completed+' 个条目');}catch(error){runtime.toast('已删除 '+completed+' 个；其余保留。'+(error.code||error.message));}finally{ui.catalogBatchBusy=false;await runtime.loadGlobalLibrary();}});
    }
  },true);
  document.addEventListener('change',event=>{if(event.target.id==='library-view-sort'&&rt())rt().ui.catalogHeaderSort=null;},true);
  document.addEventListener('click',event=>{
    const clear=event.target.closest('[data-library-legacy-clear]'),remove=event.target.closest('[data-library-legacy-remove]');
    if(rt()&&(clear||remove)){rt().ui.libraryLegacyTags=clear?[]:(rt().ui.libraryLegacyTags||[]).filter(tag=>tag!==remove.dataset.libraryLegacyRemove);changeLegacyTags();return;}
    const button=event.target.closest('[data-catalog-action]');if(!button||!rt())return;
    const action=button.dataset.catalogAction,entry=active();
    if(action==='new')editDialog();
    else if(action==='edit'&&entry)editDialog(entry);
    else if(action==='columns')columnsDialog();
    else if(action==='groups')groupsDialog();
    else if(action==='removed'){rt().ui.libraryIncludeRemoved=!rt().ui.libraryIncludeRemoved;rt().ui.libraryPage=1;run(rt().loadGlobalLibrary);}
    else if(['remove','restore'].includes(action)&&entry){
      if(action==='remove'&&!confirm('从总库移除此条目？原文、缓存和已有课题引用会保留，可在“含已移除”中恢复。'))return;
      run(async()=>{const owner=await ensureEntry(entry);await execute({type:'entry.'+action,entryId:owner.entryId},owner.revision);await rt().loadGlobalLibrary();});
    }
    else window.dispatchEvent(new CustomEvent('brevess-catalog-action',{detail:{action,entry}}));
  });
  document.addEventListener('change',event=>{
    const legacyChoice=event.target.closest('[data-library-legacy-choice]'),legacyMode=event.target.closest('[data-library-legacy-mode]');
    if(rt()&&(legacyChoice||legacyMode)){
      if(legacyChoice){const tags=rt().ui.libraryLegacyTags||[];if(!legacyChoice.value||tags.includes(legacyChoice.value))return;rt().ui.libraryLegacyTags=[...tags,legacyChoice.value];}
      if(legacyMode)rt().ui.libraryLegacyTagMode=legacyMode.value==='all'?'all':'any';changeLegacyTags();return;
    }
    const select=event.target.closest('[data-catalog-tags]');if(select&&active()){
      const entry=active(),groupId=select.dataset.catalogTags,tagIds=[...select.selectedOptions].map(option=>option.value).filter(Boolean),revision=rt().ui.catalogRevision;select.disabled=true;
      run(async()=>{try{const owner=await ensureEntry(entry,revision);await execute({type:'entry.tags.set',entryId:owner.entryId,groupId,tagIds},owner.revision);await rt().loadGlobalLibrary();}finally{select.disabled=false;}});
    }
    if(['library-query-field','library-query-operator','library-query-group'].includes(event.target.id)){
      rt().ui.libraryQueryField=document.getElementById('library-query-field').value;rt().ui.libraryQueryOperator=document.getElementById('library-query-operator').value;rt().ui.libraryQueryGroup=document.getElementById('library-query-group').value;document.getElementById('library-query-group').hidden=rt().ui.libraryQueryField!=='tags';
    }
  });
  document.addEventListener('keydown',event=>{if(event.key==='Enter'&&event.target.id==='library-view-query'){event.preventDefault();document.querySelector('[data-action="library-view-search"]')?.click();}});
  window.BrevessLibraryCatalogUI={table,detail,ensureEntry,execute};
})();


;/* native/workbench/library-source-controls.js */
(function attach(root, factory) {
  const common = typeof module === 'object' && module.exports;
  const api = factory(common ? require('../core/local-library-tags.js') : root.SciLLM);
  if (common) module.exports = api;
  root.BrevessLibrarySourceControls = Object.assign(root.BrevessLibrarySourceControls || {}, api);
  if (!common && root.document) {
    let controls;
    root.addEventListener('brevess-catalog-detail', event => {
      controls ||= api.createLibrarySourceControls({ document: root.document, window: root,
        sendMessage: message => root.chrome?.runtime?.sendMessage ? root.chrome.runtime.sendMessage(message)
          : Promise.reject(Object.assign(new Error('扩展未连接，仅可预览。'), { code: 'LIBRARY_SOURCE_RUNTIME_UNAVAILABLE' })),
        getURL: path => root.chrome?.runtime?.getURL?.(path) || new URL('../' + path, root.location.href).href,
        runtimeAvailable: typeof root.chrome?.runtime?.sendMessage === 'function',
        onSaved: () => root.__workbenchRuntime?.loadGlobalLibrary?.() });
      controls.mount(event.detail?.entry, root.document.querySelector('.catalog-detail-actions'));
    });
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory(tagsApi) {
  'use strict';
  const fail = code => { throw Object.assign(new Error(code), { code }); };
  function eligibleLibrarySource(source) {
    return !!source && source.inventoryOnly !== true && source.tagState !== 'aggregate' &&
      /^workspace:[a-f0-9]{64}$/u.test(source.workspaceId || '') && Number.isSafeInteger(source.workspaceGeneration) && source.workspaceGeneration >= 1;
  }
  function requireSource(source) { if (!eligibleLibrarySource(source)) fail('LIBRARY_SOURCE_IDENTITY_INVALID'); return source; }
  function librarySourceDirectoryUrl(source, getURL) {
    requireSource(source);
    return getURL(`options.html#page=storage&libraryDirectory=${encodeURIComponent(source.workspaceId)}`);
  }
  function createLibrarySourceService({ sendMessage } = {}) {
    if (typeof sendMessage !== 'function' || !tagsApi?.normalizeLocalLibraryTagsAsset) fail('LIBRARY_SOURCE_SERVICE_UNAVAILABLE');
    const path = tagsApi.LOCAL_LIBRARY_TAGS_ASSET_PATH;
    async function response(message) {
      const result = await sendMessage(message);
      if (result?.success !== true) throw Object.assign(new Error(result?.error?.message || '工作区请求未确认'), { code: result?.error?.code || 'LIBRARY_SOURCE_REQUEST_UNCONFIRMED' });
      return result.data;
    }
    async function readTags(source) {
      requireSource(source);
      const data = await response({ type: 'ARTICLE_WORKSPACE_GET_ASSET', workspaceId: source.workspaceId, relativePath: path });
      if (data?.workspaceGeneration !== source.workspaceGeneration) fail('WORKSPACE_GENERATION_CONFLICT');
      if (data.found === false && data.asset === null) return { generation: source.workspaceGeneration, revision: 0, contentHash: '', tags: [] };
      const asset = data.asset;
      if (data.found !== true || !asset || asset.relativePath !== path || !Number.isSafeInteger(asset.revision) || asset.revision < 1 ||
          typeof asset.contentHash !== 'string' || !asset.contentHash || asset.contentHash.length > 200) fail('LIBRARY_SOURCE_TAG_BASE_INVALID');
      const content = tagsApi.normalizeLocalLibraryTagsAsset(asset.content, { workspaceId: source.workspaceId });
      return { generation: source.workspaceGeneration, revision: asset.revision, contentHash: asset.contentHash, tags: [...content.tags] };
    }
    async function saveTags(source, base, tags) {
      requireSource(source);
      if (!base || base.generation !== source.workspaceGeneration || !Number.isSafeInteger(base.revision) || base.revision < 0 ||
          typeof base.contentHash !== 'string' || base.contentHash.length > 200 || (base.revision > 0 ? !base.contentHash : base.contentHash !== '')) fail('LIBRARY_SOURCE_TAG_BASE_INVALID');
      const content = tagsApi.normalizeLocalLibraryTagsAsset({ schemaVersion: 1, workspaceId: source.workspaceId, tags }, { workspaceId: source.workspaceId });
      const data = await response({ type: 'ARTICLE_WORKSPACE_SAVE_ASSET', workspaceId: source.workspaceId,
        workspaceGeneration: base.generation, relativePath: path, content, expectedRevision: base.revision,
        expectedContentHash: base.contentHash, createOnly: base.revision === 0 });
      if (data?.saved !== true || !Number.isSafeInteger(data.asset?.revision) || data.asset.revision <= base.revision ||
          typeof data.asset.contentHash !== 'string' || !data.asset.contentHash || data.asset.contentHash.length > 200 ||
          data.asset.relativePath !== undefined && data.asset.relativePath !== path) fail('TAG_SAVE_UNVERIFIED');
      return data;
    }
    return { readTags, saveTags };
  }
  function createLibrarySourceTagDraft(source, { service, onChange = () => {}, onSaved = () => {} } = {}) {
    requireSource(source);
    const owner = { workspaceId: source.workspaceId, workspaceGeneration: source.workspaceGeneration, title: String(source.title || source.fileName || '原文版本') };
    const state = { source: owner, base: null, tags: [], input: '', backups: [], latest: null, busy: false, blocked: true, closed: false, status: '' };
    const changed = () => onChange(state);
    const editable = () => { if (state.closed || state.busy) fail('LIBRARY_SOURCE_EDITOR_BUSY'); };
    const dirty = () => !!state.input || JSON.stringify(state.tags) !== JSON.stringify(state.base?.tags || []);
    function setInput(value) { editable(); state.input = String(value); }
    function addInput() {
      editable(); if (!state.input) return;
      const tags = tagsApi.normalizeLocalLibraryTags([...state.tags, state.input]);
      state.tags = [...tags]; state.input = ''; state.status = '有未保存的旧标签修改。'; changed();
    }
    function removeTag(tag) { editable(); state.tags = state.tags.filter(value => value !== tag); state.status = '有未保存的旧标签修改。'; changed(); }
    async function readLatest(initial = false) {
      editable(); state.busy = true; state.latest = null; state.status = '正在校验已保存旧标签…'; changed();
      try {
        const base = await service.readTags(owner);
        if (initial && !state.base && !dirty()) { state.base = base; state.tags = [...base.tags]; state.blocked = false; state.status = base.revision ? '已读取本机旧标签。' : '本来源尚无旧标签。'; }
        else { state.latest = base; state.blocked = true; state.status = '草稿仍保留；请核对最新旧标签，再明确选择是否重新编辑。'; }
        return base;
      } catch (error) { state.blocked = true; state.status = `旧标签无法校验（${error.code || '读取未确认'}），禁止覆盖，草稿保留。`; throw error; }
      finally { state.busy = false; changed(); }
    }
    function adoptLatest() {
      editable(); if (!state.latest) fail('LIBRARY_SOURCE_TAG_BASE_INVALID');
      if (dirty()) state.backups.push({ tags: [...state.tags], input: state.input });
      state.base = state.latest; state.tags = [...state.latest.tags]; state.input = ''; state.latest = null; state.blocked = false;
      state.status = '已采用最新旧标签；可重新增删后保存。'; changed();
    }
    async function save() {
      editable(); if (state.blocked || !state.base) fail('LIBRARY_SOURCE_TAG_BASE_INVALID'); addInput();
      const pendingTags = [...state.tags]; state.busy = true; state.status = '正在保存旧标签…'; changed();
      let result;
      try {
        result = await service.saveTags(owner, state.base, pendingTags);
        state.base = { ...state.base, revision: result.asset.revision, contentHash: result.asset.contentHash, tags: pendingTags };
        state.status = result.directoryPersisted ? '旧标签已保存到本机并同步到目录。' : '旧标签已保存到本机；目录同步尚未完成。';
      } catch (error) {
        state.blocked = true; state.latest = null;
        state.status = /CONFLICT/u.test(error.code || '') ? '保存冲突：另一页面或工作区版本已改变。草稿保留，请读取最新标签后重新编辑。'
          : '保存未确认。草稿保留，请读取最新标签确认后重新编辑；不会自动重试覆盖。';
        throw error;
      } finally { state.busy = false; changed(); }
      // A view refresh failure must not turn a confirmed successful save into an ambiguous write.
      try { await onSaved(result, owner); } catch (_) { state.status += ' 列表刷新未完成，请稍后刷新。'; changed(); }
      return result;
    }
    function close(confirmDiscard = () => false) {
      if (state.busy || dirty() && !confirmDiscard()) return false;
      state.closed = true; changed(); return true;
    }
    return { state, dirty, setInput, addInput, removeTag, readLatest, adoptLatest, save, close };
  }
  function createLibrarySourceControls({ document, window = globalThis, sendMessage, getURL, onSaved, runtimeAvailable = true } = {}) {
    const service = createLibrarySourceService({ sendMessage });
    let current = null, editorPanel = null, root = null;
    const element = (tag, content) => { const node = document.createElement(tag); if (content !== undefined) node.textContent = content; return node; };
    const button = (label, action) => { const node = element('button', label); node.type = 'button'; node.addEventListener('click', action); return node; };
    function attachEditor() { const mount = root?.querySelector('[data-library-source-editor]'); if (mount && editorPanel) mount.append(editorPanel); }
    function openTags(source) {
      if (!runtimeAvailable) fail('LIBRARY_SOURCE_RUNTIME_UNAVAILABLE');
      requireSource(source);
      if (current && !current.state.closed) {
        if (current.state.source.workspaceId === source.workspaceId && current.state.source.workspaceGeneration === source.workspaceGeneration || current.state.busy || current.dirty()) {
          if (current.state.source.workspaceId !== source.workspaceId) current.state.status = '请先保存或关闭当前来源的旧标签草稿，再编辑其他来源。';
          attachEditor(); render(); input?.focus(); return current;
        }
      }
      editorPanel = element('section'); editorPanel.className = 'catalog-source-tag-editor'; editorPanel.dataset.i18nIgnore = '';
      current = createLibrarySourceTagDraft(source, { service, onChange: () => render(), onSaved });
      buildEditor(); attachEditor(); current.readLatest(true).catch(() => {}); return current;
    }
    let input, status, chips, save, refresh, close, add, latest, adopt, backup;
    function buildEditor() {
      const source = current.state.source;
      const heading = element('h4', `来源旧标签 · ${source.title}`), identity = element('small', '已绑定此本机文献来源');
      const help = element('p', '旧标签只属于这个来源工作区，与总库标签组分别保存。Enter 添加，最多 32 个，每个最多 80 字。');
      chips = element('div'); chips.className = 'actions';
      input = element('input'); input.autocomplete = 'off'; input.setAttribute('aria-label', '新旧标签'); input.dataset.sourceTagInput = '';
      input.addEventListener('input', () => { current.setInput(input.value); });
      const addInput = () => { try { current.setInput(input.value); current.addInput(); } catch (_) { status.textContent = '标签无效：最多 32 个，每个 1–80 字；输入已保留。'; } };
      input.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); addInput(); } });
      add = button('添加', addInput);
      status = element('p'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); status.dataset.sourceTagStatus = '';
      save = button('保存旧标签', () => { try { current.setInput(input.value); current.save().catch(error => {
        if (error.code === 'LOCAL_LIBRARY_TAGS_INVALID') status.textContent = '标签无效：最多 32 个，每个 1–80 字；输入已保留。';
      }); } catch (_) {} });
      refresh = button('读取最新标签', () => current.readLatest(false).catch(() => {}));
      close = button('关闭', () => { if (current.close(() => window.confirm('放弃当前来源未保存的旧标签草稿？'))) { editorPanel.remove(); editorPanel = null; current = null; } });
      const actions = element('div'); actions.className = 'actions'; actions.append(save, refresh, close);
      latest = element('p'); adopt = button('采用最新标签，重新编辑', () => current.adoptLatest());
      const backupLabel = element('label', '未保存草稿备份（供复制，不自动覆盖新版本）');
      backup = element('textarea'); backup.readOnly = true; backup.setAttribute('aria-label', '旧标签草稿备份'); backup.dataset.sourceTagBackup = ''; backupLabel.append(backup);
      editorPanel.append(heading, identity, help, chips, input, add, status, actions, latest, adopt, backupLabel);
      render();
    }
    function render() {
      if (!current || !editorPanel || !status) return;
      const state = current.state;
      input.value = state.input; status.textContent = state.status;
      [input, add, close, refresh].forEach(node => { node.disabled = state.busy; }); save.disabled = state.busy || state.blocked;
      chips.replaceChildren(...state.tags.map(tag => { const control = button(`${tag} ×`, () => current.removeTag(tag)); control.disabled = state.busy; return control; }));
      latest.hidden = adopt.hidden = !state.latest; latest.textContent = state.latest ? `最新旧标签：${state.latest.tags.join('、') || '无'}` : '';
      adopt.disabled = state.busy; backup.parentNode.hidden = !state.backups.length; backup.value = state.backups.map(value => JSON.stringify(value)).join('\n\n');
    }
    function mount(entry, container) {
      root = container; if (!root || !entry) return;
      const nodes = root.querySelectorAll('[data-catalog-source-index]');
      nodes.forEach(node => {
        const index = Number(node.dataset.catalogSourceIndex), source = entry.sourceDocuments?.[index], target = node.querySelector('[data-library-source-controls]');
        if (!target) return; target.replaceChildren();
        if (!Number.isSafeInteger(index) || index < 0 || !eligibleLibrarySource(source)) {
          target.append(element('small', '此来源没有可校验的本机工作区；旧标签与目录操作不可用。')); return;
        }
        const edit = button(source.tagState === 'invalid' ? '旧标签异常 · 查看' : '编辑来源旧标签', () => openTags(source));
        edit.disabled = !runtimeAvailable;
        edit.dataset.librarySourceEditTags = ''; edit.setAttribute('aria-label', `编辑 ${source.title || '本来源'} 的旧标签`);
        const directory = element('a', '打开文件夹…'); directory.className = 'btn';
        if (runtimeAvailable) directory.href = librarySourceDirectoryUrl(source, getURL); else directory.setAttribute('aria-disabled', 'true');
        directory.target = '_blank'; directory.rel = 'noopener noreferrer'; directory.title = '到本地保存设置核对来源并确认打开文件夹'; directory.dataset.librarySourceDirectory = '';
        target.append(edit, directory);
        if (!runtimeAvailable) target.append(element('small', '扩展未连接，仅可预览；旧标签与目录操作不可用。'));
      });
      attachEditor();
    }
    const beforeUnload = event => { if (current && (current.dirty() || current.state.busy)) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener?.('beforeunload', beforeUnload);
    return { mount, openTags, getDraft: () => current,
      destroy() { if (current && (current.dirty() || current.state.busy)) return false; window.removeEventListener?.('beforeunload', beforeUnload); editorPanel?.remove(); current = null; return true; } };
  }
  return { eligibleLibrarySource, librarySourceDirectoryUrl, createLibrarySourceService, createLibrarySourceTagDraft, createLibrarySourceControls };
});

