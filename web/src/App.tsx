import { useEffect, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { SonioxClient } from "@soniox/client";
import { ApiError, fetchSttKey, login } from "./api";
import { createPublisher } from "./broadcast";
import { floatingSupported, useFloatingWindow } from "./floatingWindow";
import { isLang, LANGS, langShort, sanitizeTargets, type Lang } from "./languages";
import { Listener, type ErrorKind, type Status } from "./listener";
import { MSG } from "./messages";
import { SharedMic } from "./sharedMic";
import { OneRow, SubtitleView } from "./SubtitleView";
import { clearTranscript, currentSubtitle, emptyTranscript, type Subtitle, type Transcript } from "./subtitles";

const LS = { token: "s2t.token", exp: "s2t.expiresAt", source: "s2t.source", targets: "s2t.targets" };

function loadSource(): Lang {
  const v = localStorage.getItem(LS.source);
  return isLang(v) ? v : "en";
}

function loadTargets(source: Lang): Lang[] {
  try {
    const arr: unknown = JSON.parse(localStorage.getItem(LS.targets) ?? "[]");
    return sanitizeTargets(source, Array.isArray(arr) ? arr.filter(isLang) : []);
  } catch {
    return sanitizeTargets(source, []);
  }
}

function loadToken(): string | null {
  const token = localStorage.getItem(LS.token);
  const exp = Date.parse(localStorage.getItem(LS.exp) ?? "");
  return token && exp > Date.now() ? token : null;
}

const ERROR_MSG: Record<Exclude<ErrorKind, "expired">, string> = {
  permission: MSG.MSG02,
  network: MSG.MSG05,
  service: MSG.MSG10,
};

const mics = new WeakMap<AudioContext, SharedMic>();
function micFor(ctx: AudioContext): SharedMic {
  let mic = mics.get(ctx);
  if (!mic) mics.set(ctx, (mic = new SharedMic(ctx)));
  return mic;
}

/** Must be called inside the click handler so iOS lets the context run. */
function newAudioContext(): AudioContext {
  const ctx = new AudioContext();
  void ctx.resume().catch(() => {});
  return ctx;
}

export default function App() {
  const [token, setToken] = useState(loadToken);
  const [loginMsg, setLoginMsg] = useState("");

  if (!token) {
    return (
      <Login
        initialMsg={loginMsg}
        onToken={(t, exp) => {
          localStorage.setItem(LS.token, t);
          localStorage.setItem(LS.exp, exp);
          setLoginMsg("");
          setToken(t);
        }}
      />
    );
  }
  return (
    <Main
      token={token}
      onExpired={() => {
        localStorage.removeItem(LS.token);
        localStorage.removeItem(LS.exp);
        setLoginMsg(MSG.MSG09);
        setToken(null);
      }}
    />
  );
}

function Login({ initialMsg, onToken }: { initialMsg: string; onToken: (token: string, exp: string) => void }) {
  const [passcode, setPasscode] = useState("");
  const [msg, setMsg] = useState(initialMsg);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const { token, expiresAt } = await login(passcode);
      onToken(token, expiresAt);
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 0;
      setMsg(status === 401 ? MSG.MSG01 : status === 429 ? MSG.MSG08 : MSG.MSG10);
      setBusy(false);
      input.current?.focus();
    }
  }

  return (
    <form className="login" onSubmit={submit}>
      <h1>Phụ đề</h1>
      <input
        ref={input}
        type="password"
        autoFocus
        autoComplete="current-password"
        placeholder="Passcode"
        value={passcode}
        onChange={(e) => setPasscode(e.target.value)}
      />
      <button type="submit" disabled={busy || !passcode}>
        Vào
      </button>
      <p className="error" role="alert">
        {msg}
      </p>
    </form>
  );
}

