(function attach(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.BrevessLibraryCatalog = Object.assign(root.BrevessLibraryCatalog || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory() {
  'use strict';

  // Optional metadata only: no workspace, flat-tag or original-file writes.
  const CATALOG_SCHEMA_VERSION = 1;
  const FIELDS = ['title', 'authors', 'journal', 'doi', 'pmid', 'publicationDate'];
  const TEXT_SCOPES = ['fulltext', 'notes', 'abstract', 'method', 'caption'];
  const SORT_FIELDS = [...FIELDS, 'addedAt'];
  const FIXED_COLUMNS = [...FIELDS, 'addedAt', 'legacyTags', 'attachments'];
  const MAX_RECEIPTS = 64;
  const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  const plain = value => value !== null && typeof value === 'object' &&
    !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
  const clone = value => JSON.parse(JSON.stringify(value));
  const unique = values => [...new Set(values)];
  const fold = value => String(value ?? '').normalize('NFKC').replace(/\s+/gu, ' ').trim().toLowerCase();
  function fail(code, details) { throw Object.assign(new Error(code), { code, ...(details ? { details } : {}) }); }
  function assert(ok, code = 'LIBRARY_CATALOG_INVALID') { if (!ok) fail(code); }
  function onlyKeys(value, keys, code = 'LIBRARY_CATALOG_INVALID') {
    assert(plain(value) && Object.keys(value).every(key => keys.includes(key)), code);
  }
  function boundedString(value, max = 4096, empty = true) {
    return typeof value === 'string' && value.length <= max && (empty || value.length > 0) &&
      !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\ud800-\udfff]/u.test(value);
  }
  function name(value) {
    assert(boundedString(value, 240, false), 'LIBRARY_CATALOG_NAME_INVALID');
    const result = value.normalize('NFC').trim();
    assert(result.length > 0, 'LIBRARY_CATALOG_NAME_INVALID');
    return result;
  }
  function id(value, prefix) {
    assert(typeof value === 'string' && new RegExp(`^${prefix}:[A-Za-z0-9_-]{1,100}$`, 'u').test(value),
      'LIBRARY_CATALOG_ID_INVALID');
    return value;
  }
  function iso(value) { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value; }
  function timestamp(value) { assert(value === null || iso(value), 'LIBRARY_CATALOG_TIME_INVALID'); return value; }
  function jsonSafe(value, depth = 0, seen = new Set()) {
    assert(depth <= 20, 'LIBRARY_CATALOG_TOO_DEEP');
    if (value === null || typeof value === 'boolean') return;
    if (typeof value === 'number') { assert(Number.isFinite(value)); return; }
    if (typeof value === 'string') { assert(boundedString(value, 2_000_000)); return; }
    assert(Array.isArray(value) || plain(value));
    assert(!seen.has(value), 'LIBRARY_CATALOG_CYCLE'); seen.add(value);
    if (Array.isArray(value)) {
      assert(value.length <= 100_000, 'LIBRARY_CATALOG_TOO_LARGE');
      value.forEach(item => jsonSafe(item, depth + 1, seen));
    } else {
      for (const [key, item] of Object.entries(value)) {
        assert(!['__proto__', 'constructor', 'prototype'].includes(key), 'LIBRARY_CATALOG_KEY_INVALID');
        jsonSafe(item, depth + 1, seen);
      }
    }
    seen.delete(value);
  }
  function canonical(value) {
    if (Array.isArray(value)) return value.map(canonical);
    return plain(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
  }
  function normalizeCatalogDoi(value) {
    if (typeof value !== 'string') return '';
    let result = value.trim().replace(/^doi:\s*/iu, '');
    if (/^https?:\/\//iu.test(result)) {
      try {
        const url = new URL(result);
        if (!/^(dx\.)?doi\.org$/iu.test(url.hostname) || url.username || url.password || url.search || url.hash) return '';
        result = decodeURIComponent(url.pathname.slice(1));
      } catch (_) { return ''; }
    }
    return result.length <= 500 && /^10\.\d{4,9}\/[^\s?#\u0000-\u001f\u007f]+$/u.test(result) ? result.toLowerCase() : '';
  }
  function normalizeCatalogPmid(value) {
    if (typeof value !== 'string' && typeof value !== 'number') return '';
    const result = String(value).trim().replace(/^pmid:\s*/iu, '');
    return /^[1-9]\d{0,11}$/u.test(result) ? result : '';
  }
  function validAlias(value) {
    return boundedString(value, 800, false) && (
      value.startsWith('doi:') && normalizeCatalogDoi(value.slice(4)) === value.slice(4) ||
      value.startsWith('pmid:') && normalizeCatalogPmid(value.slice(5)) === value.slice(5) ||
      /^workspace:[a-f0-9]{64}$/u.test(value) || /^source:[^\s\u0000-\u001f]{1,700}$/u.test(value));
  }
  function normalizeAliases(values) {
    assert(Array.isArray(values) && values.length > 0 && values.length <= 256 && values.every(validAlias),
      'LIBRARY_CATALOG_ALIASES_INVALID');
    const result = unique(values).sort();
    assert(['doi:', 'pmid:'].every(prefix => result.filter(value => value.startsWith(prefix)).length <= 1),
      'LIBRARY_CATALOG_IDENTITY_CONFLICT');
    return result;
  }
  function libraryCatalogIdentityAliases(record = {}) {
    const aliases = [];
    const doi = normalizeCatalogDoi(record.doi), pmid = normalizeCatalogPmid(record.pmid);
    if (doi) aliases.push(`doi:${doi}`);
    if (pmid) aliases.push(`pmid:${pmid}`);
    if (boundedString(record.sourceId, 700, false) && !/\s/u.test(record.sourceId)) aliases.push(`source:${record.sourceId}`);
    for (const document of Array.isArray(record.sourceDocuments) ? record.sourceDocuments : []) {
      if (record.inventoryOnly !== true && document?.inventoryOnly !== true && /^workspace:[a-f0-9]{64}$/u.test(document?.workspaceId || '')) {
        aliases.push(document.workspaceId);
      }
    }
    return unique(aliases).sort();
  }
  function normalizeFields(fields) {
    assert(plain(fields), 'LIBRARY_CATALOG_FIELDS_INVALID');
    for (const [key, value] of Object.entries(fields)) assert(FIELDS.includes(key) &&
      (value === null || boundedString(value, key === 'title' || key === 'authors' ? 20_000 : 2000)),
    'LIBRARY_CATALOG_FIELDS_INVALID');
    return clone(fields);
  }
  function defaultGroups() {
    return [
      { id: 'group:document-type', name: '文献类型', mode: 'single', removedAt: null, tags: [
        { id: 'tag:type-review', name: 'review', removedAt: null },
        { id: 'tag:type-article', name: 'article', removedAt: null },
        { id: 'tag:type-clinical-trials', name: 'clinical trials', removedAt: null }] },
      { id: 'group:recommendation', name: '推荐程度', mode: 'single', removedAt: null, tags: [
        { id: 'tag:rating-1', name: '⭐', removedAt: null },
        { id: 'tag:rating-2', name: '⭐⭐', removedAt: null },
        { id: 'tag:rating-3', name: '⭐⭐⭐', removedAt: null }] }
    ];
  }
  function createEmptyLibraryCatalog() {
    return { schemaVersion: CATALOG_SCHEMA_VERSION, revision: 0, groups: defaultGroups(), entries: [],
      preferences: { columns: ['title', 'publicationDate', 'journal', 'addedAt', 'group:document-type', 'group:recommendation'],
        groupOrder: ['group:document-type', 'group:recommendation'], sort: { field: 'addedAt', direction: 'desc' } }, receipts: [] };
  }
  function safeUrl(value) {
    try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password; }
    catch (_) { return false; }
  }
  function normalizeCatalogAttachment(value) {
    assert(plain(value), 'LIBRARY_CATALOG_ATTACHMENT_INVALID');
    id(value.id, 'attachment');
    assert(['pdf', 'html', 'other'].includes(value.kind) &&
      ['available', 'partial', 'missing', 'inventory-only'].includes(value.availability), 'LIBRARY_CATALOG_ATTACHMENT_INVALID');
    assert(boundedString(value.name, 500, false) && boundedString(value.mime, 200) &&
      (value.size === null || Number.isSafeInteger(value.size) && value.size >= 0) &&
      (value.sha256 === null || /^[a-f0-9]{64}$/u.test(value.sha256)), 'LIBRARY_CATALOG_ATTACHMENT_INVALID');
    timestamp(value.removedAt);
    const locator = value.locator;
    assert(plain(locator), 'LIBRARY_CATALOG_LOCATOR_INVALID');
    let assetId;
    if (locator.type === 'pdf-source') {
      assert(value.kind === 'pdf' && /^[a-f0-9]{64}$/u.test(locator.sha256) && locator.sha256 === value.sha256,
        'LIBRARY_CATALOG_LOCATOR_INVALID');
      assetId = `sha256:${locator.sha256}`;
      assert(Object.keys(locator).every(key => ['type', 'sha256'].includes(key)), 'LIBRARY_CATALOG_LOCATOR_INVALID');
    } else if (locator.type === 'catalog-blob') {
      assert(/^[a-f0-9]{64}$/u.test(locator.sha256) && locator.sha256 === value.sha256 &&
        Object.keys(locator).every(key => ['type', 'sha256'].includes(key)), 'LIBRARY_CATALOG_LOCATOR_INVALID');
      assetId = `sha256:${locator.sha256}`;
    } else if (locator.type === 'workspace-asset') {
      assert(/^workspace:[a-f0-9]{64}$/u.test(locator.workspaceId || '') &&
        Number.isSafeInteger(locator.workspaceGeneration) && locator.workspaceGeneration >= 1 &&
        boundedString(locator.relativePath, 500, false) &&
        !/[\\\u0000-\u001f:?%#]/u.test(locator.relativePath) && !locator.relativePath.startsWith('/') &&
        locator.relativePath.split('/').every(part => part && part !== '.' && part !== '..'), 'LIBRARY_CATALOG_LOCATOR_INVALID');
      assert(Object.keys(locator).every(key => ['type', 'workspaceId', 'workspaceGeneration', 'relativePath'].includes(key)),
        'LIBRARY_CATALOG_LOCATOR_INVALID');
      assetId = value.sha256 ? `sha256:${value.sha256}` : `workspace-asset:${JSON.stringify([locator.workspaceId, locator.workspaceGeneration, locator.relativePath])}`;
    } else {
      assert(locator.type === 'external' && safeUrl(locator.url) && value.availability === 'inventory-only' &&
        Object.keys(locator).every(key => ['type', 'url'].includes(key)), 'LIBRARY_CATALOG_LOCATOR_INVALID');
      assetId = value.sha256 ? `sha256:${value.sha256}` : `external:${locator.url}`;
    }
    assert(value.assetId === assetId, 'LIBRARY_CATALOG_ASSET_ID_MISMATCH');
    assert(Object.keys(value).every(key => ['id', 'assetId', 'name', 'mime', 'size', 'sha256', 'kind', 'availability', 'locator', 'removedAt'].includes(key)),
      'LIBRARY_CATALOG_ATTACHMENT_INVALID');
    return clone(value);
  }
  function normalizePreferences(value, groups) {
    onlyKeys(value, ['columns', 'groupOrder', 'sort'], 'LIBRARY_CATALOG_PREFERENCES_INVALID');
    assert(plain(value) && Array.isArray(value.columns) && value.columns.length <= 100 &&
      Array.isArray(value.groupOrder) && value.groupOrder.length <= 100 && plain(value.sort), 'LIBRARY_CATALOG_PREFERENCES_INVALID');
    onlyKeys(value.sort, ['field', 'direction'], 'LIBRARY_CATALOG_PREFERENCES_INVALID');
    const groupIds = new Set(groups.map(group => group.id));
    assert(value.columns.every(column => FIXED_COLUMNS.includes(column) || groupIds.has(column)) &&
      value.groupOrder.every(groupId => groupIds.has(groupId)) && unique(value.columns).length === value.columns.length &&
      unique(value.groupOrder).length === value.groupOrder.length && SORT_FIELDS.includes(value.sort.field) &&
      ['asc', 'desc'].includes(value.sort.direction), 'LIBRARY_CATALOG_PREFERENCES_INVALID');
    return clone(value);
  }
  function normalizeLibraryCatalog(value) {
    jsonSafe(value);
    onlyKeys(value, ['schemaVersion', 'revision', 'groups', 'entries', 'preferences', 'receipts']);
    assert(plain(value) && value.schemaVersion === CATALOG_SCHEMA_VERSION && Number.isSafeInteger(value.revision) && value.revision >= 0 &&
      Array.isArray(value.groups) && value.groups.length <= 100 && Array.isArray(value.entries) && value.entries.length <= 50_000 &&
      Array.isArray(value.receipts) && value.receipts.length <= MAX_RECEIPTS, 'LIBRARY_CATALOG_INVALID');
    const groupIds = new Set(), tagIds = new Set(), aliases = new Set(), entryIds = new Set();
    for (const group of value.groups) {
      onlyKeys(group, ['id', 'name', 'mode', 'removedAt', 'tags']);
      id(group.id, 'group'); assert(!groupIds.has(group.id)); groupIds.add(group.id);
      assert(name(group.name) === group.name && ['single', 'multiple'].includes(group.mode) && Array.isArray(group.tags) && group.tags.length <= 1000);
      timestamp(group.removedAt);
      for (const tag of group.tags) {
        onlyKeys(tag, ['id', 'name', 'removedAt']);
        id(tag.id, 'tag'); assert(!tagIds.has(tag.id)); tagIds.add(tag.id);
        assert(name(tag.name) === tag.name); timestamp(tag.removedAt);
      }
    }
    for (const entry of value.entries) {
      onlyKeys(entry, ['id', 'aliases', 'addedAt', 'fields', 'tagIds', 'attachments', 'removedAt']);
      id(entry.id, 'entry'); assert(!entryIds.has(entry.id)); entryIds.add(entry.id);
      const normalized = normalizeAliases(entry.aliases);
      assert(JSON.stringify(normalized) === JSON.stringify(entry.aliases), 'LIBRARY_CATALOG_ALIASES_INVALID');
      for (const alias of entry.aliases) { assert(!aliases.has(alias), 'LIBRARY_CATALOG_IDENTITY_CONFLICT'); aliases.add(alias); }
      timestamp(entry.addedAt); timestamp(entry.removedAt); normalizeFields(entry.fields);
      assert(Array.isArray(entry.tagIds) && entry.tagIds.every(tagId => tagIds.has(tagId)) && unique(entry.tagIds).length === entry.tagIds.length);
      for (const group of value.groups.filter(group => group.mode === 'single')) {
        assert(group.tags.filter(tag => !tag.removedAt && entry.tagIds.includes(tag.id)).length <= 1, 'LIBRARY_CATALOG_SINGLE_SELECTION');
      }
      assert(Array.isArray(entry.attachments) && entry.attachments.length <= 1000);
      const attachmentIds = new Set();
      for (const attachment of entry.attachments) {
        normalizeCatalogAttachment(attachment);
        assert(!attachmentIds.has(attachment.id)); attachmentIds.add(attachment.id);
      }
    }
    normalizePreferences(value.preferences, value.groups);
    const receiptIds = new Set();
    for (const receipt of value.receipts) {
      onlyKeys(receipt, ['key', 'command', 'result']);
      onlyKeys(receipt.result, ['revision', 'targetId', 'type']);
      assert(plain(receipt) && boundedString(receipt.key, 200, false) && boundedString(receipt.command, 128 * 1024, false) &&
        plain(receipt.result) && Number.isSafeInteger(receipt.result.revision) && receipt.result.revision > 0 &&
        receipt.result.revision <= value.revision && !receiptIds.has(receipt.key));
      receiptIds.add(receipt.key);
    }
    return clone(value);
  }
  function exportLibraryCatalog(catalog) { return JSON.stringify(normalizeLibraryCatalog(catalog), null, 2); }
  function importLibraryCatalog(serialized) {
    assert(typeof serialized === 'string' && serialized.length <= 32 * 1024 * 1024, 'LIBRARY_CATALOG_IMPORT_TOO_LARGE');
    let value; try { value = JSON.parse(serialized); } catch (_) { fail('LIBRARY_CATALOG_IMPORT_INVALID'); }
    return normalizeLibraryCatalog(value);
  }
  function applyLibraryCatalogCommand(catalog, request, { now = () => new Date().toISOString(),
    createId = prefix => `${prefix}:${globalThis.crypto.randomUUID()}` } = {}) {
    const state = normalizeLibraryCatalog(catalog);
    jsonSafe(request);
    onlyKeys(request, ['expectedRevision', 'idempotencyKey', 'command'], 'LIBRARY_CATALOG_REQUEST_INVALID');
    assert(plain(request) && Number.isSafeInteger(request.expectedRevision) && request.expectedRevision >= 0 && boundedString(request.idempotencyKey, 200, false) && plain(request.command),
      'LIBRARY_CATALOG_REQUEST_INVALID');
    const commandKeys = {
      'entry.create': ['aliases', 'addedAt', 'fields'], 'entry.aliases.add': ['entryId', 'aliases'],
      'entry.update': ['entryId', 'fields', 'clearOverrides', 'addedAt'], 'entry.remove': ['entryId'], 'entry.restore': ['entryId'],
      'group.create': ['name', 'mode'], 'group.update': ['groupId', 'name', 'mode'], 'group.remove': ['groupId'], 'group.restore': ['groupId'],
      'tag.create': ['groupId', 'name'], 'tag.update': ['groupId', 'tagId', 'name'], 'tag.remove': ['groupId', 'tagId'], 'tag.restore': ['groupId', 'tagId'],
      'entry.tags.set': ['entryId', 'groupId', 'tagIds'], 'attachment.add': ['entryId', 'attachment'],
      'attachment.remove': ['entryId', 'attachmentId'], 'attachment.restore': ['entryId', 'attachmentId'],
      'attachment.setAvailability': ['entryId', 'attachmentId', 'availability'], 'preferences.set': ['preferences']
    };
    assert(own(commandKeys, request.command.type), 'LIBRARY_CATALOG_COMMAND_UNKNOWN');
    onlyKeys(request.command, ['type', ...commandKeys[request.command.type]], 'LIBRARY_CATALOG_COMMAND_INVALID');
    const commandText = JSON.stringify(canonical(request.command));
    assert(commandText.length <= 128 * 1024, 'LIBRARY_CATALOG_COMMAND_TOO_LARGE');
    const previous = state.receipts.find(receipt => receipt.key === request.idempotencyKey);
    if (previous) {
      assert(previous.command === commandText, 'LIBRARY_CATALOG_IDEMPOTENCY_CONFLICT');
      return { catalog: state, result: { ...previous.result, replayed: true } };
    }
    assert(state.revision === request.expectedRevision, 'LIBRARY_CATALOG_REVISION_CONFLICT');
    const command = request.command, at = timestamp(now());
    assert(at !== null, 'LIBRARY_CATALOG_TIME_INVALID');
    const findEntry = () => {
      const entry = state.entries.find(entry => entry.id === command.entryId);
      assert(entry, 'LIBRARY_CATALOG_ENTRY_NOT_FOUND'); return entry;
    };
    const findGroup = () => {
      const group = state.groups.find(group => group.id === command.groupId);
      assert(group, 'LIBRARY_CATALOG_GROUP_NOT_FOUND'); return group;
    };
    let targetId = null;
    switch (command.type) {
      case 'entry.create': {
        const aliases = normalizeAliases(command.aliases);
        assert(!state.entries.some(entry => entry.aliases.some(alias => aliases.includes(alias))), 'LIBRARY_CATALOG_IDENTITY_CONFLICT');
        targetId = id(createId('entry'), 'entry');
        state.entries.push({ id: targetId, aliases, addedAt: own(command, 'addedAt') ? timestamp(command.addedAt) : at,
          fields: normalizeFields(own(command, 'fields') ? command.fields : {}), tagIds: [], attachments: [], removedAt: null });
        break;
      }
      case 'entry.aliases.add': {
        const entry = findEntry(), aliases = normalizeAliases([...entry.aliases, ...normalizeAliases(command.aliases)]);
        assert(!state.entries.some(other => other.id !== entry.id && other.aliases.some(alias => aliases.includes(alias))), 'LIBRARY_CATALOG_IDENTITY_CONFLICT');
        entry.aliases = aliases; targetId = entry.id; break;
      }
      case 'entry.update': {
        const entry = findEntry();
        if (own(command, 'fields')) Object.assign(entry.fields, normalizeFields(command.fields));
        if (own(command, 'clearOverrides')) {
          assert(Array.isArray(command.clearOverrides) && command.clearOverrides.every(field => FIELDS.includes(field)));
          assert(!command.clearOverrides.some(field => own(command.fields || {}, field)), 'LIBRARY_CATALOG_COMMAND_INVALID');
          for (const field of command.clearOverrides) delete entry.fields[field];
        }
        if (own(command, 'addedAt')) entry.addedAt = timestamp(command.addedAt);
        targetId = entry.id; break;
      }
      case 'entry.remove': case 'entry.restore': {
        const entry = findEntry(); entry.removedAt = command.type === 'entry.remove' ? at : null; targetId = entry.id; break;
      }
      case 'group.create': {
        assert(['single', 'multiple'].includes(command.mode), 'LIBRARY_CATALOG_GROUP_MODE_INVALID');
        targetId = id(createId('group'), 'group');
        state.groups.push({ id: targetId, name: name(command.name), mode: command.mode, tags: [], removedAt: null });
        state.preferences.groupOrder.push(targetId); break;
      }
      case 'group.update': case 'group.remove': case 'group.restore': {
        const group = findGroup(); targetId = group.id;
        if (command.type === 'group.update') {
          if (own(command, 'name')) group.name = name(command.name);
          if (own(command, 'mode')) { assert(['single', 'multiple'].includes(command.mode)); group.mode = command.mode; }
        } else group.removedAt = command.type === 'group.remove' ? at : null;
        break;
      }
      case 'tag.create': {
        const group = findGroup(); assert(!group.removedAt, 'LIBRARY_CATALOG_GROUP_REMOVED');
        targetId = id(createId('tag'), 'tag'); group.tags.push({ id: targetId, name: name(command.name), removedAt: null }); break;
      }
      case 'tag.update': case 'tag.remove': case 'tag.restore': {
        const group = findGroup(), tag = group.tags.find(tag => tag.id === command.tagId);
        assert(tag, 'LIBRARY_CATALOG_TAG_NOT_FOUND'); targetId = tag.id;
        if (command.type === 'tag.update') tag.name = name(command.name);
        else tag.removedAt = command.type === 'tag.remove' ? at : null;
        break;
      }
      case 'entry.tags.set': {
        const entry = findEntry(), group = findGroup();
        assert(!group.removedAt && Array.isArray(command.tagIds) && command.tagIds.every(tagId => group.tags.some(tag => tag.id === tagId && !tag.removedAt)),
          'LIBRARY_CATALOG_TAG_ASSIGNMENT_INVALID');
        const selected = unique(command.tagIds);
        assert(group.mode === 'multiple' || selected.length <= 1, 'LIBRARY_CATALOG_SINGLE_SELECTION');
        // An explicit set replaces this group's selection, including its old tombstones.
        const groupIds = new Set(group.tags.map(tag => tag.id));
        entry.tagIds = [...entry.tagIds.filter(tagId => !groupIds.has(tagId)), ...selected]; targetId = entry.id; break;
      }
      case 'attachment.add': {
        const entry = findEntry(), attachment = normalizeCatalogAttachment(command.attachment);
        assert(!entry.attachments.some(item => item.id === attachment.id), 'LIBRARY_CATALOG_ATTACHMENT_EXISTS');
        entry.attachments.push(attachment); targetId = attachment.id; break;
      }
      case 'attachment.remove': case 'attachment.restore': {
        const entry = findEntry(), attachment = entry.attachments.find(item => item.id === command.attachmentId);
        assert(attachment, 'LIBRARY_CATALOG_ATTACHMENT_NOT_FOUND');
        attachment.removedAt = command.type === 'attachment.remove' ? at : null; targetId = attachment.id; break;
      }
      case 'attachment.setAvailability': {
        const entry = findEntry(), attachment = entry.attachments.find(item => item.id === command.attachmentId);
        assert(attachment, 'LIBRARY_CATALOG_ATTACHMENT_NOT_FOUND');
        const normalized = normalizeCatalogAttachment({ ...attachment, availability: command.availability });
        attachment.availability = normalized.availability; targetId = attachment.id; break;
      }
      case 'preferences.set': {
        assert(plain(command.preferences), 'LIBRARY_CATALOG_PREFERENCES_INVALID');
        state.preferences = normalizePreferences({ ...state.preferences, ...command.preferences }, state.groups); break;
      }
      default: fail('LIBRARY_CATALOG_COMMAND_UNKNOWN');
    }
    state.revision += 1;
    const result = { revision: state.revision, targetId, type: command.type };
    state.receipts.push({ key: request.idempotencyKey, command: commandText, result });
    state.receipts = state.receipts.slice(-MAX_RECEIPTS);
    return { catalog: normalizeLibraryCatalog(state), result };
  }
  function authorText(value) {
    return Array.isArray(value) ? value.map(author => typeof author === 'string' ? author : author?.name || author?.fullName || author?.literal || '').filter(Boolean).join(', ') :
      typeof value === 'string' ? value : '';
  }
  function projectSource(record, index, warnings) {
    if (!plain(record)) { warnings.push({ code: 'SOURCE_INVALID', index }); return null; }
    const aliases = libraryCatalogIdentityAliases(record);
    if (!aliases.length) { warnings.push({ code: 'SOURCE_IDENTITY_MISSING', index }); return null; }
    const fields = Object.fromEntries(FIELDS.map(field => [field, field === 'authors' ? authorText(record.authors) : typeof record[field] === 'string' ? record[field] : null]));
    const searchText = {};
    for (const scope of TEXT_SCOPES) {
      if (typeof record.searchText?.[scope] === 'string') searchText[scope] = record.searchText[scope];
      else if (scope === 'abstract' && typeof record.abstract === 'string') searchText[scope] = record.abstract;
    }
    const attachments = [];
    for (const attachment of Array.isArray(record.attachments) ? record.attachments : []) {
      try {
        const normalized = normalizeCatalogAttachment(attachment);
        if (record.inventoryOnly === true && normalized.availability !== 'inventory-only') fail('LIBRARY_CATALOG_INVENTORY_ASSET_INVALID');
        attachments.push(normalized);
      } catch (error) { warnings.push({ code: error.code || 'SOURCE_ATTACHMENT_INVALID', index }); }
    }
    // Original source identity/CAS stays nested and never becomes aggregate write authority.
    const sourceDocuments = (Array.isArray(record.sourceDocuments) ? record.sourceDocuments : []).filter(plain).map(document => {
      const allowed = ['contentType', 'hasSavedWebContent', 'workspaceId', 'workspaceGeneration', 'sourceKind', 'title', 'url', 'canonicalUrl', 'documentHash',
        'sourceUrl', 'fileName', 'mimeType', 'publisherUrl', 'doiUrl', 'savedAt', 'offlineSavedAt',
        'offlineMissingResourceCount', 'lastSaveAttemptStatus', 'lastSaveAttemptAt',
        'hasOfflineSnapshot', 'offlineSnapshotStatus', 'tagRevision', 'tagContentHash', 'tagState', 'inventoryOnly'];
      const result = Object.fromEntries(allowed.filter(key => own(document, key) && document[key] !== undefined).map(key => [key, clone(document[key])]));
      if (record.inventoryOnly === true || document.inventoryOnly === true) {
        result.inventoryOnly = true;
        delete result.tagRevision; delete result.tagContentHash;
      }
      return result;
    });
    return { aliases, fields, sourceId: record.sourceId || null, sourceKind: record.sourceKind || 'unknown',
      addedAt: iso(record.addedAt) ? record.addedAt : null, inventoryOnly: record.inventoryOnly === true,
      legacyTags: unique((Array.isArray(record.tags) ? record.tags : []).filter(tag => boundedString(tag, 4096))), searchText, attachments, sourceDocuments,
      url: safeUrl(record.url) ? record.url : null };
  }
  function projectRow(sources, entry, aliases, catalog, conflict = null) {
    const fields = Object.fromEntries(FIELDS.map(field => [field, entry && own(entry.fields, field) ? entry.fields[field] :
      sources.map(source => source.fields[field]).find(value => value !== null && value !== '') ?? null]));
    const tagGroups = catalog.groups.filter(group => !group.removedAt).map(group => ({ id: group.id, name: group.name, mode: group.mode,
      tags: group.tags.filter(tag => !tag.removedAt && entry?.tagIds.includes(tag.id)).map(tag => ({ id: tag.id, name: tag.name })) }));
    // An explicitly registered association overrides the matching source projection,
    // including a removal tombstone. Unregistered source files remain read-only.
    const attachmentKey = attachment => `${attachment.id}|${attachment.assetId}`;
    const registered = entry?.attachments || [], registeredKeys = new Set(registered.map(attachmentKey));
    const attachments = [...sources.flatMap(source => source.attachments).filter(attachment => !registeredKeys.has(attachmentKey(attachment))), ...registered];
    const seenAttachments = new Set();
    const visibleAttachments = attachments.filter(attachment => {
      const key = attachmentKey(attachment);
      if (seenAttachments.has(key) || attachment.removedAt) return false;
      seenAttachments.add(key); return true;
    });
    return { ...fields, entryId: entry?.id || null, viewId: entry?.id || `view:${encodeURIComponent(aliases.join('|'))}`,
      aliases, addedAt: entry ? entry.addedAt : sources.map(source => source.addedAt).filter(Boolean).sort()[0] || null,
      removedAt: entry?.removedAt || null, sourceRecords: sources, sourceDocuments: sources.flatMap(source => source.sourceDocuments),
      legacyTags: unique(sources.flatMap(source => source.legacyTags)), tagGroups,
      tagIds: tagGroups.flatMap(group => group.tags.map(tag => tag.id)), attachments: visibleAttachments,
      searchText: Object.fromEntries(TEXT_SCOPES.map(scope => [scope, sources.filter(source => own(source.searchText, scope)).map(source => source.searchText[scope])])),
      missingSearchCoverage: TEXT_SCOPES.filter(scope => !sources.length || sources.some(source => !own(source.searchText, scope))),
      conflicts: conflict ? [conflict] : [], inventoryOnly: !!sources.length && sources.every(source => source.inventoryOnly) };
  }
  function buildLibraryCatalogRows(records, catalog = createEmptyLibraryCatalog()) {
    assert(Array.isArray(records), 'LIBRARY_CATALOG_SOURCES_INVALID');
    const state = normalizeLibraryCatalog(catalog), warnings = [];
    const sources = records.map((record, index) => projectSource(record, index, warnings)).filter(Boolean);
    const nodes = [...sources.map(source => ({ source, aliases: source.aliases })), ...state.entries.map(entry => ({ entry, aliases: entry.aliases }))];
    const parent = nodes.map((_, index) => index), aliasOwner = new Map();
    function find(index) { while (parent[index] !== index) { parent[index] = parent[parent[index]]; index = parent[index]; } return index; }
    nodes.forEach((node, index) => node.aliases.forEach(alias => {
      if (aliasOwner.has(alias)) parent[find(index)] = find(aliasOwner.get(alias)); else aliasOwner.set(alias, index);
    }));
    const clusters = new Map();
    nodes.forEach((node, index) => { const key = find(index); if (!clusters.has(key)) clusters.set(key, []); clusters.get(key).push(node); });
    const rows = [];
    for (const cluster of clusters.values()) {
      const aliases = unique(cluster.flatMap(node => node.aliases)).sort(), entries = cluster.filter(node => node.entry).map(node => node.entry);
      const conflict = entries.length > 1 || ['doi:', 'pmid:'].some(prefix => aliases.filter(alias => alias.startsWith(prefix)).length > 1);
      if (conflict) {
        const detail = { code: 'LIBRARY_CATALOG_IDENTITY_CONFLICT', aliases, entryIds: entries.map(entry => entry.id) };
        warnings.push(detail);
        // Conflicting components are deliberately not assigned another entry's metadata.
        for (const node of cluster) rows.push(projectRow(node.source ? [node.source] : [], node.entry || null, node.aliases, state, detail));
      } else rows.push(projectRow(cluster.filter(node => node.source).map(node => node.source), entries[0] || null, aliases, state));
    }
    return { rows, warnings };
  }
  function dateBounds(value) {
    if (typeof value !== 'string') return null;
    if (iso(value)) return { start: value, end: value };
    const match = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/u.exec(value);
    if (!match || Number(match[1]) < 1000 || Number(match[1]) > 9999) return null;
    const year = Number(match[1]), month = match[2] ? Number(match[2]) : 1, day = match[3] ? Number(match[3]) : 1;
    const start = new Date(Date.UTC(year, month - 1, day));
    if (start.getUTCFullYear() !== year || start.getUTCMonth() !== month - 1 || start.getUTCDate() !== day) return null;
    const end = match[3] ? new Date(start.getTime() + 86400000 - 1) :
      match[2] ? new Date(Date.UTC(year, month, 1) - 1) : new Date(Date.UTC(year + 1, 0, 1) - 1);
    return { start: start.toISOString(), end: end.toISOString() };
  }
  function conditionPredicate(condition) {
    assert(plain(condition), 'LIBRARY_CATALOG_QUERY_INVALID');
    const { field, operator, value } = condition;
    if (field === 'tagId' || field === 'groupId') {
      assert(['has', 'notHas'].includes(operator) && typeof value === 'string', 'LIBRARY_CATALOG_QUERY_INVALID');
      id(value, field === 'tagId' ? 'tag' : 'group');
      return row => {
        const has = field === 'tagId' ? row.tagIds.includes(value) : row.tagGroups.some(group => group.id === value && group.tags.length > 0);
        return operator === 'has' ? has : !has;
      };
    }
    assert([...FIELDS, 'addedAt', 'legacyTags', 'tags', 'all', ...TEXT_SCOPES].includes(field) && typeof value === 'string' &&
      value.length <= 4000 && ['exact', 'contains', 'before', 'after'].includes(operator), 'LIBRARY_CATALOG_QUERY_INVALID');
    if (['before', 'after'].includes(operator)) {
      const bound = dateBounds(value);
      assert(['publicationDate', 'addedAt'].includes(field) && bound, 'LIBRARY_CATALOG_QUERY_INVALID');
      return row => { const date = dateBounds(row[field]); return !!date && (operator === 'before' ? date.end <= bound.end : date.start >= bound.start); };
    }
    if (own(condition, 'groupId')) { assert(field === 'tags', 'LIBRARY_CATALOG_QUERY_INVALID'); id(condition.groupId, 'group'); }
    const wanted = fold(value);
    return row => {
      let values;
      if (field === 'all') values = [...FIELDS.map(key => row[key]), row.addedAt, ...row.legacyTags,
        ...row.tagGroups.flatMap(group => group.tags.map(tag => tag.name)), ...Object.values(row.searchText).flat()];
      else if (TEXT_SCOPES.includes(field)) values = row.searchText[field];
      else if (field === 'legacyTags') values = row.legacyTags;
      else if (field === 'tags') values = row.tagGroups.filter(group => !condition.groupId || group.id === condition.groupId).flatMap(group => group.tags.map(tag => tag.name));
      else values = [row[field]];
      return values.some(item => item !== null && item !== undefined && (operator === 'exact' ? fold(item) === wanted : fold(item).includes(wanted)));
    };
  }
  function queryLibraryCatalog(records, { catalog = createEmptyLibraryCatalog(), conditions = [], match = 'all',
    sort = catalog.preferences.sort, page = 1, pageSize = 40, includeRemoved = false, evaluateCondition, includeRow } = {}) {
    assert(Array.isArray(conditions) && conditions.length <= 50 && ['all', 'any'].includes(match) &&
      plain(sort) && (SORT_FIELDS.includes(sort.field) || ['legacyTags','attachments'].includes(sort.field) || catalog.groups.some(g=>g.id===sort.field&&!g.removedAt)) && ['asc', 'desc'].includes(sort.direction) &&
      Number.isSafeInteger(page) && page >= 1 && Number.isSafeInteger(pageSize) && pageSize >= 1 && pageSize <= 500 &&
      typeof includeRemoved === 'boolean' && (evaluateCondition === undefined || typeof evaluateCondition === 'function') &&
      (includeRow === undefined || typeof includeRow === 'function'), 'LIBRARY_CATALOG_QUERY_INVALID');
    // Internal adapter hook for source-store search results. JSON commands/metadata never
    // carry this callback. Validate conditions before allowing a trusted adapter override.
    const predicates = conditions.map(condition => {
      const predicate = conditionPredicate(condition);
      return row => {
        const defaultMatch = predicate(row);
        if (!evaluateCondition) return defaultMatch;
        const evaluated = evaluateCondition(row, condition, defaultMatch);
        assert(typeof evaluated === 'boolean', 'LIBRARY_CATALOG_QUERY_EVALUATOR_INVALID');
        return evaluated;
      };
    });
    const { rows, warnings } = buildLibraryCatalogRows(records, catalog);
    const visible = rows.filter(row => includeRemoved || !row.removedAt);
    const filtered = visible.filter(row => {
      if (includeRow) {
        const included = includeRow(row);
        assert(typeof included === 'boolean', 'LIBRARY_CATALOG_QUERY_EVALUATOR_INVALID');
        if (!included) return false;
      }
      return !predicates.length || (match === 'all' ? predicates.every(predicate => predicate(row)) : predicates.some(predicate => predicate(row)));
    });
    filtered.sort((a, b) => {
      const value = row => sort.field === 'attachments' ? row.attachments.length
        : sort.field === 'legacyTags' ? row.legacyTags.join(' · ')
        : catalog.groups.some(g=>g.id===sort.field) ? (row.tagGroups.find(g=>g.id===sort.field)?.tags||[]).map(t=>t.name).join(' · ')
        : row[sort.field];
      const aValue = value(a), bValue = value(b);
      const aMissing = aValue == null || aValue === '', bMissing = bValue == null || bValue === '';
      if (aMissing !== bMissing) return aMissing ? 1 : -1;
      const left = typeof aValue==='number'?aValue:fold(aValue), right = typeof bValue==='number'?bValue:fold(bValue);
      const compared = left < right ? -1 : left > right ? 1 : 0;
      return compared ? compared * (sort.direction === 'desc' ? -1 : 1) : a.viewId.localeCompare(b.viewId);
    });
    const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize)), current = Math.min(page, pageCount);
    const attachments = visible.flatMap(row => row.attachments);
    return { items: filtered.slice((current - 1) * pageSize, current * pageSize), page: current, pageSize, pageCount,
      matchedCount: filtered.length, totalCount: visible.length, warnings,
      counts: { papers: visible.length, sources: visible.reduce((sum, row) => sum + row.sourceRecords.length, 0),
        pdf: unique(attachments.filter(item => item.kind === 'pdf').map(item => item.assetId)).length,
        html: unique(attachments.filter(item => item.kind === 'html').map(item => item.assetId)).length,
        inventoryOnly: visible.filter(row => row.inventoryOnly).length,
        available: attachments.filter(item => item.availability === 'available').length,
        partial: attachments.filter(item => item.availability === 'partial').length,
        missing: attachments.filter(item => item.availability === 'missing').length,
        missingSearchCoverage: Object.fromEntries(TEXT_SCOPES.map(scope => [scope, visible.filter(row => row.missingSearchCoverage.includes(scope)).length])) } };
  }
  function previewLibraryCatalogAssetDeletion(catalog, assetId) {
    const state = normalizeLibraryCatalog(catalog);
    assert(boundedString(assetId, 2000, false), 'LIBRARY_CATALOG_ASSET_ID_INVALID');
    return { assetId, canDelete: false, reason: 'EXTERNAL_REFERENCE_SCAN_AND_EXPLICIT_CONFIRMATION_REQUIRED',
      references: state.entries.flatMap(entry => entry.attachments.filter(item => item.assetId === assetId).map(attachment => ({
        entryId: entry.id, entryRemoved: entry.removedAt !== null, attachmentId: attachment.id, associationRemoved: attachment.removedAt !== null }))) };
  }
  return { CATALOG_SCHEMA_VERSION, createEmptyLibraryCatalog, normalizeLibraryCatalog, normalizeCatalogAttachment,
    normalizeCatalogDoi, normalizeCatalogPmid, libraryCatalogIdentityAliases, applyLibraryCatalogCommand,
    buildLibraryCatalogRows, queryLibraryCatalog, exportLibraryCatalog, importLibraryCatalog, previewLibraryCatalogAssetDeletion };
});
