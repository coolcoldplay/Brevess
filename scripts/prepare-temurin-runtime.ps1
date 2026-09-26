param(
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$runtimeRoot = Join-Path $projectRoot 'native-host\runtime'
$archive = Join-Path $projectRoot 'tmp\OpenJDK8U-jre_x64_windows_hotspot_8u492b09.zip'
$staging = Join-Path $projectRoot 'tmp\temurin-jre-package'
$uri = 'https://github.com/adoptium/temurin8-binaries/releases/download/jdk8u492-b09/OpenJDK8U-jre_x64_windows_hotspot_8u492b09.zip'
$expectedHash = 'bb25b002556afc7ef158cd95ec6270dddb3eecba69acdd7abb9d28b2e9ff0f5e'
$java = Join-Path $runtimeRoot 'bin\java.exe'

if ((Test-Path -LiteralPath $java -PathType Leaf) -and -not $Force) {
  Write-Output $runtimeRoot
  exit 0
}
New-Item -ItemType Directory -Path (Split-Path -Parent $archive) -Force | Out-Null
if (-not (Test-Path -LiteralPath $archive -PathType Leaf)) {
  Invoke-WebRequest -Uri $uri -OutFile $archive -UseBasicParsing
}
$actualHash = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actualHash -ne $expectedHash) {
  throw "Temurin archive checksum mismatch: $actualHash"
}
if (Test-Path -LiteralPath $staging) {
  $resolvedStaging = [System.IO.Path]::GetFullPath($staging)
  $resolvedTmp = [System.IO.Path]::GetFullPath((Join-Path $projectRoot 'tmp'))
  if (-not $resolvedStaging.StartsWith($resolvedTmp.TrimEnd('\') + '\')) {
    throw 'Temurin staging path escaped the project tmp directory.'
  }
  Remove-Item -LiteralPath $staging -Recurse -Force
}
Expand-Archive -LiteralPath $archive -DestinationPath $staging
$source = Get-ChildItem -LiteralPath $staging -Directory | Select-Object -First 1
if (-not $source) { throw 'Temurin archive did not contain a runtime directory.' }
if (Test-Path -LiteralPath $runtimeRoot) {
  $resolvedRuntime = [System.IO.Path]::GetFullPath($runtimeRoot)
  $resolvedHost = [System.IO.Path]::GetFullPath((Join-Path $projectRoot 'native-host'))
  if (-not $resolvedRuntime.StartsWith($resolvedHost.TrimEnd('\') + '\')) {
    throw 'Temurin runtime target escaped the native-host directory.'
  }
  Remove-Item -LiteralPath $runtimeRoot -Recurse -Force
}
Move-Item -LiteralPath $source.FullName -Destination $runtimeRoot
Write-Output $runtimeRoot
