param(
  [string]$CatalogExtensionId = '',
  [string]$ReleaseName = '',
  [switch]$SkipNativeHostBuild,
  [switch]$IncludeStableCompanionAlias
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

. (Join-Path $PSScriptRoot 'copy-release-files.ps1')
Copy-BrevessReleaseFiles -ProjectRoot $projectRoot -Target $extensionStage -Profile store

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
Copy-BrevessReleaseFiles -ProjectRoot $projectRoot -Target $bridgeStage -Profile companion

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
if ($IncludeStableCompanionAlias) {
  # Needed only when publishing the documented stable download URL.
  Copy-Item -LiteralPath $bridgeVersionedZip -Destination $bridgeStableZip
}

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

$artifactPaths = @($extensionZip, $bridgeVersionedZip)
if ($IncludeStableCompanionAlias) { $artifactPaths += $bridgeStableZip }
$artifacts = $artifactPaths | ForEach-Object {
  $item = Get-Item -LiteralPath $_
  [ordered]@{
    file = $item.Name
    bytes = $item.Length
    sha256 = (Get-FileHash -LiteralPath $_ -Algorithm SHA256).Hash.ToLowerInvariant()
  }
}
$pdfEngineVersion = Get-Content -LiteralPath (Join-Path $projectRoot 'native-host\pdffigures2\VERSION.json') -Raw | ConvertFrom-Json
$runtimeVersion = Get-Content -LiteralPath (Join-Path $projectRoot 'native-host\runtime-version.json') -Raw | ConvertFrom-Json
$releaseMetadata = [ordered]@{
  product = 'Brevess'
  version = $version
  builtAt = (Get-Date).ToUniversalTime().ToString('o')
  catalogExtensionIds = $catalogIds
  localCompanion = [ordered]@{
    nativeHostId = 'com.sci_reader.codex_bridge'
    pdffigures2Version = $pdfEngineVersion.version
    pdffigures2Commit = $pdfEngineVersion.commit
    temurinVersion = $runtimeVersion.version
  }
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
if ($IncludeStableCompanionAlias) { Write-Output $bridgeStableZip }
else { Write-Output $bridgeVersionedZip }
