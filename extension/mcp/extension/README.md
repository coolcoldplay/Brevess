# BREVESS Workbench MCP bridge

`workbench-mcp-bridge.js` is the extension-side half of the MCP transport. It
does not read IndexedDB or OPFS directly. It expects the Workbench owner to
expose `window.BrevessWorkbenchMCP`:

```js
window.BrevessWorkbenchMCP = {
  protocolVersion: 1,
  status() {},
  getContext() {},
  listCapabilities(options) {},
  execute(name, args, { signal, requestId, scopeToken }) {
    // Must call the same Workbench session/store/agent-tools path as the UI.
    // Return the real receipt, or throw an error with code/details.
  },
  requestWriteScope(request) {},
  readResource(uri, options) {},
  cancel(requestId) {},
  // Optional: revokeWriteScope(scope)
};
window.dispatchEvent(new CustomEvent('brevess:mcp-host-ready'));
```

The host must not accept text from MCP as approval. Destructive local-data
operations continue through the existing Workbench approval UI; the bridge
only focuses the tab before such a call.

The script is intentionally not wired into `workbench/index.html` by the MCP
session because that file is owned by the Workbench session. The Workbench
owner should load this script after `app.js` when the host is ready, or expose
an equivalent loader.
