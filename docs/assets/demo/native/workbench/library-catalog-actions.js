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
