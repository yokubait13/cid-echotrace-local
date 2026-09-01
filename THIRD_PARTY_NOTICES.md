# Third-party notices

CID EchoTrace Local 0.10.0 bundles the following components so transcription works immediately after installation.

## whisper.cpp

- Component: `whisper-cli.exe` and its required Windows x64 runtime files
- Source: [ggml-org/whisper.cpp](https://github.com/ggml-org/whisper.cpp)
- Release: `b4938`
- License: MIT. The packaged license text is available in `resources/licenses/whisper.cpp-MIT.txt`.

## Whisper Large v3 Turbo multilingual model

- Component: `ggml-large-v3-turbo.bin`, a whisper.cpp-converted model
- Source: [ggerganov/whisper.cpp on Hugging Face](https://huggingface.co/ggerganov/whisper.cpp)
- Revision: `98aa99a0a9db05ae2342309f5096248665f7cba3`
- License metadata: MIT.

## Silero VAD model

- Component: `ggml-silero-v6.2.0.bin`, a local voice activity detection model included with the runtime.
- Source: [ggml-org/whisper-vad on Hugging Face](https://huggingface.co/ggml-org/whisper-vad)
- Revision: `9ffd54a`

## FFmpeg

- Component: `ffmpeg.exe`, provided by `ffmpeg-static@5.3.0`
- Source: [eugeneware/ffmpeg-static](https://github.com/eugeneware/ffmpeg-static)
- License: GPL-3.0-or-later. The packaged license text is available in `resources/licenses/ffmpeg-static-GPL-3.0-or-later.txt`.

## ICMV Audio Codec

- Component: `icmv.acm`, loaded only through an included x86 private ACM bridge.
- Source supplied to this project: `ICMVCODEC.MSI`, ProductName `ICMV Audio Codec`, ProductVersion `1.0.0`, Manufacturer `PCS Inc.`
- Installation behavior deliberately avoided: the MSI normally writes `msacm.ICMV=icmv.acm` under Windows `Drivers32`; CID EchoTrace does not run the MSI or make this registry change.
- Licence and signature: no licence text was embedded in the supplied MSI, and the module was not digitally signed. The distribution notice is packaged at `resources/licenses/ICMV_AUDIO_CODEC_NOTICE.txt`.
- Redistribution: confirm the rights to redistribute this codec with PCS Inc. or the applicable rights holder before shipping it beyond the licensed/authorized audience.

The runtime manifest saved at `resources/runtime-manifest.json` lists SHA-256 hashes for each bundled executable and model file. Before distributing this package commercially or under a proprietary license, obtain legal review of the applicable third-party license obligations.
