# MCP client configuration

## Codex CLI

The coordinating session verified this HTTP form with an isolated `CODEX_HOME`.
The local CLI reports `codex-cli 0.151.0`.

```powershell
$env:BREVESS_MCP_TOKEN = '<token printed by mcp/server.js>'
codex exec --skip-git-repo-check `
  -c 'mcp_servers.brevess.url="http://127.0.0.1:9537/mcp"' `
  -c 'mcp_servers.brevess.bearer_token_env_var="BREVESS_MCP_TOKEN"' `
  'Use the BREVESS MCP server to read the current project context.'
```

Start the server separately with `node mcp/server.js --http-only --allow-write`.
To make Codex use the generated token without copying it into a file, set the
same environment variable before starting Codex:

```powershell
$env:BREVESS_MCP_TOKEN = (Get-Content (Join-Path $env:LOCALAPPDATA 'BrevessMcp\bridge-token')).Trim()
```

`mcp/config/codex-exec.ps1` passes the same configuration as one-off `-c`
overrides and avoids editing `config.toml`.

The `--allow-write` flag only enables write transport. The external Agent must
still call `brevess.request_write_scope` and wait for the human's Workbench
approval before a routine mutation.

## DeepSeek harness

Use the stdio form for a harness that launches MCP processes itself:

```json
{"command":"node","args":["D:\\path\\to\\BREVESS-Deepseek\\mcp\\server.js","--stdio-only","--allow-write"]}
```

The
`deepseek-harness.json` file is a generic `mcpServers` example; adapt its
transport field to the harness version in use. The server speaks standard
newline-delimited JSON-RPC over stdio and does not require Codex-only APIs.

## Isolation

For an isolated test, create a temporary `CODEX_HOME`, copy or authenticate the
test profile explicitly, and set `BREVESS_MCP_STATE_DIR` to a temporary
directory. Do not point the test at a production project or rewrite a user's
existing MCP configuration.

