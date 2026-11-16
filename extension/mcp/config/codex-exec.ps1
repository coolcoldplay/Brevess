# Run an isolated Codex exec session with the MCP server as a temporary
# command-line config override. It does not edit the user's config.toml.
#
# Usage:
#   .\mcp\config\codex-exec.ps1 "Open the saved PDF, query the library, ..."

param(
  [Parameter(Mandatory = $true, Position = 0)]
  [string]$Prompt,
  [string]$Repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
)

if (-not $env:BREVESS_MCP_TOKEN) {
  throw "Set BREVESS_MCP_TOKEN to the local token printed by mcp/server.js."
}

# Start  node mcp/server.js --http-only --allow-write  in another terminal.
$arguments = @(
  'exec',
  '-C', $Repo,
  '--skip-git-repo-check',
  '-c', 'mcp_servers.brevess.url="http://127.0.0.1:9537/mcp"',
  '-c', 'mcp_servers.brevess.bearer_token_env_var="BREVESS_MCP_TOKEN"',
  $Prompt
)

& codex @arguments

