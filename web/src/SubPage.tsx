import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { subscribe } from "./broadcast";
import { floatingSupported, useFloatingWindow } from "./floatingWindow";
import { langShort, type Lang } from "./languages";
import { SubtitleList } from "./SubtitleView";
import type { DisplayLine } from "./subtitles";

/** Output page: only the subtitles of one language, fed by the recording tab on this browser. */
export function SubPage({ lang }: { lang: Lang }) {
  const [lines, setLines] = useState<DisplayLine[]>([]);
  const [floating, toggleFloating] = useFloatingWindow();

  useEffect(() => subscribe(lang, setLines), [lang]);

  useEffect(() => {
    document.title = `Phụ đề — ${langShort(lang)}`;
    document.body.classList.add("pip");
  }, [lang]);

  return (
    <>
      <SubtitleList lines={lines} floating />
      {floatingSupported() && (
        <button className="float-btn" aria-pressed={!!floating} onClick={toggleFloating}>
          Nổi lên trên
        </button>
      )}
      {floating && createPortal(<SubtitleList lines={lines} floating />, floating.document.body)}
    </>
  );
}
