import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { AudioPermissionError, SonioxClient, type RecordingState } from "@soniox/client";
import { ApiError, fetchSttKey, login } from "./api";
import { MSG } from "./messages";
import { PcmMicSource } from "./pcmSource";
import { applyTokens, closeOpenLine, emptyTranscript, type Lang } from "./subtitles";

type Status = "idle" | "connecting" | "listening" | "reconnecting";
type Recording = ReturnType<SonioxClient["realtime"]["record"]>;

const LS = { token: "s2t.token", exp: "s2t.expiresAt", lang: "s2t.lang" };

function loadToken(): string | null {
  const token = localStorage.getItem(LS.token);
  const exp = Date.parse(localStorage.getItem(LS.exp) ?? "");
  return token && exp > Date.now() ? token : null;
}

function toStatus(s: RecordingState): Status {
  if (s === "starting" || s === "connecting") return "connecting";
  if (s === "recording") return "listening";
  if (s === "reconnecting") return "reconnecting";
  return "idle";
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
  const [lang, setLang] = useState<Lang>(() => (localStorage.getItem(LS.lang) === "ja" ? "ja" : "en"));
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState(emptyTranscript);

  const recording = useRef<Recording | null>(null);
  const gen = useRef(0);
  const list = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);

  function start(l: Lang) {
    const id = ++gen.current;
    const isCurrent = () => gen.current === id;
    const ctx = new AudioContext();
    void ctx.resume(); // inside the click gesture, so iOS allows audio
    let apiError: ApiError | null = null;
    let wasReconnecting = false;

    const fail = (err?: unknown) => {
      if (!isCurrent()) return;
      gen.current++;
      recording.current?.cancel();
      recording.current = null;
      setTranscript(closeOpenLine);
      setStatus("idle");
      if (apiError?.status === 401 || (err instanceof ApiError && err.status === 401)) {
        onExpired();
        return;
      }
      const name = err instanceof Error ? err.name : "";
      if (err instanceof AudioPermissionError || name === "AudioPermissionError" || name === "NotAllowedError") {
        setError(MSG.MSG02);
      } else if (wasReconnecting || apiError?.status === 0) {
        setError(MSG.MSG05);
      } else {
        setError(MSG.MSG10);
      }
      if (err) console.error(err);
    };

    const client = new SonioxClient({
      config: async () => {
        try {
          return { api_key: await fetchSttKey(token) };
        } catch (err) {
          if (err instanceof ApiError) apiError = err;
          throw err;
        }
      },
    });

    const rec = client.realtime.record({
      model: "stt-rt-v6",
      source: new PcmMicSource(ctx),
      audio_format: "pcm_s16le",
      sample_rate: ctx.sampleRate,
      num_channels: 1,
      language_hints: [l],
      enable_endpoint_detection: true,
      translation: { type: "one_way", target_language: "vi" },
      auto_reconnect: true,
      max_reconnect_attempts: 3,
      reconnect_base_delay_ms: 1000,
    });
    recording.current = rec;
    setError(null);
    setStatus("connecting");

    rec.on("result", (r) => {
      if (isCurrent()) setTranscript((t) => applyTokens(t, r.tokens, l));
    });
    rec.on("session_restart", () => {
      if (isCurrent()) setTranscript(closeOpenLine);
    });
    rec.on("state_change", ({ new_state }) => {
      if (!isCurrent()) return;
      if (new_state === "error") {
        // Let the `error` event (which carries the cause) win if it comes right after.
        setTimeout(() => fail(), 0);
        return;
      }
      const s = toStatus(new_state);
      if (s === "reconnecting") wasReconnecting = true;
      if (s === "listening") wasReconnecting = false;
      setStatus(s);
      if (s === "idle") recording.current = null;
    });
    rec.on("error", (err) => fail(err));
  }

  async function stop() {
    const rec = recording.current;
    if (!rec) return;
    try {
      await rec.stop();
    } catch {
      rec.cancel();
    }
    setTranscript(closeOpenLine);
    setStatus("idle");
  }

  function cancel() {
    gen.current++;
    recording.current?.cancel();
    recording.current = null;
    setTranscript(closeOpenLine);
    setStatus("idle");
  }

  function onMic() {
    if (status === "idle") start(lang);
    else if (status === "listening") void stop();
    else if (status === "reconnecting") cancel();
  }

  function onLang(l: Lang) {
    if (l === lang) return;
    localStorage.setItem(LS.lang, l);
    setLang(l);
    if (status !== "idle") {
      cancel();
      start(l);
    }
  }

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

  useEffect(() => () => recording.current?.cancel(), []);

  useLayoutEffect(() => {
    const el = list.current;
    if (el && atBottom.current) el.scrollTop = el.scrollHeight;
  }, [transcript]);

  const lines = transcript.lines;
  const open = lines.length && !lines[lines.length - 1].closed ? lines[lines.length - 1] : null;
  const closed = open ? lines.slice(0, -1) : lines;
  const liveOriginal = ((open?.original ?? "") + transcript.interimOriginal).trim();
  const liveVi = ((open?.vi ?? "") + transcript.interimVi).trim();

  const statusText =
    status === "listening"
      ? MSG.MSG03(lang)
      : status === "reconnecting"
        ? MSG.MSG04
        : status === "connecting"
          ? "Đang kết nối…"
          : (error ?? MSG.MSG11(lang));

  return (
    <div className="main">
      <header>
        <strong>Phụ đề</strong>
        <div className="langs">
          <button aria-pressed={lang === "en"} onClick={() => onLang("en")}>
            Anh → Việt
          </button>
          <button aria-pressed={lang === "ja"} onClick={() => onLang("ja")}>
            Nhật → Việt
          </button>
        </div>
      </header>

      <div
        className="lines"
        ref={list}
        onScroll={(e) => {
          const el = e.currentTarget;
          atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
        }}
      >
        {closed.map((line, i) => (
          <div key={line.id} className={i === closed.length - 1 ? "line latest" : "line"}>
            <div className="vi">{line.vi.trim() || "…"}</div>
            <div className="orig">{line.original.trim()}</div>
          </div>
        ))}
        {(liveOriginal || liveVi) && (
          <div className="line live">
            <div className="vi">{liveVi || "…"}</div>
            <div className="orig">{liveOriginal}</div>
          </div>
        )}
      </div>

      <footer>
        <p className="status" role="status">
          {statusText}
        </p>
        <button
          className={`mic ${status}`}
          onClick={onMic}
          disabled={status === "connecting"}
          aria-label={status === "idle" ? "Bắt đầu nghe" : "Dừng nghe"}
        >
          {status === "connecting" ? "…" : status === "idle" ? "🎤" : "■"}
        </button>
      </footer>
    </div>
  );
}
