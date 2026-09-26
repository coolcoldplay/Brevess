$ErrorActionPreference = 'Stop'
# This is the compatibility ID registered by all Brevess releases.
$hostName = 'com.sci_reader.codex_bridge'
$registryRoots = @(
  "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\$hostName",
  "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$hostName"
)
foreach ($registryPath in $registryRoots) {
  if (Test-Path -LiteralPath $registryPath) {
    Remove-Item -LiteralPath $registryPath -Recurse -Force
  }
}

$stateRoots = @(
  (Join-Path $env:LOCALAPPDATA 'BrevessCodexBridge'),
  (Join-Path $env:LOCALAPPDATA 'SCIReaderCodexBridge')
)
foreach ($installRoot in $stateRoots) {
  if (Test-Path -LiteralPath $installRoot) {
    Write-Output "Registry entries removed. Local state remains at: $installRoot"
  }
}
