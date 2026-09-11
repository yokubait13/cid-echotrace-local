# CID EchoTrace Local

CID EchoTrace Local is an offline-first audio and video transcription workspace for evidence review. It gives a desktop interface for batch-dropping recordings, transcribing with its already-included higher-accuracy Whisper model and NVIDIA GPU acceleration, reviewing timestamped output, and exporting TXT, SRT, or a branded PDF transcript.

CID EchoTrace Local is independently branded for CID-style case workflows. It does not reproduce U.S. Army, Department of Defense, or Army CID seals, insignia, or official branding.

The installed Windows application deliberately has no analytics, cloud API calls, external fonts, or remote transcription requests. Its local service listens only on `127.0.0.1` and invokes bundled offline command-line tools.

## What is already implemented

- Local-only browser UI with drag-and-drop audio/video intake.
- Broad local media compatibility through the bundled static FFmpeg decoder suite: MP1/MP2/MP3, WAV/RF64/W64, ICMV WAV, AAC/M4A/ALAC, AMR/AWB, GSM, Opus/Ogg/Speex, FLAC, APE, WMA, RealMedia, CAF, AIFF, DSF/DFF, DTS/AC-3/E-AC-3, and common MP4/MKV/AVI/MOV/3GP/MPEG/TS containers.
- Batch upload intake: choose or drop multiple files, which are added to one local FIFO queue and transcribed strictly one at a time.
- Processing and engine details in a collapsible section of the left rail, with active-file progress and queue status. The included model is fixed and language is detected automatically.
- A wider, independently scrolling left case rail with readable filenames, case and recording search, status filters, expandable case folders, and selected-recording actions. The main area is dedicated to intake and transcript review.
- Bundled `ffmpeg` audio preparation, Whisper Large v3 Turbo multilingual model, and `whisper.cpp` `whisper-cli` execution.
- Bundled official `whisper.cpp` CUDA/cuBLAS runtime for automatic NVIDIA GPU transcription, plus a private CPU runtime fallback for PCs without a compatible NVIDIA GPU.
- Included ICMV Audio Codec bridge for legacy ICMV-compressed RIFF/WAV recordings; it loads the supplied x86 ACM module privately and makes no system-wide codec installation or registry change.
- Case management directly in the left rail: create empty cases, rename cases, add recordings to a selected case, move finished or failed recordings using the explicit destination selector, retry failed recordings using their retained local source copy, and remove local copies with a confirmation that explains what is deleted. Selecting a completed filename opens its transcript in the central workspace. Cases with active jobs cannot be renamed, and active recordings cannot be moved.
- Case and recording metadata persist in an atomically replaced local `data/case-catalog.json`. Cases, completed transcripts, corrections, and case membership are restored on restart. Interrupted jobs appear as needing attention and can be retried. This does not reconstruct metadata from sessions that ended before catalog persistence was introduced.
- Each case can export a combined branded PDF portfolio or a local package containing imported audio/video, available TXT/SRT/PDF exports, a portfolio, and a manifest. These actions are available in the left rail and the library and apply to the whole case, regardless of the rail's current search/status filter. Existing packages are snapshots; re-export after corrections or case changes.
- Transcript corrections have an explicit **Save corrections** action and visible unsaved status. Saving updates the local transcript and individual exports. The catalog retains the pre-correction transcript and segments; imported source media is unchanged. Desktop drafts are backed up in the local profile and restored on restart. Title-bar Close and Exit wait for a draft backup and stop local processing; a failed backup offers Keep open. Browser-only sessions retain the browser unsaved-change warning.
- Branded PDF transcript exports generated locally, with the CID EchoTrace Local name and a vector EchoTrace mark embedded directly in the document, using the same field-olive, brass, and parchment palette as the application.
- Synchronized local review playback: the active transcript segment is highlighted while audio plays, and each timestamp jumps directly to that point in the recording. Transcript search highlights every match, shows the current match count, and provides a Next control (or Enter) to move through each result.
- Local speaker differentiation: true two-channel recordings retain their separate channels through preparation and use bundled `whisper.cpp` stereo diarization to label the dominant channel as **Speaker A** or **Speaker B**; overlapping/indeterminate audio is marked clearly. Mono recordings expose an **Assign speaker** tag on each segment for reviewer-applied local labels. Renaming or assigning a label refreshes individual TXT, SRT, and PDF exports. Re-export case portfolios and packages to include updated labels.

