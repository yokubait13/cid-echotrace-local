# CID EchoTrace Local v0.10.1

This maintenance build fixes desktop shutdown and focuses the workspace on case organization and transcript review.

- Title-bar Close and the Exit menu now follow the same shutdown path. Review drafts are backed up locally before closing; interrupted processing retains its source copy for retry.
- Unsaved review drafts restore after restarting. Saving corrections updates the transcript and individual exports. A failed draft backup offers Keep open; canceling exit leaves the local service usable.
- Removed speaker assignment controls and the speaker column from transcript review.
- Simplified the workspace to a case rail and review area. Processing and engine details are available in the left rail.
- Case vocabulary remembers explicitly verified names and phrases for future recordings in that case. Select wording in a transcript, choose Remember selected wording, and save the vocabulary. Terms can be edited or removed from the case rail.
- Vocabulary guides the bundled model through its initial prompt. It does not train model weights, guarantee accuracy, or change existing transcripts. The vocabulary used is recorded with each transcription.
- Copy uses the current review text, including pending corrections. Ctrl+S saves corrections.

Validation: source syntax checks; case workflow integration tests covering persistence, exports, source preservation, retry, and vocabulary validation/isolation; real Electron tests covering clean title-bar close, draft close/recovery, menu Exit, failed-backup cancellation with a still-usable backend, vocabulary UI, and closing during bundled-engine intake.

This build is unsigned. Windows may display an unknown-publisher prompt. The normal signed packaging requirement remains enabled in the source; this artifact uses a one-time packaging override.

Limits: validation does not establish speech-recognition accuracy on real investigative recordings, courtroom admissibility, or forensic certification. Review transcription against the original recording. Existing case packages and portfolios are snapshots and must be regenerated after corrections. Legacy speaker metadata remains in previously saved records and exports.

Portable SHA-256: 5efc7ded8bc17f2e702cf5a26350817da6541ac08cacbca31c5785353d366cc8

Installer SHA-256: 64c2e5e031d4874dfbc472115b11649aac6a98089e238e1b69dcae755d561c22
