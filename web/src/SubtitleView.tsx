import { useLayoutEffect, useRef } from "react";
import type { Subtitle } from "./subtitles";

function showTail(el: HTMLElement) {
  el.scrollLeft = el.scrollWidth;
  el.classList.toggle("clipped", el.scrollWidth > el.clientWidth);
}

/** One text row; when too long, the start is clipped so the newest words stay visible. */
export function OneRow({ text, className }: { text: string; className: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (ref.current) showTail(ref.current);
  });

  useLayoutEffect(() => {
    const el = ref.current;
    const win = el?.ownerDocument.defaultView;
    if (!el || !win) return;
    const onResize = () => showTail(el);
    win.addEventListener("resize", onResize);
    return () => win.removeEventListener("resize", onResize);
  }, []);

  return (
    <div ref={ref} className={`row ${className}`}>
      {text || " "}
    </div>
  );
}

/** Translation on top, original speech below — a single subtitle, never a list. */
export function SubtitleView({ sub, floating = false }: { sub: Subtitle | null; floating?: boolean }) {
  return (
    <div className={floating ? "sub floating" : "sub"} aria-live="polite">
      <OneRow className="tr" text={sub?.translation ?? ""} />
      <OneRow className="orig" text={sub?.original ?? ""} />
    </div>
  );
}
