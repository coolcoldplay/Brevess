function Copy-BrevessReleaseFiles {
  param([Parameter(Mandatory=$true)][string]$ProjectRoot,
        [Parameter(Mandatory=$true)][string]$Target,
        [ValidateSet('full','browser','store','companion')][string]$Profile='full')
  $inventoryText = & node (Join-Path $PSScriptRoot 'release-inventory.mjs') --root $ProjectRoot --profile $Profile
  if($LASTEXITCODE -ne 0){throw 'Release inventory validation failed; no files copied.'}
  $inventory = $inventoryText | ConvertFrom-Json
  $resolvedTarget=[IO.Path]::GetFullPath($Target)
  $resolvedProject=[IO.Path]::GetFullPath($ProjectRoot).TrimEnd('\')
  if(-not $resolvedTarget.StartsWith($resolvedProject+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Release staging must stay in the project.'}
  $ancestor=$resolvedTarget
  while($ancestor.Length -gt $resolvedProject.Length){
    if(Test-Path -LiteralPath $ancestor){
      if((Get-Item -LiteralPath $ancestor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Refusing linked staging path.'}
    }
    $ancestor=Split-Path -Parent $ancestor
  }
  $prefix=$resolvedTarget.TrimEnd('\')+'\'
  foreach($entry in $inventory.files){
    $destination=[IO.Path]::GetFullPath((Join-Path $Target ([string]$entry.path)))
    if(-not $destination.StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase)){throw 'Release target escaped staging directory.'}
    if(Test-Path -LiteralPath $destination){throw "Refusing to overwrite staged file: $($entry.path)"}
    $parent=Split-Path -Parent $destination
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $ProjectRoot ([string]$entry.source)) -Destination $destination
  }
}
