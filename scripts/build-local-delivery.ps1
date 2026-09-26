param([Parameter(Mandatory=$true)][string]$BuildName,[switch]$SkipNativeHostBuild,[string]$ComponentChangeReason='', [string]$IsolatedNativeBuildManifest='')
$ErrorActionPreference='Stop'
$projectRoot=Split-Path -Parent $PSScriptRoot
if($BuildName -notmatch '^Brevess-[A-Za-z0-9._-]+$'){throw 'Invalid build name'}
$distRoot=[IO.Path]::GetFullPath((Join-Path $projectRoot 'dist'))
$releaseRoot=[IO.Path]::GetFullPath((Join-Path $distRoot $BuildName))
if(-not $releaseRoot.StartsWith($distRoot.TrimEnd('\')+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Release escaped dist'}
if(Test-Path -LiteralPath $releaseRoot){throw 'Release exists; refusing to overwrite'}
if($IsolatedNativeBuildManifest){
 if($SkipNativeHostBuild -or -not $ComponentChangeReason.Trim()){throw 'Isolated native build requires a component change reason and cannot combine with SkipNativeHostBuild'}
 $IsolatedNativeBuildManifest=[IO.Path]::GetFullPath($IsolatedNativeBuildManifest)
 & node (Join-Path $PSScriptRoot 'finalize-local-delivery.mjs') --verify-isolated-native $IsolatedNativeBuildManifest
 if($LASTEXITCODE -ne 0){throw 'Isolated native build validation failed; no staging created'}
}elseif(-not $SkipNativeHostBuild){
 & (Join-Path $PSScriptRoot 'build-codex-native-host.ps1')
 if($LASTEXITCODE -ne 0){throw 'Native build failed'}
}
New-Item -ItemType Directory -Path $releaseRoot | Out-Null
. (Join-Path $PSScriptRoot 'copy-release-files.ps1')
$browser=Join-Path $releaseRoot 'browser-extension'
$companion=Join-Path $releaseRoot 'native-companion'
Copy-BrevessReleaseFiles -ProjectRoot $projectRoot -Target $browser -Profile browser
Copy-BrevessReleaseFiles -ProjectRoot $projectRoot -Target $companion -Profile companion
$mode=if($IsolatedNativeBuildManifest){'verified-isolated'}elseif($SkipNativeHostBuild){'verified-prebuilt'}else{'rebuilt'}
$finalizeArguments=@($releaseRoot,$BuildName,$mode,$ComponentChangeReason)
if($IsolatedNativeBuildManifest){$finalizeArguments+= $IsolatedNativeBuildManifest}
& node (Join-Path $PSScriptRoot 'finalize-local-delivery.mjs') @finalizeArguments
if($LASTEXITCODE -ne 0){throw 'Release source/resource validation failed'}
Add-Type -AssemblyName System.IO.Compression.FileSystem
$artifacts=@()
foreach($package in @(@{Path=$browser;Name="$BuildName-browser.zip"},@{Path=$companion;Name="$BuildName-Windows-companion.zip"})){
 $zip=Join-Path $releaseRoot $package.Name
 [IO.Compression.ZipFile]::CreateFromDirectory($package.Path,$zip,[IO.Compression.CompressionLevel]::Optimal,$false)
 $artifacts+=@{file=$package.Name;bytes=(Get-Item -LiteralPath $zip).Length;sha256=(Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant()}
}
$fullZip=Join-Path $releaseRoot "$BuildName-full.zip"
$inputs=Get-Content -LiteralPath (Join-Path $releaseRoot 'full-archive-inputs.json') -Raw|ConvertFrom-Json
$archive=[IO.Compression.ZipFile]::Open($fullZip,[IO.Compression.ZipArchiveMode]::Create)
try{foreach($entry in $inputs){
 $source=[IO.Path]::GetFullPath([string]$entry.source)
 if(-not $source.StartsWith($releaseRoot.TrimEnd('\')+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Full ZIP input escaped release'}
 if([string]$entry.file -match '(^/|\\|:|(^|/)\.\.(/|$))'){throw 'Unsafe ZIP member path'}
 [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive,$source,[string]$entry.file,[IO.Compression.CompressionLevel]::Optimal)|Out-Null
}}finally{$archive.Dispose()}
$artifacts+=@{file=[IO.Path]::GetFileName($fullZip);bytes=(Get-Item -LiteralPath $fullZip).Length;sha256=(Get-FileHash -LiteralPath $fullZip -Algorithm SHA256).Hash.ToLowerInvariant()}
$manifestPath=Join-Path $releaseRoot 'release-manifest.json'
$release=Get-Content -LiteralPath $manifestPath -Raw|ConvertFrom-Json
$release.artifacts=$artifacts
[IO.File]::WriteAllText($manifestPath,($release|ConvertTo-Json -Depth 30),[Text.UTF8Encoding]::new($false))
Write-Output $releaseRoot
