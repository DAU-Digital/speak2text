// The recording tab publishes the current subtitle of every output language; /sub pages on the
// same browser listen. A page that opens later says "hello" and gets the latest state at once.
import { useEffect, useRef } from "react";
import { isLang, type Lang } from "./languages";
import type { Subtitle } from "./subtitles";

export const CHANNEL = "s2t-subtitles";

export type SubtitleState = { source: Lang; subs: Partial<Record<Lang, Subtitle | null>> };
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

export function subscribe(lang: Lang, onSub: (sub: Subtitle | null) => void): () => void {
  const ch = new BroadcastChannel(CHANNEL);
  ch.onmessage = (e: MessageEvent<Message>) => {
    const msg = e.data;
    if (msg?.type === "state" && isLang(msg.state?.source)) onSub(msg.state.subs[lang] ?? null);
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
