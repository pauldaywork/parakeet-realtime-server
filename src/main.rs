use anyhow::Result;
use axum::{
    extract::{ws, Multipart, State, WebSocketUpgrade},
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use clap::Parser;
use futures_util::{SinkExt, StreamExt};
use parakeet_rs::ParakeetEOU;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::{error, info};

#[derive(Parser)]
struct Args {
    #[arg(long)]
    model_dir: String,

    #[arg(long, default_value = "127.0.0.1")]
    host: String,

    #[arg(long, default_value = "9005")]
    port: u16,

    #[arg(long, default_value = "160")]
    chunk_ms: u32,

    #[arg(long, default_value = "cuda")]
    device: String,
}

#[derive(Clone)]
struct AppState {
    ready: Arc<RwLock<bool>>,
    model_dir: String,
    chunk_samples: usize,
}

#[derive(Serialize)]
struct HealthResponse {
    ready: bool,
}

#[derive(Serialize)]
struct TranscribeResponse {
    text: String,
}

#[derive(Serialize, Deserialize)]
struct StreamEvent {
    #[serde(rename = "type")]
    event_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<String>,
}

fn clean_tokens(text: &str) -> String {
    text.replace('\u{2581}', " ").trim().to_string()
}

async fn health(State(state): State<AppState>) -> Json<HealthResponse> {
    let ready = *state.ready.read().await;
    Json(HealthResponse { ready })
}

async fn transcribe(
    State(state): State<AppState>,
    mut multipart: Multipart,
) -> impl IntoResponse {
    let mut audio_data: Option<Vec<u8>> = None;
    while let Ok(Some(field)) = multipart.next_field().await {
        if field.name() == Some("file") {
            if let Ok(bytes) = field.bytes().await {
                audio_data = Some(bytes.to_vec());
            }
        }
    }

    let Some(wav_bytes) = audio_data else {
        return Json(TranscribeResponse {
            text: String::new(),
        });
    };

    let result = tokio::task::spawn_blocking(move || -> Result<String> {
        let cursor = std::io::Cursor::new(wav_bytes);
        let mut reader = hound::WavReader::new(cursor)?;
        let spec = reader.spec();
        let samples: Vec<f32> = match spec.sample_format {
            hound::SampleFormat::Float => reader.samples::<f32>().filter_map(|s| s.ok()).collect(),
            hound::SampleFormat::Int => reader
                .samples::<i16>()
                .filter_map(|s| s.ok())
                .map(|s| s as f32 / 32768.0)
                .collect(),
        };

        let mut model = ParakeetEOU::from_pretrained(&state.model_dir, None)?;
        let chunk_size = state.chunk_samples;
        let mut full_text = String::new();

        for chunk in samples.chunks(chunk_size) {
            let text = model.transcribe(&chunk.to_vec(), false)?;
            if !text.is_empty() {
                full_text.push_str(&text);
            }
        }
        for _ in 0..3 {
            let text = model.transcribe(&vec![0.0; chunk_size], false)?;
            if !text.is_empty() {
                full_text.push_str(&text);
            }
        }

        Ok(clean_tokens(&full_text))
    })
    .await;

    match result {
        Ok(Ok(text)) => Json(TranscribeResponse { text }),
        Ok(Err(e)) => {
            error!("transcription failed: {e}");
            Json(TranscribeResponse {
                text: String::new(),
            })
        }
        Err(e) => {
            error!("task panicked: {e}");
            Json(TranscribeResponse {
                text: String::new(),
            })
        }
    }
}

async fn ws_stream(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_ws(socket, state))
}

