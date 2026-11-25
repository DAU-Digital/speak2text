import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { connectHost, connectViewer, normalizeRoomCode, roomLink } from "./roomClient";

class FakeSocket {
  static all: FakeSocket[] = [];
  readyState = 0;
  sent: unknown[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) {
    FakeSocket.all.push(this);
  }
  send(s: string) {
    this.sent.push(JSON.parse(s));
  }
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  receive(m: object) {
    this.onmessage?.({ data: JSON.stringify(m) });
  }
  drop() {
    this.readyState = 3;
    this.onclose?.();
  }
}

const socket = (url: string) => new FakeSocket(url) as unknown as WebSocket;
const last = () => FakeSocket.all[FakeSocket.all.length - 1];

beforeEach(() => {
  FakeSocket.all = [];
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const noop = () => {};
const hostOpts = (over = {}) => ({
  room: "hop",
  onHello: vi.fn(),
  onDemand: vi.fn(),
  onError: vi.fn(),
  onStatus: noop,
  socket,
  url: "ws://x/ws",
  ...over,
});

test("host gửi handshake rồi nhận hello", () => {
  const o = hostOpts({ hostKey: "k0", token: "tok" });
  connectHost(o);
  last().open();
  expect(last().sent[0]).toEqual({ t: "host", room: "hop", hostKey: "k0", token: "tok" });
  last().receive({ t: "hello", hostKey: "k1" });
  expect(o.onHello).toHaveBeenCalledWith("k1");
  last().receive({ t: "demand", langs: ["vi"], viewers: 2 });
  expect(o.onDemand).toHaveBeenCalledWith({ langs: ["vi"], viewers: 2 });
});

test("rớt kết nối → nối lại sau 1 giây, gửi lại handshake với key mới, state và lines cuối", () => {
  const h = connectHost(hostOpts());
  last().open();
  last().receive({ t: "hello", hostKey: "k1" });
  h.sendState({ source: "en", listening: true, activeLangs: ["vi"] });
  h.sendLines("vi", [{ id: 1, original: "a", translation: "b", live: false }]);
  last().drop();
  expect(FakeSocket.all).toHaveLength(1);
  vi.advanceTimersByTime(1000);
  expect(FakeSocket.all).toHaveLength(2);
  last().open();
  last().receive({ t: "hello", hostKey: "k1" });
  expect(last().sent).toEqual([
    { t: "host", room: "hop", hostKey: "k1" },
    { t: "state", source: "en", listening: true, activeLangs: ["vi"] },
    { t: "lines", lang: "vi", lines: [{ id: 1, original: "a", translation: "b", live: false }] },
  ]);
});

test("lịch nối lại 1, 2, 4, 8, 10, 10 giây", () => {
  connectHost(hostOpts());
  const waits: number[] = [];
  for (let i = 0; i < 6; i++) {
    last().drop();
    const before = FakeSocket.all.length;
    let waited = 0;
    while (FakeSocket.all.length === before) {
      vi.advanceTimersByTime(500);
      waited += 500;
    }
    waits.push(waited);
  }
  expect(waits).toEqual([1000, 2000, 4000, 8000, 10000, 10000]);
});

test("error taken → không nối lại", () => {
  const o = hostOpts();
  connectHost(o);
  last().open();
  last().receive({ t: "error", code: "taken" });
  last().drop();
  vi.advanceTimersByTime(60_000);
  expect(FakeSocket.all).toHaveLength(1);
  expect(o.onError).toHaveBeenCalledWith("taken");
});

test("close() dừng hẳn, không nối lại", () => {
  const h = connectHost(hostOpts());
  last().open();
  h.close();
  vi.advanceTimersByTime(60_000);
  expect(FakeSocket.all).toHaveLength(1);
});

test("viewer gửi handshake, nhận room và lines", () => {
  const onRoom = vi.fn();
  const onLines = vi.fn();
  connectViewer({ room: "hop", langs: ["vi"], onRoom, onLines, onStatus: noop, socket, url: "ws://x/ws" });
  last().open();
  expect(last().sent[0]).toEqual({ t: "viewer", room: "hop", langs: ["vi"] });
  last().receive({ t: "room", exists: true, source: "en", listening: true, hostOnline: true, activeLangs: ["vi"] });
  last().receive({ t: "lines", lang: "vi", lines: [] });
  expect(onRoom).toHaveBeenCalledWith({ exists: true, source: "en", listening: true, hostOnline: true, activeLangs: ["vi"] });
  expect(onLines).toHaveBeenCalledWith("vi", []);
});

test("viewer setLangs gửi langs, nối lại vẫn giữ langs mới", () => {
  const v = connectViewer({ room: "hop", langs: ["vi"], onRoom: noop, onLines: noop, onStatus: noop, socket, url: "ws://x/ws" });
  last().open();
  v.setLangs(["vi", "en"]);
  expect(last().sent[1]).toEqual({ t: "langs", langs: ["vi", "en"] });
  last().drop();
  vi.advanceTimersByTime(1000);
  last().open();
  expect(last().sent[0]).toEqual({ t: "viewer", room: "hop", langs: ["vi", "en"] });
});

test("normalizeRoomCode giống server", () => {
  expect(normalizeRoomCode(" Hop-Thu-2 ")).toBe("hop-thu-2");
  for (const bad of ["ab", "a b c", "x".repeat(33), "héllo"]) expect(normalizeRoomCode(bad)).toBeNull();
});

test("roomLink tạo link /r/<mã>", () => {
  expect(roomLink("https://s2t.example.com", "hop")).toBe("https://s2t.example.com/r/hop");
});
