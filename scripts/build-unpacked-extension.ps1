param(
  [string]$BuildName
)

if ([string]::IsNullOrWhiteSpace($BuildName)) {
  $BuildName = 'SCI' + [char]0x8BBA + [char]0x6587 + [char]0x903B +
    [char]0x8F91 + [char]0x52A9 + [char]0x624B +
    '-v2.4.0-article-workspaces-build35'
}

$projectRoot = Split-Path -Parent $PSScriptRoot
$distRoot = Join-Path $projectRoot 'dist'
$target = Join-Path $distRoot $BuildName

if (Test-Path -LiteralPath $target) {
  throw "Target exists; refusing to overwrite: $target"
}

New-Item -ItemType Directory -Path $target | Out-Null

foreach ($directory in @('core', 'providers', 'vendor', 'icons')) {
  Copy-Item -LiteralPath (Join-Path $projectRoot $directory) -Destination $target -Recurse
}

foreach ($file in @(
  'manifest.json', 'background.js', 'content.js', 'content.css',
  'popup.html', 'popup.js', 'popup.css',
  'options.html', 'options.js', 'options.css',
  'offscreen.html', 'offscreen.js', 'offscreen-network-worker.js',
  'LICENSE', 'THIRD_PARTY_NOTICES.md', 'OPEN_SOURCE.md', 'README.md', 'INSTALL.md'
)) {
  Copy-Item -LiteralPath (Join-Path $projectRoot $file) -Destination $target
}

Write-Output $target
