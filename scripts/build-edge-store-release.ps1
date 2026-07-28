param(
  [string]$CatalogExtensionId = '',
  [string]$ReleaseName = '',
  [switch]$SkipNativeHostBuild
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$manifestPath = Join-Path $projectRoot 'manifest.json'
$manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding utf8 |
  ConvertFrom-Json
$version = [string]$manifest.version
if ([string]::IsNullOrWhiteSpace($version)) {
  throw 'manifest.json has no version.'
}
if ([string]::IsNullOrWhiteSpace($ReleaseName)) {
  $ReleaseName = "Brevess-Edge-v$version"
}
if ($ReleaseName -notmatch '^[A-Za-z0-9._-]+$') {
  throw 'ReleaseName may contain only letters, numbers, dots, underscores, and hyphens.'
}
if ($CatalogExtensionId -and $CatalogExtensionId -notmatch '^[a-p]{32}$') {
  throw "Invalid Microsoft Edge extension ID: $CatalogExtensionId"
}

$distRoot = Join-Path $projectRoot 'dist'
$releaseRoot = Join-Path $distRoot $ReleaseName
$resolvedDist = [System.IO.Path]::GetFullPath($distRoot)
$resolvedRelease = [System.IO.Path]::GetFullPath($releaseRoot)
if (-not $resolvedRelease.StartsWith(
    $resolvedDist.TrimEnd('\') + '\',
    [System.StringComparison]::OrdinalIgnoreCase
  )) {
  throw 'Release target escaped the dist directory.'
}
if (Test-Path -LiteralPath $releaseRoot) {
  throw "Release target already exists; refusing to overwrite: $releaseRoot"
}

$extensionStage = Join-Path $releaseRoot 'extension-package'
$bridgeStage = Join-Path $releaseRoot 'codex-bridge-package'
$assetsTarget = Join-Path $releaseRoot 'store-assets'
New-Item -ItemType Directory -Path $extensionStage -Force | Out-Null
New-Item -ItemType Directory -Path $bridgeStage -Force | Out-Null
New-Item -ItemType Directory -Path $assetsTarget -Force | Out-Null

foreach ($directory in @('core', 'providers', 'vendor', 'icons', '_locales')) {
  Copy-Item -LiteralPath (Join-Path $projectRoot $directory) `
    -Destination $extensionStage -Recurse
}
foreach ($file in @(
  'manifest.json', 'background.js', 'content.js', 'content.css',
  'popup.html', 'popup.js', 'popup.css',
  'options.html', 'options.js', 'options.css',
  'offscreen.html', 'offscreen.js', 'offscreen-network-worker.js',
  'LICENSE', 'THIRD_PARTY_NOTICES.md', 'OPEN_SOURCE.md'
)) {
  Copy-Item -LiteralPath (Join-Path $projectRoot $file) -Destination $extensionStage
}

# The source manifest keeps a public key so local/unpacked installs retain a
# stable extension ID. Microsoft Edge Add-ons assigns the catalog ID itself and
# rejects uploaded manifests that contain the Chrome-specific `key` field, so
# remove it only from the staged store package.
$storeManifestPath = Join-Path $extensionStage 'manifest.json'
$storeManifest = Get-Content -LiteralPath $storeManifestPath -Raw -Encoding utf8 |
  ConvertFrom-Json
$storeManifest.PSObject.Properties.Remove('key')
$storeManifestJson = $storeManifest | ConvertTo-Json -Depth 20
[System.IO.File]::WriteAllText(
  $storeManifestPath,
  $storeManifestJson + [Environment]::NewLine,
  $utf8NoBom
)

$extensionZip = Join-Path $releaseRoot "Brevess-v$version-Microsoft-Edge.zip"
Compress-Archive -Path (Join-Path $extensionStage '*') `
  -DestinationPath $extensionZip -CompressionLevel Optimal

if (-not $SkipNativeHostBuild) {
  & (Join-Path $PSScriptRoot 'build-codex-native-host.ps1')
  if ($LASTEXITCODE -ne 0) {
    throw 'Unable to build the optional Codex Native Messaging host.'
  }
}
$hostExecutable = Join-Path $projectRoot 'native-host\bin\brevess-codex-host.exe'
if (-not (Test-Path -LiteralPath $hostExecutable -PathType Leaf)) {
  throw "Codex Bridge executable is missing: $hostExecutable"
}
$bridgeBin = Join-Path $bridgeStage 'bin'
New-Item -ItemType Directory -Path $bridgeBin -Force | Out-Null
Copy-Item -LiteralPath $hostExecutable -Destination $bridgeBin
foreach ($file in @(
  'install.ps1', 'login.ps1', 'uninstall.ps1',
  'Install-Brevess-Codex-Bridge.cmd', 'Uninstall-Brevess-Codex-Bridge.cmd',
  'README-STORE.md'
)) {
  Copy-Item -LiteralPath (Join-Path $projectRoot "native-host\$file") `
    -Destination $bridgeStage
}
Copy-Item -LiteralPath (Join-Path $projectRoot 'CODEX_LOCAL_SETUP.md') `
  -Destination $bridgeStage

$catalogIds = @(
  Get-Content -LiteralPath (
    Join-Path $projectRoot 'native-host\catalog-extension-ids.txt'
  ) -Encoding utf8 |
    ForEach-Object { $_.Trim() } |
    Where-Object { $_ -and -not $_.StartsWith('#') }
)
if ($CatalogExtensionId) {
  $catalogIds += $CatalogExtensionId
}
$catalogIds = @($catalogIds | Select-Object -Unique)
$catalogText = @(
  '# Allowed Microsoft Edge / Chromium extension IDs'
  $catalogIds
) -join [Environment]::NewLine
[System.IO.File]::WriteAllText(
  (Join-Path $bridgeStage 'catalog-extension-ids.txt'),
  $catalogText + [Environment]::NewLine,
  $utf8NoBom
)

$bridgeVersionedZip = Join-Path $releaseRoot (
  "Brevess-Codex-Bridge-Windows-x64-v$version.zip"
)
$bridgeStableZip = Join-Path $releaseRoot 'Brevess-Codex-Bridge-Windows-x64.zip'
Compress-Archive -Path (Join-Path $bridgeStage '*') `
  -DestinationPath $bridgeVersionedZip -CompressionLevel Optimal
Copy-Item -LiteralPath $bridgeVersionedZip -Destination $bridgeStableZip

$storeAssetsSource = Join-Path $projectRoot 'docs\edge-store\assets'
if (Test-Path -LiteralPath $storeAssetsSource -PathType Container) {
  Copy-Item -Path (Join-Path $storeAssetsSource '*') `
    -Destination $assetsTarget -Recurse
}
foreach ($file in @(
  'STORE_LISTING.md', 'PRIVACY_AND_PERMISSIONS.md',
  'CERTIFICATION_NOTES.md', 'RELEASE_CHECKLIST.md', 'PUBLISHING_GUIDE_CN.md',
  'RELEASE_NOTES.md'
)) {
  $source = Join-Path $projectRoot "docs\edge-store\$file"
  if (Test-Path -LiteralPath $source -PathType Leaf) {
    Copy-Item -LiteralPath $source -Destination $releaseRoot
  }
}
Copy-Item -LiteralPath (Join-Path $projectRoot 'docs\privacy-policy.html') `
  -Destination $releaseRoot
Copy-Item -LiteralPath (Join-Path $projectRoot 'docs\reviewer-demo.html') `
  -Destination $releaseRoot
Copy-Item -LiteralPath (Join-Path $projectRoot 'docs\index.html') `
  -Destination $releaseRoot

$artifacts = @(
  $extensionZip, $bridgeVersionedZip, $bridgeStableZip
) | ForEach-Object {
  $item = Get-Item -LiteralPath $_
  [ordered]@{
    file = $item.Name
    bytes = $item.Length
    sha256 = (Get-FileHash -LiteralPath $_ -Algorithm SHA256).Hash.ToLowerInvariant()
  }
}
$releaseMetadata = [ordered]@{
  product = 'Brevess'
  version = $version
  builtAt = (Get-Date).ToUniversalTime().ToString('o')
  catalogExtensionIds = $catalogIds
  artifacts = $artifacts
}
$releaseJson = $releaseMetadata | ConvertTo-Json -Depth 5
[System.IO.File]::WriteAllText(
  (Join-Path $releaseRoot 'release-manifest.json'),
  $releaseJson + [Environment]::NewLine,
  $utf8NoBom
)

Write-Output $releaseRoot
Write-Output $extensionZip
Write-Output $bridgeStableZip
