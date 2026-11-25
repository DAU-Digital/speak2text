import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SonioxNodeClient } from "@soniox/node";
import { createApp } from "./app.js";
import { loadConfig, type Config } from "./config.js";

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

const app = createApp({
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
});

app.listen(config.port, () => console.log(`listening on :${config.port}`));
