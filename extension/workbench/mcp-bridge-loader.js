(function loadBrevessMcpBridgeOnRequest() {
  'use strict';
  const params = new URLSearchParams(globalThis.location?.search || '');
  const requested = document.documentElement.dataset.mcpBridge === 'on' ||
    params.has('mcpServer') || params.has('mcpToken') || params.get('mcpBridge') === '1';
  if (!requested || document.querySelector('script[data-brevess-mcp-loader]')) return;
  const script = document.createElement('script');
  script.dataset.brevessMcpLoader = '1';
  script.src = 'mcp-bridge.js';
  script.defer = true;
  document.head.append(script);
})();
