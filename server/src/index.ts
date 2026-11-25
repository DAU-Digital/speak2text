import { existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SonioxNodeClient } from "@soniox/node";
import { createApp } from "./app.js";

const apiKey = process.env.SONIOX_API_KEY;
if (!apiKey) {
  console.error("SONIOX_API_KEY is required");
  process.exit(1);
}

let sessionSecret = process.env.SESSION_SECRET ?? "";
if (sessionSecret.length < 32) {
  sessionSecret = randomBytes(32).toString("hex");
  console.warn("SESSION_SECRET missing or < 32 chars: using a random one (sessions reset on restart)");
}

const passcode = process.env.APP_PASSCODE || undefined;
if (!passcode) console.warn("APP_PASSCODE not set: dev mode, any passcode is accepted");
else if (passcode.length < 8) console.warn("APP_PASSCODE should be at least 8 characters");

const soniox = new SonioxNodeClient({ api_key: apiKey });

const here = path.dirname(fileURLToPath(import.meta.url));
const webDist = path.resolve(here, "../../web/dist");

const app = createApp({
  passcode,
  sessionSecret,
  staticDir: existsSync(webDist) ? webDist : undefined,
  createSttKey: async () => {
    const { api_key, expires_at } = await soniox.auth.createTemporaryKey({
      usage_type: "transcribe_websocket",
      expires_in_seconds: 60,
    });
    return { apiKey: api_key, expiresAt: expires_at };
  },
});

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => console.log(`listening on :${port}`));
