import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { SonioxClient } from "@soniox/client";
import { ApiError, fetchSttKey, getConfig, login, retriableForSdk } from "./api";
import { effectiveTargets } from "./demand";
import { floatingSupported, useFloatingWindow } from "./floatingWindow";
import { isLang, LANGS, type Lang } from "./languages";
import { Listener, type ErrorKind, type Status } from "./listener";
import { tr, useT, type Strings } from "./i18n";
import { createRoomPublisher } from "./publisher";
import { SharedMic } from "./sharedMic";
import { connectHost, normalizeRoomCode, roomLink, type LinkStatus } from "./roomClient";
import { SubtitleList } from "./SubtitleView";
import { clearTranscript, displayLines, emptyTranscript, type DisplayLine, type Transcript } from "./subtitles";
import {
  ArrowIcon,
  BrandMark,
  ClearIcon,
  ColumnHead,
  LeaveIcon,
  LinkIcon,
  MicIcon,
  SplitLayout,
  StopIcon,
  UiLangSwitch,
  WindowIcon,
} from "./ui";

const LS = {
  token: "s2t.token",
  exp: "s2t.expiresAt",
  source: "s2t.source",
  targets: "s2t.targets",
  room: "s2t.room",
  hostKeys: "s2t.hostKeys",
};

function loadSource(): Lang {
  const v = localStorage.getItem(LS.source);
  return isLang(v) ? v : "en";
}

/** The host's own output picks (may be empty: viewers can ask for languages). */
function loadTargets(): Lang[] {
  try {
    const arr: unknown = JSON.parse(localStorage.getItem(LS.targets) ?? "[]");
    return Array.isArray(arr) ? arr.filter(isLang) : [];
  } catch {
    return [];
  }
}

const isConcurrencyLimit = (err: unknown) =>
  String((err as { raw?: { error_type?: string } })?.raw?.error_type).includes("max_concurrent");

function hostKeys(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(LS.hostKeys) ?? "{}") as Record<string, string>;
  } catch {
    return {};
  }
}

function loadToken(): string | null {
  const token = localStorage.getItem(LS.token);
  const exp = Date.parse(localStorage.getItem(LS.exp) ?? "");
  return token && exp > Date.now() ? token : null;
}

/** A message shown later in whatever interface language is current then. */
type Msg = (t: Strings) => string;

const ERROR_MSG: Record<Exclude<ErrorKind, "expired">, Msg> = {
  permission: (t) => t.MSG02,
  network: (t) => t.MSG05,
  service: (t) => t.MSG10,
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
  const t = useT();
  useEffect(() => {
    document.title = t.hostTitle;
  }, [t]);
  const [token, setToken] = useState(loadToken);
  const [loginMsg, setLoginMsg] = useState<Msg | null>(null);
  // null = still asking the server; "" token = open mode (no passcode configured)
  const [passcodeRequired, setPasscodeRequired] = useState<boolean | null>(null);

  useEffect(() => {
    if (token) return;
    let alive = true;
    getConfig()
      .then((c) => alive && setPasscodeRequired(c.passcodeRequired))
      .catch(() => alive && setPasscodeRequired(true));
    return () => {
      alive = false;
    };
  }, [token]);

  if (!token && passcodeRequired === false) {
    return (
      <Main
        token=""
        onExpired={() => {
          setLoginMsg(() => (t: Strings) => t.MSG09);
          setPasscodeRequired(true);
        }}
      />
    );
  }
  if (!token) {
    if (passcodeRequired === null) return null;
    return (
      <Login
        initialMsg={loginMsg}
        onToken={(t, exp) => {
          localStorage.setItem(LS.token, t);
          localStorage.setItem(LS.exp, exp);
          setLoginMsg(null);
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
        setLoginMsg(() => (t: Strings) => t.MSG09);
        setToken(null);
      }}
    />
  );
}

function Login({ initialMsg, onToken }: { initialMsg: Msg | null; onToken: (token: string, exp: string) => void }) {
  const t = useT();
  const [passcode, setPasscode] = useState("");
  const [msg, setMsg] = useState<Msg | null>(() => initialMsg);
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
      setMsg(() => (x: Strings) => (status === 401 ? x.MSG01 : status === 429 ? x.MSG08 : x.MSG10));
      setBusy(false);
      input.current?.focus();
    }
  }

  return (
    <SplitLayout>
    <form className="stack" onSubmit={submit}>
      <BrandMark />
      <h2 className="welcome">
        {t.welcome}
        <br />
        <span>{t.welcomeName}</span>
      </h2>
      <p className="lead">{t.loginLead}</p>
      <label className="eyebrow" htmlFor="passcode">
        {t.passcode}
      </label>
      <input
        id="passcode"
        ref={input}
        type="password"
        autoFocus
        autoComplete="current-password"
        value={passcode}
        onChange={(e) => setPasscode(e.target.value)}
      />
      <button type="submit" className="btn-primary btn-lg" disabled={busy || !passcode}>
        {t.enter} <ArrowIcon />
      </button>
      <p className="error" role="alert">
        {msg?.(t)}
      </p>
    </form>
    </SplitLayout>
  );
}

