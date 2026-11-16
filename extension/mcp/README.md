# BREVESS MCP integration

## 首次连接与文献机制图

工作台、雷达、文献总库和文献机制图的 **Agent 连接**入口显示当前目标、连接状态和写入权限。Windows 首次接入先打开匹配配套组件的 `Install-Brevess-Codex-Bridge.cmd`，选择已安装的 Codex、DeepSeek Harness 或两者。默认只读；空选择仅安装组件，不配置 Agent。安装器合并所选客户端配置，使用固定版本的本机 Node/MCP payload；已有配置应复用，不改成临时解压路径，不另开 HTTP 服务。

重载所选客户端，在工作台连接中心依次选择“检测连接组件”和“自动配对并自检”，再从客户端调用 `brevess.status` / `brevess.capabilities`。自动配对不需要把凭据复制到聊天；确需手动配对时仅在连接中心粘贴完整本机链接。组件就绪、服务在线、扩展配对和客户端读工具成功分别核验。MCP 不需要收费模型调用或插件专用模型登录；它与插件发起模型调用所用的 Windows 模型桥是不同能力。

安装及已核验客户端版本见 [客户端说明](config/README.md)。配套组件包必须包含匹配版本的 native host、Node 和 Agent payload；仅更新扩展不能更新旧 native 协议。当前没有已核实的公开安装下载 URL，不提供猜测地址。“未检测到服务”只说明本次连接失败，不代表没有安装。随包 `Start-BREVESS-MCP.cmd` 只帮助打开配套安装选择器；缺少组件时给出说明，不启动第二个服务。

机制图使用独立接口：`mechanism.read_context` → `mechanism.list_evidence` → `brevess.request_document_write_scope` → `mechanism.apply_commands` → `mechanism.read_context`。文献解图界面必须保持打开并显示正确文献；多个有效文献界面会拒绝含糊的目标。`target` 使用读取结果中的完整身份，不能自行编造。请求权限后在该文献界面确认，再重新请求取得授权回执。

文献授权默认15分钟，只在内存中保存，重载/切换文献/撤回后失效。允许操作为 `edit`、`layout`，删除权限须另行勾选，实际删除还会展示受影响的节点、联系和证据绑定再次确认。课题授权不能用于文献，文献授权也不能用于课题。

`mechanism.apply_commands` 每批1–32条、最多128KiB，必须附 `expectedRevision` 和稳定的 `idempotencyKey`。使用真实证据清单中的完整 Panel 集合与两种指纹；失效证据或手工修改造成的版本冲突直接拒绝。一批只提交一次，不能部分成功。`mechanism.read_receipt` 用于断线后查回执；返回 `UNKNOWN_REQUIRES_READ` 时先回读画布，不能换键盲目重放。凭据不出现在工具结果中。

连接中心可检测/重连/撤回权限。无配对、鉴权失效、版本不符与服务不可达分别显示；只有通过鉴权的桥轮询成功才显示已连接。不能用端口可达或客户端发现了工具替代实际连接验证。

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

Discover the actual tool inventory with `tools/list` and `brevess.capabilities`;
do not infer capabilities from a historical tool count. Workbench owns domain
operations and the dedicated PDF open hook. Calls return the host's precise
error instead of inventing a result.

## Advanced development: isolated source startup

The installer-managed connection above is the user path. These source commands
are for explicitly authorized development with synthetic targets. Current stdio
uses a proxy to one shared localhost service; it verifies service identity,
runtime revision, extension ID and write mode before reuse. It does not start
one listener per client. Do not replace an installed client's stable entry with
this checkout or start a second default-port HTTP service.

Use a dedicated temporary state directory, a random port and explicit read-only
mode, without modifying a real client configuration:

```powershell
$brevessDevState = Join-Path $env:TEMP ('brevess-mcp-dev-' + [guid]::NewGuid().ToString('N'))
node .\mcp\server.js --stdio-only --no-write --port 0 --state-dir $brevessDevState
```

