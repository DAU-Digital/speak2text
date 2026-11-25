import { useEffect, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { SonioxClient } from "@soniox/client";
import { ApiError, fetchSttKey, login } from "./api";
import { Listener, type ErrorKind, type Status } from "./listener";
import { MSG } from "./messages";
import { SharedMic } from "./sharedMic";
import { floatingSupported, openFloatingWindow } from "./floatingWindow";
import { SubtitleView } from "./SubtitleView";
import { clearTranscript, currentSubtitle, emptyTranscript, type Lang } from "./subtitles";

const LS = { token: "s2t.token", exp: "s2t.expiresAt", lang: "s2t.lang" };

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
  const [lang, setLang] = useState<Lang>(() => (localStorage.getItem(LS.lang) === "ja" ? "ja" : "en"));
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState(emptyTranscript);

  const [floating, setFloating] = useState<Window | null>(null);
  const expired = useRef(onExpired);
  expired.current = onExpired;

  const listener = useRef<Listener | null>(null);
  listener.current ??= new Listener({
    createRecording: (l, ctx, noteApiError) =>
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
        language_hints: [l],
        enable_endpoint_detection: true,
        translation: { type: "one_way", target_language: "vi" },
        auto_reconnect: true,
        max_reconnect_attempts: 3,
        reconnect_base_delay_ms: 1000,
      }),
    onStatus: (s) => {
      setStatus(s);
      if (s === "connecting") setError(null);
    },
    onTranscript: setTranscript,
    onError: (kind, err) => {
      if (err) console.error(err);
      if (kind === "expired") expired.current();
      else setError(ERROR_MSG[kind]);
    },
  });

  function onMic() {
    const ls = listener.current!;
    if (status === "idle") ls.start(lang, newAudioContext());
    else if (status === "listening") void ls.stop();
    else if (status === "reconnecting") ls.cancel();
  }

  function onLang(l: Lang) {
    if (l === lang) return;
    localStorage.setItem(LS.lang, l);
    setLang(l);
    if (listener.current!.current !== "idle") void listener.current!.switchLang(l, newAudioContext());
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

  useEffect(() => () => listener.current?.cancel(), []);

  // The floating window closes itself when the user closes it or the page goes away.
  useEffect(() => {
    if (!floating) return;
    const onClose = () => setFloating(null);
    floating.addEventListener("pagehide", onClose);
    return () => {
      floating.removeEventListener("pagehide", onClose);
      floating.close();
    };
  }, [floating]);

  async function onFloat() {
    if (floating) return setFloating(null);
    try {
      setFloating(await openFloatingWindow());
    } catch (err) {
      console.error(err);
    }
  }

  const sub = currentSubtitle(transcript);

  const statusText =
    status === "listening"
      ? MSG.MSG03(lang)
      : status === "reconnecting"
        ? MSG.MSG04
        : status === "connecting"
          ? "Đang kết nối…"
          : status === "stopping"
            ? "Đang dừng…"
            : (error ?? MSG.MSG11(lang));

  return (
    <div className="main">
      <header>
        <strong>Phụ đề</strong>
        <div className="tools">
          <button aria-pressed={lang === "en"} onClick={() => onLang("en")}>
            Anh → Việt
          </button>
          <button aria-pressed={lang === "ja"} onClick={() => onLang("ja")}>
            Nhật → Việt
          </button>
          <button onClick={() => setTranscript(clearTranscript)}>Xoá</button>
          {floatingSupported() && (
            <button aria-pressed={!!floating} onClick={onFloat}>
              Cửa sổ phụ đề
            </button>
          )}
        </div>
      </header>

      <div className="stage">
        <SubtitleView sub={sub} />
      </div>
      {floating && createPortal(<SubtitleView sub={sub} floating />, floating.document.body)}

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
