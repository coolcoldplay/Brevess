(function attach(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory() {
  function directoryTransportError(code) {
    return Object.assign(new Error(code), { code, retryable: false });
  }

  function createWorkspaceDirectoryNativeClient(runtime, options = {}) {
    const timeoutMs = Math.max(5, Math.min(30000, Number(options.timeoutMs) || 15000));
    let sequence = 0;
    function request(action, payload) {
      return new Promise((resolve, reject) => {
        let port, timer, settled = false;
        const requestId = `workspace-directory-${Date.now().toString(36)}-${++sequence}`;
        const finish = (error, value) => {
          if (settled) return;
          settled = true; clearTimeout(timer);
          try { port?.disconnect(); } catch (_) { /* Already disconnected. */ }
          if (error) reject(error); else resolve(value);
        };
        if (typeof runtime?.connectNative !== 'function') {
          finish(directoryTransportError('WORKSPACE_DIRECTORY_HOST_UNAVAILABLE')); return;
        }
        try {
          port = runtime.connectNative('com.sci_reader.codex_bridge');
          port.onMessage.addListener(message => {
            if (settled || message?.requestId !== requestId) return;
            if (message.type === 'host.error') {
              finish(directoryTransportError(message.error?.code === 'INVALID_SETTINGS'
                ? 'WORKSPACE_DIRECTORY_HOST_UPDATE_REQUIRED' : 'WORKSPACE_DIRECTORY_HOST_UNAVAILABLE'));
            } else if (message.type === 'workspace.directory.error') {
              const code = String(message.error?.code || '');
              finish(directoryTransportError(/^WORKSPACE_DIRECTORY_[A-Z_]{1,64}$/u.test(code)
                ? code : 'WORKSPACE_DIRECTORY_PROTOCOL_INVALID'));
            } else if (message.type === `workspace.directory.${action}.result`) {
              finish(null, message);
            } else {
              finish(directoryTransportError('WORKSPACE_DIRECTORY_PROTOCOL_INVALID'));
            }
          });
          port.onDisconnect.addListener(() => {
            // Consume lastError without exposing local paths or host diagnostics.
            void runtime.lastError;
            finish(directoryTransportError('WORKSPACE_DIRECTORY_HOST_UNAVAILABLE'));
          });
          timer = setTimeout(() => finish(directoryTransportError('WORKSPACE_DIRECTORY_TIMEOUT')), timeoutMs);
          port.postMessage({ ...payload, type: `workspace.directory.${action}`, requestId });
        } catch (_) {
          finish(directoryTransportError('WORKSPACE_DIRECTORY_HOST_UNAVAILABLE'));
        }
      });
    }
    return {
      status(rootId = '') { return request('status', { rootId }); },
      bind({ absolutePath, rootId, challenge } = {}) {
        return request('bind', { absolutePath, rootId, challenge });
      },
      open({ rootId, workspaceId, workspaceGeneration, canonicalUrl, directoryName } = {}) {
        return request('open', { rootId, workspaceId, workspaceGeneration, canonicalUrl, directoryName });
      },
      openResearch({ rootId, identity, mappingId, mappingRecordId } = {}) {
        return request('openResearch', { rootId, identity, mappingId, mappingRecordId }).catch(error=>{
          if(error.code==='WORKSPACE_DIRECTORY_INVALID_REQUEST')throw directoryTransportError('WORKSPACE_DIRECTORY_HOST_UPDATE_REQUIRED');
          throw error;
        });
      }
    };
  }
  return { createWorkspaceDirectoryNativeClient };
});