This is an MCP stdio process, not a user pairing command; the proxy does not
print a connect URL. Explicit HTTP debugging is an alternative only when needed,
with its own state directory, random port and `--no-write`. Never reuse the
installed user's state or port 9537 for that separate listener. Historical
HTTP/client-exec examples under `config/` and `e2e/` are development material,
not the normal setup or a free model-independent self-check.

The installed shared service uses `%LOCALAPPDATA%\BrevessMcp` by default. Its
token is local pairing material, not an API key; never copy it into project
data, reports or chat. Native pairing obtains it from the verified service.

Useful options:

```text
--http-only
--stdio-only
--no-write
--allow-write
--port <number>
--token <token>
--state-dir <dir>
--tool-timeout-ms <milliseconds>
--max-result-bytes <bytes>
```

## Transports

### stdio

The proxy accepts one JSON-RPC object per line and writes one response object
per line on stdout. Its sanitized diagnostics go to stderr. Each client has
its own request namespace while sharing the verified local service.

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
library.catalog_read
library.catalog_command
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

## PPT material tools

`ppt.prepare` starts the existing source-bound export preparation without running a new model. `ppt.status` exposes progress; `ppt.get_manifest` lists bounded file handles, sizes, SHA-256 and missing images. The first `ppt.read_chunk` requires explicit consent in the current document UI; a chunk contains at most32KiB of binary data encoded as base64. `ppt.cancel` releases only that preparation. A different document, changed material content, expiry or cancelled session rejects reads. Existing ZIP export remains available.

The material manifest includes the current article's images, captions, analyses, text context, Q&A and manual annotations; the consent dialog lists these before file contents are sent to the Agent. It never reads the entire library. Downloads stay local unless the user separately authorizes a destination service. The packaged skill collects presentation requirements in chat, retrieves and checks the files, produces an editable PPTX, renders it, and delivers both PPTX and preview. Material readiness alone is not presentation completion.

## Read and write authorization

Installed clients default to read-only. Enabling write transport requires the
user's explicit consent and the companion installer's `-AgentAllowWrite` option
or a reviewed advanced `--allow-write` configuration. Do not silently change a
managed client block; when both clients are managed, follow the installer's
joint-upgrade check and reload the selected clients.

- Global library reads (`library.query_global_library`, `library.catalog_read`)
  need no project scope or active project.
- `library.catalog_command` requires **both `--allow-write` and per-operation
  confirmation in the browser's native Workbench dialog**. Supply the catalog's
  latest `expectedRevision`, a stable `idempotencyKey` and the precise command.
  A project scope cannot bypass this confirmation. Denial, cancellation,
  timeout or revocation prevents a late write.
- Project mutations use `brevess.request_write_scope`, bound to project ID,
  operation set, task ID and expiry. Keep required project/revision/source guards.
- Document mechanism mutations use `brevess.request_document_write_scope` and
  the exact document identity, independently of project permissions.
- `brevess.revoke_write_scope` clears the local project scope and asks the host
  to revoke its token. It also invalidates pending catalog approval at the host;
  it does not rewrite a client's transport configuration.

Use the idempotency fields required by each tool. Repeated catalog commands with
the same key and arguments return the prior receipt without another mutation;
different arguments fail with `LIBRARY_CATALOG_IDEMPOTENCY_CONFLICT`. After any
timeout, read back before retrying rather than assuming a write did not happen.

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

Historical 2026-10-18 evidence: 15/15 passing, plus the runtime sender query-boundary test
`tests/mcp-runtime-workbench-query.test.js` 1/1. The real headless Edge bridge
smoke is in `output/mcp-20261018/`.

The HTTP test binds only to `127.0.0.1` with a random port. In a sandbox that
blocks loopback sockets, run that test with controlled loopback permission;
the fixed port is never used for test startup.

