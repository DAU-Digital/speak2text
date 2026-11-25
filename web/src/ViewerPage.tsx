import { useEffect, useRef, useState } from "react";
import { useT, type Strings } from "./i18n";
import { isLang, LANGS, type Lang } from "./languages";
import { connectViewer, normalizeRoomCode, type LinkStatus, type RoomInfo } from "./roomClient";
import { SubtitleList } from "./SubtitleView";
import type { DisplayLine } from "./subtitles";
import { BrandMark, ClearIcon, ColumnHead, UiLangSwitch } from "./ui";

const LS_LANGS = "s2t.viewerLangs";

type Fatal = "invalid" | "full" | "other";
const FATAL_TEXT: Record<Fatal, (t: Strings) => string> = {
  invalid: (t) => t.vInvalid,
  full: (t) => t.vFull,
  other: (t) => t.vFailed,
};

function loadLangs(): Lang[] {
  try {
    const arr: unknown = JSON.parse(localStorage.getItem(LS_LANGS) ?? "null");
    const langs = Array.isArray(arr) ? arr.filter(isLang) : [];
    return langs.length ? langs : ["vi"];
  } catch {
    return ["vi"];
  }
}

/** Viewer page /r/<code>: pick one or more languages, each one is a live subtitle column. */
export function ViewerPage({ code }: { code: string }) {
  const t = useT();
  const [langs, setLangs] = useState<Lang[]>(loadLangs);
  const [info, setInfo] = useState<RoomInfo | null>(null);
  const [link, setLink] = useState<LinkStatus>("connecting");
  const [everOpen, setEverOpen] = useState(false);
  const [lines, setLines] = useState<Partial<Record<Lang, DisplayLine[]>>>({});
  const [hidden, setHidden] = useState<Partial<Record<Lang, number[]>>>({});
  const valid = normalizeRoomCode(code) !== null;
  const [fatal, setFatal] = useState<Fatal | null>(valid ? null : "invalid");
  const conn = useRef<ReturnType<typeof connectViewer> | null>(null);

  useEffect(() => {
    if (!valid) return;
    const c = connectViewer({
      room: code,
      langs: loadLangs(),
      onRoom: setInfo,
      onLines: (lang, ls) => setLines((prev) => ({ ...prev, [lang]: ls })),
      onStatus: (s) => {
        setLink(s);
        if (s === "open") setEverOpen(true);
      },
      onError: (e) => setFatal(e === "invalid" || e === "full" ? e : "other"),
    });
    conn.current = c;
    return () => c.close();
  }, [code, valid]);

  useEffect(() => {
    document.title = t.viewerTitle(code);
  }, [t, code]);

  function toggle(l: Lang) {
    const next = LANGS.map((x) => x.code).filter((c) => (c === l ? !langs.includes(c) : langs.includes(c)));
    setLangs(next);
    localStorage.setItem(LS_LANGS, JSON.stringify(next));
    conn.current?.setLangs(next);
  }

  /** Hides the finished lines on this screen only; the sentence being spoken stays. */
  function clear() {
    setHidden(Object.fromEntries(langs.map((l) => [l, (lines[l] ?? []).filter((x) => !x.live).map((x) => x.id)])));
  }

  const source = info?.source ?? null;
  const status = fatal
    ? FATAL_TEXT[fatal](t)
    : link !== "open"
      ? everOpen
        ? t.vReconnecting
        : t.vConnecting
      : !info?.exists
        ? t.vNotOpen
        : !info.hostOnline
          ? t.vHostLost
          : info.listening && source
            ? t.vListening(source)
            : t.vPaused;

  const live = !!info?.listening && link === "open";
  return (
    <div className="screen">
      <header className="topbar">
        <BrandMark />
        <div className="room">
          <span className="room-code">
            <span className="eyebrow">{t.room}</span> {code}
          </span>
          <span className={live ? "pill live" : fatal ? "pill bad" : "pill"}>{status}</span>
          <UiLangSwitch />
        </div>
      </header>
      <div className="toolbar">
        <div className="chips" role="group" aria-label={t.show}>
          <span className="eyebrow">{t.show}</span>
          {LANGS.map((l) => (
            <button key={l.code} aria-pressed={langs.includes(l.code)} onClick={() => toggle(l.code)}>
              {t.langShort[l.code]}
              {l.code === source && <span className="badge">{t.original}</span>}
            </button>
          ))}
        </div>
        <div className="actions">
          <button onClick={clear}>
            <ClearIcon /> {t.clear}
          </button>
        </div>
      </div>

      {langs.length === 0 ? (
        <p className="empty">{t.vPickOne}</p>
      ) : (
        <main className="cols">
          {langs.map((l) => {
            const hide = new Set(hidden[l] ?? []);
            const shown = (lines[l] ?? []).filter((x) => !hide.has(x.id));
            const waiting = !!info?.listening && l !== source && !info.activeLangs.includes(l);
            return (
              <section className="col" key={l}>
                <ColumnHead lang={l} original={l === source} />
                {shown.length ? (
                  <SubtitleList lines={shown} mode={l === source ? "original" : "translation"} />
                ) : (
                  <p className="empty">{waiting ? t.vStarting(l) : t.vNoSubs}</p>
                )}
              </section>
            );
          })}
        </main>
      )}
    </div>
  );
}
