# BREVESS MCP integration

This directory is the transport and adapter layer between an external MCP
client and the BREVESS Workbench. It does not implement project storage.
Workbench remains the only authority for project data, CAS, undo and source
identity.

## What is implemented

- Newline-delimited JSON-RPC over stdio.
- Localhost JSON-RPC over `POST /mcp`.
- Legacy SSE transport (`GET /sse` plus `POST /mcp?sessionId=...`).
- `initialize`, `ping`, `tools/list`, `tools/call`, `resources/list`,
  `resources/templates/list`, `resources/read`, `prompts/list`,
  `prompts/get`, `completion/complete`, `logging/setLevel` and cancellation.
- Tool adapters backed by `workbench/agent-tools.js` and radar tools, plus the
  Workbench Operation Contract v1 adapters.
- One-task human-approved write scope, idempotency caching, CAS error
  propagation, audit hashes, bounded results and `workbench.read_more`.
- A Workbench-page client for the host object `window.BrevessWorkbenchMCP`.

The Workbench host now exposes six contract operations and the dedicated PDF
open hook. Legacy `createAgentTools` execution, the general background/native
relay and the new operation handlers are still Workbench-owned integration
points. Domain calls return the host's precise error instead of inventing a
result.

## Run

Read-only stdio server (the default):

```powershell
node mcp/server.js --stdio-only
```

Read/write transport, still requiring a task-level scope from
`brevess.request_write_scope`:

```powershell
node mcp/server.js --stdio-only --allow-write
```

The localhost bridge is always started for extension pairing. The default
port is `9537`; use `--port 0` for a random port during tests.

On startup the server prints a one-time connect URL and writes a local token
under `%LOCALAPPDATA%\\BrevessMcp\\bridge-token`. The token is not an API key
and must not be copied into project data. The connect page derives the
extension ID from `manifest.json` and links to the Workbench page.

Useful options:

```text
--http-only
--stdio-only
--allow-write
--port <number>
--token <token>
--state-dir <dir>
--tool-timeout-ms <milliseconds>
--max-result-bytes <bytes>
```

## Transports

### stdio

The server accepts one JSON-RPC object per line and writes one response object
per line on stdout. Logs and the connect URL go to stderr, so they cannot
corrupt the MCP stream.

### Localhost HTTP

`POST /mcp` accepts a JSON-RPC object or batch. The bridge token is required in
`Authorization: Bearer <token>`. `GET /sse` uses the same token as a query
parameter because `EventSource` cannot set custom headers.

`GET /health` reports server scope, bridge online state and the current
Approval-safe write-scope summary. It does not include the bridge token or a
host scope token.

## Extension bridge

The Workbench owner exposes:

```js
window.BrevessWorkbenchMCP = {
  contractVersion: 1,
  status() {},
  getContext() {},
  listCapabilities() {},
  execute(name, args, { signal, requestId, scopeToken }) {},
  requestWriteScope(request) {},
  readResource(uri, options) {},
  cancel(operationId) {},
  // Optional: revokeWriteScope(scope)
};
```

Load [`mcp/extension/workbench-mcp-bridge.js`](./extension/workbench-mcp-bridge.js)
after the Workbench host is ready. The bridge:

1. Stores only the localhost server URL, bridge token and a stable client ID in
   `chrome.storage.local` under `brevess-mcp-bridge-v1`.
2. Long-polls `/bridge/poll`; it does not scan or copy Workbench storage.
3. Calls the host operation object for every tool call.
4. Forwards a host-issued `scopeToken` only in the bridge job metadata, never
   as a tool argument or tool result.
5. Focuses the Workbench tab before starting an approval-requiring operation.
6. Stops rather than silently reading stale state when the host is unavailable.

The current page client is deliberately in the same extension page as the
host. A production background/native-messaging relay must preserve the same
message shape and must authenticate the exact Workbench document before
forwarding; see `extension/HOST-INTEGRATION.md`.

## Tools

Namespaces are fixed:

