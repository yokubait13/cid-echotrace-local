[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$OutputPath
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$SourcePath = Join-Path $ProjectRoot 'native\IcmvDecode.cs'
$CscPath = 'C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe'

if (-not (Test-Path -LiteralPath $SourcePath -PathType Leaf)) {
    throw "The ICMV decoder source was not found: $SourcePath"
}
if (-not (Test-Path -LiteralPath $CscPath -PathType Leaf)) {
    throw 'The Windows .NET Framework x86 C# compiler is required to build the ICMV decoder helper.'
}

$outputDirectory = Split-Path -Parent $OutputPath
New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null
& $CscPath /nologo /target:exe /platform:x86 /optimize+ /out:$OutputPath $SourcePath
if ($LASTEXITCODE -ne 0) {
    throw "The ICMV decoder helper compiler exited with $LASTEXITCODE."
}
