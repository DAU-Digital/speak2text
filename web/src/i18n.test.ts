// @vitest-environment jsdom
import { beforeEach, expect, test, vi } from "vitest";

// Node's own (flagged) localStorage shadows jsdom's, so use a plain in-memory one.
const store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  clear: () => store.clear(),
});

beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
});

const load = () => import("./i18n");

test("giao diện mặc định là tiếng Anh", async () => {
  const { uiLang, tr } = await load();
  expect(uiLang()).toBe("en");
  expect(tr().openRoom).toBe("Open room");
  expect(tr().langName.vi).toBe("Vietnamese");
});

test("chọn tiếng Việt: đổi chữ và nhớ cho lần sau", async () => {
  const { setUiLang, tr } = await load();
  setUiLang("vi");
  expect(tr().openRoom).toBe("Mở phòng");
  expect(tr().langName.vi).toBe("tiếng Việt");
  expect(localStorage.getItem("s2t.ui")).toBe("vi");
  vi.resetModules();
  expect((await load()).uiLang()).toBe("vi");
});

test("giá trị lạ trong localStorage → tiếng Anh", async () => {
  localStorage.setItem("s2t.ui", "fr");
  expect((await load()).uiLang()).toBe("en");
});

test("số người xem: số ít / số nhiều", async () => {
  const { tr, setUiLang } = await load();
  expect(tr().viewers(1)).toBe("1 viewer");
  expect(tr().viewers(3)).toBe("3 viewers");
  setUiLang("vi");
  expect(tr().viewers(3)).toBe("3 người đang xem");
});

test("câu có tên ngôn ngữ theo ngôn ngữ giao diện", async () => {
  const { tr, setUiLang } = await load();
  expect(tr().MSG11("ja")).toBe("Press the mic to listen to Japanese.");
  setUiLang("vi");
  expect(tr().MSG11("ja")).toBe("Bấm micro để nghe tiếng Nhật.");
});
