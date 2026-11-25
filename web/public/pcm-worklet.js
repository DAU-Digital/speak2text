// Captures mono Float32 audio and posts ~100 ms Int16 little-endian PCM chunks.
class PcmCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.size = Math.round(sampleRate / 10);
    this.buf = new Int16Array(this.size);
    this.pos = 0;
  }

  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      const s = Math.max(-1, Math.min(1, ch[i]));
      this.buf[this.pos++] = s < 0 ? s * 0x8000 : s * 0x7fff;
      if (this.pos === this.size) {
        const out = this.buf.buffer;
        this.port.postMessage(out, [out]);
        this.buf = new Int16Array(this.size);
        this.pos = 0;
      }
    }
    return true;
  }
}

registerProcessor("pcm-capture", PcmCapture);