async fn handle_ws(socket: ws::WebSocket, state: AppState) {
    let (mut sink, mut stream) = socket.split();
    let chunk_samples = state.chunk_samples;

    // pcm_tx/rx: receiver task sends 160ms f32 chunks to blocking model task.
    // None signals end-of-stream.
    let (pcm_tx, pcm_rx) = std::sync::mpsc::channel::<Option<Vec<f32>>>();

    // event_tx/rx: blocking model task sends events to async WS sender in real-time.
    let (event_tx, mut event_rx) = tokio::sync::mpsc::unbounded_channel::<StreamEvent>();

    // Task 1: Receive WS binary frames, convert int16 LE → f32, chunk, forward
    let recv_task = tokio::spawn(async move {
        let mut pcm_buffer: Vec<f32> = Vec::new();
        while let Some(Ok(msg)) = stream.next().await {
            match msg {
                ws::Message::Binary(pcm_bytes) => {
                    let samples: Vec<f32> = pcm_bytes
                        .chunks_exact(2)
                        .map(|b| i16::from_le_bytes([b[0], b[1]]) as f32 / 32768.0)
                        .collect();
                    pcm_buffer.extend_from_slice(&samples);
                    while pcm_buffer.len() >= chunk_samples {
                        let chunk: Vec<f32> = pcm_buffer.drain(..chunk_samples).collect();
                        if pcm_tx.send(Some(chunk)).is_err() {
                            return;
                        }
                    }
                }
                ws::Message::Text(text) => {
                    if let Ok(evt) = serde_json::from_str::<StreamEvent>(&text) {
                        if evt.event_type == "end" {
                            if !pcm_buffer.is_empty() {
                                let mut final_chunk: Vec<f32> = pcm_buffer.drain(..).collect();
                                final_chunk.resize(chunk_samples, 0.0);
                                let _ = pcm_tx.send(Some(final_chunk));
                            }
                            let _ = pcm_tx.send(None);
                            return;
                        }
                    }
                }
                ws::Message::Close(_) => {
                    let _ = pcm_tx.send(None);
                    return;
                }
                _ => {}
            }
        }
        let _ = pcm_tx.send(None);
    });

    // Task 2: Blocking model inference — processes chunks as they arrive,
    // sends partial events immediately so client sees text grow in real-time.
    let model_dir = state.model_dir.clone();
    let process_task = tokio::task::spawn_blocking(move || {
        let model = ParakeetEOU::from_pretrained(&model_dir, None);
        let mut model = match model {
            Ok(m) => m,
            Err(e) => {
                let _ = event_tx.send(StreamEvent {
                    event_type: "error".to_string(),
                    text: None,
                    message: Some(format!("Model load failed: {e}")),
                });
                return;
            }
        };

        // Accumulated raw tokens for the CURRENT utterance. Cleared each
        // time the model emits the `[EOU]` sentinel and a `final` is sent.
        //
        // parakeet-rs returns `[EOU]` as a literal text token at
        // end-of-utterance (with `reset_on_eou=true`, the decoder also
        // resets internal state alongside emitting `[EOU]`). We treat
        // `[EOU]`'s presence in a chunk's output as the authoritative
        // signal to finalize the current utterance — strip it from the
        // user-facing text and emit a `final`.
        let mut raw_text = String::new();

        while let Ok(maybe_chunk) = pcm_rx.recv() {
            let Some(chunk) = maybe_chunk else {
                break; // end-of-stream
            };
            match model.transcribe(&chunk, true) {
                Ok(text) if !text.is_empty() => {
                    let has_eou = text.contains("[EOU]");
                    let stripped = text.replace("[EOU]", "");

                    // Append any non-EOU content to the running utterance.
                    // Guard against `[EOU]` appearing alone (stripped ends up
                    // empty) — in that case we jump straight to the final.
                    if !stripped.is_empty() {
                        raw_text.push_str(&stripped);
                        let _ = event_tx.send(StreamEvent {
                            event_type: "partial".to_string(),
                            text: Some(clean_tokens(&raw_text)),
                            message: None,
                        });
                    }

                    if has_eou && !raw_text.is_empty() {
                        let _ = event_tx.send(StreamEvent {
                            event_type: "final".to_string(),
                            text: Some(clean_tokens(&raw_text)),
                            message: None,
                        });
                        raw_text.clear();
                    }
                }
                Ok(_) => {
                    // Empty return — no action. `[EOU]` is our finalization
                    // signal now, not silence duration.
                }
                Err(e) => {
                    error!("transcribe error: {e}");
                }
            }
        }

        // End-of-stream silence flush: drain any tokens still queued in the
        // decoder. Also strip `[EOU]` here — it can appear during the flush
        // when the user stops mid-utterance.
        for _ in 0..3 {
            if let Ok(text) = model.transcribe(&vec![0.0; chunk_samples], true) {
                if !text.is_empty() {
                    let stripped = text.replace("[EOU]", "");
                    if !stripped.is_empty() {
                        raw_text.push_str(&stripped);
                        let _ = event_tx.send(StreamEvent {
                            event_type: "partial".to_string(),
                            text: Some(clean_tokens(&raw_text)),
                            message: None,
                        });
                    }
                }
            }
        }

        // Emit a final ONLY if there's accumulated text left. If the
        // streaming loop already emitted a final for the last utterance
        // and `raw_text` is empty, we don't want a redundant empty final.
        if !raw_text.is_empty() {
            let _ = event_tx.send(StreamEvent {
                event_type: "final".to_string(),
                text: Some(clean_tokens(&raw_text)),
                message: None,
            });
        }
    });

    // Task 3: Forward events to WS client as they arrive (real-time)
    let send_task = tokio::spawn(async move {
        while let Some(event) = event_rx.recv().await {
            if let Ok(json) = serde_json::to_string(&event) {
                if sink.send(ws::Message::Text(json.into())).await.is_err() {
                    break;
                }
            }
        }
        let _ = sink.close().await;
    });

    let _ = recv_task.await;
    let _ = process_task.await;
    let _ = send_task.await;
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt::init();

    let args = Args::parse();
    let chunk_samples = (args.chunk_ms as usize * 16000) / 1000;

    info!(
        model_dir = %args.model_dir,
        device = %args.device,
        chunk_ms = args.chunk_ms,
        chunk_samples = chunk_samples,
        "loading parakeet realtime EOU model"
    );

    let state = AppState {
        ready: Arc::new(RwLock::new(false)),
        model_dir: args.model_dir.clone(),
        chunk_samples,
    };

    // Bind the listener FIRST so /health can serve {ready: false} while the
    // model warms up. The adapter polls /health and only considers the
    // daemon ready once it sees {ready: true} — otherwise the UI would show
    // "ready" as soon as the process started, before the model finished
    // loading.
    let app = Router::new()
        .route("/health", get(health))
        .route("/v1/audio/transcriptions", post(transcribe))
        .route("/stream", get(ws_stream))
        .with_state(state.clone());

    let addr = format!("{}:{}", args.host, args.port);
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    info!("listening on {} (model warming up)", addr);

    let warmup_state = state.clone();
    let warmup_dir = args.model_dir.clone();
    let warmup_samples = chunk_samples;
    tokio::spawn(async move {
        let load = tokio::task::spawn_blocking(move || -> Result<()> {
            let mut model = ParakeetEOU::from_pretrained(&warmup_dir, None)?;
            let _ = model.transcribe(&vec![0.0; warmup_samples], false)?;
            Ok(())
        })
        .await;
        match load {
            Ok(Ok(())) => {
                *warmup_state.ready.write().await = true;
                info!("warm-up complete — ready: true");
            }
            Ok(Err(e)) => error!("warm-up failed: {e}"),
            Err(e) => error!("warm-up task panicked: {e}"),
        }
    });

    axum::serve(listener, app).await?;

    Ok(())
}
