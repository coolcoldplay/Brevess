param(
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$hostRoot = Join-Path $projectRoot 'native-host'
$binRoot = Join-Path $hostRoot 'bin'
$blobPath = Join-Path $binRoot 'brevess-codex-host.blob'
$executablePath = Join-Path $binRoot 'brevess-codex-host.exe'

New-Item -ItemType Directory -Path $binRoot -Force | Out-Null

Push-Location $projectRoot
try {
  node --experimental-sea-config native-host/sea-config.json
  if ($LASTEXITCODE -ne 0) { throw 'Unable to create the Node SEA blob.' }

  $nodeExecutable = (Get-Command node.exe -ErrorAction Stop).Source
  Copy-Item -LiteralPath $nodeExecutable -Destination $executablePath -Force

  $signTool = Get-Command signtool.exe -ErrorAction SilentlyContinue
  if ($signTool) {
    & $signTool.Source remove /s $executablePath | Out-Null
  }

  npx --no-install postject $executablePath NODE_SEA_BLOB $blobPath `
    --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2 `
    --overwrite
  if ($LASTEXITCODE -ne 0) { throw 'Unable to inject the Node SEA blob.' }
} finally {
  Pop-Location
}

Write-Output $executablePath
