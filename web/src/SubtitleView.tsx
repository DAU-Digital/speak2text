import { useLayoutEffect, useRef } from "react";
import type { DisplayLine } from "./subtitles";

/**
 * Recent subtitle lines, translation above original, newest at the bottom. Scrolls to the newest
 * line automatically unless the reader has scrolled up to look back.
 */
export function SubtitleList({ lines, floating = false }: { lines: DisplayLine[]; floating?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  useLayoutEffect(() => {
    const el = ref.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [lines]);

  useLayoutEffect(() => {
    const el = ref.current;
    const win = el?.ownerDocument.defaultView;
    if (!el || !win) return;
    const onResize = () => {
      if (stick.current) el.scrollTop = el.scrollHeight;
    };
    win.addEventListener("resize", onResize);
    return () => win.removeEventListener("resize", onResize);
  }, []);

  return (
    <div
      ref={ref}
      className={floating ? "list floating" : "list"}
      aria-live="polite"
      onScroll={(e) => {
        const el = e.currentTarget;
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
      }}
    >
      {lines.map((l, i) => (
        <div key={l.id} className={i === lines.length - 1 ? "line latest" : "line"}>
          <div className="tr">{l.translation || "…"}</div>
          {l.original && <div className="orig">{l.original}</div>}
        </div>
      ))}
    </div>
  );
}
