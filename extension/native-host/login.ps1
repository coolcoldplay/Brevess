$ErrorActionPreference = 'Stop'

$bridgeRoot = Join-Path $env:LOCALAPPDATA 'BrevessCodexBridge'
$legacyBridgeRoot = Join-Path $env:LOCALAPPDATA 'SCIReaderCodexBridge'
if (-not (Test-Path -LiteralPath $bridgeRoot) -and
    (Test-Path -LiteralPath $legacyBridgeRoot -PathType Container)) {
  New-Item -ItemType Directory -Path $bridgeRoot -Force | Out-Null
  Get-ChildItem -LiteralPath $legacyBridgeRoot -Force |
    Where-Object {
      $_.Name -notin @(
        'sci-reader-codex-host.exe',
        'com.sci_reader.codex_bridge.json'
      )
    } |
    Copy-Item -Destination $bridgeRoot -Recurse -Force
}
$pluginCodexHome = Join-Path $bridgeRoot 'codex-home'
New-Item -ItemType Directory -Path $pluginCodexHome -Force | Out-Null

$env:CODEX_HOME = $pluginCodexHome
$env:CODEX_SQLITE_HOME = $pluginCodexHome

Write-Output "Signing in to the Brevess plugin's isolated Codex session:"
Write-Output $pluginCodexHome
& codex login
if ($LASTEXITCODE -ne 0) {
  throw "Codex login failed with exit code $LASTEXITCODE"
}
