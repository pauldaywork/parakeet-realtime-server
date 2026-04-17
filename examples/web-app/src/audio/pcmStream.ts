import { CONFIG } from "../config";

export interface PcmSession {
  stop(): Promise<void>;
  /** Async iterator of int16 LE PCM chunks (ArrayBuffer) at 16 kHz. */
  chunks: AsyncIterable<ArrayBuffer>;
}

export async function openPcmStream(deviceId: string | null): Promise<PcmSession> {
  const constraints: MediaStreamConstraints = {
    audio: deviceId ? { deviceId: { exact: deviceId }, channelCount: 1 } : { channelCount: 1 },
  };
  const stream = await navigator.mediaDevices.getUserMedia(constraints);
  const audioCtx = new AudioContext({ sampleRate: CONFIG.sampleRate });
  if (audioCtx.sampleRate !== CONFIG.sampleRate) {
    stream.getTracks().forEach(t => t.stop());
    await audioCtx.close();
    throw new Error(`AudioContext sampleRate is ${audioCtx.sampleRate}, need ${CONFIG.sampleRate}. Try Chrome/Edge.`);
  }
  const source = audioCtx.createMediaStreamSource(stream);
  await audioCtx.audioWorklet.addModule("/pcm-worklet.js");
  const node = new AudioWorkletNode(audioCtx, "pcm");
  source.connect(node);

  const queue: ArrayBuffer[] = [];
  let resolver: (() => void) | null = null;
  let done = false;

  node.port.onmessage = (e: MessageEvent<ArrayBuffer>) => {
    queue.push(e.data);
    resolver?.();
    resolver = null;
  };

  const chunks: AsyncIterable<ArrayBuffer> = {
    [Symbol.asyncIterator]() {
      return {
        async next(): Promise<IteratorResult<ArrayBuffer>> {
          while (queue.length === 0) {
            if (done) return { value: undefined, done: true };
            await new Promise<void>(r => { resolver = r; });
          }
          return { value: queue.shift()!, done: false };
        }
      };
    }
  };

  return {
    async stop() {
      done = true;
      resolver?.();
      stream.getTracks().forEach(t => t.stop());
      try { await audioCtx.close(); } catch { /* ignore */ }
    },
    chunks,
  };
}
