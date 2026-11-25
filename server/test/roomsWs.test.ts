import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, expect, test } from "vitest";
import WebSocket from "ws";
import { RoomRegistry } from "../src/rooms.js";
import { attachRooms } from "../src/roomsWs.js";

type Msg = { t: string; [k: string]: unknown };

const cleanups: (() => void)[] = [];
afterEach(() => {
  cleanups.splice(0).reverse().forEach((f) => f());
});

let keyN = 0;
async function startServer(opts: { hostAuth?: (t: string | undefined) => boolean; maxConnsPerIp?: number } = {}) {
  const server = http.createServer();
  const registry = new RoomRegistry({
    maxRooms: 200,
    maxViewers: 500,
    graceMs: 30 * 60_000,
    now: Date.now,
    newKey: () => `key${++keyN}`,
  });
  const rooms = attachRooms(server, {
    registry,
    hostAuth: opts.hostAuth,
    maxConnsPerIp: opts.maxConnsPerIp ?? 20,
    pingMs: 30_000,
    sweepMs: 60_000,
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const url = `ws://127.0.0.1:${(server.address() as AddressInfo).port}/ws`;
  cleanups.push(() => {
    rooms.close();
    server.close();
  });
  return { url, registry };
}

/** A client that queues every message so tests can await the next one of a given type. */
function client(url: string) {
  const ws = new WebSocket(url);
  const queue: Msg[] = [];
  const waiters: { t: string; resolve: (m: Msg) => void }[] = [];
  ws.on("message", (data) => {
    const msg = JSON.parse(String(data)) as Msg;
    const i = waiters.findIndex((w) => w.t === msg.t);
    if (i >= 0) waiters.splice(i, 1)[0].resolve(msg);
    else queue.push(msg);
  });
  const opened = new Promise<void>((r) => ws.once("open", () => r()));
  const closed = new Promise<void>((r) => ws.once("close", () => r()));
  cleanups.push(() => ws.terminate());
  return {
    ws,
    closed,
    async send(m: object) {
      await opened;
      ws.send(JSON.stringify(m));
    },
    async sendRaw(s: string) {
      await opened;
      ws.send(s);
    },
    next(t: string, timeoutMs = 1000): Promise<Msg> {
      const i = queue.findIndex((m) => m.t === t);
      if (i >= 0) return Promise.resolve(queue.splice(i, 1)[0]);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`no "${t}" message`)), timeoutMs);
        waiters.push({ t, resolve: (m) => (clearTimeout(timer), resolve(m)) });
      });
    },
    /** Waits for the next message of type `t` that satisfies `pred`, skipping earlier ones. */
    async until(t: string, pred: (m: Msg) => boolean, timeoutMs = 1000): Promise<Msg> {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const m = await this.next(t, Math.max(1, deadline - Date.now()));
        if (pred(m)) return m;
      }
    },
    drain(t: string) {
      for (let i = queue.length - 1; i >= 0; i--) if (queue[i].t === t) queue.splice(i, 1);
    },
  };
}

const line = (id: number, text: string) => ({ id, original: text, translation: text, live: false });

async function hostIn(url: string, room = "hop", extra: object = {}) {
  const h = client(url);
  await h.send({ t: "host", room, ...extra });
  const hello = await h.next("hello");
  return { h, hostKey: hello.hostKey as string };
}

test("chủ phòng giành phòng → hello có hostKey", async () => {
  const { url } = await startServer();
  const { hostKey } = await hostIn(url);
  expect(hostKey).toMatch(/^key\d+$/);
});

test("mã đã có chủ → error taken", async () => {
  const { url } = await startServer();
  await hostIn(url);
  const other = client(url);
  await other.send({ t: "host", room: "hop" });
  expect((await other.next("error")).code).toBe("taken");
  await other.closed;
});

test("mã phòng không hợp lệ → error invalid", async () => {
  const { url } = await startServer();
  const c = client(url);
  await c.send({ t: "viewer", room: "a b", langs: ["vi"] });
  expect((await c.next("error")).code).toBe("invalid");
});

test("người xem chỉ nhận lines của ngôn ngữ mình chọn", async () => {
  const { url } = await startServer();
  const { h } = await hostIn(url);
  const v = client(url);
  await v.send({ t: "viewer", room: "hop", langs: ["vi"] });
  await v.next("room");
  await h.send({ t: "lines", lang: "en", lines: [line(1, "Hello")] });
  await h.send({ t: "lines", lang: "vi", lines: [line(1, "Xin chào")] });
  const got = await v.next("lines");
  expect(got).toMatchObject({ lang: "vi", lines: [{ translation: "Xin chào" }] });
  await expect(v.next("lines", 150)).rejects.toThrow();
});

