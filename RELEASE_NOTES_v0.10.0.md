# CID EchoTrace Local v0.10.0 — Case workspace

This release makes the left rail the main place to organize recordings for legal and investigative review. Cases, transcripts, and saved corrections now survive an app restart.

## Windows downloads

- **Portable x64**: run without an installer; includes the offline transcription runtime and model.
- **Setup x64**: Windows installer with shortcuts and the bundled offline runtime.
- **SHA256SUMS.txt**: checksums for verifying the downloaded release files.

**These executables are unsigned.** Windows may show an Unknown Publisher or SmartScreen warning. No publisher certificate is included. The repository's normal signed-build configuration remains enabled; this release was built with a one-time unsigned override.

## Changes

- Create empty cases, rename cases, search case names and filenames, and filter recordings by processing/review status from the left rail.
- Add recordings to a selected case, move finished or failed recordings, retry failed jobs from the retained source copy, and access review/playback/exports beside the case list.
- Export case PDF portfolios and case folders directly from the left rail. Case exports include the whole case, regardless of the current list filter.
- Save case membership, completed transcripts, speaker labels, and corrections in a local catalog. Interrupted jobs return as needing attention and can be retried.
- Save transcript corrections explicitly, with visible unsaved status. Saving refreshes individual TXT/SRT/PDF exports while retaining the original transcript and segments in the catalog.
- Improve filename readability, keyboard focus visibility, smaller-window layouts, intake feedback, runtime status, and empty-transcript error guidance.
- Keep processing local, with the included Whisper Large v3 Turbo model, NVIDIA GPU acceleration/CPU fallback, VAD, FFmpeg, and private ICMV decoding.

## Review and upgrade notes

- Catalog persistence starts with this version. Metadata from sessions that ended before persistence was introduced cannot be reconstructed automatically.
- Case packages and portfolios are snapshots. Export a new copy after transcript corrections, speaker-label changes, case renames, or moves.
- Moving a recording changes its case membership, not the original source file. Removing a local copy deletes the app's imported copy and generated review files; separately saved packages and the original file outside the app remain intact.
- Machine-generated wording and speaker labels require review against the recording. This release does not claim spoken-word accuracy or certified evidence handling.

## Validation

The automated workflow covers case creation, duplicate/invalid names, moves, saved corrections, TXT/SRT/PDF exports, portfolio/package generation, restart recovery, retry, and preservation of the synthetic source-file hash. Browser checks cover the case controls, correction saving, filters, and compact desktop layouts. A generated non-speech tone exercised the bundled NVIDIA processing and retry paths; spoken-word accuracy was not measured in this pass.
