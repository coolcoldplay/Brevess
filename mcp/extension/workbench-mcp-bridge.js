(function installBrevessWorkbenchMcpBridge(root) {
  'use strict';

  const CONFIG_KEY = 'brevess-mcp-bridge-v1';
  const CLIENT_KEY = 'brevess-mcp-client-id-v1';
  const PROTOCOL_VERSION = 1;
  const MAX_TOKEN_LENGTH = 512;
  const NORMAL_POLL_TIMEOUT_MS = 35000;
  const CONTROL_POLL_TIMEOUT_MS = 35000;
  const APPROVAL_OPERATIONS = new Set(['patch_asset', 'set_tags', 'delete_workspace']);
  const LEGACY_OPERATIONS = new Set([
    'read_context', 'list_projects', 'get_project', 'query_library', 'read_literature',
    'create_project', 'edit_project', 'remove_entity', 'undo', 'redo',
    'list_recycle', 'restore', 'model_operation', 'navigate', 'save_view',
    'invoke_action', 'import_project', 'export_project', 'import_asset',
    'read_asset', 'locate_source', 'clipboard', 'local_data', 'data_directory',
    'radar_list', 'radar_get', 'radar_save', 'radar_check',
    'radar_backfill_abstracts', 'radar_mark_read'
  ]);

  if (!root?.chrome?.runtime?.id) return;

  let generation = 0;
  let config = null;
  let clientId = '';
  let workAbort = null;
  let controlAbort = null;
  const running = new Map();

  async function openLocalPdfViaHost(args = {}) {
    if (!args || typeof args !== 'object' || typeof args.fileUrl !== 'string' ||
        !/^file:\/\//iu.test(args.fileUrl)) {
      throw error('MCP_PDF_FILE_URL_INVALID', 'openLocalPdf requires an explicit file:// URL.', {
        field: 'fileUrl'
      });
    }
    if (typeof chrome.runtime.sendMessage !== 'function') {
      throw error('PENDING_HOST_HOOK', 'The extension background has no local PDF opener hook.');
    }
    let response;
    try {
      response = await chrome.runtime.sendMessage({
        type: 'BREVESS_MCP_OPEN_LOCAL_PDF',
        fileUrl: args.fileUrl,
        title: args.title || '',
        expectedProjectId: args.expectedProjectId || null,
        expectedRevision: args.expectedRevision ?? null
      });
    } catch (failure) {
      throw error(
        'PENDING_HOST_HOOK',
        'No extension background handler is installed for BREVESS_MCP_OPEN_LOCAL_PDF.',
        { cause: failure?.message || String(failure) }
      );
    }
    if (response?.success !== true) {
      throw error(
        response?.error?.code || 'PENDING_HOST_HOOK',
        response?.error?.message || 'The extension background did not return a PDF parse receipt.',
        response?.error?.details
      );
    }
    return response.data;
  }

  root.BrevessWorkbenchMCPBridge = Object.assign(root.BrevessWorkbenchMCPBridge || {}, {
    openLocalPdf: openLocalPdfViaHost
  });

  function emitStatus(state, detail = {}) {
    try {
      root.dispatchEvent(new CustomEvent('brevess:mcp-status', {
        detail: { state, ...detail }
      }));
    } catch {
      // Status rendering is optional.
    }
    const node = root.document?.getElementById('mcp-status');
    if (node) {
      const labels = {
        unpaired: 'MCP 未配对',
        connecting: 'MCP 连接中',
        connected: 'MCP 已连接',
        unauthorized: 'MCP 配对失效',
        incompatible: 'MCP 版本不兼容',
        offline: 'MCP 离线，重试中'
      };
      node.textContent = labels[state] || state;
      node.dataset.state = state;
      node.title = detail.message || labels[state] || state;
    }
  }

  function error(code, message, details = undefined) {
    const value = new Error(message || code);
    value.code = code;
    if (details !== undefined) value.details = details;
    return value;
  }

  function normalizeServer(value) {
    let url;
    try {
      url = new URL(String(value || ''));
    } catch {
      throw error('MCP_BRIDGE_SERVER_INVALID', 'MCP server must be a localhost HTTP URL.');
    }
    if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname) ||
        url.username || url.password || url.search || url.hash) {
      throw error('MCP_BRIDGE_SERVER_INVALID', 'MCP server must be http://127.0.0.1:<port> or http://localhost:<port>.');
    }
    return url.href.replace(/\/+$/u, '');
  }

  function normalizeConfig(value) {
    if (!value || typeof value !== 'object') throw error('MCP_BRIDGE_CONFIG_INVALID');
    const server = normalizeServer(value.server);
    const token = String(value.token || '');
    if (!token || token.length > MAX_TOKEN_LENGTH) throw error('MCP_BRIDGE_TOKEN_INVALID');
    return { server, token };
  }

  async function ensureClientId() {
    if (clientId) return clientId;
    const stored = await chrome.storage.local.get(CLIENT_KEY);
    clientId = typeof stored?.[CLIENT_KEY] === 'string' && /^[A-Za-z0-9._:-]{6,160}$/u.test(stored[CLIENT_KEY])
      ? stored[CLIENT_KEY]
      : `workbench-${crypto.randomUUID()}`;
    await chrome.storage.local.set({ [CLIENT_KEY]: clientId });
    return clientId;
  }

  async function loadConfig() {
    const params = new URLSearchParams(root.location.search);
    const server = params.get('mcpServer');
    const token = params.get('mcpToken');
    if (server || token) {
      const next = normalizeConfig({ server, token });
      await chrome.storage.local.set({ [CONFIG_KEY]: next });
      params.delete('mcpServer');
      params.delete('mcpToken');
      const query = params.toString();
      root.history.replaceState(null, '', `${root.location.pathname}${query ? `?${query}` : ''}${root.location.hash}`);
      return next;
    }
    const stored = await chrome.storage.local.get(CONFIG_KEY);
    if (!stored?.[CONFIG_KEY]) return null;
    return normalizeConfig(stored[CONFIG_KEY]);
  }

  function host() {
    const value = root.BrevessWorkbenchMCP || root.BrevessMcpHost;
    if (!value ||
        (value.contractVersion !== undefined && Number(value.contractVersion) !== PROTOCOL_VERSION) ||
        (value.protocolVersion !== undefined && value.protocolVersion !== PROTOCOL_VERSION) ||
        typeof value.execute !== 'function') {
      return null;
    }
    return value;
  }

  async function waitForHost(signal) {
    const current = host();
    if (current) return current;
    await new Promise((resolve, reject) => {
      let timer, interval;
      const done = () => {
        cleanup();
        const value = host();
        if (value) resolve(value);
        else if (Date.now() >= deadline) {
          reject(error('MCP_WORKBENCH_HOST_UNAVAILABLE', 'The Workbench operation host is not ready.'));
        }
      };
      const cleanup = () => {
        clearTimeout(timer);
        clearInterval(interval);
        root.removeEventListener('brevess:mcp-host-ready', done);
        root.removeEventListener('brevess:workbench-mcp-ready', done);
        signal?.removeEventListener('abort', aborted);
      };
      const aborted = () => {
        cleanup();
        reject(error('CANCELLED', 'The MCP bridge was stopped.'));
      };
      root.addEventListener('brevess:mcp-host-ready', done, { once: true });
      root.addEventListener('brevess:workbench-mcp-ready', done, { once: true });
      signal?.addEventListener('abort', aborted, { once: true });
      const deadline = Date.now() + 30000;
      interval = setInterval(() => {
        if (host()) done();
        else if (Date.now() >= deadline) done();
      }, 250);
      timer = setTimeout(done, 30000);
    });
  }

  async function request(pathname, body, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs || NORMAL_POLL_TIMEOUT_MS);
    options.signal?.addEventListener('abort', () => controller.abort(), { once: true });
    try {
      const response = await fetch(`${config.server}${pathname}`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${config.token}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify(body || {}),
        cache: 'no-store',
        credentials: 'omit',
        signal: controller.signal
      });
      const value = await response.json().catch(() => null);
      if (!response.ok) {
        const failure = error(
          value?.error?.code || `MCP_HTTP_${response.status}`,
          value?.error?.message || `MCP bridge request failed with HTTP ${response.status}.`,
          value?.error?.details
        );
        failure.status = response.status;
        throw failure;
      }
      return value;
    } finally {
      clearTimeout(timer);
    }
  }

  function bridgeMeta(extensionVersion) {
    return {
      clientId,
      name: 'BREVESS Workbench',
      extensionVersion,
      protocolVersion: PROTOCOL_VERSION,
      platform: navigator.platform || root.navigator?.platform || ''
    };
  }

  async function focusWorkbenchForApproval() {
    try {
      const tab = await chrome.tabs.getCurrent();
      if (tab?.id !== undefined) await chrome.tabs.update(tab.id, { active: true });
      await chrome.windows?.update?.(tab?.windowId, { focused: true });
      root.focus();
    } catch {
      // The approval remains visible when the user returns to the tab.
    }
  }

  async function postResult(requestId, payload, signal) {
    let last;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (signal?.aborted) return;
      try {
        await request('/bridge/result', {
          requestId,
          ...payload
        }, { signal, timeoutMs: 15000 });
        return;
      } catch (failure) {
        last = failure;
        if (failure.status === 401) break;
        await new Promise(resolve => setTimeout(resolve, 400 * (attempt + 1)));
      }
    }
    console.error('[brevess-mcp] result delivery failed', last?.code || last?.message);
  }

  function normalizeHostResult(value) {
    if (!value || typeof value !== 'object') return value;
    if (value.success === false) {
      throw error(
        value.error?.code || 'MCP_WORKBENCH_OPERATION_FAILED',
        value.error?.message || 'The Workbench operation failed.',
        value.error?.details
      );
    }
    if (value.success !== true) return value;
    const data = value.data && typeof value.data === 'object' && !Array.isArray(value.data)
      ? { ...value.data }
      : value.data;
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return value.data === undefined ? value : value.data;
    }
    if (value.revision !== undefined && data.revision === undefined) data.revision = value.revision;
    if (Array.isArray(value.changedPaths) && data.changedPaths === undefined) data.changedPaths = value.changedPaths;
    if (value.approval !== undefined) data.approval = value.approval;
    if (value.auditId !== undefined) data.auditId = value.auditId;
    return data;
  }

  async function executeJob(job, extensionVersion, signal) {
    const hostApi = host();
    if (!hostApi) throw error('MCP_WORKBENCH_HOST_UNAVAILABLE');
    if (job.name === 'local_data' &&
        APPROVAL_OPERATIONS.has(job.args?.operation)) {
      await focusWorkbenchForApproval();
    }
    const controller = new AbortController();
    running.set(job.requestId, controller);
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    const started = Date.now();
    try {
      let result;
      if (job.name === 'brevess.status') {
        result = await hostApi.status();
      } else if (job.name === 'brevess.capabilities') {
        result = await hostApi.listCapabilities(job.args || {});
      } else if (job.name === 'brevess.request_write_scope' && job.args?.bootstrap === true) {
        const bootstrapScope = hostApi.requestBootstrapScope || hostApi.request_bootstrap_scope;
        if (typeof bootstrapScope === 'function') {
          await focusWorkbenchForApproval();
          result = await bootstrapScope.call(hostApi, job.args || {}, {
            requestId: job.requestId,
            signal: controller.signal,
            extensionVersion
          });
        } else if (typeof hostApi.requestWriteScope === 'function') {
          // The current Workbench host exposes the bootstrap branch through
          // requestWriteScope({projectId:null,bootstrap:true,...}).
          await focusWorkbenchForApproval();
          result = await hostApi.requestWriteScope(job.args || {}, {
            requestId: job.requestId,
            signal: controller.signal,
            extensionVersion
          });
        } else {
          throw error(
            'MCP_WORKBENCH_BOOTSTRAP_HOST_UNAVAILABLE',
            'The Workbench host does not expose a bootstrap write-scope entry.',
            {
              field: 'bootstrap',
              request: {
                projectId: null,
                bootstrap: true,
                operations: ['workbench.create_project']
              }
            }
          );
        }
      } else if (job.name === 'brevess.request_write_scope') {
        await focusWorkbenchForApproval();
        result = await hostApi.requestWriteScope(job.args || {});
      } else if (job.name === 'brevess.revoke_write_scope') {
        result = typeof hostApi.revokeWriteScope === 'function'
          ? await hostApi.revokeWriteScope(job.args || {})
          : await hostApi.requestWriteScope({ ...(job.args || {}), action: 'revoke' });
      } else if (job.name === 'brevess.read_resource') {
        result = await hostApi.readResource(job.args?.uri, {
          signal: controller.signal,
          requestId: job.requestId
        });
      } else if (job.name === 'export_library_transfer') {
        if (typeof hostApi.exportLibraryTransfer !== 'function') {
          throw error(
            'MCP_WORKBENCH_TRANSFER_HOST_UNAVAILABLE',
            'The Workbench host does not expose exportLibraryTransfer.',
            { method: 'exportLibraryTransfer' }
          );
        }
        result = await hostApi.exportLibraryTransfer(job.args || {}, {
          signal: controller.signal,
          requestId: job.requestId
        });
      } else if (job.name === 'import_library_transfer') {
        if (typeof hostApi.importLibraryTransfer !== 'function') {
          throw error(
            'MCP_WORKBENCH_TRANSFER_HOST_UNAVAILABLE',
            'The Workbench host does not expose importLibraryTransfer.',
            { method: 'importLibraryTransfer' }
          );
        }
        await focusWorkbenchForApproval();
        result = await hostApi.importLibraryTransfer(job.args || {}, {
          ...(job.hostOptions || {}),
          signal: controller.signal,
          requestId: job.requestId
        });
      } else if (job.name === 'open_local_pdf') {
        const openLocalPdf = hostApi.openLocalPdf || hostApi.open_local_pdf;
        if (typeof openLocalPdf !== 'function') {
          throw error(
            'MCP_WORKBENCH_HOST_METHOD_UNAVAILABLE',
            'The Workbench host does not expose openLocalPdf/open_local_pdf.',
            { field: 'openLocalPdf', requestId: job.requestId }
          );
        }
        result = await openLocalPdf.call(hostApi, job.args || {}, {
          ...(job.hostOptions || {}),
          requestId: job.requestId,
          signal: controller.signal,
          extensionVersion
        });
      } else if (LEGACY_OPERATIONS.has(job.name) && typeof hostApi.legacyExecute === 'function') {
        result = await hostApi.legacyExecute(job.name, job.args, {
          ...(job.hostOptions || {}),
          requestId: job.requestId,
          signal: controller.signal,
          extensionVersion
        });
      } else {
        result = await hostApi.execute(job.name, job.args, {
          ...(job.hostOptions || {}),
          requestId: job.requestId,
          signal: controller.signal,
          extensionVersion
        });
      }
      result = normalizeHostResult(result);
      if (controller.signal.aborted) {
        throw error('CANCELLED', 'The Workbench operation was cancelled.');
      }
      await postResult(job.requestId, {
        success: true,
        result,
        durationMs: Date.now() - started
      }, signal);
    } catch (failure) {
      const cancelled = controller.signal.aborted || failure?.code === 'CANCELLED';
      await postResult(job.requestId, {
        success: false,
        error: {
          code: cancelled ? 'CANCELLED' : failure?.code || 'MCP_WORKBENCH_OPERATION_FAILED',
          message: cancelled ? 'The Workbench operation was cancelled.' : failure?.message || String(failure),
          ...(failure?.details !== undefined ? { details: failure.details } : {}),
          retryable: failure?.retryable === true
        },
        durationMs: Date.now() - started
      }, signal);
    } finally {
      signal?.removeEventListener('abort', abort);
      running.delete(job.requestId);
    }
  }

  async function workLoop(myGeneration, extensionVersion) {
    const signal = workAbort.signal;
    let backoff = 1000;
    while (!signal.aborted && generation === myGeneration) {
      try {
        const job = await request('/bridge/poll', bridgeMeta(extensionVersion), { signal });
        if (signal.aborted || generation !== myGeneration) return;
        emitStatus('connected', { bridge: job.bridge || null });
        backoff = 1000;
        if (job.type === 'call') {
          await executeJob(job, extensionVersion, signal);
        } else if (job.type === 'idle' || job.type === 'reconnect') {
          continue;
        } else if (job.type === 'closed') {
          return;
        }
      } catch (failure) {
        if (signal.aborted || generation !== myGeneration) return;
        if (failure?.status === 401) {
          emitStatus('unauthorized', { message: failure.message });
          return;
        }
        if (failure?.code === 'BRIDGE_VERSION_MISMATCH') {
          emitStatus('incompatible', { message: failure.message });
          return;
        }
        emitStatus('offline', { message: failure?.message || String(failure) });
        await new Promise(resolve => setTimeout(resolve, backoff));
        backoff = Math.min(30000, Math.round(backoff * 1.8));
      }
    }
  }

  async function controlLoop(myGeneration, extensionVersion) {
    const signal = controlAbort.signal;
    let backoff = 1000;
    while (!signal.aborted && generation === myGeneration) {
      try {
        const job = await request('/bridge/control/poll', bridgeMeta(extensionVersion), {
          signal,
          timeoutMs: CONTROL_POLL_TIMEOUT_MS
        });
        backoff = 1000;
        if (job.type === 'cancel' && job.targetRequestId) {
          running.get(job.targetRequestId)?.abort();
        }
      } catch (failure) {
        if (signal.aborted || generation !== myGeneration) return;
        if (failure?.status === 401) return;
        await new Promise(resolve => setTimeout(resolve, backoff));
        backoff = Math.min(30000, Math.round(backoff * 1.8));
      }
    }
  }

  async function connect(nextConfig = null) {
    generation += 1;
    const myGeneration = generation;
    workAbort?.abort();
    controlAbort?.abort();
    for (const controller of running.values()) controller.abort();
    running.clear();
    config = nextConfig ? normalizeConfig(nextConfig) : await loadConfig();
    if (!config) {
      emitStatus('unpaired');
      return { connected: false, state: 'unpaired' };
    }
    await chrome.storage.local.set({ [CONFIG_KEY]: config });
    await ensureClientId();
    emitStatus('connecting');
    try {
      const health = await request('/health', {}, { timeoutMs: 10000 });
      const extensionVersion = chrome.runtime.getManifest?.().version || 'unknown';
      const protocol = health?.bridge?.protocolVersion;
      if (protocol !== undefined && protocol !== PROTOCOL_VERSION) {
        const failure = error(
          'BRIDGE_VERSION_MISMATCH',
          `MCP server expects bridge protocol ${protocol}; this Workbench bridge is ${PROTOCOL_VERSION}.`
        );
        emitStatus('incompatible', { message: failure.message });
        throw failure;
      }
      workAbort = new AbortController();
      controlAbort = new AbortController();
      void workLoop(myGeneration, extensionVersion);
      void controlLoop(myGeneration, extensionVersion);
      return { connected: true, scopes: health?.scopes || [] };
    } catch (failure) {
      if (failure?.status === 401) emitStatus('unauthorized', { message: failure.message });
      else if (failure?.code !== 'BRIDGE_VERSION_MISMATCH') {
        emitStatus('offline', { message: failure?.message || String(failure) });
      }
      throw failure;
    }
  }

  async function disconnect({ forget = false } = {}) {
    generation += 1;
    workAbort?.abort();
    controlAbort?.abort();
    for (const controller of running.values()) controller.abort();
    running.clear();
    config = null;
    if (forget) await chrome.storage.local.remove(CONFIG_KEY);
    emitStatus(forget ? 'unpaired' : 'offline');
  }

  function status() {
    return {
      paired: !!config,
      connected: !!workAbort && !workAbort.signal.aborted,
      server: config?.server || null,
      protocolVersion: PROTOCOL_VERSION,
      activeRequests: [...running.keys()]
    };
  }

  const api = { connect, disconnect, status, configKey: CONFIG_KEY };
  root.BrevessMcpBridge = api;
  emitStatus('unpaired');
  ensureClientId().catch(() => {});
  connect().catch(() => {});
})(globalThis);