test("người xem vào muộn nhận ngay 50 dòng gần nhất", async () => {
  const { url } = await startServer();
  const { h } = await hostIn(url);
  await h.send({ t: "lines", lang: "vi", lines: Array.from({ length: 60 }, (_, i) => line(i, `s${i}`)) });
  await new Promise((r) => setTimeout(r, 50));
  const v = client(url);
  await v.send({ t: "viewer", room: "hop", langs: ["vi"] });
  const got = await v.next("lines");
  expect((got.lines as unknown[]).length).toBe(50);
});

test("người xem đổi langs → chủ phòng nhận demand mới với viewers đúng", async () => {
  const { url } = await startServer();
  const { h } = await hostIn(url);
  await h.send({ t: "state", source: "ja", listening: true, activeLangs: [] });
  const v = client(url);
  await v.send({ t: "viewer", room: "hop", langs: ["vi"] });
  expect(await h.until("demand", (m) => m.viewers === 1)).toMatchObject({ langs: ["vi"], viewers: 1 });
  await v.send({ t: "langs", langs: ["en", "ja"] });
  expect(await h.until("demand", (m) => (m.langs as string[]).includes("en"))).toMatchObject({ langs: ["en"], viewers: 1 });
  v.ws.close();
  expect(await h.until("demand", (m) => m.viewers === 0)).toMatchObject({ langs: [], viewers: 0 });
});

test("người xem vào trước chủ phòng → room exists false; chủ phòng vào → hostOnline true", async () => {
  const { url } = await startServer();
  const v = client(url);
  await v.send({ t: "viewer", room: "hop", langs: ["vi"] });
  expect(await v.next("room")).toMatchObject({ exists: false, hostOnline: false });
  await hostIn(url);
  expect(await v.next("room")).toMatchObject({ exists: true, hostOnline: true });
});

test("state của chủ phòng được phát cho người xem", async () => {
  const { url } = await startServer();
  const { h } = await hostIn(url);
  const v = client(url);
  await v.send({ t: "viewer", room: "hop", langs: ["vi"] });
  await v.next("room");
  await h.send({ t: "state", source: "en", listening: true, activeLangs: ["vi"] });
  expect(await v.next("room")).toMatchObject({ source: "en", listening: true, activeLangs: ["vi"] });
});

test("chủ phòng nối lại bằng hostKey → người xem vẫn ở trong phòng", async () => {
  const { url } = await startServer();
  const { h, hostKey } = await hostIn(url);
  const v = client(url);
  await v.send({ t: "viewer", room: "hop", langs: ["vi"] });
  await v.next("room");
  h.ws.close();
  expect(await v.next("room")).toMatchObject({ hostOnline: false });
  const { h: h2 } = await hostIn(url, "hop", { hostKey });
  expect(await v.next("room")).toMatchObject({ hostOnline: true });
  expect(await h2.until("demand", (m) => m.viewers === 1)).toMatchObject({ viewers: 1 });
});

test("chủ phòng thứ hai cùng key → kết nối cũ bị đóng", async () => {
  const { url } = await startServer();
  const { h, hostKey } = await hostIn(url);
  await hostIn(url, "hop", { hostKey });
  await h.closed;
});

test("có passcode: host không có token → unauthorized", async () => {
  const { url } = await startServer({ hostAuth: (t) => t === "good" });
  const c = client(url);
  await c.send({ t: "host", room: "hop" });
  expect((await c.next("error")).code).toBe("unauthorized");
  const ok = client(url);
  await ok.send({ t: "host", room: "hop", token: "good" });
  expect((await ok.next("hello")).hostKey).toBeTruthy();
});

test("JSON rác sau handshake bị bỏ qua, kết nối vẫn sống", async () => {
  const { url } = await startServer();
  const { h } = await hostIn(url);
  await h.sendRaw("{not json");
  await h.send({ t: "lines", lang: "vi", lines: "nope" });
  const v = client(url);
  await v.send({ t: "viewer", room: "hop", langs: ["vi"] });
  await v.next("room");
  await h.send({ t: "lines", lang: "vi", lines: [line(1, "ok")] });
  expect(await v.next("lines")).toMatchObject({ lang: "vi" });
});

test("lang lạ trong lines bị bỏ qua", async () => {
  const { url } = await startServer();
  const { h } = await hostIn(url);
  const v = client(url);
  await v.send({ t: "viewer", room: "hop", langs: ["vi", "xx"] });
  await v.next("room");
  await h.send({ t: "lines", lang: "xx", lines: [line(1, "bad")] });
  await expect(v.next("lines", 150)).rejects.toThrow();
});

test("quá 20 kết nối một IP → kết nối thứ 21 bị đóng", async () => {
  const { url } = await startServer({ maxConnsPerIp: 2 });
  const a = client(url);
  const b = client(url);
  await a.send({ t: "viewer", room: "hop", langs: ["vi"] });
  await b.send({ t: "viewer", room: "hop", langs: ["vi"] });
  await a.next("room");
  await b.next("room");
  const c = client(url);
  await c.closed;
});
