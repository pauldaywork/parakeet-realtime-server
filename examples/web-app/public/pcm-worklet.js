// AudioWorkletProcessor that converts Float32 mic input to int16 LE PCM
// and posts it to the main thread. Chunks are ~128 samples (one quantum),
// batched inside the main thread into WS frames before send.

class PcmProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0]?.[0];
    if (!ch || ch.length === 0) return true;
    const i16 = new Int16Array(ch.length);
    for (let i = 0; i < ch.length; i++) {
      const s = Math.max(-1, Math.min(1, ch[i]));
      i16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    this.port.postMessage(i16.buffer, [i16.buffer]);
    return true;
  }
}
registerProcessor("pcm", PcmProcessor);
