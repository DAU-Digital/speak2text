import { expect, test } from "vitest";
import { effectiveTargets, LINGER_MS } from "./demand";

test("gộp với ngôn ngữ chủ phòng tự bật, xếp theo thứ tự", () => {
  const r = effectiveTargets({ source: "ja", hostTargets: ["vi"], demand: ["en"], lastWanted: {}, now: 0 });
  expect(r.targets).toEqual(["en", "vi"]);
});

test("bỏ ngôn ngữ người nói", () => {
  const r = effectiveTargets({ source: "en", hostTargets: ["en", "vi"], demand: ["en"], lastWanted: {}, now: 0 });
  expect(r.targets).toEqual(["vi"]);
});

test("ngôn ngữ người xem vừa bỏ vẫn giữ trong 60 giây, quá 60 giây thì bỏ", () => {
  const first = effectiveTargets({ source: "en", hostTargets: [], demand: ["ko"], lastWanted: {}, now: 1000 });
  expect(first.targets).toEqual(["ko"]);
  const later = effectiveTargets({ source: "en", hostTargets: [], demand: [], lastWanted: first.lastWanted, now: 1000 + LINGER_MS - 1 });
  expect(later.targets).toEqual(["ko"]);
  const gone = effectiveTargets({ source: "en", hostTargets: [], demand: [], lastWanted: later.lastWanted, now: 1000 + LINGER_MS + 1 });
  expect(gone.targets).toEqual([]);
});
