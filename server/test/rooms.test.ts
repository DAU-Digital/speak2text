import { beforeEach, expect, test } from "vitest";
import { normalizeRoomCode, RoomRegistry, type Line } from "../src/rooms.js";

const GRACE = 30 * 60_000;
let t: number;
let keys: number;
let reg: RoomRegistry;

const make = (over: Partial<ConstructorParameters<typeof RoomRegistry>[0]> = {}) =>
  new RoomRegistry({
    maxRooms: 200,
    maxWaitingRooms: 500,
    maxViewers: 500,
    graceMs: GRACE,
    now: () => t,
    newKey: () => `key${++keys}`,
    ...over,
  });

beforeEach(() => {
  t = 1_000_000;
  keys = 0;
  reg = make();
});

const line = (id: number, text = "x"): Line => ({ id, original: text, translation: text, live: false });

test("normalizeRoomCode", () => {
  expect(normalizeRoomCode(" Hop-Thu-2 ")).toBe("hop-thu-2");
  for (const bad of ["ab", "a b c", "x".repeat(33), 123, null, "héllo"]) expect(normalizeRoomCode(bad)).toBeNull();
});

test("giành phòng mới → có hostKey", () => {
  expect(reg.claimHost("hop")).toEqual({ ok: true, hostKey: "key1" });
  expect(reg.info("hop")).toMatchObject({ exists: true, hostOnline: true });
});

test("mã đang có chủ phòng khác → taken", () => {
  reg.claimHost("hop");
  expect(reg.claimHost("hop")).toEqual({ ok: false, code: "taken" });
  expect(reg.claimHost("hop", "wrong")).toEqual({ ok: false, code: "taken" });
});

test("nối lại bằng hostKey cũ trong 30 phút → ok, cùng key", () => {
  reg.claimHost("hop");
  reg.hostLeft("hop");
  t += GRACE - 1;
  reg.sweep();
  expect(reg.claimHost("hop", "key1")).toEqual({ ok: true, hostKey: "key1" });
});

test("chủ phòng rời rồi, trong 30 phút người khác vẫn không giành được", () => {
  reg.claimHost("hop");
  reg.hostLeft("hop");
  expect(reg.info("hop").hostOnline).toBe(false);
  expect(reg.claimHost("hop")).toEqual({ ok: false, code: "taken" });
});

test("hết 30 phút sau khi chủ phòng rời → người khác giành được", () => {
  reg.claimHost("hop");
  reg.hostLeft("hop");
  t += GRACE + 1;
  expect(reg.sweep()).toEqual(["hop"]);
  expect(reg.claimHost("hop")).toEqual({ ok: true, hostKey: "key2" });
});

test("hết grace nhưng còn người xem → phòng về trạng thái chờ, xoá dữ liệu cũ", () => {
  reg.claimHost("hop");
  reg.setLines("hop", "vi", [line(1)]);
  reg.addViewer("hop", "v1", ["vi"]);
  reg.hostLeft("hop");
  t += GRACE + 1;
  reg.sweep();
  expect(reg.info("hop")).toMatchObject({ exists: false, hostOnline: false });
  expect(reg.lines("hop", "vi")).toEqual([]);
  expect(reg.viewerCount("hop")).toBe(1);
});

test("người xem vào phòng chưa có chủ → info.exists false, chủ phòng vào sau giành được", () => {
  expect(reg.addViewer("hop", "v1", ["vi"])).toEqual({ ok: true });
  expect(reg.info("hop")).toEqual({ exists: false, source: null, listening: false, hostOnline: false, activeLangs: [] });
  expect(reg.claimHost("hop").ok).toBe(true);
  expect(reg.info("hop").exists).toBe(true);
  expect(reg.viewerCount("hop")).toBe(1);
});

test("demand gộp ngôn ngữ người xem, bỏ ngôn ngữ người nói", () => {
  reg.claimHost("hop");
  reg.setState("hop", { source: "ja", listening: true, activeLangs: [] });
  reg.addViewer("hop", "a", ["vi", "en"]);
  reg.addViewer("hop", "b", ["en", "ja"]);
  expect(reg.demand("hop")).toEqual(["en", "vi"]);
  reg.setViewerLangs("hop", "a", ["ko"]);
  expect(reg.demand("hop")).toEqual(["en", "ko"]);
  reg.removeViewer("hop", "b");
  expect(reg.demand("hop")).toEqual(["ko"]);
});

test("setLines cắt còn 50 dòng và 1000 ký tự", () => {
  reg.claimHost("hop");
  const stored = reg.setLines("hop", "vi", Array.from({ length: 60 }, (_, i) => line(i, "y".repeat(1200))));
  expect(stored).toHaveLength(50);
  expect(stored[0].id).toBe(10);
  expect(stored[0].original).toHaveLength(1000);
  expect(reg.lines("hop", "vi")).toEqual(stored);
});

test("quá 200 phòng có chủ → full", () => {
  reg = make({ maxRooms: 2 });
  reg.claimHost("aaa");
  reg.claimHost("bbb");
  expect(reg.claimHost("ccc")).toEqual({ ok: false, code: "full" });
});

test("phòng chờ của người xem không chặn chủ phòng mở phòng", () => {
  reg = make({ maxRooms: 1, maxWaitingRooms: 5 });
  reg.addViewer("w1", "v", ["vi"]);
  reg.addViewer("w2", "v", ["vi"]);
  expect(reg.claimHost("real").ok).toBe(true);
});

test("quá số phòng chờ → người xem mở mã mới bị full", () => {
  reg = make({ maxWaitingRooms: 2 });
  reg.addViewer("w1", "v", ["vi"]);
  reg.addViewer("w2", "v", ["vi"]);
  expect(reg.addViewer("w3", "v", ["vi"])).toEqual({ ok: false, code: "full" });
  reg.claimHost("hostroom");
  expect(reg.addViewer("hostroom", "v", ["vi"])).toEqual({ ok: true });
});

test("quá 500 người xem → full", () => {
  reg = make({ maxViewers: 2 });
  reg.addViewer("hop", "a", ["vi"]);
  reg.addViewer("hop", "b", ["vi"]);
  expect(reg.addViewer("hop", "c", ["vi"])).toEqual({ ok: false, code: "full" });
});

test("người xem cuối rời phòng chờ → phòng bị xoá", () => {
  reg.addViewer("hop", "a", ["vi"]);
  reg.removeViewer("hop", "a");
  reg = reg; // same instance
  expect(reg.viewerCount("hop")).toBe(0);
  expect(reg.claimHost("hop")).toEqual({ ok: true, hostKey: "key1" });
});

test("activeLangs và listening đi theo state của chủ phòng", () => {
  reg.claimHost("hop");
  reg.setState("hop", { source: "en", listening: true, activeLangs: ["vi"] });
  expect(reg.info("hop")).toEqual({ exists: true, source: "en", listening: true, hostOnline: true, activeLangs: ["vi"] });
});
