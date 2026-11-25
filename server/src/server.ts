// Entry point for local runs and Docker: HTTP API + static web app + room WebSocket at /ws.
import express from "express";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SonioxNodeClient } from "@soniox/node";
import { loadConfig, type Config } from "./config.js";
import { createApp } from "./createApp.js";
import { RoomRegistry } from "./rooms.js";
import { attachRooms } from "./roomsWs.js";
import { verifyToken } from "./session.js";

let config: Config;
try {
  config = loadConfig(process.env);
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
config.warnings.forEach((w) => console.warn(w));

const soniox = new SonioxNodeClient({ api_key: config.apiKey });

const here = path.dirname(fileURLToPath(import.meta.url));
const webDist = path.resolve(here, "../../web/dist");

const app = express();
app.use(
  createApp({
    passcode: config.passcode,
    sessionSecret: config.sessionSecret,
    staticDir: existsSync(webDist) ? webDist : undefined,
    createSttKey: async () => {
      const { api_key, expires_at } = await soniox.auth.createTemporaryKey({
        usage_type: "transcribe_websocket",
        expires_in_seconds: 60,
      });
      return { apiKey: api_key, expiresAt: expires_at };
    },
  }),
);

export default app;

const httpServer = app.listen(config.port, () => console.log(`listening on :${config.port}`));
const secret = config.sessionSecret;
attachRooms(httpServer, {
  registry: new RoomRegistry({
    maxRooms: 200,
    maxWaitingRooms: 500,
    maxViewers: 500,
    graceMs: 30 * 60_000,
    now: Date.now,
    newKey: () => randomBytes(16).toString("hex"),
  }),
  hostAuth: config.passcode ? (t) => !!t && verifyToken(secret, t, Date.now()) : undefined,
  // Venue Wi-Fi puts many viewers behind one public IP.
  maxConnsPerIp: 300,
  pingMs: 30_000,
  sweepMs: 60_000,
  handshakeMs: 10_000,
});

process.on("uncaughtException", (err) => console.error("uncaught:", err));
