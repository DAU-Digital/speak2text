import type { Lang } from "./languages";
import type { DisplayLine } from "./subtitles";

/**
 * Sends a room's subtitle lines per language: skips a language whose transcript object did not
 * change since the last push, and sends at most once every `everyMs` per language (always ending
 * with the latest lines).
 */
export function createRoomPublisher(send: (lang: Lang, lines: DisplayLine[]) => void, everyMs = 200) {
  const lastKey = new Map<Lang, object>();
  const pending = new Map<Lang, DisplayLine[]>();
  const timers = new Map<Lang, ReturnType<typeof setTimeout>>();

  const flush = (lang: Lang) => {
    const lines = pending.get(lang);
    if (!lines) return void timers.delete(lang);
    pending.delete(lang);
    send(lang, lines);
    timers.set(lang, setTimeout(() => flush(lang), everyMs));
  };

  return {
    /** `key` identifies the transcript version (its object); `lines` is only called when it changed. */
    push(lang: Lang, key: object, lines: () => DisplayLine[]) {
      if (lastKey.get(lang) === key) return;
      lastKey.set(lang, key);
      pending.set(lang, lines());
      if (!timers.has(lang)) flush(lang);
    },
    clear() {
      timers.forEach(clearTimeout);
      timers.clear();
      pending.clear();
      lastKey.clear();
    },
  };
}
