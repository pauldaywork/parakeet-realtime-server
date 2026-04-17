# parakeet-realtime-server

Streaming HTTP + WebSocket server wrapping NVIDIA Parakeet Realtime EOU
(120M) via [parakeet-rs](https://github.com/altunenes/parakeet-rs).
Cache-aware streaming ASR with end-of-utterance detection, designed to
drop into any app that needs low-latency transcription.

## Highlights

- ~160 ms chunked streaming over WebSocket, partial text emitted per chunk
- `[EOU]` end-of-utterance detection → `final` events, decoder cache resets
- Plain HTTP endpoint for batch WAV transcription
- Single ~5 MB Rust binary, dynamically loads onnxruntime
- CUDA 12.x acceleration on Windows x64

## Quick start (pre-built binary)

1. Download `parakeet-realtime-server-v0.1.0-win-x64.zip` from the
   [latest release](https://github.com/pauldaywork/parakeet-realtime-server/releases/latest).
2. Unzip into a folder of your choice (call it `<install>`).
3. Clone this repo anywhere and copy `scripts/` into `<install>/scripts/`
   (or just download the four PowerShell scripts individually).
4. In `<install>`:

```powershell
.\scripts\fetch-cuda-deps.ps1      # one-time, ~2 GB of NVIDIA DLLs
.\scripts\download-models.ps1      # one-time, ~480 MB of ONNX weights
.\parakeet-realtime-server.exe --model-dir models --port 9005
```

Health check: `curl http://127.0.0.1:9005/health` should return `{"ready":true}` after warm-up.

## Build from source

### Prerequisites (Windows x64)

- **Rust stable** — install via [rustup](https://rustup.rs) (`rustup default stable-x86_64-pc-windows-msvc`)
- **Visual Studio 2022 Build Tools** with the "Desktop development with C++" workload
- **CUDA 12.x toolkit** (set `CUDA_PATH`)
- **cuDNN 9.x** DLLs (the `fetch-cuda-deps.ps1` script grabs these)
- **7-Zip** on PATH (needed by `fetch-cuda-deps.ps1` to extract one archive)

### Build

```powershell
git clone https://github.com/pauldaywork/parakeet-realtime-server
cd parakeet-realtime-server
.\scripts\build.ps1
```

Output lands in `dist/`. Then:

```powershell
.\scripts\fetch-cuda-deps.ps1
.\scripts\download-models.ps1
.\dist\parakeet-realtime-server.exe --model-dir dist\models --port 9005
```

## HTTP API

### `GET /health`

Readiness check. `{"ready": false}` while the model warms up, `{"ready": true}` once a test transcription completes.

### `POST /v1/audio/transcriptions`

Multipart WAV upload. Field name: `file`. Returns `{"text": "..."}`.

```bash
curl -F file=@audio.wav http://127.0.0.1:9005/v1/audio/transcriptions
```

## WebSocket streaming

Connect to `ws://127.0.0.1:9005/stream`. Send binary frames containing raw int16 LE PCM at 16 kHz. The server accumulates into 160 ms chunks and emits JSON text frames:

```json
{"type": "partial", "text": "hello wor"}
{"type": "partial", "text": "hello world"}
{"type": "final",   "text": "hello world"}
```

Send `{"type":"end"}` to flush remaining audio. The server resets its decoder cache after each `final` event so multiple utterances can be streamed on one connection.

## CLI flags

| Flag           | Default     | Description                                                       |
|----------------|-------------|-------------------------------------------------------------------|
| `--model-dir`  | *(required)* | Folder containing `encoder.onnx`, `decoder_joint.onnx`, `tokenizer.json` |
| `--host`       | `127.0.0.1` | Bind address                                                      |
| `--port`       | `9005`      | TCP port                                                          |
| `--chunk-ms`   | `160`       | Chunk size in ms (affects latency)                                |
| `--device`     | `cuda`      | `cuda` or `cpu`                                                   |

## Examples

- [`examples/mic-streaming.html`](examples/mic-streaming.html) — zero-dependency single-file demo; open in any browser after starting the server.
- [`examples/web-app/`](examples/web-app/) — a full Vite/React app with mic picker, live transcript, raw event log, and health badge.

## Troubleshooting

| Symptom                                        | Fix                                                                                 |
|------------------------------------------------|-------------------------------------------------------------------------------------|
| `exit code 0xc0000135` at startup              | Missing CUDA/cuDNN DLLs. Run `scripts\fetch-cuda-deps.ps1`.                         |
| `Could not locate cudnn_graph64_9.dll`         | cuDNN 9.x sub-DLL missing. Same fix.                                                |
| `/health` returns `{"ready": false}` forever   | Model files not found. Check `--model-dir` points at a folder with all three ONNX files. |
| Partial events stop mid-stream                 | Client stopped sending PCM but didn't send `{"type":"end"}`. Send it before closing. |

## License

MIT. See [LICENSE](LICENSE).

## Acknowledgements

- [altunenes/parakeet-rs](https://github.com/altunenes/parakeet-rs) — the underlying Rust parakeet inference crate this server wraps.
- [NVIDIA Parakeet Realtime EOU 120M](https://huggingface.co/altunenes/parakeet-rs/tree/main/realtime_eou_120m-v1-onnx) — the model.
- [whisper.cpp](https://github.com/ggml-org/whisper.cpp) — repo-structure inspiration.
