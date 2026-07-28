$ErrorActionPreference = 'Stop'

$bridgeRoot = Join-Path $env:LOCALAPPDATA 'SCIReaderCodexBridge'
$pluginCodexHome = Join-Path $bridgeRoot 'codex-home'
New-Item -ItemType Directory -Path $pluginCodexHome -Force | Out-Null

$env:CODEX_HOME = $pluginCodexHome
$env:CODEX_SQLITE_HOME = $pluginCodexHome

Write-Output "Signing in to the SCI Reader plugin's isolated Codex session:"
Write-Output $pluginCodexHome
& codex login
if ($LASTEXITCODE -ne 0) {
  throw "Codex login failed with exit code $LASTEXITCODE"
}
