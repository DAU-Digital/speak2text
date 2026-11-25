// Recording lifecycle: start / graceful stop / cancel / language switch, with a generation
// counter so events and late promises from an old recording never touch the current one.
import { AudioPermissionError, type RecordingState, type SonioxClient } from "@soniox/client";
import { ApiError } from "./api";
import { applyTokens, closeOpenLine, type Lang, type Transcript } from "./subtitles";

export type Status = "idle" | "connecting" | "listening" | "reconnecting" | "stopping";
export type ErrorKind = "permission" | "expired" | "network" | "service";
export type RecordingLike = Pick<ReturnType<SonioxClient["realtime"]["record"]>, "on" | "stop" | "cancel">;

export type ListenerDeps = {
  createRecording: (lang: Lang, ctx: AudioContext, noteApiError: (e: ApiError) => void) => RecordingLike;
  onStatus: (s: Status) => void;
  onTranscript: (update: (t: Transcript) => Transcript) => void;
  onError: (kind: ErrorKind, err?: unknown) => void;
};

function toStatus(s: RecordingState): Status | null {
  switch (s) {
    case "starting":
    case "connecting":
      return "connecting";
    case "recording":
      return "listening";
    case "reconnecting":
      return "reconnecting";
    case "stopping":
    case "paused":
      return "stopping";
    case "error":
      return null; // the `error` event carries the cause
    default:
      return "idle"; // idle, stopped, canceled
  }
}

function classify(err: unknown, apiError: ApiError | null, wasReconnecting: boolean): ErrorKind {
  if (apiError?.status === 401 || (err instanceof ApiError && err.status === 401)) return "expired";
  const name = err instanceof Error ? err.name : "";
  if (err instanceof AudioPermissionError || name === "AudioPermissionError" || name === "NotAllowedError") {
    return "permission";
  }
  if (wasReconnecting || apiError?.status === 0) return "network";
  return "service";
}

function closeCtx(ctx: AudioContext) {
  if (ctx.state === "closed") return;
  Promise.resolve(ctx.close()).catch(() => {});
}

export class Listener {
  private gen = 0;
  private rec: RecordingLike | null = null;
  private status: Status = "idle";

  constructor(private readonly deps: ListenerDeps) {}

  get current(): Status {
    return this.status;
  }

  /** Starts listening. `ctx` must be created inside the user's click so iOS allows audio. */
  start(lang: Lang, ctx: AudioContext): void {
    if (this.status !== "idle") {
      closeCtx(ctx);
      return;
    }
    const id = ++this.gen;
    const isCurrent = () => this.gen === id;
    let apiError: ApiError | null = null;
    let wasReconnecting = false;

    const rec = this.deps.createRecording(lang, ctx, (e) => {
      apiError = e;
    });
    this.rec = rec;
    this.setStatus("connecting");

    const fail = (err?: unknown) => {
      if (!isCurrent()) return;
      this.gen++;
      this.rec = null;
      rec.cancel();
      this.deps.onTranscript(closeOpenLine);
      this.setStatus("idle");
      this.deps.onError(classify(err, apiError, wasReconnecting), err);
    };

    rec.on("result", (r) => {
      if (isCurrent()) this.deps.onTranscript((t) => applyTokens(t, r.tokens, lang));
    });
    rec.on("session_restart", () => {
      if (isCurrent()) this.deps.onTranscript(closeOpenLine);
    });
    rec.on("state_change", ({ new_state }) => {
      if (!isCurrent()) return;
      const s = toStatus(new_state);
      if (s === null) return fail();
      if (s === "reconnecting") wasReconnecting = true;
      if (s === "listening") wasReconnecting = false;
      if (s === "idle") {
        this.rec = null;
        this.deps.onTranscript(closeOpenLine);
      }
      this.setStatus(s);
    });
    rec.on("error", (err) => fail(err));
  }

  /** Graceful stop: waits for Soniox to finalize, so the last words are kept. */
  async stop(): Promise<void> {
    const rec = this.rec;
    if (!rec || this.status !== "listening") return;
    const id = this.gen;
    this.setStatus("stopping");
    try {
      await rec.stop();
    } catch {
      if (this.gen === id) rec.cancel();
    }
    if (this.gen !== id) return;
    this.rec = null;
    this.deps.onTranscript(closeOpenLine);
    this.setStatus("idle");
  }

  /** Immediate stop, drops anything not yet final. */
  cancel(): void {
    this.gen++;
    const rec = this.rec;
    this.rec = null;
    rec?.cancel();
    this.deps.onTranscript(closeOpenLine);
    this.setStatus("idle");
  }

  async switchLang(lang: Lang, ctx: AudioContext): Promise<void> {
    if (this.status === "idle") {
      closeCtx(ctx);
      return;
    }
    if (this.status === "listening") {
      const id = this.gen;
      await this.stop();
      if (this.gen !== id) {
        closeCtx(ctx);
        return;
      }
    } else {
      this.cancel();
    }
    this.start(lang, ctx);
  }

  private setStatus(s: Status) {
    if (s === this.status) return;
    this.status = s;
    this.deps.onStatus(s);
  }
}
