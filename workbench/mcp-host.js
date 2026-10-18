/* Host-side MCP surface for the Workbench.
 *
 * `BrevessWorkbenchHost` is the domain host; `BrevessWorkbenchMCP` is the
 * stable envelope consumed by the MCP bridge. Both read the runtime lazily so
 * this file can load immediately after app.js while session.init() is pending.
 */
(function (root) {
  'use strict';
  const registry = root.BrevessWorkbenchOperations;
  const runtime = () => root.__workbenchRuntime || null;
  const tools = () => root.__workbenchTools || null;
  const operation = name => (registry?.WORKBENCH_OPERATIONS || []).find(item => item.name === name);
  const modelOperations = new Set([
    'create_hypothesis',
    'create_plan',
    'create_figure',
    'create_node',
    'create_edge',
    'create_panel',
    'layout',
    'set_panel_status',
    'attach_material',
    'update_material_stance',
    'create_evidence_block',
    'set_edge_relation'
  ]);
  const LEGACY_READ_ONLY = new Set([
    'read_context', 'list_projects', 'get_project', 'query_library', 'read_literature',
    'list_recycle', 'export_project', 'read_asset', 'radar_list', 'radar_get'
  ]);
  const LEGACY_WRITE = new Set([
    'create_project', 'edit_project', 'remove_entity', 'undo', 'redo', 'restore',
    'model_operation', 'navigate', 'save_view', 'invoke_action', 'import_project',
    'import_asset', 'locate_source', 'data_directory',
    'radar_save', 'radar_check', 'radar_backfill_abstracts', 'radar_mark_read'
  ]);
  const LOCAL_READ_OPERATIONS = new Set(['query_library', 'read_workspace', 'read_export', 'read_asset']);
  const GLOBAL_WRITE_OPERATIONS = new Set(['radar_save', 'radar_check', 'radar_backfill_abstracts', 'radar_mark_read']);
  const fail = (code, message, details) => Object.assign(new Error(message || code), { code, details });
  const now = () => new Date().toISOString();
  const auditId = () => `audit-${root.crypto?.randomUUID?.() || Date.now()}`;
  const operationName = value => String(value || '').replace(/^workbench\./u, '');
  function requireRuntime() {
    const value = runtime();
    if (!value?.session || !value?.project) throw fail('WORKBENCH_HOST_NOT_READY', '课题工作台尚未就绪');
    return value;
  }
  function currentRevision(rt) { return rt.session.state.row?.revision ?? null; }
  function toolDefinition(name) {
    return (tools()?.definitions || []).find(item => item.name === name) || null;
  }
  function legacyToolMayWrite(definition, args = {}) {
    if (!definition) return false;
    if (LEGACY_READ_ONLY.has(definition.name)) return false;
    if (definition.name === 'local_data') return !LOCAL_READ_OPERATIONS.has(args.operation);
    if (definition.name === 'clipboard') return args.operation !== 'copy';
    if (LEGACY_WRITE.has(definition.name)) return true;
    const properties = definition.inputSchema?.properties || {};
    return Object.hasOwn(properties, 'expectedRevision') || Object.hasOwn(properties, 'expectedEditVersion');
  }
  function legacyDefinition(name, args = {}) {
    const definition = toolDefinition(name);
    if (!definition) return null;
    const properties = definition.inputSchema?.properties || {};
    const write = legacyToolMayWrite(definition, args);
    return {
      name,
      access: write ? 'write' : 'read',
      approvalClass: name === 'create_project' ? 'human_confirm' : 'routine_write',
      requiredScopes: [write ? 'workbench:write' : 'workbench:read'],
      global: GLOBAL_WRITE_OPERATIONS.has(name) || !Object.hasOwn(properties, 'expectedProjectId'),
      inputSchema: definition.inputSchema,
      version: 1
    };
  }
  function definitionFor(name, args = {}) {
    return operation(name) || legacyDefinition(name, args);
  }
  function validBootstrapScope(rt) {
    const scope = rt.ui.bootstrapScope;
    return scope && scope.bootstrap === true && scope.projectId === null && scope.used !== true &&
      scope.expiresAt > Date.now() && Array.isArray(scope.operations) &&
      scope.operations.length === 1 && scope.operations[0] === 'create_project';
  }
  function ensureWriteScope(rt, definition, args) {
    if (definition?.access !== 'write') return null;
    if (definition.name === 'create_project') {
      if (args.expectedProjectId !== null || args.expectedRevision !== 0) {
        throw fail('WORKBENCH_BOOTSTRAP_PRECONDITION_INVALID', '空工作区创建课题必须使用 expectedProjectId:null、expectedRevision:0');
      }
      if (rt.project()?.id) throw fail('WORKBENCH_BOOTSTRAP_REQUIRES_EMPTY_WORKSPACE', '当前已有课题；创建后续课题请使用工作台正常写作用域，不能复用 bootstrap');
      if (validBootstrapScope(rt)) return null;
      return {
        type: 'bootstrap_write_scope',
        request: {
          projectId: null,
          bootstrap: true,
          operations: ['create_project'],
          ttlMs: 600000,
          taskId: args.taskId || null
        }
      };
    }
    const scope = rt.ui.writeScope;
    const targetProjectId = definition.global === true ? null : args.expectedProjectId;
    const valid = scope && scope.projectId === targetProjectId && scope.expiresAt > Date.now() &&
      Array.isArray(scope.operations) && scope.operations.includes(definition.name);
    if (valid) return null;
    return { type: 'write_scope', request: { projectId: targetProjectId, operations: [definition.name], ttlMs: 900000, taskId: args.taskId || null } };
  }
  function consumeBootstrapScope(rt) {
    if (rt.ui.bootstrapScope?.bootstrap === true) rt.ui.bootstrapScope = null;
  }
  const host = {
    contractVersion: registry?.WORKBENCH_OPERATION_CONTRACT_VERSION || 1,
    status() {
      const rt = runtime();
      if (!rt?.session) return { ready: false, projectId: null, revision: null, scope: null, writeScope: null, connectedClients: [], recentCalls: [], pendingApprovals: [] };
      return {
        ready: true,
        projectId: rt.project()?.id || null,
        revision: currentRevision(rt),
        scope: rt.sel ? rt.sel() : null,
        writeScope: rt.ui.writeScope || null,
        bootstrapScope: rt.ui.bootstrapScope || null,
        connectedClients: Array.isArray(rt.connectedClients) ? rt.connectedClients : [],
        recentCalls: (rt.ui.audit || []).slice(-20),
        pendingApprovals: Array.isArray(rt.ui.pendingApprovals) ? rt.ui.pendingApprovals : []
      };
    },
    getContext() {
      const rt = requireRuntime();
      const p = rt.project();
      return {
        projectId: p?.id || null,
        name: p?.name || '',
        question: p?.question || '',
        revision: currentRevision(rt),
        selection: rt.sel ? rt.sel() : null,
        scope: rt.scope ? rt.scope() : null,
        hypotheses: (p?.hypotheses || []).map(h => ({ id: h.id, name: h.name, nodes: h.nodes.length, edges: h.edges.length })),
        plans: (p?.plans || []).map(pl => ({ id: pl.id, name: pl.name, figures: pl.figures.map(f => ({ id: f.id, title: f.title, panels: f.panels.length, evidenceBlocks: (f.evidenceBlocks || []).length })) })),
        materialLinks: (p?.materialLinks || []).length,
        libraryEntries: (rt.ui.libraryEntries || []).length,
        module: rt.ui.library ? 'library' : rt.ui.radar ? 'radar' : rt.sel()?.mode || 'overview'
      };
    },
    listCapabilities() {
      return {
        contractVersion: registry?.WORKBENCH_OPERATION_CONTRACT_VERSION || 1,
        operations: (registry?.WORKBENCH_OPERATIONS || []).map(item => ({ ...item })),
        capabilities: registry?.WORKBENCH_CAPABILITIES || null,
        legacyOperations: (tools()?.definitions || [])
          .filter(item => !operation(item.name))
          .map(item => legacyDefinition(item.name))
          .filter(Boolean)
      };
    },
    async execute(name, args = {}, options = {}) {
      if (name === 'brevess.request_write_scope') return host.requestWriteScope(args);
      if (name === 'open_local_pdf') return host.openLocalPdf(args);
      if (name === 'export_library_transfer') {
        const data = await host.exportLibraryTransfer(args);
        return { data, revision: currentRevision(requireRuntime()), changedPaths: [], approval: null, auditId: auditId() };
      }
      if (name === 'import_library_transfer') {
        const data = await host.importLibraryTransfer(args);
        return { data, revision: currentRevision(requireRuntime()), changedPaths: [], approval: null, auditId: auditId() };
      }
      const definition = definitionFor(name, args);
      if (!definition) throw fail('WORKBENCH_OPERATION_UNKNOWN', `未知 Workbench operation: ${name}`);
      const rt = requireRuntime();
      if (options?.scopeToken) {
        const active = name === 'create_project' ? rt.ui.bootstrapScope : rt.ui.writeScope;
        if (active?.token !== options.scopeToken) throw fail('WORKBENCH_WRITE_SCOPE_TOKEN_MISMATCH', '外部写作用域 token 与 Workbench 当前授权不一致');
      }
      if (name === 'query_global_library') {
        if (!rt.globalLibraryReader) throw fail('WORKBENCH_GLOBAL_LIBRARY_UNAVAILABLE', '全局文献总库读取器未就绪');
        const result = await rt.globalLibraryReader.query(args);
        rt.ui.libraryEntries = result.items || [];
        rt.render?.();
        return { data: result, revision: currentRevision(rt), changedPaths: [], approval: null, auditId: auditId() };
      }
      const approval = ensureWriteScope(rt, definition, args);
      if (approval) return { data: null, revision: currentRevision(rt), changedPaths: [], approval, auditId: null };
      const toolset = tools();
      if (!toolset?.execute) throw fail('WORKBENCH_TOOLS_NOT_READY', 'Workbench operation registry 尚未就绪');
      const result = modelOperations.has(name)
        ? await toolset.execute('model_operation', { ...args, operation: name })
        : await toolset.execute(name, args);
      const data = result?.data ?? result;
      if (name === 'create_project') {
        consumeBootstrapScope(rt);
        const created = data?.createdId || null;
        const projectId = rt.project()?.id || null;
        if (!projectId || currentRevision(rt) === null) {
          throw fail('WORKBENCH_BOOTSTRAP_RECEIPT_INVALID', '课题已创建但无法重新读取真实 projectId/revision');
        }
        if (created && created !== projectId) throw fail('WORKBENCH_BOOTSTRAP_RECEIPT_INVALID', '创建回执与当前课题不一致');
        if (data && typeof data === 'object') {
          data.projectId = projectId;
          data.revision = currentRevision(rt);
        }
      }
      const entry = { id: auditId(), name, at: now(), args, success: true, revision: currentRevision(rt) };
      (rt.ui.audit ||= []).push(entry);
      return { data, revision: currentRevision(rt), changedPaths: result?.changedPaths || [], approval: null, auditId: entry.id };
    },
    requestWriteScope(request = {}) {
      const rt = requireRuntime();
      const bootstrap = request.bootstrap === true;
      const projectId = request.projectId === null ? null : String(request.projectId || '');
      const operations = Array.isArray(request.operations) ? [...new Set(request.operations.map(operationName))] : [];
      const ttlMs = Math.max(1000, Math.min(3600000, Math.floor(Number(request.ttlMs) || 900000)));
      const allowed = new Set((registry?.WORKBENCH_OPERATIONS || [])
        .filter(item => item.access === 'write' && item.name !== 'create_project')
        .map(item => item.name));
      for (const definition of tools()?.definitions || []) {
        if (definition.name !== 'create_project' && legacyToolMayWrite(definition, request)) allowed.add(definition.name);
      }
      if (bootstrap) {
        if (projectId !== null || operations.length !== 1 || operations[0] !== 'create_project') {
          throw fail('WORKBENCH_BOOTSTRAP_SCOPE_INVALID', 'bootstrap scope 只能是 {projectId:null, bootstrap:true, operations:[create_project]}');
        }
        if (rt.project()?.id) throw fail('WORKBENCH_BOOTSTRAP_REQUIRES_EMPTY_WORKSPACE', '当前已有课题，不能申请 bootstrap scope');
      } else if (!operations.length || operations.some(name => !allowed.has(name))) {
        throw fail('WORKBENCH_WRITE_SCOPE_INVALID', 'write scope 需要有效的 projectId 和允许的写 operation');
      } else {
        const definitions = operations.map(name => definitionFor(name, request));
        const needsProject = definitions.some(definition => definition && definition.global !== true);
        if (needsProject && !projectId) throw fail('WORKBENCH_WRITE_SCOPE_INVALID', '课题级写作用域需要 projectId');
        if (projectId && rt.project()?.id !== projectId) {
          throw fail('WORKBENCH_WRITE_SCOPE_PROJECT_MISMATCH', 'write scope 只能绑定当前打开的课题');
        }
      }
      if (!rt.modal) throw fail('WORKBENCH_HOST_NOT_READY', 'Workbench UI 未就绪');
      return new Promise(resolve => {
        const modalHost = root.document?.getElementById('modal');
        const title = bootstrap ? '空工作区初始化授权' : '外部 Agent 写入授权';
        const description = bootstrap
          ? '<p>当前工作台没有课题。外部客户端请求创建第一个课题。该授权仅执行一次 <code>create_project</code>，不能用于任何已有或后续课题的写入。</p>'
          : '<p>外部客户端请求在当前课题中连续执行以下写操作。授权只覆盖本任务、列出的 operation 和有效期；删除、覆盖、跨项目与来源替换仍需逐次确认。</p>';
        rt.modal(title, `${description}<dl class="detail-data"><dt>课题</dt><dd>${bootstrap ? '无（创建后重新读取真实 ID）' : projectId}</dd><dt>操作</dt><dd>${operations.map(name => `<code>${name}</code>`).join(' ')}</dd><dt>有效期</dt><dd>${Math.round(ttlMs / 60000)} 分钟</dd><dt>任务</dt><dd>${request.taskId || '未提供'}</dd></dl><div class="modal-actions"><button data-scope-deny>拒绝</button><button data-scope-allow class="primary">${bootstrap ? '确认创建第一个课题' : '授权本任务'}</button></div>`, dialog => {
          const finish = value => { dialog.close(); resolve(value); };
          dialog.querySelector('[data-scope-deny]').onclick = () => finish({ success: false, error: { code: 'WRITE_SCOPE_DENIED', message: '用户拒绝 write scope' } });
          dialog.querySelector('[data-scope-allow]').onclick = () => {
            const scope = { token: `scope-${root.crypto?.randomUUID?.() || Date.now()}`, projectId, bootstrap, operations, ttlMs, taskId: request.taskId || null, expiresAt: Date.now() + ttlMs, grantedAt: now(), used: false };
            if (bootstrap) rt.ui.bootstrapScope = scope;
            else rt.ui.writeScope = scope;
            finish({ success: true, data: scope });
          };
          dialog.addEventListener('close', () => resolve({ success: false, error: { code: 'WRITE_SCOPE_DISMISSED', message: 'write scope 授权窗口已关闭' } }), { once: true });
        });
      });
    },
    async readResource(uri) {
      const rt = requireRuntime();
      const raw = String(uri || '');
      if (!raw.startsWith('brevess://')) throw fail('WORKBENCH_RESOURCE_URI_INVALID', '仅支持 brevess:// resource URI');
      const parts = raw.slice('brevess://'.length).split('/').filter(Boolean);
      if (parts[0] === 'workbench' && parts[1] === 'project') {
        const row = rt.session.state.rows.find(item => item.id === parts[2]);
        if (!row) throw fail('WORKBENCH_PROJECT_NOT_FOUND');
        return { uri: raw, projectId: row.id, revision: row.revision, project: rt.session.state.row?.id === row.id ? rt.project() : row.project };
      }
      if (parts[0] === 'workbench' && parts[1] === 'hypothesis') {
        const h = rt.project()?.hypotheses.find(item => item.id === parts[2]);
        if (!h) throw fail('WORKBENCH_ENTITY_NOT_FOUND');
        return { uri: raw, hypothesis: h };
      }
      if (parts[0] === 'workbench' && parts[1] === 'figure') {
        for (const plan of rt.project()?.plans || []) {
          const figure = plan.figures.find(item => item.id === parts[2]);
          if (figure) return { uri: raw, planId: plan.id, figure };
        }
        throw fail('WORKBENCH_ENTITY_NOT_FOUND');
      }
      if (parts[0] === 'library' && parts[1] === 'paper') {
        const entry = (rt.ui.libraryEntries || []).find(item => (item.sourceDocuments || []).some(doc => doc.workspaceId === parts[2] && String(doc.workspaceGeneration || 1) === String(parts[3] || 1)));
        if (!entry) throw fail('WORKBENCH_LIBRARY_ENTRY_NOT_LOADED', '请先调用 query_global_library 读取该论文');
        return { uri: raw, entry };
      }
      throw fail('WORKBENCH_RESOURCE_URI_INVALID', '不支持的 resource URI');
    },
    async cancel(operationId) {
      if (typeof root.__workbenchAgentCancel === 'function') {
        root.__workbenchAgentCancel(operationId);
        return { cancelled: true, operationId: operationId || null };
      }
      return { cancelled: false, operationId: operationId || null, reason: 'NO_ACTIVE_OPERATION' };
    },
    async openLocalPdf(args = {}) {
      const hook = root.BrevessWorkbenchMCPBridge?.openLocalPdf || root.BrevessWorkbenchHostHooks?.openLocalPdf;
      if (typeof hook !== 'function') throw fail('PENDING_HOST_HOOK', '本地 PDF 打开需要 MCP/native host 提供 openLocalPdf(path) hook；Workbench 不读取或伪造 PDF 解析结果');
      return hook(args);
    },
    async exportLibraryTransfer(args = {}) {
      const rt = requireRuntime();
      if (typeof rt.libraryTransfer?.export !== 'function') throw fail('LIBRARY_TRANSFER_HOST_UNAVAILABLE', 'Workbench 文献转移服务尚未就绪');
      return rt.libraryTransfer.export(args);
    },
    async importLibraryTransfer(args = {}) {
      const rt = requireRuntime();
      if (!args.bundle || typeof args.bundle !== 'object') throw fail('LIBRARY_TRANSFER_BUNDLE_REQUIRED', '缺少文献转移 bundle');
      if (typeof rt.libraryTransfer?.import !== 'function') throw fail('LIBRARY_TRANSFER_HOST_UNAVAILABLE', 'Workbench 文献转移服务尚未就绪');
      const definition = root.BrevessLibraryTransfer?.validateEnvelope?.(args.bundle);
      const kind = definition?.kind || args.bundle.kind || 'transfer';
      const cards = kind === 'radar' ? (args.bundle.payload?.radars?.length || 0)
        : kind === 'global-library' ? (args.bundle.payload?.entries?.length || 0)
          : `${args.bundle.payload?.radar?.length || args.bundle.payload?.radars?.length || 0} / ${args.bundle.payload?.globalLibrary?.length || args.bundle.payload?.entries?.length || 0}`;
      if (!rt.modal) throw fail('WORKBENCH_HOST_NOT_READY', 'Workbench UI 未就绪');
      const approved = await new Promise(resolve => {
        let settled = false;
        const finish = value => { if (settled) return; settled = true; resolve(value); };
        rt.modal('外部 Agent 文献分享导入', `<p>外部客户端请求导入 <code>brevess-library-transfer-v1</code> 元数据。</p><dl class="detail-data"><dt>类型</dt><dd>${kind}</dd><dt>记录数</dt><dd>${cards}</dd><dt>去重</dt><dd>PMID → DOI → 规范化标题</dd></dl><p class="muted">导入会显示冲突和仅元数据警告；不会写入 PDF 字节、凭据或全文缓存。</p><div class="modal-actions"><button data-transfer-deny>拒绝</button><button data-transfer-allow class="primary">确认导入</button></div>`, dialog => {
          dialog.querySelector('[data-transfer-deny]').onclick = () => { finish(false); dialog.close(); };
          dialog.querySelector('[data-transfer-allow]').onclick = () => { finish(true); dialog.close(); };
          dialog.addEventListener('close', () => finish(false), { once: true });
        });
      });
      if (!approved) throw fail('LIBRARY_TRANSFER_DENIED', '用户未确认文献分享导入');
      return rt.libraryTransfer.import(args.bundle, { idempotencyKey: args.idempotencyKey || `host-transfer-${root.crypto?.randomUUID?.() || Date.now()}` });
    },
    async legacyExecute(name, args = {}, options = {}) {
      const rt = requireRuntime();
      const toolset = tools();
      const definition = legacyDefinition(name, args);
      if (!toolset?.execute || !definition) throw fail('WORKBENCH_OPERATION_UNKNOWN', `未知 Agent tool: ${name}`);
      if (operation(name)) return host.execute(name, args, options);
      const approval = ensureWriteScope(rt, definition, args);
      if (approval) throw fail('WORKBENCH_WRITE_SCOPE_REQUIRED', '该 Agent tool 需要 Workbench 写作用域', approval.request);
      if (options?.scopeToken) {
        const active = rt.ui.writeScope;
        if (active?.token !== options.scopeToken) throw fail('WORKBENCH_WRITE_SCOPE_TOKEN_MISMATCH', '外部写作用域 token 与 Workbench 当前授权不一致');
      }
      const result = await toolset.execute(name, args);
      const entry = { id: auditId(), name, at: now(), args, success: true, revision: currentRevision(rt), legacy: true };
      (rt.ui.audit ||= []).push(entry);
      return { data: result, revision: currentRevision(rt), changedPaths: [], approval: null, auditId: entry.id };
    }
  };
  root.BrevessWorkbenchHost = host;
  const wrap = async fn => {
    try { return { success: true, data: await fn(), revision: host.status().revision, changedPaths: [], approval: null, auditId: null }; }
    catch (error) { return { success: false, error: { code: error.code || 'WORKBENCH_HOST_ERROR', message: error.message || String(error), ...(error.details ? { details: error.details } : {}) }, revision: host.status().revision, changedPaths: [], approval: null, auditId: null }; }
  };
  root.BrevessWorkbenchMCP = {
    contractVersion: host.contractVersion,
    status: () => wrap(() => host.status()),
    getContext: () => wrap(() => host.getContext()),
    listCapabilities: () => ({ success: true, data: host.listCapabilities() }),
    execute: async (name, args, options = {}) => {
      if (name === 'brevess.request_write_scope') return host.requestWriteScope(args);
      try {
        const result = await host.execute(name, args, options);
        if (result?.approval) return { success: false, error: { code: 'WRITE_SCOPE_REQUIRED', message: '需要任务级 write scope' }, ...result };
        return { success: true, data: result.data, revision: result.revision, changedPaths: result.changedPaths || [], approval: result.approval || null, auditId: result.auditId || null };
      } catch (error) {
        return { success: false, error: { code: error.code || 'WORKBENCH_HOST_ERROR', message: error.message || String(error) }, revision: host.status().revision, changedPaths: [], approval: null, auditId: null };
      }
    },
    requestWriteScope: request => host.requestWriteScope(request),
    requestBootstrapScope: request => host.requestWriteScope({ ...(request || {}), projectId: null, bootstrap: true, operations: ['create_project'] }),
    legacyExecute: async (name, args, options = {}) => {
      try {
        const result = await host.legacyExecute(name, args, options);
        return { success: true, data: result.data, revision: result.revision, changedPaths: result.changedPaths || [], approval: null, auditId: result.auditId || null };
      } catch (error) {
        return { success: false, error: { code: error.code || 'WORKBENCH_HOST_ERROR', message: error.message || String(error), ...(error.details ? { details: error.details } : {}) }, revision: host.status().revision, changedPaths: [], approval: null, auditId: null };
      }
    },
    readResource: uri => wrap(() => host.readResource(uri)),
    cancel: operationId => wrap(() => host.cancel(operationId)),
    openLocalPdf: args => wrap(() => host.openLocalPdf(args))
  };
  if (typeof root.BrevessWorkbenchMCPBridge?.attach === 'function') {
    try { root.BrevessWorkbenchMCPBridge.attach(root.BrevessWorkbenchMCP); } catch {}
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
