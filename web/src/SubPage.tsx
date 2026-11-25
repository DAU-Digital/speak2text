import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { subscribe } from "./broadcast";
import { floatingSupported, useFloatingWindow } from "./floatingWindow";
import { langShort, type Lang } from "./languages";
import { SubtitleView } from "./SubtitleView";
import type { Subtitle } from "./subtitles";

/** Output page: only the subtitle of one language, fed by the recording tab on this browser. */
export function SubPage({ lang }: { lang: Lang }) {
  const [sub, setSub] = useState<Subtitle | null>(null);
  const [floating, toggleFloating] = useFloatingWindow();

  useEffect(() => subscribe(lang, setSub), [lang]);

  useEffect(() => {
    document.title = `Phụ đề — ${langShort(lang)}`;
    document.body.classList.add("pip");
  }, [lang]);

  return (
    <>
      <SubtitleView sub={sub} floating />
      {floatingSupported() && (
        <button className="float-btn" aria-pressed={!!floating} onClick={toggleFloating}>
          Nổi lên trên
        </button>
      )}
      {floating && createPortal(<SubtitleView sub={sub} floating />, floating.document.body)}
    </>
  );
}
