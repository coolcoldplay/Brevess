param([Parameter(Mandatory=$true)][string]$ReleaseRoot,[Parameter(Mandatory=$true)][string]$VerificationRoot)
$ErrorActionPreference='Stop'
$release=[IO.Path]::GetFullPath($ReleaseRoot)
$target=[IO.Path]::GetFullPath($VerificationRoot)
$project=[IO.Path]::GetFullPath((Split-Path -Parent (Split-Path -Parent $PSScriptRoot)))
if(-not $target.StartsWith($project.TrimEnd('\')+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Verification must stay in the project workspace'}
if(Test-Path -LiteralPath $target){throw 'Verification directory exists; refusing to overwrite'}
$manifest=Get-Content -LiteralPath (Join-Path $release 'release-manifest.json') -Raw|ConvertFrom-Json
New-Item -ItemType Directory -Path $target|Out-Null
Add-Type -AssemblyName System.IO.Compression.FileSystem
$results=@()
foreach($artifact in $manifest.artifacts){
 $zipPath=[IO.Path]::GetFullPath((Join-Path $release ([string]$artifact.file)))
 if(-not $zipPath.StartsWith($release.TrimEnd('\')+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Artifact path escaped release'}
 if((Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $artifact.sha256){throw 'ZIP hash mismatch'}
 $kind=if($artifact.file -like '*-browser.zip'){'browser'}elseif($artifact.file -like '*-companion.zip'){'companion'}elseif($artifact.file -like '*-full.zip'){'full'}else{throw 'Unknown artifact kind'}
 $directory=Join-Path $target $kind
 New-Item -ItemType Directory -Path $directory|Out-Null
 $prefix=[IO.Path]::GetFullPath($directory).TrimEnd('\')+'\'
 $seen=[Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
 $zip=[IO.Compression.ZipFile]::OpenRead($zipPath)
 try{foreach($entry in $zip.Entries){
  if($entry.FullName.EndsWith('/')){continue}
  if($entry.FullName -match '(^/|:|(^|/)\.\.(/|$))'){throw 'Unsafe archive member'}
  $dest=[IO.Path]::GetFullPath((Join-Path $directory $entry.FullName))
  if(-not $dest.StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase) -or -not $seen.Add($dest)){throw 'Escaping or duplicate archive member'}
  New-Item -ItemType Directory -Path (Split-Path -Parent $dest) -Force|Out-Null
  [IO.Compression.ZipFileExtensions]::ExtractToFile($entry,$dest,$false)
 }}finally{$zip.Dispose()}
 $infoFile=if($kind -eq 'companion'){'COMPONENT_INFO.json'}else{'PACKAGE_INFO.json'}
 $info=Get-Content -LiteralPath (Join-Path $directory $infoFile) -Raw|ConvertFrom-Json
 $bytes=0L
 foreach($file in $info.files){
  $filePath=[IO.Path]::GetFullPath((Join-Path $directory ([string]$file.file)))
  if(-not $filePath.StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase)){throw 'Metadata path escaped stage'}
  $actual=Get-Item -LiteralPath $filePath
  if($actual.Length -ne $file.bytes -or (Get-FileHash -LiteralPath $filePath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $file.sha256){throw 'Unpacked file hash mismatch'}
  $bytes+=$actual.Length
 }
 if($seen.Count -ne $info.files.Count+1){throw 'Unlisted archive files'}
 if($kind -eq 'browser' -and (Test-Path -LiteralPath (Join-Path $directory 'native-host'))){throw 'Native runtime leaked into browser-only archive'}
 $results+=@{kind=$kind;directory=$directory;zipSha256=$artifact.sha256;zipBytes=$artifact.bytes;fileCount=$seen.Count;uncompressedBytes=($bytes+(Get-Item -LiteralPath (Join-Path $directory $infoFile)).Length);hashesVerified=$true}
}
$browserResult=$results|Where-Object kind -eq 'browser'
$fullResult=$results|Where-Object kind -eq 'full'
$browserInfo=Get-Content -LiteralPath (Join-Path $browserResult.directory 'PACKAGE_INFO.json') -Raw|ConvertFrom-Json
foreach($file in $browserInfo.files){
 if((Get-FileHash -LiteralPath (Join-Path $fullResult.directory $file.file) -Algorithm SHA256).Hash.ToLowerInvariant() -ne $file.sha256){throw 'Browser code differs across delivery variants'}
}
$report=@{status='PASS';at=(Get-Date).ToUniversalTime().ToString('o');browserPayloadIdenticalAcrossVariants=$true;artifacts=$results}
[IO.File]::WriteAllText((Join-Path $target 'archive-verification.json'),($report|ConvertTo-Json -Depth 12),[Text.UTF8Encoding]::new($false))
$report|ConvertTo-Json -Depth 12
