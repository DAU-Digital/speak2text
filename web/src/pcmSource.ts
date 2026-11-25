import { AudioPermissionError, type AudioSource, type AudioSourceHandlers } from "@soniox/client";

// Microphone source that sends raw PCM (pcm_s16le, mono, ctx.sampleRate).
// Used instead of the SDK's MediaRecorder source because iOS Safari records mp4,
// which Soniox's audio_format "auto" does not accept.
export class PcmMicSource implements AudioSource {
  private stream: MediaStream | null = null;
  private node: AudioWorkletNode | null = null;
  private input: MediaStreamAudioSourceNode | null = null;
  private stopped = false;

  constructor(private readonly ctx: AudioContext) {}

  async start(handlers: AudioSourceHandlers): Promise<void> {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
    } catch (err) {
      if (err instanceof DOMException && (err.name === "NotAllowedError" || err.name === "SecurityError")) {
        throw new AudioPermissionError(err.message, err);
      }
      throw err;
    }
    if (this.stopped) {
      this.release();
      return;
    }
    await this.ctx.audioWorklet.addModule("/pcm-worklet.js");
    this.input = this.ctx.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(this.ctx, "pcm-capture");
    this.node.port.onmessage = (e: MessageEvent<ArrayBuffer>) => handlers.onData(e.data);
    this.input.connect(this.node);
    const track = this.stream.getAudioTracks()[0];
    if (track) {
      track.onended = () => handlers.onError(new Error("Microphone track ended"));
      track.onmute = () => handlers.onMuted?.();
      track.onunmute = () => handlers.onUnmuted?.();
    }
  }

  stop(): void {
    this.stopped = true;
    this.release();
  }

  private release(): void {
    if (this.node) this.node.port.onmessage = null;
    this.input?.disconnect();
    this.node?.disconnect();
    this.stream?.getTracks().forEach((t) => {
      t.onended = null;
      t.stop();
    });
    this.input = null;
    this.node = null;
    this.stream = null;
    if (this.ctx.state !== "closed") void this.ctx.close().catch(() => {});
  }
}