## Installed-app requirements

1. Windows 10/11 x64.
2. No account, network connection, model download, Node.js, Python, `ffmpeg`, `whisper-cli`, CUDA Toolkit, or ICMV codec installation is required after installing CID EchoTrace Local. The installed edition offers an installer-time choice to enable its bundled CUDA runtime; an NVIDIA display driver is all that option requires.
3. The local intake supports individual source files up to **64 GiB**. Ensure that the Windows account's app-data drive has at least the source-file size plus 1 GiB free before importing. Use NTFS or exFAT for files above 4 GiB; FAT32 cannot hold them.

The package includes an official CUDA/cuBLAS build of `whisper.cpp`, a CPU fallback build, one fixed **Whisper Large v3 Turbo multilingual** GGML model, a local Silero voice-activity model, a static FFmpeg binary, and an x86 helper plus the supplied `icmv.acm` module. When an NVIDIA GPU and driver are available and CUDA acceleration was enabled in the installer, CID EchoTrace automatically uses the CUDA engine. If a target PC has no compatible NVIDIA GPU, GPU acceleration was declined during installation, or the GPU runtime cannot initialize, it retries the same file once using the bundled CPU engine. The installed app presents no model picker and requires no runtime configuration.

### Speaker labels and their limits

For a true stereo/two-channel recording, CID EchoTrace preserves the two source channels while normalizing to 16 kHz PCM and enables the included `whisper.cpp` stereo-diarization mode. This assigns a segment to the channel with clearly higher energy: **Speaker A** for the first/left channel, **Speaker B** for the second/right channel, and **Overlapping / unclear** when neither channel dominates. These are channel labels—not a claim that a voice has been biometrically identified—and they are especially useful for dual-channel interview, call-capture, and recorder exports.

For one-channel/mono recordings, the software does not guess a person's identity. Each timestamped line instead displays **Assign speaker**, which saves a reviewer-entered label in the local case catalog. Click a populated tag to rename that label throughout the transcript. Both paths update the individual TXT, SRT, and PDF exports. Create a new portfolio or case package to include the latest saved labels. No recording, embedding, or speaker label is sent to a service.

### Broad audio decoder coverage

CID EchoTrace accepts the principal common and forensic-call audio/video containers and lets its bundled FFmpeg build identify and decode the embedded stream locally. The supplied `LAME3.100` MP3 needs no extra codec. Common AAC, AMR, GSM, Opus, WMA, FLAC, AC-3, E-AC-3, DTS, G.729-in-container, PCM, and legacy container variants are handled whenever the static decoder recognizes the source.

No general-purpose transcriber can guarantee every proprietary or encrypted format. Files requiring a vendor-only decoder, a decryption key, a nonstandard raw bitstream layout, or an unsupported proprietary ACM module are rejected with FFmpeg's local diagnosis; they are never uploaded or sent to a cloud converter. The supplied ICMV bridge remains the sole additional private proprietary codec in the package.

The ICMV path has been verified to load the supplied decoder privately. A representative ICMV-compressed WAV recording is still required to verify exact source-format coverage and transcript quality end to end. Before redistributing the package, confirm your rights to redistribute the PCS Inc. codec; the MSI provides neither embedded licence text nor a digital signature. The packaged notice is `resources/licenses/ICMV_AUDIO_CODEC_NOTICE.txt`.

## Development-only first run

Running the source project directly is a developer workflow. Use Node.js 18+ for the test suite. When the prepared `vendor/engine` and `vendor/models` directories are present, `npm start` uses them automatically. Otherwise, source development needs local `ffmpeg` and `whisper-cli` commands on `PATH` and a local Whisper Large v3 Turbo model at `models/ggml-large-v3-turbo.bin`.

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

## Case vocabulary

Open Vocabulary on a case in the left rail to remember verified names, places, and specialist phrases. In a transcript, select a short verified phrase and choose Remember selected wording to add it to that case vocabulary for confirmation. Save the vocabulary to apply it to future recordings in that case; remove terms to forget them.

This is local vocabulary guidance through the bundled model's initial prompt, not weight training or automatic correction of evidence. The vocabulary used is stored with each new transcription. Accuracy still requires review against the source audio.

Desktop lifecycle checks run with `npm run test:desktop`. They use isolated synthetic case profiles and exercise actual Electron windows, menu Exit, draft recovery, failed-backup cancellation, and active-intake shutdown.
