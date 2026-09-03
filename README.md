# CID EchoTrace Local

CID EchoTrace Local is an offline-first audio and video transcription workspace for evidence review. It gives a graphite, field-olive, brass, and oxide-red desktop interface for batch-dropping recordings, transcribing with its already-included higher-accuracy Whisper model and NVIDIA GPU acceleration, reviewing timestamped output, and exporting TXT, SRT, or a branded PDF transcript.

CID EchoTrace Local is independently branded for CID-style case workflows. It does not reproduce U.S. Army, Department of Defense, or Army CID seals, insignia, or official branding.

The installed Windows application deliberately has no analytics, cloud API calls, external fonts, or remote transcription requests. Its local service listens only on `127.0.0.1` and invokes bundled offline command-line tools.

## What is already implemented

- Local-only browser UI with drag-and-drop audio/video intake.
- Broad local media compatibility through the bundled static FFmpeg decoder suite: MP1/MP2/MP3, WAV/RF64/W64, ICMV WAV, AAC/M4A/ALAC, AMR/AWB, GSM, Opus/Ogg/Speex, FLAC, APE, WMA, RealMedia, CAF, AIFF, DSF/DFF, DTS/AC-3/E-AC-3, and common MP4/MKV/AVI/MOV/3GP/MPEG/TS containers.
- Batch upload intake: choose or drop multiple files, which are added to one local FIFO queue and transcribed strictly one at a time.
- A right-side live processing panel with responsive decode/transcription progress, active engine, and queue status. The included model is fixed and language is detected automatically; there is no setup tab or model picker.
- A widened, frozen left evidence rail that keeps the local queue, readable source filenames, and expandable project folders available while the workspace scrolls without a visible rail scrollbar.
- Bundled `ffmpeg` audio preparation, Whisper Large v3 Turbo multilingual model, and `whisper.cpp` `whisper-cli` execution.
- Bundled official `whisper.cpp` CUDA/cuBLAS runtime for automatic NVIDIA GPU transcription, plus a private CPU runtime fallback for PCs without a compatible NVIDIA GPU.
- Included ICMV Audio Codec bridge for legacy ICMV-compressed RIFF/WAV recordings; it loads the supplied x86 ACM module privately and makes no system-wide codec installation or registry change.
- Project management directly in the left rail: create empty project folders, drag a recording onto another project to move it, or use the accessible Move to control in the library. Selecting a completed filename expands its full transcript directly below that file instead of changing tabs.
- A local library view for the active app session, grouped by project and shown as expandable project folders in the left rail. Each project can export one combined branded PDF portfolio of all completed transcripts, or be packaged into a local folder containing the original audio/video files, completed TXT/SRT/PDF exports, that PDF portfolio, and a manifest.
- Branded PDF transcript exports generated locally, with the CID EchoTrace Local name and a vector EchoTrace mark embedded directly in the document, using the same field-olive, brass, and parchment palette as the application.
- Synchronized local review playback: the active transcript segment is highlighted while audio plays, and each timestamp jumps directly to that point in the recording. Transcript search highlights every match, shows the current match count, and provides a Next control (or Enter) to move through each result.
- Local speaker differentiation: true two-channel recordings retain their separate channels through preparation and use bundled `whisper.cpp` stereo diarization to label the dominant channel as **Speaker A** or **Speaker B**; overlapping/indeterminate audio is marked clearly. Mono recordings expose an **Assign speaker** tag on each segment for reviewer-applied local labels. Renaming or assigning a label refreshes its TXT, SRT, PDF, portfolio, and project-package exports locally.
- An intentionally original visual system inspired by the *interaction pattern* of a simple Whisper GUI—rather than by WizWhisp branding, logos, images, or source code.

## Installed-app requirements

1. Windows 10/11 x64.
2. No account, network connection, model download, Node.js, Python, `ffmpeg`, `whisper-cli`, CUDA Toolkit, or ICMV codec installation is required after installing CID EchoTrace Local. The installed edition offers an installer-time choice to enable its bundled CUDA runtime; an NVIDIA display driver is all that option requires.
3. The local intake supports individual source files up to **64 GiB**. Ensure that the Windows account's app-data drive has at least the source-file size plus 1 GiB free before importing. Use NTFS or exFAT for files above 4 GiB; FAT32 cannot hold them.

