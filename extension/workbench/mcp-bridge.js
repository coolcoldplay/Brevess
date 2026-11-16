// MCP-owned Workbench entry point. This file is a thin loader so the
// Workbench index/app remain owned by the Workbench session.
(function loadBrevessMcpBridge() {
  'use strict';
  let loading = null;
  globalThis.ensureBrevessMcpBridge = () => {
    if (globalThis.BrevessMcpBridge) return Promise.resolve(globalThis.BrevessMcpBridge);
    if (loading) return loading;
    if (!globalThis.chrome?.runtime?.id) return Promise.reject(Error('请从扩展工作台打开连接中心。'));
    loading = new Promise((resolve, reject) => {
      const existing = document.querySelector('script[data-brevess-mcp-core]');
      const script = existing || document.createElement('script');
      script.addEventListener('load', () => resolve(globalThis.BrevessMcpBridge), { once: true });
      script.addEventListener('error', () => { loading = null; script.remove(); reject(Error('MCP 桥未能加载')); }, { once: true });
      if (!existing) { script.dataset.brevessMcpCore = '1'; script.src = chrome.runtime.getURL('mcp/extension/workbench-mcp-bridge.js'); document.head.append(script); }
    });
    return loading;
  };
  // Credentials in an old workbench link do not bypass settings management.
  const params=new URLSearchParams(globalThis.location?.search||'');
  if(params.has('mcpToken')||params.has('mcpServer')){params.delete('mcpToken');params.delete('mcpServer');const query=params.toString();history.replaceState(null,'',location.pathname+(query?'?'+query:'')+location.hash);}
  // Settings manager resumes saved pairing only through an actual open module.
})();
