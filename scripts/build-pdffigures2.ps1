param(
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$engineRoot = Join-Path $projectRoot 'native-host\pdffigures2'
$targetJar = Join-Path $engineRoot 'pdffigures2.jar'
$expectedJarHash = '61b97c6a456b8c993b6c716d0a5f83177dae4521242160f65a51f2ad72459a48'
$imageIoAssets = @(
  @{
    Name = 'jai-imageio-core-1.4.0.jar'
    Uri = 'https://repo1.maven.org/maven2/com/github/jai-imageio/jai-imageio-core/1.4.0/jai-imageio-core-1.4.0.jar'
    Sha256 = '8ad3c68e9efffb10ac87ff8bc589adf64b04a729c5194c079efd0643607fd72a'
  },
  @{
    Name = 'jai-imageio-jpeg2000-1.4.0.jar'
    Uri = 'https://repo1.maven.org/maven2/com/github/jai-imageio/jai-imageio-jpeg2000/1.4.0/jai-imageio-jpeg2000-1.4.0.jar'
    Sha256 = '07fb6e3a3040122b846c5e52520033175c3251e2ec8830df82f87cb21f388bb1'
  }
)
$upstreamCommit = '3d7ad46753d4a315cccd1c2bcab398380e88c534'
$sbtVersion = '1.7.1'
$sbtHash = 'e7b41f1e6cd524a11cb21a3aee8670a6ada17afbc05befa29f1c2c784f1fce58'
$buildRoot = Join-Path $projectRoot 'tmp\pdffigures2-build'
$sourceRoot = Join-Path $buildRoot 'source'
$sbtJar = Join-Path $buildRoot "sbt-launch-$sbtVersion.jar"

function Get-LowerHash([string]$Path) {
  return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Ensure-PinnedAsset([hashtable]$Asset) {
  $target = Join-Path $engineRoot $Asset.Name
  if (-not (Test-Path -LiteralPath $target -PathType Leaf)) {
    Invoke-WebRequest -Uri $Asset.Uri -OutFile $target -UseBasicParsing
  }
  $actual = Get-LowerHash $target
  if ($actual -ne $Asset.Sha256) {
    throw "Pinned PDF image decoder checksum mismatch for $($Asset.Name): $actual"
  }
}

New-Item -ItemType Directory -Path $engineRoot -Force | Out-Null
foreach ($asset in $imageIoAssets) { Ensure-PinnedAsset $asset }

if ((Test-Path -LiteralPath $targetJar -PathType Leaf) -and -not $Force) {
  $hash = Get-LowerHash $targetJar
  if ($hash -eq $expectedJarHash) {
    Write-Output $targetJar
    exit 0
  }
  throw "Existing PDFFigures2 JAR has an unexpected SHA-256: $hash"
}

New-Item -ItemType Directory -Path $buildRoot -Force | Out-Null
if (-not (Test-Path -LiteralPath $sourceRoot -PathType Container)) {
  git clone https://github.com/allenai/pdffigures2.git $sourceRoot
  if ($LASTEXITCODE -ne 0) { throw 'Unable to clone the PDFFigures2 source.' }
}
Push-Location $sourceRoot
try {
  git fetch --all --tags --prune
  if ($LASTEXITCODE -ne 0) { throw 'Unable to update the PDFFigures2 source.' }
  git checkout --detach $upstreamCommit
  if ($LASTEXITCODE -ne 0) { throw 'Unable to checkout the pinned PDFFigures2 commit.' }
} finally {
  Pop-Location
}

if (-not (Test-Path -LiteralPath $sbtJar -PathType Leaf)) {
  $sbtUri = "https://repo1.maven.org/maven2/org/scala-sbt/sbt-launch/$sbtVersion/sbt-launch-$sbtVersion.jar"
  Invoke-WebRequest -Uri $sbtUri -OutFile $sbtJar -UseBasicParsing
}
$actualSbtHash = Get-LowerHash $sbtJar
if ($actualSbtHash -ne $sbtHash) {
  throw "SBT launcher checksum mismatch: $actualSbtHash"
}

$java = if ($env:JAVA_HOME) {
  Join-Path $env:JAVA_HOME 'bin\java.exe'
} else {
  (Get-Command java.exe -ErrorAction Stop).Source
}
Push-Location $sourceRoot
try {
  & $java -jar $sbtJar assembly
  if ($LASTEXITCODE -ne 0) { throw 'PDFFigures2 assembly failed.' }
} finally {
  Pop-Location
}

$builtJar = Join-Path $sourceRoot 'pdffigures2.jar'
if (-not (Test-Path -LiteralPath $builtJar -PathType Leaf)) {
  throw 'PDFFigures2 did not produce pdffigures2.jar.'
}
$actualJarHash = Get-LowerHash $builtJar
if ($actualJarHash -ne $expectedJarHash) {
  throw "PDFFigures2 JAR checksum mismatch: $actualJarHash"
}
Copy-Item -LiteralPath $builtJar -Destination $targetJar -Force
Copy-Item -LiteralPath (Join-Path $sourceRoot 'LICENSE.txt') `
  -Destination (Join-Path $engineRoot 'LICENSE.txt') -Force
Write-Output $targetJar
