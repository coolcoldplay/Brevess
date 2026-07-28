param(
  [string]$BuildName
)

if ([string]::IsNullOrWhiteSpace($BuildName)) {
  $BuildName = 'SCI' + [char]0x8BBA + [char]0x6587 +
    [char]0x9605 + [char]0x8BFB + [char]0x52A9 + [char]0x624B +
    '-v1.0.0-build1-store-release'
}

$projectRoot = Split-Path -Parent $PSScriptRoot
$distRoot = Join-Path $projectRoot 'dist'
$target = Join-Path $distRoot $BuildName

if (Test-Path -LiteralPath $target) {
  throw "Target exists; refusing to overwrite: $target"
}

New-Item -ItemType Directory -Path $target | Out-Null

& (Join-Path $PSScriptRoot 'build-codex-native-host.ps1')
if ($LASTEXITCODE -ne 0) {
  throw 'Unable to build the local Codex Native Messaging host.'
}

foreach ($directory in @('core', 'providers', 'vendor', 'icons', '_locales')) {
  Copy-Item -LiteralPath (Join-Path $projectRoot $directory) -Destination $target -Recurse
}

$nativeTarget = Join-Path $target 'native-host'
$nativeBinTarget = Join-Path $nativeTarget 'bin'
New-Item -ItemType Directory -Path $nativeBinTarget -Force | Out-Null
foreach ($file in @(
  'host.js', 'install.ps1', 'login.ps1', 'uninstall.ps1',
  'catalog-extension-ids.txt', 'Install-Brevess-Codex-Bridge.cmd',
  'Uninstall-Brevess-Codex-Bridge.cmd', 'README-STORE.md'
)) {
  Copy-Item -LiteralPath (Join-Path $projectRoot "native-host\$file") `
    -Destination $nativeTarget
}
Copy-Item -LiteralPath (
  Join-Path $projectRoot 'native-host\bin\sci-reader-codex-host.exe'
) -Destination $nativeBinTarget

foreach ($file in @(
  'manifest.json', 'background.js', 'content.js', 'content.css',
  'popup.html', 'popup.js', 'popup.css',
  'options.html', 'options.js', 'options.css',
  'offscreen.html', 'offscreen.js', 'offscreen-network-worker.js',
  'LICENSE', 'THIRD_PARTY_NOTICES.md', 'OPEN_SOURCE.md', 'README.md', 'INSTALL.md',
  'BUILD39_OPTIMIZATION.md', 'CHANGELOG-v1.0.0.md',
  'CHANGELOG-v2.4.12.md', 'CHANGELOG-v2.4.13.md',
  'CHANGELOG-v2.4.14.md', 'CHANGELOG-v2.4.15.md', 'CHANGELOG-v2.4.16.md',
  'CHANGELOG-v2.4.17.md', 'CHANGELOG-v2.4.18.md', 'CHANGELOG-v2.4.19.md',
  'CHANGELOG-v2.4.20.md', 'CHANGELOG-v2.4.21.md', 'CHANGELOG-v2.4.22.md',
  'CHANGELOG-v2.4.23.md', 'CHANGELOG-v2.4.24.md', 'CHANGELOG-v2.4.25.md',
  'CHANGELOG-v2.4.26.md', 'CHANGELOG-v2.4.27.md', 'CHANGELOG-v2.4.28.md',
  'CODEX_LOCAL_SETUP.md'
)) {
  Copy-Item -LiteralPath (Join-Path $projectRoot $file) -Destination $target
}

Write-Output $target
