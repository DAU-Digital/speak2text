import { AudioPermissionError, type AudioSource, type AudioSourceHandlers } from "@soniox/client";
import { micLevel, pcmLevel } from "./audioLevel";

// One microphone capture shared by several Soniox sessions (one per output language).
// Sends raw PCM (pcm_s16le, mono, ctx.sampleRate) rather than the SDK's MediaRecorder source,
// because iOS Safari records mp4, which Soniox's audio_format "auto" does not accept.
export class SharedMic {
  private stream: MediaStream | null = null;
  private input: MediaStreamAudioSourceNode | null = null;
  private node: AudioWorkletNode | null = null;
  private mute: GainNode | null = null;
  private starting: Promise<void> | null = null;
  private readonly subscribers = new Set<AudioSourceHandlers>();
  private live = 0;
  private released = false;

  constructor(private readonly ctx: AudioContext) {}

  get sampleRate(): number {
    return this.ctx.sampleRate;
  }

  /** A source for one session. The mic is released when the last source stops. */
  source(): AudioSource {
    this.live++;
    let handlers: AudioSourceHandlers | null = null;
    let stopped = false;
    return {
      start: async (h) => {
        if (stopped) return;
        handlers = h;
        this.subscribers.add(h);
        try {
          await this.ensureStarted();
        } catch (err) {
          this.subscribers.delete(h);
          throw err;
        }
      },
      stop: () => {
        if (stopped) return;
        stopped = true;
        if (handlers) this.subscribers.delete(handlers);
        if (--this.live === 0) this.release();
      },
    };
  }

  private ensureStarted(): Promise<void> {
    if (this.released) return Promise.reject(new Error("Microphone already released"));
    this.starting ??= this.capture();
    return this.starting;
  }

  private async capture(): Promise<void> {
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
    if (this.released) {
      this.release();
      return;
    }
    // iOS can leave a context created before the permission prompt suspended.
    await this.ctx.resume().catch(() => {});
    await this.ctx.audioWorklet.addModule("/pcm-worklet.js");
    if (this.released) return;
    this.input = this.ctx.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(this.ctx, "pcm-capture");
    this.node.port.onmessage = (e: MessageEvent<ArrayBuffer>) => {
      micLevel.current = pcmLevel(e.data);
      for (const h of this.subscribers) h.onData(e.data);
    };
    // WebKit only runs nodes reachable from the destination: route through a silent gain.
    this.mute = this.ctx.createGain();
    this.mute.gain.value = 0;
    this.input.connect(this.node);
    this.node.connect(this.mute);
    this.mute.connect(this.ctx.destination);
    const track = this.stream.getAudioTracks()[0];
    if (track) {
      track.onended = () => this.subscribers.forEach((h) => h.onError(new Error("Microphone track ended")));
      track.onmute = () => this.subscribers.forEach((h) => h.onMuted?.());
      track.onunmute = () => this.subscribers.forEach((h) => h.onUnmuted?.());
    }
  }

  private release(): void {
    this.released = true;
    micLevel.current = 0;
    if (this.node) this.node.port.onmessage = null;
    this.input?.disconnect();
    this.node?.disconnect();
    this.mute?.disconnect();
    this.stream?.getTracks().forEach((t) => {
      t.onended = null;
      t.stop();
    });
    this.input = null;
    this.node = null;
    this.mute = null;
    this.stream = null;
    this.subscribers.clear();
    if (this.ctx.state !== "closed") void Promise.resolve(this.ctx.close()).catch(() => {});
  }
}
