$ErrorActionPreference = 'Stop'
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

$installRoot = Join-Path $env:LOCALAPPDATA 'SCIReaderCodexBridge'
if (Test-Path -LiteralPath $installRoot) {
  Write-Output "Registry entries removed. Local state remains at: $installRoot"
}
