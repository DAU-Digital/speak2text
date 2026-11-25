import { afterEach, expect, test, vi } from "vitest";
import { createPublisher, subscribe } from "./broadcast";
import type { DisplayLine } from "./subtitles";

const cleanups: (() => void)[] = [];
afterEach(() => {
  cleanups.splice(0).forEach((f) => f());
});

const sub = (translation: string, original = "orig"): DisplayLine[] => [{ id: 1, original, translation, live: true }];

function publisher() {
  const p = createPublisher();
  cleanups.push(() => p.close());
  return p;
}
function listen(lang: Parameters<typeof subscribe>[0]) {
  const seen: DisplayLine[][] = [];
  cleanups.push(subscribe(lang, (s) => seen.push(s)));
  return seen;
}

test("trang nhận phụ đề của đúng ngôn ngữ", async () => {
  const p = publisher();
  const en = listen("en");
  const viSeen = listen("vi");
  await new Promise((r) => setTimeout(r, 10));
  p.publish({ source: "ja", subs: { en: sub("Hello"), vi: sub("Xin chào") } });
  await vi.waitFor(() => expect(en.at(-1)?.[0]?.translation).toBe("Hello"));
  await vi.waitFor(() => expect(viSeen.at(-1)?.[0]?.translation).toBe("Xin chào"));
});

test("trang mở sau vẫn nhận ngay trạng thái hiện tại", async () => {
  const p = publisher();
  p.publish({ source: "ja", subs: { en: sub("Already said") } });
  const en = listen("en");
  await vi.waitFor(() => expect(en.at(-1)?.[0]?.translation).toBe("Already said"));
});

test("ngôn ngữ không có trong state → danh sách rỗng", async () => {
  const p = publisher();
  p.publish({ source: "ja", subs: { en: sub("Hello") } });
  const ko = listen("ko");
  await vi.waitFor(() => expect(ko).toContainEqual([]));
});

test("huỷ đăng ký thì không nhận nữa", async () => {
  const p = publisher();
  const seen: DisplayLine[][] = [];
  const off = subscribe("en", (s) => seen.push(s));
  off();
  p.publish({ source: "ja", subs: { en: sub("Hello") } });
  await new Promise((r) => setTimeout(r, 30));
  expect(seen).toEqual([]);
});
