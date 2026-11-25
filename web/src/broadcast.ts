// The recording tab publishes the recent subtitle lines of every output language; /sub pages on the
// same browser listen. A page that opens later says "hello" and gets the latest state at once.
import { useEffect, useRef } from "react";
import { isLang, type Lang } from "./languages";
import type { DisplayLine } from "./subtitles";

export const CHANNEL = "s2t-subtitles";

export type SubtitleState = { source: Lang; subs: Partial<Record<Lang, DisplayLine[]>> };
type Message = { type: "hello" } | { type: "state"; state: SubtitleState };

export function createPublisher(): { publish(state: SubtitleState): void; close(): void } {
  const ch = new BroadcastChannel(CHANNEL);
  let last: SubtitleState | null = null;
  ch.onmessage = (e: MessageEvent<Message>) => {
    if (e.data?.type === "hello" && last) ch.postMessage({ type: "state", state: last } satisfies Message);
  };
  return {
    publish(state) {
      last = state;
      ch.postMessage({ type: "state", state } satisfies Message);
    },
    close() {
      ch.close();
    },
  };
}

export function subscribe(lang: Lang, onLines: (lines: DisplayLine[]) => void): () => void {
  const ch = new BroadcastChannel(CHANNEL);
  ch.onmessage = (e: MessageEvent<Message>) => {
    const msg = e.data;
    if (msg?.type === "state" && isLang(msg.state?.source)) onLines(msg.state.subs[lang] ?? []);
  };
  ch.postMessage({ type: "hello" } satisfies Message);
  return () => ch.close();
}

/** Publishes `state` for /sub pages; the channel lives exactly as long as the component. */
export function useSubtitlePublisher(state: SubtitleState): void {
  const publisher = useRef<ReturnType<typeof createPublisher> | null>(null);
  const latest = useRef(state);
  latest.current = state;

  useEffect(() => {
    const p = createPublisher();
    publisher.current = p;
    p.publish(latest.current);
    return () => {
      p.close();
      if (publisher.current === p) publisher.current = null;
    };
  }, []);

  useEffect(() => {
    publisher.current?.publish(state);
  }, [state]);
}
