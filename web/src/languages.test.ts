import { expect, test } from "vitest";
import { LANGS, sanitizeTargets } from "./languages";

test("năm ngôn ngữ theo thứ tự en, ja, vi, zh, ko", () => {
  expect(LANGS.map((l) => l.code)).toEqual(["en", "ja", "vi", "zh", "ko"]);
});

test("sanitizeTargets bỏ trùng và xếp theo thứ tự", () => {
  expect(sanitizeTargets("ja", ["vi", "en", "vi"])).toEqual(["en", "vi"]);
});

test("sanitizeTargets bỏ ngôn ngữ người nói, rỗng thì dùng mặc định", () => {
  expect(sanitizeTargets("vi", ["vi"])).toEqual(["en"]);
  expect(sanitizeTargets("en", [])).toEqual(["vi"]);
});

test("sanitizeTargets bỏ mã không hợp lệ", () => {
  expect(sanitizeTargets("en", ["xx" as never, "ja"])).toEqual(["ja"]);
});
