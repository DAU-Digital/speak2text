// Entry point for local runs, Docker and Vercel. Vercel imports this file and uses the default
// export (it serves server/public from its CDN); everywhere else it listens on PORT.
import express from "express";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SonioxNodeClient } from "@soniox/node";
import { loadConfig, type Config } from "./config.js";
import { createApp } from "./createApp.js";

const onVercel = !!process.env.VERCEL;

let config: Config;
try {
  config = loadConfig(process.env);
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  if (onVercel) throw err;
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
    staticDir: !onVercel && existsSync(webDist) ? webDist : undefined,
    rootRedirect: onVercel ? "/app" : undefined,
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

if (!onVercel) app.listen(config.port, () => console.log(`listening on :${config.port}`));
