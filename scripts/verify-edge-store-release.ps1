param(
  [Parameter(Mandatory = $true)]
  [string]$ReleaseRoot
)

$ErrorActionPreference = 'Stop'
$releaseRootPath = (Resolve-Path -LiteralPath $ReleaseRoot).Path
$releaseMetadataPath = Join-Path $releaseRootPath 'release-manifest.json'
if (-not (Test-Path -LiteralPath $releaseMetadataPath -PathType Leaf)) {
  throw 'release-manifest.json is missing.'
}
$release = Get-Content -LiteralPath $releaseMetadataPath -Raw -Encoding utf8 |
  ConvertFrom-Json
$extensionZip = Join-Path $releaseRootPath (
  "Brevess-v$($release.version)-Microsoft-Edge.zip"
)
if (-not (Test-Path -LiteralPath $extensionZip -PathType Leaf)) {
  throw "Microsoft Edge ZIP is missing: $extensionZip"
}

$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) (
  'brevess-edge-verify-' + [Guid]::NewGuid().ToString('N')
)
New-Item -ItemType Directory -Path $tempRoot | Out-Null
try {
  Expand-Archive -LiteralPath $extensionZip -DestinationPath $tempRoot
  $manifestPath = Join-Path $tempRoot 'manifest.json'
  if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
    throw 'manifest.json is not at the root of the Edge ZIP.'
  }
  $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding utf8 |
    ConvertFrom-Json
  if ([string]$manifest.version -ne [string]$release.version) {
    throw 'ZIP manifest version does not match release-manifest.json.'
  }
  if ($null -ne $manifest.PSObject.Properties['key']) {
    throw 'Microsoft Edge store ZIP manifest must not contain the key field.'
  }
  foreach ($required in @(
    '_locales\zh_CN\messages.json',
    '_locales\en\messages.json',
    'icons\icon128.png',
    'pdf-reader.html',
    'pdf-reader.js',
    'pdf-reader.css',
    'pdf-native-reader.mjs',
    'vendor\pdfjs\build\pdf.min.mjs',
    'vendor\pdfjs\build\pdf.worker.min.mjs',
    'offline-reader.html',
    'offline-reader.js',
    'offline-reader.css',
    'action-popup.html',
    'action-popup.js',
    'action-popup.css',
    'LICENSE',
    'THIRD_PARTY_NOTICES.md'
  )) {
    if (-not (Test-Path -LiteralPath (Join-Path $tempRoot $required) -PathType Leaf)) {
      throw "Required package file is missing: $required"
    }
  }
  $forbidden = Get-ChildItem -LiteralPath $tempRoot -Recurse -File |
    Where-Object {
      $_.Extension -in @('.exe', '.pdb', '.map', '.log') -or
      $_.FullName -match '[\\/](tests?|scripts?|output|native-host|node_modules|\.git)[\\/]'
    }
  if ($forbidden) {
    throw "Forbidden package files: $($forbidden.FullName -join ', ')"
  }

  $textExtensions = @('.js', '.json', '.html', '.css', '.md', '.txt')
  $secretMatches = @()
  Get-ChildItem -LiteralPath $tempRoot -Recurse -File |
    Where-Object { $_.Extension -in $textExtensions } |
    ForEach-Object {
      $matches = Select-String -LiteralPath $_.FullName -Encoding utf8 `
        -Pattern '(?i)(sk-[a-z0-9_-]{20,}|api[_-]?key\s*[:=]\s*["''][^"'']{12,})'
      if ($matches) {
        $secretMatches += $matches
      }
    }
  if ($secretMatches) {
    throw "Possible embedded secret found in $($secretMatches.Path -join ', ')"
  }

  foreach ($artifact in $release.artifacts) {
    $artifactPath = Join-Path $releaseRootPath ([string]$artifact.file)
    if (-not (Test-Path -LiteralPath $artifactPath -PathType Leaf)) {
      throw "Release artifact is missing: $($artifact.file)"
    }
    $actualHash = (Get-FileHash -LiteralPath $artifactPath -Algorithm SHA256).
      Hash.ToLowerInvariant()
    if ($actualHash -ne [string]$artifact.sha256) {
      throw "SHA-256 mismatch: $($artifact.file)"
    }
  }

  [pscustomobject]@{
    Release = $releaseRootPath
    Version = $release.version
    PackageBytes = (Get-Item -LiteralPath $extensionZip).Length
    PackageFiles = (Get-ChildItem -LiteralPath $tempRoot -Recurse -File).Count
    CatalogExtensionIds = ($release.catalogExtensionIds -join ', ')
    Status = 'PASS'
  } | Format-List
} finally {
  if (Test-Path -LiteralPath $tempRoot) {
    $resolvedTemp = (Resolve-Path -LiteralPath $tempRoot).Path
    $systemTemp = [System.IO.Path]::GetFullPath(
      [System.IO.Path]::GetTempPath()
    ).TrimEnd('\')
    if (-not $resolvedTemp.StartsWith(
        $systemTemp + '\brevess-edge-verify-',
        [System.StringComparison]::OrdinalIgnoreCase
      )) {
      throw 'Refusing to remove an unexpected verification directory.'
    }
    Remove-Item -LiteralPath $resolvedTemp -Recurse -Force
  }
}