type RoomState = { code: string; link: LinkStatus; opened: boolean };
const EMPTY = emptyTranscript();

function Main({ token, onExpired }: { token: string; onExpired: () => void }) {
  const [source, setSource] = useState<Lang>(loadSource);
  const [hostTargets, setHostTargets] = useState<Lang[]>(loadTargets);
  const [status, setStatus] = useState<Status>("idle");
  const t = useT();
  const [error, setError] = useState<Msg | null>(null);
  const [transcripts, setTranscripts] = useState<Partial<Record<Lang, Transcript>>>({});
  const [floating, toggleFloating] = useFloatingWindow();
  const [running, setRunning] = useState<Lang[]>([]);
  const [pinned, setPinned] = useState<Lang | null>(null);

  const [roomInput, setRoomInput] = useState(() => localStorage.getItem(LS.room) ?? "");
  const [room, setRoom] = useState<RoomState | null>(null);
  const [roomMsg, setRoomMsg] = useState<Msg | null>(null);
  const [viewers, setViewers] = useState(0);
  const [demand, setDemand] = useState<Lang[]>([]);
  const [shared, setShared] = useState(false);
  const [eff, setEff] = useState<Lang[]>([]);
  const [tick, setTick] = useState(0);
  const lastWanted = useRef<Partial<Record<Lang, number>>>({});
  const host = useRef<ReturnType<typeof connectHost> | null>(null);
  const publisher = useRef<ReturnType<typeof createRoomPublisher> | null>(null);

  const expired = useRef(onExpired);
  expired.current = onExpired;

  const listener = useRef<Listener | null>(null);
  const syncRunning = () => {
    setRunning(listener.current?.running ?? []);
    setPinned(listener.current?.pinned ?? null);
  };
  listener.current ??= new Listener({
    createRecording: (src, target, ctx, noteApiError) =>
      new SonioxClient({
        config: async () => {
          try {
            return { api_key: await fetchSttKey(token) };
          } catch (err) {
            if (err instanceof ApiError) noteApiError(err);
            throw retriableForSdk(err);
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
      syncRunning();
    },
    onTranscript: (target, update) =>
      setTranscripts((ts) => ({ ...ts, [target]: update(ts[target] ?? emptyTranscript()) })),
    onTargetFailed: (target, _kind, err) => {
      if (err) console.error(err);
      const limit = isConcurrencyLimit(err);
      setRoomMsg(() => (x: Strings) => x.targetFailed(target, limit));
    },
    onError: (kind, err) => {
      if (err) console.error(err);
      if (isConcurrencyLimit(err)) {
        setError(() => (x: Strings) => x.concurrency);
      } else if (kind === "expired") expired.current();
      else setError(() => ERROR_MSG[kind]);
    },
  });

  // Output languages = host picks ∪ viewers' demand, kept 60 s after the last viewer leaves them.
  useEffect(() => {
    const r = effectiveTargets({ source, hostTargets, demand, lastWanted: lastWanted.current, now: Date.now() });
    lastWanted.current = r.lastWanted;
    setEff((prev) => (prev.join() === r.targets.join() ? prev : r.targets));
  }, [source, hostTargets, demand, tick]);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 10_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (listener.current!.current === "idle") return;
    listener.current!.setTargets(eff);
    syncRunning();
  }, [eff]);

  const visible = running.filter((l) => eff.includes(l));

  function openRoom() {
    const code = normalizeRoomCode(roomInput);
    if (!code) {
      setRoomMsg(() => (x: Strings) => x.roomInvalid);
      return;
    }
    setRoomMsg(null);
    localStorage.setItem(LS.room, code);
    setRoomInput(code);
    setRoom({ code, link: "connecting", opened: false });
    publisher.current?.clear();
    host.current = connectHost({
      room: code,
      hostKey: hostKeys()[code],
      token: token || undefined,
      onHello: (k) => {
        localStorage.setItem(LS.hostKeys, JSON.stringify({ ...hostKeys(), [code]: k }));
        setRoom({ code, link: "open", opened: true });
      },
      onDemand: (d) => {
        setDemand(d.langs);
        setViewers(d.viewers);
      },
      onError: (c) => {
        if (c === "taken") setRoomMsg(() => (x: Strings) => x.roomTaken);
        else if (c === "replaced") {
          setRoomMsg(() => (x: Strings) => x.roomReplaced);
          listener.current!.cancel();
        }
        else if (c === "unauthorized") expired.current();
        else if (c === "full") setRoomMsg(() => (x: Strings) => x.roomFull);
        else setRoomMsg(() => (x: Strings) => x.roomFailed);
        host.current?.close();
        host.current = null;
        setRoom(null);
      },
      onStatus: (link) => setRoom((r) => (r && r.code === code ? { ...r, link } : r)),
    });
    publisher.current = createRoomPublisher((lang, lines) => host.current?.sendLines(lang, lines));
  }

  function leaveRoom() {
    listener.current!.cancel();
    host.current?.close();
    host.current = null;
    publisher.current?.clear();
    setRoom(null);
    setDemand([]);
    setViewers(0);
  }

  async function share() {
    if (!room) return;
    const url = roomLink(location.origin, room.code);
    if (navigator.share) {
      await navigator.share({ title: tr().shareTitle(room.code), url }).catch(() => {});
      return;
    }
    await navigator.clipboard?.writeText(url).catch(() => {});
    setShared(true);
    setTimeout(() => setShared(false), 1500);
  }

  function changeSource(next: Lang) {
    localStorage.setItem(LS.source, next);
    setSource(next);
    if (listener.current!.current !== "idle") {
      const r = effectiveTargets({ source: next, hostTargets, demand, lastWanted: lastWanted.current, now: Date.now() });
      void listener.current!.restart({ source: next, targets: r.targets }, newAudioContext()).then(syncRunning);
    }
  }

  function toggleTarget(l: Lang) {
    const next = hostTargets.includes(l) ? hostTargets.filter((x) => x !== l) : [...hostTargets, l];
    localStorage.setItem(LS.targets, JSON.stringify(next));
    setHostTargets(next);
  }

  function onMic() {
    const ls = listener.current!;
    if (status === "idle") {
      ls.start({ source, targets: eff }, newAudioContext());
      syncRunning();
    } else if (status === "listening") void ls.stop();
    else if (status === "reconnecting") ls.cancel();
  }

  function clearAll() {
    setTranscripts((ts) => Object.fromEntries(Object.entries(ts).map(([k, t]) => [k, clearTranscript(t)])));
  }

  // Publish to the room: each visible translation, plus the original text from the pinned session.
  useEffect(() => {
    const pub = publisher.current;
    if (!pub || !room?.opened) return;
    for (const l of visible) {
      const t = transcripts[l] ?? EMPTY;
      pub.push(l, t, () => displayLines(t));
    }
    if (pinned) {
      const t = transcripts[pinned] ?? EMPTY;
      pub.push(source, t, () => displayLines(t).map((x) => ({ ...x, translation: "" })));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transcripts, visible.join(), pinned, source, room?.opened]);

  useEffect(() => {
    if (!room?.opened) return;
    host.current?.sendState({ source, listening: status === "listening" || status === "reconnecting", activeLangs: visible });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, status, visible.join(), room?.opened]);

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
      host.current?.close();
      publisher.current?.clear();
    },
    [],
  );

  const columns: { lang: Lang; mode: "translation" | "original" }[] = visible.length
    ? visible.map((lang) => ({ lang, mode: "translation" }))
    : pinned
      ? [{ lang: pinned, mode: "original" }]
      : [];
  const floatLines = columns[0] ? displayLines(transcripts[columns[0].lang] ?? emptyTranscript()) : [];

  const statusText =
    status === "listening"
      ? t.MSG03(source)
      : status === "reconnecting"
        ? t.MSG04
        : status === "connecting"
          ? t.connecting
          : status === "stopping"
            ? t.stopping
            : !room?.opened
              ? t.openRoomFirst
              : (error?.(t) ?? t.MSG11(source));

  if (!room) {
    return (
      <SplitLayout>
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            openRoom();
          }}
        >
          <BrandMark />
          <h2 className="welcome">
            {t.welcome}
            <br />
            <span>{t.welcomeName}</span>
          </h2>
          <p className="lead">{t.landingLead}</p>
          <label className="eyebrow" htmlFor="room-code">
            {t.roomCode}
          </label>
          <input
            id="room-code"
            placeholder={t.roomPlaceholder}
            value={roomInput}
            onChange={(e) => setRoomInput(e.target.value)}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
          <button type="submit" className="btn-primary btn-lg" disabled={!roomInput.trim()}>
            {t.openRoom} <ArrowIcon />
          </button>
          {roomMsg && (
            <p className="error" role="alert">
              {roomMsg(t)}
            </p>
          )}
        </form>
        <div className="divider">
          <span>{t.howTo}</span>
        </div>
        <ol className="steps">
          {t.steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </SplitLayout>
    );
  }

  const busy = status === "connecting" || status === "stopping";
  return (
    <div className="screen">
      <header className="topbar">
        <BrandMark />
        <div className="room">
          <span className="room-code">
            <span className="eyebrow">{t.room}</span> {room.code}
          </span>
          <span className={room.link === "open" ? "pill live" : "pill"}>
            {room.link === "open" ? t.viewers(viewers) : t.connectingRoom}
          </span>
          <UiLangSwitch />
        </div>
        <div className="actions">
          <button className="btn-primary" onClick={share} disabled={!room.opened}>
            <LinkIcon /> {shared ? t.copied : t.share}
          </button>
          <button onClick={leaveRoom}>
            <LeaveIcon /> {t.leave}
          </button>
        </div>
      </header>
      {roomMsg && (
        <p className="error banner" role="alert">
          {roomMsg(t)}
        </p>
      )}
      <div className="toolbar">
        <label className="field">
          <span className="eyebrow">{t.speaker}</span>
          <select value={source} onChange={(e) => changeSource(e.target.value as Lang)}>
            {LANGS.map((l) => (
              <option key={l.code} value={l.code}>
                {t.langShort[l.code]}
              </option>
            ))}
          </select>
        </label>
        <div className="chips" role="group" aria-label={t.translateTo}>
          <span className="eyebrow">{t.translateTo}</span>
          {LANGS.filter((l) => l.code !== source).map((l) => (
            <button key={l.code} aria-pressed={hostTargets.includes(l.code)} onClick={() => toggleTarget(l.code)}>
              {t.langShort[l.code]}
              {demand.includes(l.code) && <span className="badge">{t.viewerBadge}</span>}
            </button>
          ))}
        </div>
        <div className="actions">
          <button onClick={clearAll}>
            <ClearIcon /> {t.clear}
          </button>
          {floatingSupported() && (
            <button className="pip-btn" aria-pressed={!!floating} onClick={toggleFloating}>
              <WindowIcon /> {t.floating}
            </button>
          )}
        </div>
      </div>

      <main className="cols">
        {columns.length === 0 && (
          <div className="placeholder">
            <span className="eyebrow">
              {t.room} {room.code}
            </span>
            <p>{t.emptyTitle}</p>
            <span>{t.emptyHint}</span>
          </div>
        )}
        {columns.map(({ lang, mode }) => (
          <section className="col" key={lang}>
            <ColumnHead lang={lang} original={mode === "original"} />
            <SubtitleList lines={displayLines(transcripts[lang] ?? emptyTranscript())} mode={mode} />
          </section>
        ))}
      </main>
      {floating &&
        createPortal(<SubtitleList lines={floatLines} floating mode={columns[0]?.mode} />, floating.document.body)}

      <div className="dock">
        <button
          className={`mic ${status}`}
          onClick={onMic}
          disabled={busy || (status === "idle" && !room.opened)}
          aria-label={status === "idle" ? t.micStart : t.micStop}
        >
          {busy ? <span className="spin" /> : status === "idle" ? <MicIcon /> : <StopIcon />}
        </button>
        <p className="status" role="status">
          {statusText}
        </p>
      </div>
    </div>
  );
}

