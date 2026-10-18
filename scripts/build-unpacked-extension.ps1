param(
  [string]$BuildName='Brevess-v1.0.1-build1-store-release',
  [ValidateSet('full','browser')][string]$PackageVariant='full',
  [switch]$SkipNativeHostBuild
)
$ErrorActionPreference='Stop'
$projectRoot=Split-Path -Parent $PSScriptRoot
$distRoot=Join-Path $projectRoot 'dist'
if([string]::IsNullOrWhiteSpace($BuildName)){$BuildName='Brevess-v1.0.1-build1-store-release'}
if($BuildName -notmatch '^Brevess-[A-Za-z0-9._-]+$'){throw 'Invalid local build name.'}
$target=[IO.Path]::GetFullPath((Join-Path $distRoot $BuildName))
$distPrefix=[IO.Path]::GetFullPath($distRoot).TrimEnd('\')+'\'
if(-not $target.StartsWith($distPrefix,[StringComparison]::OrdinalIgnoreCase)){throw 'Build target escaped dist.'}
if(Test-Path -LiteralPath $target){throw "Target exists; refusing to overwrite: $target"}
if($PackageVariant -eq 'full' -and -not $SkipNativeHostBuild){
  & (Join-Path $PSScriptRoot 'build-codex-native-host.ps1')
  if($LASTEXITCODE -ne 0){throw 'Unable to build the local companion.'}
}
# A shared inventory includes application entries, licenses and local installation documentation.
. (Join-Path $PSScriptRoot 'copy-release-files.ps1')
New-Item -ItemType Directory -Path $target | Out-Null
Copy-BrevessReleaseFiles -ProjectRoot $projectRoot -Target $target -Profile $PackageVariant
Write-Output $target
