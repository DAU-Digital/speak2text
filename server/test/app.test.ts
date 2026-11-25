import { beforeEach, describe, expect, test } from "vitest";
import request from "supertest";
import { createApp, type AppDeps } from "../src/app.js";

const SECRET = "x".repeat(32);
const PASS = "secret-pass";
const DAY = 24 * 3600 * 1000;

let t: number;
let keyCalls: number;
let failKey: boolean;

function makeApp(over: Partial<AppDeps> = {}) {
  return createApp({
    passcode: PASS,
    sessionSecret: SECRET,
    now: () => t,
    createSttKey: async () => {
      keyCalls++;
      if (failKey) throw new Error("soniox down");
      return { apiKey: "tmp-123", expiresAt: "2026-11-25T00:01:00Z" };
    },
    ...over,
  });
}

beforeEach(() => {
  t = 1_700_000_000_000;
  keyCalls = 0;
  failKey = false;
});

const login = (app: ReturnType<typeof makeApp>, passcode: string, ip = "9.9.9.9") =>
  request(app).post("/api/login").set("X-Forwarded-For", ip).send({ passcode });

async function tokenFor(app: ReturnType<typeof makeApp>) {
  const res = await login(app, PASS);
  return res.body.token as string;
}

describe("healthz", () => {
  test("healthz", async () => {
    const res = await request(makeApp()).get("/healthz");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});

describe("login", () => {
  test("login sai → 401", async () => {
    const res = await login(makeApp(), "wrong");
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("bad_passcode");
  });

  test("login đúng → token 30 ngày", async () => {
    const res = await login(makeApp(), PASS);
    expect(res.status).toBe(200);
    expect(typeof res.body.token).toBe("string");
    expect(Date.parse(res.body.expiresAt)).toBe(t + 30 * DAY);
  });

  test("sai 5 lần → lần 6 bị 429 kể cả passcode đúng", async () => {
    const app = makeApp();
    for (let i = 0; i < 5; i++) expect((await login(app, "wrong")).status).toBe(401);
    const res = await login(app, PASS);
    expect(res.status).toBe(429);
    expect(res.body.error).toBe("locked");
  });

  test("hết 5 phút thì login lại được", async () => {
    const app = makeApp();
    for (let i = 0; i < 5; i++) await login(app, "wrong");
    t += 5 * 60 * 1000 + 1;
    expect((await login(app, PASS)).status).toBe(200);
  });

  test("login đúng xoá bộ đếm sai", async () => {
    const app = makeApp();
    for (let i = 0; i < 4; i++) await login(app, "wrong");
    expect((await login(app, PASS)).status).toBe(200);
    for (let i = 0; i < 4; i++) expect((await login(app, "wrong")).status).toBe(401);
  });

  test("hai IP khác nhau không khoá chung", async () => {
    const app = makeApp();
    for (let i = 0; i < 5; i++) await login(app, "wrong", "1.1.1.1");
    expect((await login(app, PASS, "1.1.1.1")).status).toBe(429);
    expect((await login(app, PASS, "2.2.2.2")).status).toBe(200);
  });

  test("không đặt passcode → passcode nào cũng vào", async () => {
    const res = await login(makeApp({ passcode: undefined }), "anything");
    expect(res.status).toBe(200);
  });
});

describe("stt-key", () => {
  test("stt-key không có token → 401", async () => {
    const res = await request(makeApp()).post("/api/stt-key");
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("unauthorized");
    expect(keyCalls).toBe(0);
  });

  test("stt-key token sai chữ ký → 401", async () => {
    const app = makeApp();
    const token = await tokenFor(app);
    const forged = token.replace(/.$/, (c) => (c === "A" ? "B" : "A"));
    const res = await request(app).post("/api/stt-key").set("Authorization", `Bearer ${forged}`);
    expect(res.status).toBe(401);
  });

  test("stt-key token ký bằng secret khác → 401", async () => {
    const other = makeApp({ sessionSecret: "y".repeat(32) });
    const token = await tokenFor(other);
    const res = await request(makeApp()).post("/api/stt-key").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(401);
  });

  test("stt-key token hết hạn → 401", async () => {
    const app = makeApp();
    const token = await tokenFor(app);
    t += 30 * DAY + 1;
    const res = await request(app).post("/api/stt-key").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(401);
  });

  test("stt-key hợp lệ → apiKey", async () => {
    const app = makeApp();
    const token = await tokenFor(app);
    const res = await request(app).post("/api/stt-key").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ apiKey: "tmp-123", expiresAt: "2026-11-25T00:01:00Z" });
  });

  test("key thứ 31 trong một phút → 429", async () => {
    const app = makeApp();
    const token = await tokenFor(app);
    const call = () => request(app).post("/api/stt-key").set("Authorization", `Bearer ${token}`);
    for (let i = 0; i < 30; i++) expect((await call()).status).toBe(200);
    const res = await call();
    expect(res.status).toBe(429);
    expect(res.body.error).toBe("rate_limited");
    t += 60_001;
    expect((await call()).status).toBe(200);
  });

  test("Soniox lỗi → 502", async () => {
    const app = makeApp();
    const token = await tokenFor(app);
    failKey = true;
    const res = await request(app).post("/api/stt-key").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(502);
    expect(res.body.error).toBe("upstream");
  });
});