The package includes an official CUDA/cuBLAS build of `whisper.cpp`, a CPU fallback build, one fixed **Whisper Large v3 Turbo multilingual** GGML model, a local Silero voice-activity model, a static FFmpeg binary, and an x86 helper plus the supplied `icmv.acm` module. When an NVIDIA GPU and driver are available and CUDA acceleration was enabled in the installer, CID EchoTrace automatically uses the CUDA engine. If a target PC has no compatible NVIDIA GPU, GPU acceleration was declined during installation, or the GPU runtime cannot initialize, it retries the same file once using the bundled CPU engine. The installed app presents no model picker and requires no runtime configuration.

### Speaker labels and their limits

For a true stereo/two-channel recording, CID EchoTrace preserves the two source channels while normalizing to 16 kHz PCM and enables the included `whisper.cpp` stereo-diarization mode. This assigns a segment to the channel with clearly higher energy: **Speaker A** for the first/left channel, **Speaker B** for the second/right channel, and **Overlapping / unclear** when neither channel dominates. These are channel labels—not a claim that a voice has been biometrically identified—and they are especially useful for dual-channel interview, call-capture, and recorder exports.

For one-channel/mono recordings, the software does not guess a person's identity. Each timestamped line instead displays **Assign speaker**, which stores a reviewer-entered label only in the local session. Click a populated tag to rename that label throughout the transcript. Both paths update the local TXT, SRT, individual PDF, portfolio PDF, and project folder package. No recording, embedding, or speaker label is sent to a service.

### ICMV Audio Codec compatibility

The supplied `ICMVCODEC.MSI` identifies itself as **ICMV Audio Codec 1.0.0** from PCS Inc. Its sole codec payload is an unsigned x86 Windows Audio Compression Manager (`icmv.acm`) module, installed traditionally as `msacm.ICMV` in the global `Drivers32` registry.

CID EchoTrace uses the bundled FFmpeg decoder first for every input. If FFmpeg cannot decode a legacy RIFF/WAV input, CID EchoTrace then uses an x86 `icmv-decode-x86.exe` bridge that loads the supplied ACM module into that one helper process, writes a temporary PCM WAV file, and returns to the local FFmpeg/Whisper pipeline. This preserves FFmpeg's native support for streams such as G.729 while retaining the ICMV bridge as a narrow compatibility fallback. No installer runs at application launch, and CID EchoTrace does not write to `System32`, the global codec registry, or a user's codec configuration.

### Broad audio decoder coverage

CID EchoTrace accepts the principal common and forensic-call audio/video containers and lets its bundled FFmpeg build identify and decode the embedded stream locally. The supplied `LAME3.100` MP3 needs no extra codec. Common AAC, AMR, GSM, Opus, WMA, FLAC, AC-3, E-AC-3, DTS, G.729-in-container, PCM, and legacy container variants are handled whenever the static decoder recognizes the source.

No general-purpose transcriber can guarantee every proprietary or encrypted format. Files requiring a vendor-only decoder, a decryption key, a nonstandard raw bitstream layout, or an unsupported proprietary ACM module are rejected with FFmpeg's local diagnosis; they are never uploaded or sent to a cloud converter. The supplied ICMV bridge remains the sole additional private proprietary codec in the package.

The ICMV path has been verified to load the supplied decoder privately. A representative ICMV-compressed WAV recording is still required to verify exact source-format coverage and transcript quality end to end. Before redistributing the package, confirm your rights to redistribute the PCS Inc. codec; the MSI provides neither embedded licence text nor a digital signature. The packaged notice is `resources/licenses/ICMV_AUDIO_CODEC_NOTICE.txt`.

## Development-only first run

Running the source project directly is a developer workflow. It requires Node.js 16.14+, local `ffmpeg` and `whisper-cli` commands on `PATH`, and a local Whisper Large v3 Turbo model at `models/ggml-large-v3-turbo.bin`.

From this folder in PowerShell:

```powershell
npm start
```

