(function attach(root, factory) {
  const common = typeof module === 'object' && module.exports;
  const api = factory(common ? require('../core/library-catalog-model.js') : root.BrevessLibraryCatalog,
    common ? require('./operation-registry.js') : root.BrevessWorkbenchOperations);
  if (common) module.exports = api;
  root.BrevessLibraryCatalogMcp = Object.assign(root.BrevessLibraryCatalogMcp || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory(model, operations) {
  'use strict';
  const NAMES = ['query_global_library', 'read_library_catalog', 'command_library_catalog'];
  const busy = new WeakSet();
  const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value));
  const fail = code => { throw Object.assign(new Error(code), { code }); };
  const SAFE_CODES = new Set(['LIBRARY_CATALOG_MCP_ARGUMENTS_INVALID', 'LIBRARY_CATALOG_MCP_UNAVAILABLE',
    'LIBRARY_CATALOG_MCP_FAILED', 'LIBRARY_CATALOG_MCP_BUSY', 'LIBRARY_CATALOG_CONFIRMATION_REQUIRED',
    'LIBRARY_CATALOG_DENIED', 'LIBRARY_CATALOG_CANCELLED', 'LIBRARY_CATALOG_TIMEOUT', 'LIBRARY_CATALOG_APPROVAL_REVOKED',
    'LIBRARY_CATALOG_REVISION_CONFLICT', 'LIBRARY_CATALOG_IDEMPOTENCY_CONFLICT', 'LIBRARY_CATALOG_IDENTITY_CONFLICT',
    'LIBRARY_CATALOG_ENTRY_NOT_FOUND', 'LIBRARY_CATALOG_GROUP_NOT_FOUND', 'LIBRARY_CATALOG_GROUP_REMOVED',
    'LIBRARY_CATALOG_TAG_NOT_FOUND', 'LIBRARY_CATALOG_TAG_ASSIGNMENT_INVALID', 'LIBRARY_CATALOG_SINGLE_SELECTION',
    'LIBRARY_CATALOG_ATTACHMENT_NOT_FOUND', 'LIBRARY_CATALOG_COMMAND_INVALID', 'LIBRARY_CATALOG_ALIASES_INVALID',
    'LIBRARY_CATALOG_FIELDS_INVALID', 'LIBRARY_CATALOG_PREFERENCES_INVALID', 'LIBRARY_CATALOG_QUERY_INVALID',
    'LIBRARY_CATALOG_ID_INVALID', 'LIBRARY_CATALOG_NAME_INVALID', 'LIBRARY_CATALOG_TIME_INVALID',
    'LIBRARY_CATALOG_GROUP_MODE_INVALID', 'LIBRARY_CATALOG_SCOPE_INVALID', 'LIBRARY_CATALOG_SOURCE_LIMIT']);
  function publicError(error) {
    const code = SAFE_CODES.has(error?.code) ? error.code : 'LIBRARY_CATALOG_MCP_FAILED';
    // Never forward storage/adapter error.message/details/cause (may include paths or credentials).
    return Object.assign(new Error(code), { code });
  }
  function jsonOnly(value, depth = 0, seen = new Set()) {
    if (depth > 16) return false;
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
    if (typeof value === 'number') return Number.isFinite(value);
    if ((!plain(value) && !Array.isArray(value)) || seen.has(value)) return false;
    seen.add(value);
    const valid = Object.keys(value).every(key => !['__proto__', 'prototype', 'constructor'].includes(key) && jsonOnly(value[key], depth + 1, seen));
    seen.delete(value); return valid;
  }
  function matches(value, schema) {
    if (schema.oneOf) return schema.oneOf.filter(item => matches(value, item)).length === 1;
    if (own(schema, 'const') && value !== schema.const) return false;
    if (schema.enum && !schema.enum.includes(value)) return false;
    const type = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
    if (schema.type && ![].concat(schema.type).some(wanted => wanted === type || wanted === 'integer' && Number.isSafeInteger(value))) return false;
    if (typeof value === 'number' && (schema.minimum !== undefined && value < schema.minimum || schema.maximum !== undefined && value > schema.maximum)) return false;
    if (typeof value === 'string' && (schema.minLength !== undefined && value.length < schema.minLength || schema.maxLength !== undefined && value.length > schema.maxLength || schema.pattern && !new RegExp(schema.pattern, 'u').test(value))) return false;
    if (Array.isArray(value)) {
      if (schema.minItems !== undefined && value.length < schema.minItems || schema.maxItems !== undefined && value.length > schema.maxItems) return false;
      if (schema.uniqueItems && new Set(value.map(item => JSON.stringify(item))).size !== value.length) return false;
      if (schema.items && !value.every(item => matches(item, schema.items))) return false;
    } else if (plain(value)) {
      if (schema.required?.some(key => !own(value, key))) return false;
      if (!Object.keys(value).every(key => own(schema.properties || {}, key) ? matches(value[key], schema.properties[key]) : schema.additionalProperties !== false)) return false;
    }
    return true;
  }
  function validateLibraryCatalogMcpArguments(name, args) {
    const definition = NAMES.includes(name) && operations?.WORKBENCH_OPERATIONS?.find(item => item.name === name);
    if (!definition || !plain(args) || !jsonOnly(args) || JSON.stringify(args).length > 128 * 1024 || !matches(args, definition.inputSchema)) fail('LIBRARY_CATALOG_MCP_ARGUMENTS_INVALID');
    if (name === 'query_global_library') {
      const conditions = [...(args.conditions || [])];
      if (args.query?.trim()) conditions.push({ field: args.field || 'all', operator: args.operator || 'contains', value: args.query.trim(), ...(args.groupId ? { groupId: args.groupId } : {}) });
      model.queryLibraryCatalog([], { conditions, ...(args.sort ? { sort: args.sort } : {}), match: args.match || 'all' });
    }
    return true;
  }
  const clone = value => JSON.parse(JSON.stringify(value));
  const escape = value => String(value).replace(/[&<>"']/gu, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
  function currentData(state, args) {
    const all = state.entries.filter(entry => (args.includeRemoved || !entry.removedAt) && (!args.entryIds || args.entryIds.includes(entry.id)));
    const pageSize = args.pageSize || 40, pageCount = Math.max(1, Math.ceil(all.length / pageSize)), page = Math.min(args.page || 1, pageCount);
    return { schemaVersion: state.schemaVersion, revision: state.revision, entries: all.slice((page - 1) * pageSize, page * pageSize),
      groups: state.groups, preferences: state.preferences, page, pageSize, pageCount, matchedCount: all.length, totalCount: state.entries.length };
  }
  function changedObjects(before, after) {
    const changes = {};
    for (const key of ['entries', 'groups']) {
      const changed = after[key].filter(item => JSON.stringify(item) !== JSON.stringify(before[key].find(previous => previous.id === item.id)));
      if (changed.length) changes[key] = { before: changed.map(item => before[key].find(previous => previous.id === item.id) || null), after: changed };
    }
    if (JSON.stringify(before.preferences) !== JSON.stringify(after.preferences)) changes.preferences = { before: before.preferences, after: after.preferences };
    return changes;
  }
  function queryData(value) {
    if (Array.isArray(value)) return value.map(queryData);
    if (!plain(value)) return value;
    const result = {};
    for (const [key, child] of Object.entries(value)) {
      if (['receipts', 'searchText', 'scopeToken', 'bridgeToken', 'mcpToken'].includes(key)) continue;
      if (key === 'warnings') {
        const allowed = new Set(['RADAR_LIBRARY_UNAVAILABLE', 'SOURCE_INVALID', 'SOURCE_IDENTITY_MISSING', 'SOURCE_ATTACHMENT_INVALID', 'SOURCE_IDENTITY_CONFLICT', 'IDENTITY_CONFLICT']);
        result.warnings = Array.isArray(child) ? child.map(warning => ({ code: allowed.has(warning?.code) ? warning.code : 'LIBRARY_SOURCE_WARNING' })) : [];
      } else result[key] = queryData(child);
    }
    return result;
  }
  function controls(runtime) {
    const controller = new AbortController(), epoch = runtime.ui?.agentApprovalEpoch || 0;
    const deadline = Math.min(Number.isFinite(runtime.deadlineAt) ? runtime.deadlineAt : Infinity, Date.now() + 120000);
    const cancel = () => controller.abort();
    runtime.signal?.addEventListener('abort', cancel, { once: true });
    if (runtime.signal?.aborted) cancel();
    const timer = setTimeout(cancel, Math.max(0, deadline - Date.now()));
    function guard() {
      runtime.assertPermission?.();
      if (Date.now() >= deadline) fail('LIBRARY_CATALOG_TIMEOUT');
      if (controller.signal.aborted) fail('LIBRARY_CATALOG_CANCELLED');
      if ((runtime.ui?.agentApprovalEpoch || 0) !== epoch) fail('LIBRARY_CATALOG_APPROVAL_REVOKED');
      return true;
    }
    return { signal: controller.signal, guard, cleanup() { clearTimeout(timer); runtime.signal?.removeEventListener('abort', cancel); } };
  }
  function confirm(runtime, request, changes, control) {
    if (typeof runtime.modal !== 'function') fail('LIBRARY_CATALOG_CONFIRMATION_REQUIRED');
    return new Promise((resolve, reject) => {
      let settled = false, dialog;
      function finish(reason) {
        if (settled) return; settled = true;
        control.signal.removeEventListener('abort', cancelled);
        dialog?.close?.();
        reason ? reject(reason) : resolve();
      }
      function cancelled() { try { control.guard(); } catch (error) { finish(error); } }
      control.signal.addEventListener('abort', cancelled, { once: true });
      try {
        control.guard();
        const rows = runtime.typePreview;
        const summary = request.command.type === 'entry.types.fill' && Array.isArray(rows)
          ? `<p>将填写 ${rows.length} 篇文献的空白类型。</p><ul>${rows.map(row => `<li>${escape(row.title)} <strong>${escape(row.type)}</strong></li>`).join('')}</ul>`
          : `<p>确认本次全局目录修改。移除只标记关联，可恢复；不删除附件文件。</p><p>目录版本：${request.expectedRevision}；操作：<code>${escape(request.command.type)}</code></p><p>新增 ID 与默认时间为预览值，最终值以执行回执为准。</p><pre>${escape(JSON.stringify(changes, null, 2))}</pre>`;
        runtime.modal('外部 Agent 文献总库修改', summary + `<div class="modal-actions"><button data-catalog-deny>拒绝</button><button data-catalog-allow class="primary">确认本次修改</button></div>`, element => {
          dialog = element;
          if (settled) { dialog?.close?.(); return; }
          const deny = dialog?.querySelector?.('[data-catalog-deny]'), allow = dialog?.querySelector?.('[data-catalog-allow]');
          if (!deny || !allow) { finish(publicError({ code: 'LIBRARY_CATALOG_CONFIRMATION_REQUIRED' })); return; }
          deny.onclick = () => finish(publicError({ code: 'LIBRARY_CATALOG_DENIED' }));
          allow.onclick = () => { try { control.guard(); finish(); } catch (error) { finish(error); } };
          dialog.addEventListener('close', () => finish(publicError({ code: 'LIBRARY_CATALOG_DENIED' })), { once: true });
        });
      } catch (error) { finish(error); }
    });
  }
  function envelope(data, changed = false) {
    return { data, revision: data.catalogRevision ?? data.revision ?? null, changedPaths: changed ? ['library/catalog'] : [],
      approval: null, auditId: `library-catalog-${globalThis.crypto?.randomUUID?.() || Date.now()}` };
  }
  async function execute(name, input = {}, runtime = {}) {
    let control, locked = false;
    try {
      validateLibraryCatalogMcpArguments(name, input);
      const args = clone(input);
      if (name === 'command_library_catalog' && args.command.type === 'entry.create') {
        // Match manual-create identity rules: an explicit source alias cannot hide a DOI/PMID collision.
        args.command.aliases = [...new Set([...args.command.aliases, ...model.libraryCatalogIdentityAliases(args.command.fields || {})])].sort();
      }
      control = controls(runtime); control.guard();
      if (name === 'query_global_library') {
        if (typeof runtime.globalLibraryReader?.query !== 'function') fail('LIBRARY_CATALOG_MCP_UNAVAILABLE');
        const data = queryData(await runtime.globalLibraryReader.query(args)); control.guard(); return envelope(data);
      }
      if (typeof runtime.catalogActions?.read !== 'function') fail('LIBRARY_CATALOG_MCP_UNAVAILABLE');
      const state = model.normalizeLibraryCatalog(await runtime.catalogActions.read()); control.guard();
      if (name === 'read_library_catalog') return envelope(clone(currentData(state, args)));
      if (typeof runtime.catalogActions.execute !== 'function') fail('LIBRARY_CATALOG_MCP_UNAVAILABLE');
      if (busy.has(runtime.catalogActions)) fail('LIBRARY_CATALOG_MCP_BUSY');
      busy.add(runtime.catalogActions); locked = true;
      const preview = model.applyLibraryCatalogCommand(state, args, { createId: prefix => `${prefix}:preview-${globalThis.crypto?.randomUUID?.() || Date.now()}` });
      // Exact receipts are no-write replays. Never ask for new approval or execute a different command with that key.
      if (preview.result.replayed) return envelope(preview.result);
      await confirm(runtime, args, changedObjects(state, preview.catalog), control); control.guard();
      const latest = await runtime.catalogActions.read(); control.guard();
      if (latest.revision !== args.expectedRevision) fail('LIBRARY_CATALOG_REVISION_CONFLICT');
      const result = await runtime.catalogActions.execute(args, { signal: control.signal, guard: control.guard });
      return envelope(result, !result.replayed);
    } catch (error) {
      if (error?.code === 'LIBRARY_CATALOG_CANCELLED') { try { control?.guard(); } catch (reason) { error = reason; } }
      throw publicError(error);
    } finally {
      control?.cleanup(); if (locked) busy.delete(runtime.catalogActions);
    }
  }
  return { execute, validateLibraryCatalogMcpArguments };
});
