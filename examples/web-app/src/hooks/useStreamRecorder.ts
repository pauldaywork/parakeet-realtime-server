import { useCallback, useRef, useState } from "react";
import { CONFIG } from "../config";
import { openPcmStream, type PcmSession } from "../audio/pcmStream";
import type { LoggedEvent, ServerEvent } from "../types";

interface UseStreamRecorderOpts {
  deviceId: string | null;
  onEvent:  (e: LoggedEvent) => void;
  onFinal:  (text: string)  => void;
}

interface UseStreamRecorderResult {
  recording: boolean;
  error: string | null;
  start: () => Promise<void>;
  stop:  () => Promise<void>;
}

export function useStreamRecorder(opts: UseStreamRecorderOpts): UseStreamRecorderResult {
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sessionRef = useRef<PcmSession | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const onEventRef = useRef(opts.onEvent);
  const onFinalRef = useRef(opts.onFinal);
  onEventRef.current = opts.onEvent;
  onFinalRef.current = opts.onFinal;

  const stop = useCallback(async () => {
    const ws = wsRef.current; const session = sessionRef.current;
    wsRef.current = null; sessionRef.current = null;
    if (ws && ws.readyState === WebSocket.OPEN) {
      try { ws.send(JSON.stringify({ type: "end" })); } catch { /* ignore */ }
    }
    try { ws?.close(); } catch { /* ignore */ }
    await session?.stop();
    setRecording(false);
  }, []);

  const start = useCallback(async () => {
    if (recording) return;
    setError(null);
    setRecording(true);
    let session: PcmSession | null = null;
    let ws: WebSocket | null = null;
    try {
      session = await openPcmStream(opts.deviceId);
      sessionRef.current = session;

      ws = new WebSocket(CONFIG.wsUrl);
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;

      await new Promise<void>((resolve, reject) => {
        ws!.onopen = () => { onEventRef.current({ timestamp: Date.now(), event: { type: "open" } }); resolve(); };
        ws!.onerror = () => reject(new Error("WebSocket failed to connect"));
      });

      ws.onmessage = (msg) => {
        try {
          const data = typeof msg.data === "string" ? msg.data : new TextDecoder().decode(msg.data);
          const evt = JSON.parse(data) as ServerEvent;
          onEventRef.current({ timestamp: Date.now(), event: evt });
          if (evt.type === "final" && evt.text) onFinalRef.current(evt.text);
        } catch { /* malformed */ }
      };
      ws.onclose = (e) => {
        onEventRef.current({ timestamp: Date.now(), event: { type: "close", code: e.code } });
      };

      void (async () => {
        try {
          for await (const chunk of session!.chunks) {
            if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) break;
            wsRef.current.send(chunk);
          }
        } catch { /* session closed */ }
      })();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      try { ws?.close(); } catch {}
      await session?.stop();
      wsRef.current = null; sessionRef.current = null;
      setRecording(false);
    }
  }, [recording, opts.deviceId]);

  return { recording, error, start, stop };
}
