param(
  [Alias('ExtensionId')]
  [string[]]$ExtensionIds,
  [string]$HostExecutable
)

$ErrorActionPreference = 'Stop'
# Keep the registered host ID stable so existing browser permissions continue to work.
$hostName = 'com.sci_reader.codex_bridge'
$hostRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$catalogIdPath = Join-Path $hostRoot 'catalog-extension-ids.txt'

if (-not $ExtensionIds -or $ExtensionIds.Count -eq 0) {
  if (Test-Path -LiteralPath $catalogIdPath -PathType Leaf) {
    $ExtensionIds = @(
      Get-Content -LiteralPath $catalogIdPath |
        ForEach-Object { $_.Trim() } |
        Where-Object { $_ -and -not $_.StartsWith('#') }
    )
  }
}
if (-not $ExtensionIds -or $ExtensionIds.Count -eq 0) {
  $ExtensionIds = @('finhfnjbpidfakpmkghkfjlfcfpoandh')
}
$ExtensionIds = @(
  $ExtensionIds |
    ForEach-Object { $_ -split ',' } |
    ForEach-Object { $_.Trim() } |
    Where-Object { $_ } |
    Select-Object -Unique
)

if ([string]::IsNullOrWhiteSpace($HostExecutable)) {
  $HostExecutable = Join-Path $hostRoot 'bin\brevess-codex-host.exe'
}
$HostExecutable = [System.IO.Path]::GetFullPath($HostExecutable)
if (-not (Test-Path -LiteralPath $HostExecutable -PathType Leaf)) {
  throw "Codex bridge executable not found: $HostExecutable"
}
foreach ($extensionId in $ExtensionIds) {
  if ($extensionId -notmatch '^[a-p]{32}$') {
    throw "Invalid Chromium extension ID: $extensionId"
  }
}

$installRoot = Join-Path $env:LOCALAPPDATA 'BrevessCodexBridge'
$legacyInstallRoot = Join-Path $env:LOCALAPPDATA 'SCIReaderCodexBridge'
if (-not (Test-Path -LiteralPath $installRoot) -and
    (Test-Path -LiteralPath $legacyInstallRoot -PathType Container)) {
  New-Item -ItemType Directory -Path $installRoot -Force | Out-Null
  Get-ChildItem -LiteralPath $legacyInstallRoot -Force |
    Where-Object { $_.Name -notin @('sci-reader-codex-host.exe', "$hostName.json") } |
    Copy-Item -Destination $installRoot -Recurse -Force
}
New-Item -ItemType Directory -Path $installRoot -Force | Out-Null
$installedExecutable = Join-Path $installRoot 'brevess-codex-host.exe'
Copy-Item -LiteralPath $HostExecutable -Destination $installedExecutable -Force

$manifestPath = Join-Path $installRoot "$hostName.json"
$manifest = [ordered]@{
  name = $hostName
  description = 'Local Codex bridge for Brevess'
  path = $installedExecutable
  type = 'stdio'
  allowed_origins = @($ExtensionIds | ForEach-Object { "chrome-extension://$_/" })
}
$manifestJson = $manifest | ConvertTo-Json -Depth 4
$utf8WithoutBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($manifestPath, $manifestJson, $utf8WithoutBom)

$registryRoots = @(
  "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\$hostName",
  "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$hostName"
)
foreach ($registryPath in $registryRoots) {
  New-Item -Path $registryPath -Force | Out-Null
  Set-Item -Path $registryPath -Value $manifestPath
}

Write-Output "Installed $hostName"
Write-Output "Allowed extension IDs: $($ExtensionIds -join ', ')"
Write-Output "Host manifest: $manifestPath"
Write-Output "Restart Edge/Chrome or reload the extension before testing."
