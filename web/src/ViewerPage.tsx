import { useEffect, useRef, useState } from "react";
import { isLang, LANGS, langName, langShort, type Lang } from "./languages";
import { connectViewer, type LinkStatus, type RoomInfo } from "./roomClient";
import { SubtitleList } from "./SubtitleView";
import type { DisplayLine } from "./subtitles";

const LS_LANGS = "s2t.viewerLangs";

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
  const [langs, setLangs] = useState<Lang[]>(loadLangs);
  const [info, setInfo] = useState<RoomInfo | null>(null);
  const [link, setLink] = useState<LinkStatus>("connecting");
  const [everOpen, setEverOpen] = useState(false);
  const [lines, setLines] = useState<Partial<Record<Lang, DisplayLine[]>>>({});
  const [hidden, setHidden] = useState<Partial<Record<Lang, number[]>>>({});
  const conn = useRef<ReturnType<typeof connectViewer> | null>(null);

  useEffect(() => {
    document.title = `Phòng ${code} — Phụ đề`;
    const c = connectViewer({
      room: code,
      langs: loadLangs(),
      onRoom: setInfo,
      onLines: (lang, ls) => setLines((prev) => ({ ...prev, [lang]: ls })),
      onStatus: (s) => {
        setLink(s);
        if (s === "open") setEverOpen(true);
      },
    });
    conn.current = c;
    return () => c.close();
  }, [code]);

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
  const status =
    link !== "open"
      ? everOpen
        ? "Đang kết nối lại…"
        : "Đang kết nối…"
      : !info?.exists
        ? "Phòng chưa mở hoặc đã kết thúc"
        : !info.hostOnline
          ? "Chủ phòng đang mất kết nối…"
          : info.listening && source
            ? `Đang nghe ${langName(source)}`
            : "Chủ phòng đang tạm dừng";

  return (
    <div className="screen">
      <header className="bar">
        <div className="bar-row">
          <strong className="room-code">Phòng {code}</strong>
          <span className={info?.listening && link === "open" ? "pill live" : "pill"}>{status}</span>
        </div>
        <div className="bar-row">
          <div className="chips" role="group" aria-label="Ngôn ngữ muốn xem">
            {LANGS.map((l) => (
              <button key={l.code} aria-pressed={langs.includes(l.code)} onClick={() => toggle(l.code)}>
                {l.short}
                {l.code === source ? " (gốc)" : ""}
              </button>
            ))}
          </div>
          <button onClick={clear}>Xoá</button>
        </div>
      </header>

      {langs.length === 0 ? (
        <p className="empty">Chọn ít nhất một ngôn ngữ để xem phụ đề.</p>
      ) : (
        <main className="cols">
          {langs.map((l) => {
            const hide = new Set(hidden[l] ?? []);
            const shown = (lines[l] ?? []).filter((x) => !hide.has(x.id));
            const waiting = !!info?.listening && l !== source && !info.activeLangs.includes(l);
            return (
              <section className="col" key={l}>
                <span className="tag">
                  {langShort(l)}
                  {l === source ? " · gốc" : ""}
                </span>
                {shown.length ? (
                  <SubtitleList lines={shown} mode={l === source ? "original" : "translation"} />
                ) : (
                  <p className="empty">{waiting ? `Đang bật bản dịch ${langName(l)}…` : "Chưa có phụ đề."}</p>
                )}
              </section>
            );
          })}
        </main>
      )}
    </div>
  );
}
