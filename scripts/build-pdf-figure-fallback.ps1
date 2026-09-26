param([switch]$Force)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$source = Join-Path $projectRoot 'native-host\pdf-fallback\BrevessPdfFallback.java'
$engineRoot = Join-Path $projectRoot 'native-host\pdffigures2'
$dependencyJar = Join-Path $engineRoot 'pdffigures2.jar'
$targetJar = Join-Path $engineRoot 'brevess-pdf-fallback.jar'
$classes = Join-Path $projectRoot 'tmp\pdf-fallback-classes'

if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
  throw "PDF fallback source is missing: $source"
}
if (-not (Test-Path -LiteralPath $dependencyJar -PathType Leaf)) {
  throw "Build PDFFigures2 before the PDF fallback helper: $dependencyJar"
}
if ((Test-Path -LiteralPath $targetJar -PathType Leaf) -and -not $Force -and
    (Get-Item -LiteralPath $targetJar).LastWriteTimeUtc -ge
      (Get-Item -LiteralPath $source).LastWriteTimeUtc) {
  Write-Output $targetJar
  exit 0
}

$javaHomeJavac = if ($env:JAVA_HOME) {
  Join-Path $env:JAVA_HOME 'bin\javac.exe'
} else { '' }
$javaHomeJar = if ($env:JAVA_HOME) {
  Join-Path $env:JAVA_HOME 'bin\jar.exe'
} else { '' }
$pathJavacCommand = Get-Command javac.exe -ErrorAction SilentlyContinue
$pathJarCommand = Get-Command jar.exe -ErrorAction SilentlyContinue
$pathJavac = if ($pathJavacCommand) { $pathJavacCommand.Source } else { '' }
$pathJar = if ($pathJarCommand) { $pathJarCommand.Source } else { '' }
$javac = @(
  $javaHomeJavac, $pathJavac
) | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) } |
  Select-Object -First 1
$jarTool = @(
  $javaHomeJar, $pathJar
) | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) } |
  Select-Object -First 1
if (-not $javac -or -not $jarTool) {
  throw 'JDK 8 javac.exe and jar.exe are required to build the PDF fallback helper.'
}

if (Test-Path -LiteralPath $classes) {
  Remove-Item -LiteralPath $classes -Recurse -Force
}
New-Item -ItemType Directory -Path $classes -Force | Out-Null
& $javac -encoding UTF-8 -source 1.8 -target 1.8 -cp $dependencyJar -d $classes $source
if ($LASTEXITCODE -ne 0) { throw 'Unable to compile the PDF fallback helper.' }
if (Test-Path -LiteralPath $targetJar) { Remove-Item -LiteralPath $targetJar -Force }
& $jarTool cf $targetJar -C $classes .
if ($LASTEXITCODE -ne 0) { throw 'Unable to package the PDF fallback helper.' }
Write-Output $targetJar
