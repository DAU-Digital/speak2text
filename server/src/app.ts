import express from "express";
import path from "node:path";
import { signToken, verifyToken } from "./session.js";
import { createKeyLimiter, createLoginGuard } from "./limits.js";

export type AppDeps = {
  passcode?: string;
  sessionSecret: string;
  createSttKey: () => Promise<{ apiKey: string; expiresAt: string }>;
  now?: () => number;
  staticDir?: string;
};

const SESSION_MS = 30 * 24 * 3600 * 1000;

export function createApp(deps: AppDeps): express.Express {
  const now = deps.now ?? Date.now;
  const guard = createLoginGuard({ maxFails: 5, lockMs: 5 * 60 * 1000 });
  const keyLimiter = createKeyLimiter({ max: 10, windowMs: 60_000 });

  const app = express();
  app.set("trust proxy", 1);
  app.use(express.json({ limit: "4kb" }));

  app.get("/healthz", (_req, res) => {
    res.json({ ok: true });
  });

  app.post("/api/login", (req, res) => {
    const ip = req.ip ?? "unknown";
    const t = now();
    if (guard.isLocked(ip, t)) {
      res.status(429).json({ error: "locked" });
      return;
    }
    const given = typeof req.body?.passcode === "string" ? req.body.passcode : "";
    if (deps.passcode !== undefined && given !== deps.passcode) {
      guard.fail(ip, t);
      res.status(401).json({ error: "bad_passcode" });
      return;
    }
    guard.reset(ip);
    const exp = t + SESSION_MS;
    res.json({ token: signToken(deps.sessionSecret, exp), expiresAt: new Date(exp).toISOString() });
  });

  app.post("/api/stt-key", async (req, res) => {
    const auth = req.get("authorization") ?? "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    const t = now();
    if (!token || !verifyToken(deps.sessionSecret, token, t)) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    if (!keyLimiter.allow(token, t)) {
      res.status(429).json({ error: "rate_limited" });
      return;
    }
    try {
      res.json(await deps.createSttKey());
    } catch (err) {
      console.error("createSttKey failed:", err instanceof Error ? err.message : err);
      res.status(502).json({ error: "upstream" });
    }
  });

  if (deps.staticDir) {
    const dir = deps.staticDir;
    app.use(express.static(dir));
    app.use((req, res, next) => {
      if (req.method !== "GET" || req.path.startsWith("/api")) return next();
      res.sendFile(path.join(dir, "index.html"));
    });
  }

  return app;
}
