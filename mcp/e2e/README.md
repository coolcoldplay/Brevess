# MCP E2E

## Real bridge/PDF smoke

```powershell
node mcp/e2e/workbench-bridge-smoke.mjs
```

The script uses a temporary `CODEX`-independent Workbench profile and MCP
state directory, launches headless Microsoft Edge with this checkout as an
unpacked extension, opens the Workbench with `mcpServer`/`mcpToken`, and
performs:

- MCP initialize over localhost HTTP;
- `brevess.status` and `brevess.capabilities`;
- `library.query_global_library` (empty in the isolated profile is expected);
- `pdf.open_local` against the configured PDF.

Evidence is written to `output/mcp-20261018/workbench-bridge-smoke.json` and
PNG screenshots. No user profile or real Workbench store is used.

## Codex HTTP client

Start the server in one terminal:

```powershell
node mcp/server.js --http-only --allow-write
$env:BREVESS_MCP_TOKEN = (Get-Content (Join-Path $env:LOCALAPPDATA 'BrevessMcp\bridge-token')).Trim()
```

Open the printed Workbench connect URL and keep that Workbench tab open. Then:

```powershell
codex exec --skip-git-repo-check `
  -c 'mcp_servers.brevess.url="http://127.0.0.1:9537/mcp"' `
  -c 'mcp_servers.brevess.bearer_token_env_var="BREVESS_MCP_TOKEN"' `
  'Call brevess.status, then library.query_global_library with pageSize 5. Report the real tool receipt; do not create or modify any record.'
```

This verifies an external Codex Agent can speak to the MCP server. Current
capability and approval boundaries are documented in
`docs/mcp/CAPABILITY-MATRIX.md`. Treat receipts from the target installation as
the source of truth; do not claim a complete literature/radar/hypothesis/figure
workflow without them.

