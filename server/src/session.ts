import { createHmac, timingSafeEqual } from "node:crypto";

function sign(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function signToken(secret: string, expiresAtMs: number): string {
  return `${expiresAtMs}.${sign(secret, String(expiresAtMs))}`;
}

export function verifyToken(secret: string, token: string, nowMs: number): boolean {
  const dot = token.indexOf(".");
  if (dot <= 0) return false;
  const exp = token.slice(0, dot);
  if (!/^\d+$/.test(exp)) return false;
  const given = Buffer.from(token.slice(dot + 1));
  const expected = Buffer.from(sign(secret, exp));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return false;
  return Number(exp) > nowMs;
}