Open [http://127.0.0.1:4310](http://127.0.0.1:4310). The UI will immediately show whether the included model path is ready.

## Windows desktop package

The Windows package wraps this same local service in a native Electron window. It does **not** use an internet-hosted frontend: the window points only to its temporary `127.0.0.1` service, which is created when the app starts and shut down with the app.

Build both Windows formats after installing the development dependencies:

```powershell
npm install
npm run package:win
```

Before packaging, `prepackage:win` runs automatically. It downloads and hash-verifies the pinned `whisper.cpp` Windows x64 runtime, downloads the pinned Large v3 Turbo multilingual and local Silero VAD models, copies a static FFmpeg binary, extracts and verifies the supplied ICMV codec, builds the private x86 decoder helper, and records hashes in `vendor/runtime-manifest.json`. These build-only inputs are ignored by Git but copied into the distributable.

For a clean build of the ICMV-capable package, point `ICMV_CODEC_MSI_PATH` at the approved `ICMVCODEC.MSI` (or pass `-IcmvCodecMsiPath` directly to `scripts/prepare-bundled-runtime.ps1`). The script accepts only the pinned source-MSI and `icmv.acm` SHA-256 values; it uses an administrative extraction into a disposable build staging directory and never installs the MSI.

The build writes these distributables into `release/`:

- `CID EchoTrace Local-Setup-<version>-x64.exe` — an NSIS per-user installer with Start-menu and optional desktop shortcuts.
- `CID EchoTrace Local-Portable-<version>-x64.exe` — a no-install executable suitable for a USB drive or a one-off launch.

The application stores source media and generated exports under the current Windows user's app-data folder—not beside the installer and never within the read-only application archive. The bundled engine and model live inside the package and are selected automatically. The installed application does not create, read, or offer a model configuration file.

### Signing a Windows release

Release packaging is fail-closed: `npm run package:win` requires a Windows code-signing certificate and fails rather than producing an unsigned installer or portable executable. Use a code-signing certificate issued to the legal publisher that will distribute CID EchoTrace Local. A self-signed certificate is useful only for an internally managed test environment; it will not establish public Windows trust or remove SmartScreen warnings.

Keep the certificate and its password outside the repository. The project ignores `.pfx` and `.p12` files. Before running the release build, make the certificate available only to the build environment:

```powershell
$env:WIN_CSC_LINK = 'C:\secure-build-assets\publisher-code-signing.pfx'
$env:WIN_CSC_KEY_PASSWORD = '<certificate-password-from-your-secret-store>'
npm run package:win
Remove-Item Env:\WIN_CSC_LINK, Env:\WIN_CSC_KEY_PASSWORD
```

For CI, store the same values as protected, masked secrets rather than writing the certificate or password into `package.json`, a script, or the repository. Electron Builder then signs the application executables, the NSIS installer, and the portable executable and applies a timestamp so the signature remains valid after certificate expiry. With an EV certificate whose private key is held in a hardware token or cloud/HSM service, configure the signing provider or Windows certificate-store selection instead of exporting a `.pfx`.

After each release build, verify both distributables before publishing:

```powershell
Get-ChildItem .\release\*.exe | ForEach-Object {
  Get-AuthenticodeSignature -FilePath $_.FullName |
    Select-Object Path, Status, StatusMessage, SignerCertificate, TimeStamperCertificate
}
```

Both files must report `Status` as `Valid`, and the signer subject must match the intended publisher name.

## Privacy behavior

- The HTTP service is explicitly bound to `127.0.0.1`, not the network.
- A selected file streams into `data/incoming/`; it is never posted to a remote API.
- Local work WAVs are cleaned after each job, while one normalized PCM WAV is retained under `data/playback/` for synchronized in-app review. This copy is produced from the same local audio Whisper transcribes, so it remains browser-playable even when the source used a legacy WAV codec.
- Generated TXT/SRT/PDF files and the local review WAV stay under the app-data folder until the user clears their finished session, at which point the source, exports, and review audio are deleted together. A project package is a separate user-created copy and is retained.
- Jobs exist only in memory while the server is running. Restarting the server does not index old recordings.

## Development checks

Run the syntax check without installing anything:

```powershell
npm run check
```

## Bundled-runtime boundary

The Windows x64 installer and portable executable include the full CUDA/cuBLAS and CPU transcription runtimes, a fixed Large v3 Turbo multilingual model, the local Silero VAD model, and the isolated x86 ICMV Audio Codec bridge, so they are ready to use immediately. The installer has a dedicated CUDA-runtime activation page; it does not install a separate system-wide CUDA Toolkit. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for component licensing and the runtime manifest for the exact packaged hashes.
