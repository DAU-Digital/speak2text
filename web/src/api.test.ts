import { afterEach, expect, test, vi } from "vitest";
import { ApiError, fetchSttKey, login } from "./api";

const respond = (status: number, body: unknown) =>
  vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify(body), { status }));

afterEach(() => {
  vi.unstubAllGlobals();
});

test("fetchSttKey trả apiKey khi 200", async () => {
  const f = respond(200, { apiKey: "k", expiresAt: "x" });
  vi.stubGlobal("fetch", f);
  expect(await fetchSttKey("tok")).toBe("k");
  const [url, init] = f.mock.calls[0];
  expect(url).toBe("/api/stt-key");
  expect(init?.method).toBe("POST");
  expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer tok");
});

test("fetchSttKey 401 → ApiError status 401", async () => {
  vi.stubGlobal("fetch", respond(401, { error: "unauthorized" }));
  await expect(fetchSttKey("tok")).rejects.toMatchObject({ name: "ApiError", status: 401 });
});

test("fetchSttKey 502 → ApiError status 502", async () => {
  vi.stubGlobal("fetch", respond(502, { error: "upstream" }));
  const err = await fetchSttKey("tok").catch((e) => e);
  expect(err).toBeInstanceOf(ApiError);
  expect(err.status).toBe(502);
});

test("login trả token khi 200", async () => {
  const f = respond(200, { token: "t", expiresAt: "2026-12-25T00:00:00.000Z" });
  vi.stubGlobal("fetch", f);
  expect(await login("pw")).toEqual({ token: "t", expiresAt: "2026-12-25T00:00:00.000Z" });
  expect(JSON.parse(String(f.mock.calls[0][1]?.body))).toEqual({ passcode: "pw" });
});

test("login 429 → ApiError status 429", async () => {
  vi.stubGlobal("fetch", respond(429, { error: "locked" }));
  await expect(login("pw")).rejects.toMatchObject({ status: 429 });
});

test("mất mạng → ApiError status 0", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
  await expect(fetchSttKey("tok")).rejects.toMatchObject({ status: 0 });
});
