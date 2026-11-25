import { afterAll, beforeAll, expect, test } from "vitest";
import request from "supertest";
import type { Express } from "express";

// Vercel imports the entry file and uses its default export; it must not call listen() there.
let app: Express;
const saved = { ...process.env };

beforeAll(async () => {
  Object.assign(process.env, { VERCEL: "1", SONIOX_API_KEY: "k", APP_PASSCODE: "", NODE_ENV: "test" });
  app = (await import("../src/index.js")).default;
});

afterAll(() => {
  process.env = saved;
});

test("entry export default một Express app dùng được", async () => {
  const res = await request(app).get("/healthz");
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ ok: true });
});

test("entry có đủ API", async () => {
  const res = await request(app).get("/api/config");
  expect(res.body).toEqual({ passcodeRequired: false });
});
