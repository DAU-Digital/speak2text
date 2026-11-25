// @vitest-environment jsdom
import { StrictMode } from "react";
import { render } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { subscribe, useSubtitlePublisher, type SubtitleState } from "./broadcast";
import type { DisplayLine } from "./subtitles";

function Probe({ state }: { state: SubtitleState }) {
  useSubtitlePublisher(state);
  return null;
}

test("vẫn phát được trong StrictMode (mount → unmount → mount)", async () => {
  const seen: DisplayLine[][] = [];
  const off = subscribe("en", (s) => seen.push(s));
  const state: SubtitleState = { source: "ja", subs: { en: [{ id: 1, original: "o", translation: "Hello", live: true }] } };
  const { unmount } = render(
    <StrictMode>
      <Probe state={state} />
    </StrictMode>,
  );
  await vi.waitFor(() => expect(seen.at(-1)?.[0]?.translation).toBe("Hello"));
  unmount();
  off();
});