```text
workbench.*  library.*  pdf.*  figure.*  radar.*  settings.*  brevess.*
```

The first Workbench contract adapters are:

```text
library.query_global_library
workbench.attach_material
workbench.update_material_stance
workbench.create_evidence_block
workbench.set_edge_relation
```

Existing Workbench operations are exposed as legacy-compatible adapters:
`workbench.read_context`, `workbench.project_summary`,
`workbench.plan_hypotheses`, `workbench.plan_figures`,
`workbench.model_operation`, `workbench.edit_project`, `workbench.undo`,
`workbench.redo`, `workbench.list_recycle`, `workbench.restore`,
`library.query_library`, `library.read_workspace`, `library.local_data`,
`workbench.import_project`, `workbench.export_project`,
`workbench.import_asset`, `workbench.read_asset`, `workbench.clipboard`,
`workbench.locate_source`, `workbench.save_view`, `workbench.navigate`,
`workbench.data_directory`, `library.export_transfer`,
`library.import_transfer`, and the `radar.*` tools.

`pdf.open_local` opens an explicitly supplied `file://` PDF through the
existing PDF reader and returns the real `opened`, `readerUrl` and `tabId`
receipt. A real headless Edge smoke observed 45 pages, the PDF title and
document hash, with phase `text-ready`; outline and reference count remain
`PENDING_PARSING` until the reader exposes them. The tool never uses an
MCP-side PDF parser or fake metadata.

## Write scope

The process scope and task scope are separate:

- `--allow-write` enables the MCP transport to submit writes.
- It does not authorize any write. Every routine mutation needs a successful
  `brevess.request_write_scope` call.
- The Workbench UI shows the scope preview to the human. MCP cannot approve it.
- A scope is bound to `projectId`, an operation set, a task ID and an expiry.
- `brevess.status` shows whether the scope is pending, granted or absent.
- `brevess.revoke_write_scope` clears the local scope and asks the host to
  revoke its token.
- A scope never replaces `expectedProjectId`, `expectedRevision`, source
  identity checks, undo, or per-operation host guards.

Every mutating MCP call also requires a stable `idempotencyKey`. A repeated
successful call with the same key returns the original receipt; reusing the key
with different arguments fails with `IDEMPOTENCY_KEY_REUSED`.

### Empty Workbench bootstrap

An empty Workbench has no project ID. Use:

```json
{
  "projectId": null,
  "bootstrap": true,
  "operations": ["workbench.create_project"],
  "taskId": "..."
}
```

The MCP bridge routes this to the Workbench bootstrap branch of
`requestWriteScope` (or an optional `requestBootstrapScope` alias). It never invents a
project ID. After the human approves, call `workbench.create_project` with
`expectedProjectId:null`, `expectedRevision:0`; the one-shot bootstrap scope is
consumed on success. Then call `workbench.read_context` and request a normal
project scope before further writes. If the host has no bootstrap entry, the
bridge returns `MCP_WORKBENCH_BOOTSTRAP_HOST_UNAVAILABLE`.

## Error and result contract

Tool failures are returned as MCP tool results with `isError: true` and:

```json
{
  "ok": false,
  "error": {
    "code": "WORKBENCH_REVISION_CONFLICT",
    "message": "...",
    "details": {"field": "...", "correction": "..."},
    "retryable": true,
    "nextActions": [{"tool": "workbench.read_context"}]
  }
}
```

Successful writes include a real receipt, `changedPaths`, warnings and
`nextActions`. Large responses are paged by `workbench.read_more` or the
`brevess://result/{cursor}` resource.

## Tests

```powershell
node --test tests/mcp-server.test.cjs
```

Current result: 15/15 passing, plus the runtime sender query-boundary test
`tests/mcp-runtime-workbench-query.test.js` 1/1. The real headless Edge bridge
smoke is in `output/mcp-20261018/`.

The HTTP test binds only to `127.0.0.1` with a random port. In a sandbox that
blocks loopback sockets, run that test with controlled loopback permission;
the fixed port is never used for test startup.

