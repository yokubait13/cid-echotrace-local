[CmdletBinding()]
param(
    [switch]$Force,
    [string]$IcmvCodecMsiPath = $env:ICMV_CODEC_MSI_PATH
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

# Pinned, auditable inputs for the x64 offline runtime. The CUDA archive
# contains the Windows CUDA/cuBLAS dependencies required for a truly
# standalone NVIDIA build; no CUDA Toolkit install is needed on the target PC.
$WhisperRelease = 'b4938'
$WhisperCpuArchiveSha256 = 'c2a4b60edb11f7e11a9191ffb50929535527d4d91c9903dbe3e554583bbbc63d'
$WhisperCpuArchiveUrl = "https://github.com/ggml-org/whisper.cpp/releases/download/$WhisperRelease/whisper-bin-x64.zip"
$WhisperCudaArchiveSha256 = 'c1b17166e1e31a91cc8e9c1f910d3785e3ce757bb2958bf9dce13fdb4880005f'
$WhisperCudaArchiveUrl = "https://github.com/ggml-org/whisper.cpp/releases/download/$WhisperRelease/whisper-cublas-12.4.0-bin-x64.zip"
$ModelRevision = '98aa99a0a9db05ae2342309f5096248665f7cba3'
$ModelUrl = "https://huggingface.co/ggerganov/whisper.cpp/resolve/$ModelRevision/ggml-large-v3-turbo.bin?download=true"
$ModelSha256 = '1fc70f774d38eb169993ac391eea357ef47c88757ef72ee5943879b7e8e2bc69'
$VadRevision = '9ffd54a'
$VadUrl = "https://huggingface.co/ggml-org/whisper-vad/resolve/$VadRevision/ggml-silero-v6.2.0.bin?download=true"
$VadSha256 = '2aa269b785eeb53a82983a20501ddf7c1d9c48e33ab63a41391ac6c9f7fb6987'
$IcmvMsiSha256 = '7454cb13213c5a0bbf4595e68ca98d34637ea170a4a3107b5b6135d2d0175aaf'
$IcmvCodecSha256 = '9af8adadebe9013b9cf8a62115e43184f22a81b3afd283f6e84bfa9bdd8f8886'

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$VendorRoot = Join-Path $ProjectRoot 'vendor'
$DownloadRoot = Join-Path $VendorRoot 'downloads'
$EngineRoot = Join-Path $VendorRoot 'engine'
$WhisperCpuRoot = Join-Path $EngineRoot 'whisper-cpu'
$WhisperCudaRoot = Join-Path $EngineRoot 'whisper-cuda'
$LegacyWhisperRoot = Join-Path $EngineRoot 'whisper'
$FfmpegRoot = Join-Path $EngineRoot 'ffmpeg'
$IcmvRoot = Join-Path $EngineRoot 'icmv'
$ModelRoot = Join-Path $VendorRoot 'models'
$LicenseRoot = Join-Path $VendorRoot 'licenses'
$ManifestPath = Join-Path $VendorRoot 'runtime-manifest.json'

function Get-Sha256Hex {
    param([Parameter(Mandatory = $true)][string]$Path)

    $hasher = [System.Security.Cryptography.SHA256]::Create()
    $stream = [System.IO.File]::OpenRead($Path)
    try {
        return ([System.BitConverter]::ToString($hasher.ComputeHash($stream))).Replace('-', '').ToLowerInvariant()
    }
    finally {
        $stream.Dispose()
        $hasher.Dispose()
    }
}

function Get-VerifiedDownload {
    param(
        [Parameter(Mandatory = $true)][string]$Uri,
        [Parameter(Mandatory = $true)][string]$Destination,
        [string]$ExpectedSha256
    )

    if ($Force -or -not (Test-Path -LiteralPath $Destination -PathType Leaf)) {
        Write-Host "Downloading $(Split-Path -Leaf $Destination)..."
        Invoke-WebRequest -Uri $Uri -OutFile $Destination
    }
    if ($ExpectedSha256) {
        $actual = Get-Sha256Hex -Path $Destination
        if ($actual -ne $ExpectedSha256.ToLowerInvariant()) {
            throw "SHA-256 verification failed for $(Split-Path -Leaf $Destination)."
        }
    }
}

New-Item -ItemType Directory -Force -Path $DownloadRoot, $EngineRoot, $IcmvRoot, $ModelRoot, $LicenseRoot | Out-Null

function Install-WhisperRuntime {
    param(
        [Parameter(Mandatory = $true)][string]$Archive,
        [Parameter(Mandatory = $true)][string]$Root
    )

    $expectedCli = Join-Path $Root 'whisper-cli.exe'
    if (-not $Force -and (Test-Path -LiteralPath $expectedCli -PathType Leaf)) {
        return $expectedCli
    }
    $staging = Join-Path $VendorRoot ("whisper-staging-" + [Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Force -Path $staging | Out-Null
    try {
        Expand-Archive -LiteralPath $Archive -DestinationPath $staging -Force
        $cli = Get-ChildItem -LiteralPath $staging -Filter 'whisper-cli.exe' -Recurse -File | Select-Object -First 1
        if (-not $cli) { throw 'The official whisper.cpp archive did not contain whisper-cli.exe.' }
        if (Test-Path -LiteralPath $Root) { Remove-Item -LiteralPath $Root -Force -Recurse }
        New-Item -ItemType Directory -Force -Path $Root | Out-Null
        Get-ChildItem -LiteralPath $cli.Directory.FullName -Force | Copy-Item -Destination $Root -Force -Recurse
    }
    finally {
        Remove-Item -LiteralPath $staging -Force -Recurse -ErrorAction SilentlyContinue
    }
    return $expectedCli
}

$WhisperCpuArchive = Join-Path $DownloadRoot "whisper-$WhisperRelease-cpu-x64.zip"
$WhisperCudaArchive = Join-Path $DownloadRoot "whisper-$WhisperRelease-cuda-12.4-x64.zip"
Get-VerifiedDownload -Uri $WhisperCpuArchiveUrl -Destination $WhisperCpuArchive -ExpectedSha256 $WhisperCpuArchiveSha256
Get-VerifiedDownload -Uri $WhisperCudaArchiveUrl -Destination $WhisperCudaArchive -ExpectedSha256 $WhisperCudaArchiveSha256
$expectedCpuCli = Install-WhisperRuntime -Archive $WhisperCpuArchive -Root $WhisperCpuRoot
$expectedCudaCli = Install-WhisperRuntime -Archive $WhisperCudaArchive -Root $WhisperCudaRoot
if (Test-Path -LiteralPath $LegacyWhisperRoot) { Remove-Item -LiteralPath $LegacyWhisperRoot -Force -Recurse }

$ffmpegSource = Join-Path $ProjectRoot 'node_modules\ffmpeg-static\ffmpeg.exe'
$ffmpegTarget = Join-Path $FfmpegRoot 'ffmpeg.exe'
if (-not (Test-Path -LiteralPath $ffmpegSource -PathType Leaf)) {
    throw 'ffmpeg-static is missing. Run npm install before preparing the bundled offline runtime.'
}
if ($Force -or -not (Test-Path -LiteralPath $ffmpegTarget -PathType Leaf)) {
    New-Item -ItemType Directory -Force -Path $FfmpegRoot | Out-Null
    Copy-Item -LiteralPath $ffmpegSource -Destination $ffmpegTarget -Force
}

# ICMV is a supplied legacy x86 ACM codec. It is never installed by the app:
# the x86 bridge loads it privately for a single conversion process. To make a
# fresh release, provide the verified source MSI with -IcmvCodecMsiPath or
# ICMV_CODEC_MSI_PATH. Existing verified runtime payloads can be reused.
$icmvTarget = Join-Path $IcmvRoot 'icmv.acm'
if ($IcmvCodecMsiPath) {
    if (-not (Test-Path -LiteralPath $IcmvCodecMsiPath -PathType Leaf)) {
        throw "The requested ICMV codec MSI was not found: $IcmvCodecMsiPath"
    }
    if ((Get-Sha256Hex -Path $IcmvCodecMsiPath) -ne $IcmvMsiSha256) {
        throw 'The supplied ICMV codec MSI does not match the approved SHA-256.'
    }
    $icmvStaging = Join-Path $VendorRoot ("icmv-staging-" + [Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Force -Path $icmvStaging | Out-Null
    try {
        $install = Start-Process -FilePath 'msiexec.exe' -ArgumentList @('/a', ('"' + (Resolve-Path -LiteralPath $IcmvCodecMsiPath).Path + '"'), '/qn', ('TARGETDIR="' + $icmvStaging + '"')) -Wait -PassThru -WindowStyle Hidden
        if ($install.ExitCode -ne 0) { throw "ICMV MSI administrative extraction failed with exit code $($install.ExitCode)." }
        $extractedIcmv = Get-ChildItem -LiteralPath $icmvStaging -Filter 'icmv.acm' -Recurse -File | Select-Object -First 1
        if (-not $extractedIcmv) { throw 'The supplied ICMV MSI did not contain icmv.acm.' }
        Copy-Item -LiteralPath $extractedIcmv.FullName -Destination $icmvTarget -Force
    }
    finally {
        Remove-Item -LiteralPath $icmvStaging -Force -Recurse -ErrorAction SilentlyContinue
    }
}
if (-not (Test-Path -LiteralPath $icmvTarget -PathType Leaf)) {
    throw 'The ICMV codec runtime is missing. Supply the verified ICMVCODEC.MSI with -IcmvCodecMsiPath or ICMV_CODEC_MSI_PATH before packaging.'
}
if ((Get-Sha256Hex -Path $icmvTarget) -ne $IcmvCodecSha256) {
    throw 'The bundled icmv.acm does not match the approved SHA-256.'
}
$icmvHelper = Join-Path $IcmvRoot 'icmv-decode-x86.exe'
$icmvHelperSource = Join-Path $ProjectRoot 'native\IcmvDecode.cs'
if ($Force -or -not (Test-Path -LiteralPath $icmvHelper -PathType Leaf) -or (Get-Item -LiteralPath $icmvHelperSource).LastWriteTimeUtc -gt (Get-Item -LiteralPath $icmvHelper).LastWriteTimeUtc) {
    & (Join-Path $PSScriptRoot 'build-icmv-helper.ps1') -OutputPath $icmvHelper
    if ($LASTEXITCODE -ne 0) { throw "The ICMV decoder helper build exited with $LASTEXITCODE." }
}

$modelTarget = Join-Path $ModelRoot 'ggml-large-v3-turbo.bin'
Get-VerifiedDownload -Uri $ModelUrl -Destination $modelTarget -ExpectedSha256 $ModelSha256
$vadTarget = Join-Path $ModelRoot 'ggml-silero-v6.2.0.bin'
Get-VerifiedDownload -Uri $VadUrl -Destination $vadTarget -ExpectedSha256 $VadSha256
# The product has one fixed included model. Once the higher-accuracy model is
# fully verified, remove the superseded Base payload so it cannot inflate the
# installed package or become an accidental configuration choice.
$legacyModelTarget = Join-Path $ModelRoot 'ggml-base.bin'
if (Test-Path -LiteralPath $legacyModelTarget -PathType Leaf) {
    Remove-Item -LiteralPath $legacyModelTarget -Force
}

$ffmpegLicense = Join-Path $ProjectRoot 'node_modules\ffmpeg-static\LICENSE'
if (Test-Path -LiteralPath $ffmpegLicense -PathType Leaf) {
    Copy-Item -LiteralPath $ffmpegLicense -Destination (Join-Path $LicenseRoot 'ffmpeg-static-GPL-3.0-or-later.txt') -Force
}
Get-VerifiedDownload -Uri 'https://raw.githubusercontent.com/ggml-org/whisper.cpp/master/LICENSE' -Destination (Join-Path $LicenseRoot 'whisper.cpp-MIT.txt')
Copy-Item -LiteralPath (Join-Path $ProjectRoot 'licenses\ICMV_AUDIO_CODEC_NOTICE.txt') -Destination (Join-Path $LicenseRoot 'ICMV_AUDIO_CODEC_NOTICE.txt') -Force

$manifest = [ordered]@{
    generatedAt = (Get-Date).ToUniversalTime().ToString('o')
    whisperCpp = [ordered]@{
        release = $WhisperRelease
        cpu = [ordered]@{
            archiveSha256 = Get-Sha256Hex -Path $WhisperCpuArchive
            cliSha256 = Get-Sha256Hex -Path $expectedCpuCli
        }
        cuda = [ordered]@{
            cudaRuntime = '12.4.0'
            archiveSha256 = Get-Sha256Hex -Path $WhisperCudaArchive
            cliSha256 = Get-Sha256Hex -Path $expectedCudaCli
        }
    }
    ffmpeg = [ordered]@{
        sourcePackage = 'ffmpeg-static@5.3.0'
        binarySha256 = Get-Sha256Hex -Path $ffmpegTarget
    }
    icmvAudioCodec = [ordered]@{
        productName = 'ICMV Audio Codec 1.0.0'
        sourceMsiSha256 = $IcmvMsiSha256
        moduleSha256 = Get-Sha256Hex -Path $icmvTarget
        helperSha256 = Get-Sha256Hex -Path $icmvHelper
        architecture = 'x86; loaded privately by icmv-decode-x86.exe'
    }
    model = [ordered]@{
        name = 'Whisper Large v3 Turbo multilingual (ggml-large-v3-turbo.bin)'
        sourceRevision = $ModelRevision
        fileSha256 = Get-Sha256Hex -Path $modelTarget
    }
    voiceActivityDetection = [ordered]@{
        name = 'Silero VAD 6.2.0 (ggml-silero-v6.2.0.bin)'
        sourceRevision = $VadRevision
        fileSha256 = Get-Sha256Hex -Path $vadTarget
    }
}
$manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $ManifestPath -Encoding utf8

Write-Host 'Bundled offline runtime is ready.'
Get-ChildItem -LiteralPath $VendorRoot -Recurse -File | Measure-Object -Property Length -Sum | ForEach-Object {
    Write-Host ("Runtime payload: {0:N1} MB" -f ($_.Sum / 1MB))
}
