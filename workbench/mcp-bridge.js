// MCP-owned Workbench entry point. This file is a thin loader so the
// Workbench index/app remain owned by the Workbench session.
(function loadBrevessMcpBridge() {
  'use strict';
  if (!globalThis.chrome?.runtime?.id || globalThis.BrevessMcpBridge) return;
  const params = new URLSearchParams(globalThis.location?.search || '');
  const requested = document.documentElement.dataset.mcpBridge === 'on' ||
    params.has('mcpServer') || params.has('mcpToken') || params.get('mcpBridge') === '1';
  if (!requested) return;
  const source = chrome.runtime.getURL('mcp/extension/workbench-mcp-bridge.js');
  if (document.querySelector('script[data-brevess-mcp-core]')) return;
  const script = document.createElement('script');
  script.dataset.brevessMcpCore = '1';
  script.src = source;
  script.addEventListener('error', () => {
    console.error('[brevess-mcp] failed to load the MCP bridge core', source);
    const status = document.getElementById('mcp-status');
    if (status) {
      status.textContent = 'MCP 桥接加载失败';
      status.dataset.state = 'incompatible';
    }
  }, { once: true });
  document.head.append(script);
})();
