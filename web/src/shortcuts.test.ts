import { expect, test } from "vitest";
import { isMicShortcut } from "./shortcuts";

const ev = (over: Partial<{ key: string; tag: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; repeat: boolean; editable: boolean }> = {}) => ({
  key: " ",
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  repeat: false,
  ...over,
  target: { tagName: over.tag ?? "BODY", isContentEditable: !!over.editable },
});

test("Space ngoài ô nhập → bật/tắt micro", () => {
  expect(isMicShortcut(ev())).toBe(true);
});

test("Space trong ô nhập, select, nút, hay đang giữ phím / có phím bổ trợ → bỏ qua", () => {
  for (const tag of ["INPUT", "TEXTAREA", "SELECT", "BUTTON"]) expect(isMicShortcut(ev({ tag }))).toBe(false);
  expect(isMicShortcut(ev({ editable: true }))).toBe(false);
  expect(isMicShortcut(ev({ repeat: true }))).toBe(false);
  expect(isMicShortcut(ev({ ctrlKey: true }))).toBe(false);
  expect(isMicShortcut(ev({ key: "a" }))).toBe(false);
});
