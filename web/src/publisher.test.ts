import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createRoomPublisher } from "./publisher";
import type { DisplayLine } from "./subtitles";

const L = (text: string): DisplayLine[] => [{ id: 1, original: text, translation: text, live: true }];
let sent: [string, DisplayLine[]][];

beforeEach(() => {
  sent = [];
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

test("cùng transcript hai lần → chỉ gửi một lần", () => {
  const p = createRoomPublisher((lang, lines) => sent.push([lang, lines]));
  const t = {};
  p.push("vi", t, () => L("a"));
  vi.advanceTimersByTime(300);
  p.push("vi", t, () => L("a"));
  vi.advanceTimersByTime(300);
  expect(sent).toHaveLength(1);
});

test("transcript mới → gửi; trong 200 ms chỉ gửi bản mới nhất", () => {
  const p = createRoomPublisher((lang, lines) => sent.push([lang, lines]));
  p.push("vi", {}, () => L("a"));
  p.push("vi", {}, () => L("b"));
  p.push("vi", {}, () => L("c"));
  expect(sent.map(([, l]) => l[0].original)).toEqual(["a"]);
  vi.advanceTimersByTime(200);
  expect(sent.map(([, l]) => l[0].original)).toEqual(["a", "c"]);
});

test("mỗi ngôn ngữ được gom riêng", () => {
  const p = createRoomPublisher((lang, lines) => sent.push([lang, lines]));
  p.push("vi", {}, () => L("a"));
  p.push("en", {}, () => L("b"));
  expect(sent.map(([lang]) => lang)).toEqual(["vi", "en"]);
});

test("không đổi transcript thì không tính lại lines", () => {
  const p = createRoomPublisher(() => {});
  const t = {};
  const make = vi.fn(() => L("a"));
  p.push("vi", t, make);
  p.push("vi", t, make);
  expect(make).toHaveBeenCalledTimes(1);
});
