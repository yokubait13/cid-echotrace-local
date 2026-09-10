# Case workspace validation — September 10, 2026

The changes were tested in isolated temporary data directories using synthetic fixtures. User case files were not used for testing.

## Automated workflow

Run `npm test` (Node.js 18+). The integration test starts a real local HTTP service and verifies:

- Empty-case creation, duplicate-name and invalid-name rejection.
- Moving a recording, rejecting a nonexistent destination, and renaming its case.
- Saving transcript corrections and rejecting unknown segment IDs.
- TXT, SRT, and PDF responses contain the saved corrections.
- Portfolio download and case-package generation succeed.
- Original transcript segments remain in the catalog after corrections.
- SHA-256 of the synthetic source recording stays unchanged.
- A fresh server process restores cases, file membership, and corrections.
- Interrupted jobs become actionable failures; retry accepts failed jobs and rejects completed ones.

`npm run check` checks the server, renderer, Electron host, and preload syntax. `git diff --check` checks patch whitespace.

## Browser checks

The local interface was exercised with actual clicks and form input:

- Create an empty case, expand a case, open a recording, and move it to the new case.
- Edit a transcript segment and select Save corrections; the corrected text appears and the save button returns to its disabled state.
- Filter by Needs attention and search by filename.
- Rename the case and verify the case label and intake destination update.
- Inspect the layout at 1280 × 720 and 1080 × 680. The left rail remains usable and scrolls independently; the secondary right panel is hidden at the smaller size.
- Retry an actual failed engine job from the left rail; the status changes to Processing with progress, and Move file is disabled during processing.

## Bundled engine check and limits

The prepared FFmpeg, Whisper model, VAD model, ICMV bridge, and NVIDIA GPU runtime reported ready. A three-second generated tone was imported through the real API and processed on the NVIDIA GPU. It produced no readable speech text and appeared as Needs attention; retry used the retained source copy. The empty-output error now gives recovery guidance.

The machine's speech synthesizer did not provide a usable voice, so this pass did not measure spoken-word transcription accuracy. Review/edit/export tests use a clearly labeled synthetic transcript fixture.

## Windows release v0.10.0

The NSIS installer and portable x64 executable were built with Electron 28.3.3 and the prepared offline runtime. Both report Authenticode `NotSigned`; a one-time unsigned command override was used without changing the repository's normal signing requirement.

The packaged `app.asar` reports version 0.10.0. The server, renderer JS/CSS/HTML, Electron host/preload, and LICENSE match the source files byte for byte. The packaged application started successfully with an isolated temporary profile, reported the bundled engine/model/GPU/VAD/ICMV components ready, and saved a case created through the browser interface. The actual portable executable then extracted, started with that same temporary profile, restored the saved case, and reported its local runtime ready. No user case data was used.

SHA-256 checksums are supplied with the release as `SHA256SUMS.txt`. The installer was built and hashed; an installation/uninstallation cycle was not performed.
