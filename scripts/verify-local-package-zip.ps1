param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^Brevess-[A-Za-z0-9._-]+$')]
  [string]$BuildName
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$repoPath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$stagePath = Join-Path $repoPath "dist/$BuildName"
$zipPath = "$stagePath.zip"
$stagePrefix = $stagePath.TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar
$expected = @{}
foreach ($file in Get-ChildItem -LiteralPath $stagePath -Recurse -File -Force) {
  $relative = $file.FullName.Substring($stagePrefix.Length).Replace('\', '/')
  $expected[$relative] = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
}
$seen = @{}
$archive = [IO.Compression.ZipFile]::OpenRead($zipPath)
try {
  foreach ($entry in $archive.Entries) {
    $name = $entry.FullName.Replace('\', '/')
    if ($name.StartsWith('/') -or $name -match '(^|/)\.\.(/|$)' -or $name.Contains(':')) {
      throw "Unsafe ZIP entry: $name"
    }
    if ($name.EndsWith('/')) { continue }
    if ($seen.ContainsKey($name)) { throw "Duplicate ZIP entry: $name" }
    if (-not $expected.ContainsKey($name)) { throw "Unexpected ZIP entry: $name" }
    $stream = $entry.Open()
    $sha = [Security.Cryptography.SHA256]::Create()
    try {
      $digest = [BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-', '').ToLowerInvariant()
    } finally {
      $sha.Dispose()
      $stream.Dispose()
    }
    if ($digest -ne $expected[$name]) { throw "ZIP file hash mismatch: $name" }
    $seen[$name] = $digest
  }
} finally {
  $archive.Dispose()
}
if ($seen.Count -ne $expected.Count) { throw "ZIP missing files: expected $($expected.Count), got $($seen.Count)" }
if (-not $seen.ContainsKey('manifest.json')) { throw 'Manifest must be at ZIP root' }
$manifest = Get-Content -LiteralPath (Join-Path $stagePath 'manifest.json') -Raw | ConvertFrom-Json
$zipHash = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()
$receipt = [ordered]@{
  status = 'PASS'
  build = $BuildName
  version = $manifest.version
  verifiedAt = [DateTime]::UtcNow.ToString('o')
  zipPath = $zipPath
  zipBytes = (Get-Item -LiteralPath $zipPath).Length
  sha256 = $zipHash
  verifiedFiles = $seen.Count
  everyExtractedFileMatchesStage = $true
  manifestAtRoot = $true
}
$json = $receipt | ConvertTo-Json -Depth 4
[IO.File]::WriteAllText("$stagePath-release.json", $json, [Text.UTF8Encoding]::new($false))
[IO.File]::WriteAllText("$zipPath.sha256", "$zipHash  $BuildName.zip`n", [Text.UTF8Encoding]::new($false))
Write-Output $json
