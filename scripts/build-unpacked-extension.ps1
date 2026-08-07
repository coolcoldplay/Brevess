param(
  [string]$BuildName
)

if ([string]::IsNullOrWhiteSpace($BuildName)) {
  $BuildName = 'Brevess-v1.0.0-build1-store-release'
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
  Join-Path $projectRoot 'native-host\bin\brevess-codex-host.exe'
) -Destination $nativeBinTarget
foreach ($directory in @('pdffigures2', 'runtime')) {
  Copy-Item -LiteralPath (Join-Path $projectRoot "native-host\$directory") `
    -Destination $nativeTarget -Recurse
}
Copy-Item -LiteralPath (Join-Path $projectRoot 'native-host\runtime-version.json') `
  -Destination $nativeTarget

foreach ($file in @(
  'manifest.json', 'background.js', 'content.js', 'content.css',
  'popup.html', 'popup.js', 'popup.css',
  'logic-map.html', 'logic-map.js', 'logic-map.css',
  'pdf-reader.html', 'pdf-reader.js', 'pdf-reader.css',
  'options.html', 'options.js', 'options.css',
  'offscreen.html', 'offscreen.js', 'offscreen-network-worker.js',
  'LICENSE', 'THIRD_PARTY_NOTICES.md', 'OPEN_SOURCE.md', 'README.md', 'INSTALL.md',
  'BUILD39_OPTIMIZATION.md', 'CODEX_LOCAL_SETUP.md'
)) {
  Copy-Item -LiteralPath (Join-Path $projectRoot $file) -Destination $target
}

$docsTarget = Join-Path $target 'docs'
New-Item -ItemType Directory -Path $docsTarget -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $projectRoot 'docs\changelog') `
  -Destination $docsTarget -Recurse

Write-Output $target