function Main({ token, onExpired }: { token: string; onExpired: () => void }) {
  const [source, setSource] = useState<Lang>(loadSource);
  const [targets, setTargets] = useState<Lang[]>(() => loadTargets(loadSource()));
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [transcripts, setTranscripts] = useState<Partial<Record<Lang, Transcript>>>({});
  const [floating, toggleFloating] = useFloatingWindow();
  const expired = useRef(onExpired);
  expired.current = onExpired;

  const publisher = useRef<ReturnType<typeof createPublisher> | null>(null);
  publisher.current ??= createPublisher();

  const listener = useRef<Listener | null>(null);
  listener.current ??= new Listener({
    createRecording: (src, target, ctx, noteApiError) =>
      new SonioxClient({
        config: async () => {
          try {
            return { api_key: await fetchSttKey(token) };
          } catch (err) {
            if (err instanceof ApiError) noteApiError(err);
            throw err;
          }
        },
      }).realtime.record({
        model: "stt-rt-v6",
        source: micFor(ctx).source(),
        audio_format: "pcm_s16le",
        sample_rate: ctx.sampleRate,
        num_channels: 1,
        language_hints: [src],
        enable_endpoint_detection: true,
        translation: { type: "one_way", target_language: target },
        auto_reconnect: true,
        max_reconnect_attempts: 3,
        reconnect_base_delay_ms: 1000,
      }),
    onStatus: (s) => {
      setStatus(s);
      if (s === "connecting") setError(null);
    },
    onTranscript: (target, update) =>
      setTranscripts((ts) => ({ ...ts, [target]: update(ts[target] ?? emptyTranscript()) })),
    onError: (kind, err) => {
      if (err) console.error(err);
      if (kind === "expired") expired.current();
      else setError(ERROR_MSG[kind]);
    },
  });

  function applyConfig(nextSource: Lang, nextTargets: Lang[]) {
    const t = sanitizeTargets(nextSource, nextTargets);
    localStorage.setItem(LS.source, nextSource);
    localStorage.setItem(LS.targets, JSON.stringify(t));
    setSource(nextSource);
    setTargets(t);
    if (listener.current!.current !== "idle") {
      void listener.current!.restart({ source: nextSource, targets: t }, newAudioContext());
    }
  }

  function toggleTarget(l: Lang) {
    applyConfig(source, targets.includes(l) ? targets.filter((x) => x !== l) : [...targets, l]);
  }

  function onMic() {
    const ls = listener.current!;
    if (status === "idle") ls.start({ source, targets }, newAudioContext());
    else if (status === "listening") void ls.stop();
    else if (status === "reconnecting") ls.cancel();
  }

  function clearAll() {
    setTranscripts((ts) => Object.fromEntries(Object.entries(ts).map(([k, t]) => [k, clearTranscript(t)])));
  }

  function openPage(l: Lang) {
    window.open(`/sub?lang=${l}`, `s2t-sub-${l}`, "popup,width=960,height=180");
  }

  const subs: Partial<Record<Lang, Subtitle | null>> = Object.fromEntries(
    targets.map((t) => [t, currentSubtitle(transcripts[t] ?? emptyTranscript())]),
  );
  const first = subs[targets[0]] ?? null;

  useEffect(() => {
    publisher.current!.publish({ source, subs });
    // subs is derived from these three
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transcripts, source, targets]);

  // Keep the screen on while listening; ignore browsers without Wake Lock.
  useEffect(() => {
    if (status !== "listening" || !("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let released = false;
    navigator.wakeLock
      .request("screen")
      .then((l) => (released ? void l.release() : (lock = l)))
      .catch(() => {});
    return () => {
      released = true;
      void lock?.release().catch(() => {});
    };
  }, [status]);

  useEffect(
    () => () => {
      listener.current?.cancel();
      publisher.current?.close();
      publisher.current = null;
    },
    [],
  );

  const statusText =
    status === "listening"
      ? MSG.MSG03(source)
      : status === "reconnecting"
        ? MSG.MSG04
        : status === "connecting"
          ? "Đang kết nối…"
          : status === "stopping"
            ? "Đang dừng…"
            : (error ?? MSG.MSG11(source));

  return (
    <div className="main">
      <header>
        <strong>Phụ đề</strong>
        <label className="field">
          Người nói
          <select value={source} onChange={(e) => applyConfig(e.target.value as Lang, targets)}>
            {LANGS.map((l) => (
              <option key={l.code} value={l.code}>
                {l.short}
              </option>
            ))}
          </select>
        </label>
        <div className="tools">
          <span className="label">Dịch sang</span>
          {LANGS.filter((l) => l.code !== source).map((l) => (
            <button key={l.code} aria-pressed={targets.includes(l.code)} onClick={() => toggleTarget(l.code)}>
              {l.short}
            </button>
          ))}
        </div>
        <div className="tools">
          {targets.map((t) => (
            <button key={t} onClick={() => openPage(t)}>
              Mở trang {langShort(t)}
            </button>
          ))}
          <button onClick={clearAll}>Xoá</button>
          {floatingSupported() && (
            <button aria-pressed={!!floating} onClick={toggleFloating}>
              Cửa sổ phụ đề
            </button>
          )}
        </div>
      </header>

      <div className="stage">
        <div className="sub" aria-live="polite">
          {targets.map((t) => (
            <div className="labeled" key={t}>
              <span className="tag">{langShort(t)}</span>
              <OneRow className="tr" text={subs[t]?.translation ?? ""} />
            </div>
          ))}
          <OneRow className="orig" text={first?.original ?? ""} />
        </div>
      </div>
      {floating && createPortal(<SubtitleView sub={first} floating />, floating.document.body)}

      <footer>
        <p className="status" role="status">
          {statusText}
        </p>
        <button
          className={`mic ${status}`}
          onClick={onMic}
          disabled={status === "connecting" || status === "stopping"}
          aria-label={status === "idle" ? "Bắt đầu nghe" : "Dừng nghe"}
        >
          {status === "connecting" || status === "stopping" ? "…" : status === "idle" ? "🎤" : "■"}
        </button>
      </footer>
    </div>
  );
}
