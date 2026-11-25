import { expect, test } from "vitest";
import { loadConfig } from "../src/config.js";

const base = { SONIOX_API_KEY: "k" };

test("production không có APP_PASSCODE → báo lỗi, không chạy", () => {
  expect(() => loadConfig({ ...base, NODE_ENV: "production" })).toThrow(/APP_PASSCODE/);
});

test("production có APP_PASSCODE → chạy", () => {
  const c = loadConfig({ ...base, NODE_ENV: "production", APP_PASSCODE: "secret-pass", SESSION_SECRET: "s".repeat(32) });
  expect(c.passcode).toBe("secret-pass");
  expect(c.sessionSecret).toBe("s".repeat(32));
  expect(c.warnings).toEqual([]);
});

test("dev không có APP_PASSCODE → passcode undefined kèm cảnh báo", () => {
  const c = loadConfig(base);
  expect(c.passcode).toBeUndefined();
  expect(c.warnings.join(" ")).toMatch(/dev mode/);
});

test("thiếu SONIOX_API_KEY → báo lỗi", () => {
  expect(() => loadConfig({})).toThrow(/SONIOX_API_KEY/);
});

test("SESSION_SECRET ngắn → sinh secret ngẫu nhiên kèm cảnh báo", () => {
  const c = loadConfig({ ...base, SESSION_SECRET: "short" });
  expect(c.sessionSecret).toHaveLength(64);
  expect(c.warnings.join(" ")).toMatch(/SESSION_SECRET/);
});

test("PORT mặc định 3000", () => {
  expect(loadConfig(base).port).toBe(3000);
  expect(loadConfig({ ...base, PORT: "8080" }).port).toBe(8080);
});

test("production không có APP_PASSCODE nhưng ALLOW_NO_PASSCODE=1 → chạy, không passcode", () => {
  const c = loadConfig({ ...base, NODE_ENV: "production", ALLOW_NO_PASSCODE: "1", SESSION_SECRET: "s".repeat(32) });
  expect(c.passcode).toBeUndefined();
});
