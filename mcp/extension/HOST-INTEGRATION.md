# Workbench host integration request

The MCP bridge expects the Workbench page to expose
`window.BrevessWorkbenchMCP` after its session is initialized. The host must
call the same `createAgentTools().execute`, Session/store and CAS paths as the
UI. It must not expose a second CRUD implementation.

## Startup

`workbench/index.html` currently owns the Workbench bundle. Add this script
after `app.js` when the host is created:

```html
<script src="../mcp/extension/workbench-mcp-bridge.js"></script>
```

and dispatch readiness after publishing the host:

```js
window.dispatchEvent(new CustomEvent('brevess:mcp-host-ready'));
```

If the Workbench owner uses a different loader, dispatch the same event and
keep the host object stable.

The current Workbench index contains an inline conditional loader. The
extension CSP (`script-src 'self'`) blocks that inline script. The verified
external replacement is:

```html
<script src="mcp-bridge-loader.js" defer></script>
```

`workbench/mcp-bridge-loader.js` checks the `mcpServer`/`mcpToken`/`mcpBridge`
query or `data-mcp-bridge="on"` and then loads `mcp-bridge.js`; it does nothing
for ordinary Workbench tabs. This removes the CSP dependency without changing
the Workbench host/model.

## Host methods

```ts
type HostReceipt = {
  success: boolean;
  data?: unknown;
  error?: { code: string; message: string; details?: unknown };
  revision?: number;
  changedPaths?: string[];
  approval?: unknown;
  auditId?: string;
};

interface BrevessWorkbenchMCP {
  contractVersion: 1;
  status(): Promise<{
    ready: boolean;
    projectId: string | null;
    revision: number;
    writeScope?: {
      status: 'NONE' | 'PENDING_HUMAN_ACTION' | 'GRANTED' | 'DENIED' | 'EXPIRED';
      scopeId?: string;
      projectId?: string;
      operations?: string[];
      expiresAt?: number;
      scopeToken?: string;
      approvalId?: string;
    };
    pendingApprovals?: unknown[];
  }>;
  getContext(): Promise<unknown>;
  listCapabilities(options?: { includeSchemas?: boolean }): Promise<unknown>;
  execute(name: string, args: object, options: {
    signal?: AbortSignal;
    requestId?: string;
    scopeToken?: string;
  }): Promise<HostReceipt>;
  // Dedicated PDF entry point; do not route this through operation-registry.
  openLocalPdf?(request: {
    fileUrl: string;
    title?: string;
    expectedProjectId?: string;
    expectedRevision?: number;
  }, options?: {
    signal?: AbortSignal;
    requestId?: string;
  }): Promise<{
    documentId: string;
    documentHash: string;
    title: string;
    doi?: string;
    pageCount: number;
    referenceCount?: number;
    outline?: unknown[];
    readerUrl?: string;
  }>;
  exportLibraryTransfer?(options: {
    scope: 'radar' | 'global-library' | 'combined';
    radarIds?: string[];
    includeRevisions?: boolean;
  }, options?: { signal?: AbortSignal; requestId?: string }): Promise<unknown>;
  importLibraryTransfer?(request: {
    bundle: object;
    expectedTransferRevision?: number;
    idempotencyKey: string;
  }, options?: { signal?: AbortSignal; requestId?: string; scopeToken?: string }): Promise<unknown>;
  requestWriteScope(request: {
    projectId?: string;
    operations: string[];
    hostOperations?: string[];
    ttlMs: number;
    taskId?: string;
    reason?: string;
    approvalId?: string;
  }): Promise<{
    status?: 'PENDING_HUMAN_ACTION' | 'GRANTED' | 'DENIED';
    approvalId?: string;
    expiresAt?: number;
    scopeId?: string;
    token?: string;
    preview?: unknown;
  }>;
  // Optional alias; the current host may implement the same branch inside
  // requestWriteScope({projectId:null,bootstrap:true,...}).
  requestBootstrapScope?(request: {
    projectId: null;
    bootstrap: true;
    operations: ['create_project'];
    ttlMs: number;
    taskId?: string;
    reason?: string;
    approvalId?: string;
  }): Promise<{
    status?: 'PENDING_HUMAN_ACTION' | 'GRANTED' | 'DENIED';
    approvalId?: string;
    scopeId?: string;
    token?: string;
    expiresAt?: number;
    preview?: unknown;
  }>;
  readResource(uri: string, options?: object): Promise<unknown>;
  cancel(operationId: string): Promise<unknown>;
  revokeWriteScope?(request: object): Promise<unknown>;
}
```

The `execute` result must contain the real Workbench revision and changed
paths. `scopeToken` is an opaque local capability. It must be validated by the
host and must never be returned in MCP tool output.

## Background/native relay

If the bridge is moved behind a background or native-messaging relay, use
these message types and preserve the same request/response validation:

```text
BREVESS_MCP_HOST_STATUS
BREVESS_MCP_HOST_CAPABILITIES
BREVESS_MCP_HOST_EXECUTE
BREVESS_MCP_HOST_REQUEST_SCOPE
BREVESS_MCP_HOST_REVOKE_SCOPE
BREVESS_MCP_HOST_READ_RESOURCE
BREVESS_MCP_HOST_CANCEL
BREVESS_MCP_OPEN_LOCAL_PDF
```

Each message must carry a request ID and a host response must include the
Workbench document identity, project ID, revision, `success`, `data|error`,
`changedPaths` and `auditId`. The relay must reject a sender that is not the
exact Workbench document; it must not copy IndexedDB records through the relay.

`BREVESS_MCP_OPEN_LOCAL_PDF` must be handled by the extension background or a
dedicated native host. It receives `{fileUrl, title, expectedProjectId,
expectedRevision}` and must open the existing PDF reader or call the native PDF
indexer without modifying the file. It must return `{success:true,data:{...}}`
with the real `documentHash`, `pageCount`, `outline`, title, DOI and reference
count, or `{success:false,error:{code,message}}`. It must not return a partial
reader URL as if parsing had completed.

