// Recording lifecycle for a group of sessions (one per output language): start / graceful stop /
// cancel / restart, with a generation counter so events and late promises from an old group never
// touch the current one.
import { AudioPermissionError, type RecordingState, type SonioxClient } from "@soniox/client";
import { ApiError } from "./api";
import { applyTokens, closeOpenLine, type Lang, type Transcript } from "./subtitles";

export type Status = "idle" | "connecting" | "listening" | "reconnecting" | "stopping";
export type ErrorKind = "permission" | "expired" | "network" | "service";
export type RecordingLike = Pick<ReturnType<SonioxClient["realtime"]["record"]>, "on" | "stop" | "cancel">;

export type ListenConfig = { source: Lang; targets: Lang[] };

export type ListenerDeps = {
  createRecording: (
    source: Lang,
    target: Lang,
    ctx: AudioContext,
    noteApiError: (e: ApiError) => void,
  ) => RecordingLike;
  onStatus: (s: Status) => void;
  onTranscript: (target: Lang, update: (t: Transcript) => Transcript) => void;
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

/** How long a graceful stop may wait for Soniox to finalize before the group is cancelled. */
export const STOP_TIMEOUT_MS = 5000;

function closeCtx(ctx: AudioContext) {
  if (ctx.state === "closed") return;
  Promise.resolve(ctx.close()).catch(() => {});
}

/** Default target of the pinned session when nobody needs a translation yet. */
export const defaultPinned = (source: Lang): Lang => (source === "vi" ? "en" : "vi");

/**
 * Runs one Soniox session per output language as a single group. The first session is pinned: it
 * supplies the original-language text and is never dropped by setTargets().
 */
export class Listener {
  private gen = 0;
  private recs = new Map<Lang, RecordingLike>();
  private targets = new Set<Lang>();
  private status: Status = "idle";
  private group: { source: Lang; pinned: Lang; open: (target: Lang) => void; update: () => void } | null = null;

  constructor(private readonly deps: ListenerDeps) {}

  get current(): Status {
    return this.status;
  }

  /** Output languages with a running session, pinned first. */
  get running(): Lang[] {
    return [...this.recs.keys()];
  }

  get pinned(): Lang | null {
    return this.group?.pinned ?? null;
  }

  /** Starts listening. `ctx` must be created inside the user's click so iOS allows audio. */
  start(cfg: ListenConfig, ctx: AudioContext): void {
    if (this.status !== "idle") {
      closeCtx(ctx);
      return;
    }
    const id = ++this.gen;
    const isCurrent = () => this.gen === id;
    const { source } = cfg;
    const wanted = cfg.targets.filter((t) => t !== source);
    const pinned = wanted[0] ?? defaultPinned(source);
    const states = new Map<Lang, Status>();
    let apiError: ApiError | null = null;
    let wasReconnecting = false;

    const end = (err?: unknown, report = true) => {
      if (!isCurrent()) return;
      this.gen++;
      const recs = [...this.recs.values()];
      this.recs = new Map();
      this.group = null;
      recs.forEach((r) => r.cancel());
      this.closeLines();
      this.setStatus("idle");
      if (report) this.deps.onError(classify(err, apiError, wasReconnecting), err);
    };

    const update = () => {
      if (this.status === "stopping") return; // stop() owns the status until it finishes
      const all = [...this.recs.keys()].map((t) => states.get(t));
      const s: Status = all.includes("reconnecting")
        ? "reconnecting"
        : states.get(pinned) === "listening"
          ? "listening"
          : "connecting";
      if (s === "reconnecting") wasReconnecting = true;
      if (s === "listening") wasReconnecting = false;
      this.setStatus(s);
    };

    const open = (target: Lang) => {
      states.set(target, "connecting");
      this.targets.add(target);
      const rec = this.deps.createRecording(source, target, ctx, (e) => {
        apiError = e;
      });
      const mine = () => isCurrent() && this.recs.get(target) === rec;
      rec.on("result", (r) => {
        if (mine()) this.deps.onTranscript(target, (t) => applyTokens(t, r.tokens, source));
      });
      rec.on("session_restart", () => {
        if (mine()) this.deps.onTranscript(target, closeOpenLine);
      });
      rec.on("state_change", ({ new_state }) => {
        if (!mine()) return;
        const s = toStatus(new_state);
        if (s === null) return end();
        if (s === "idle" && this.status !== "stopping") return end(undefined, false); // ended on its own
        states.set(target, s);
        update();
      });
      rec.on("error", (err) => {
        if (mine()) end(err);
      });
      this.recs.set(target, rec);
    };

    this.targets = new Set();
    this.group = { source, pinned, open, update };
    this.setStatus("connecting");
    [pinned, ...wanted.filter((t) => t !== pinned)].forEach(open);
  }

  /**
   * Opens sessions for new output languages and gracefully stops the ones no longer wanted, without
   * touching the others. The pinned session always stays. No-op unless a group is running.
   */
  setTargets(targets: Lang[]): void {
    const g = this.group;
    if (!g || this.status === "idle" || this.status === "stopping") return;
    const wanted = new Set(targets.filter((t) => t !== g.source));
    wanted.add(g.pinned);
    for (const t of wanted) if (!this.recs.has(t)) g.open(t);
    for (const [t, rec] of [...this.recs]) {
      if (wanted.has(t)) continue;
      this.recs.delete(t);
      this.deps.onTranscript(t, closeOpenLine);
      rec.stop().catch(() => rec.cancel());
    }
    g.update();
  }

  /** Graceful stop: waits for Soniox to finalize every session, so the last words are kept. */
  async stop(): Promise<void> {
    if (!this.recs.size || this.status !== "listening") return;
    const id = this.gen;
    const recs = [...this.recs.values()];
    this.setStatus("stopping");
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), STOP_TIMEOUT_MS);
    });
    const finished = Promise.all(
      recs.map((r) =>
        r.stop().catch(() => {
          if (this.gen === id) r.cancel();
        }),
      ),
    );
    const outcome = await Promise.race([finished, timedOut]);
    clearTimeout(timer);
    if (this.gen !== id) return;
    if (outcome === "timeout") return this.cancel(); // a session never finished: drop the rest
    this.recs = new Map();
    this.group = null;
    this.closeLines();
    this.setStatus("idle");
  }

  /** Immediate stop, drops anything not yet final. */
  cancel(): void {
    this.gen++;
    const recs = [...this.recs.values()];
    this.recs = new Map();
    this.group = null;
    recs.forEach((r) => r.cancel());
    this.closeLines();
    this.setStatus("idle");
  }

  /** Applies a new speaker/output configuration, restarting the sessions if they are running. */
  async restart(cfg: ListenConfig, ctx: AudioContext): Promise<void> {
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
    this.start(cfg, ctx);
  }

  private closeLines() {
    this.targets.forEach((t) => this.deps.onTranscript(t, closeOpenLine));
  }

  private setStatus(s: Status) {
    if (s === this.status) return;
    this.status = s;
    this.deps.onStatus(s);
  }
}
