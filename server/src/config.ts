import { randomBytes } from "node:crypto";

export type Config = {
  apiKey: string;
  passcode?: string;
  sessionSecret: string;
  port: number;
  warnings: string[];
};

export function loadConfig(env: Record<string, string | undefined>): Config {
  const warnings: string[] = [];
  const apiKey = env.SONIOX_API_KEY;
  if (!apiKey) throw new Error("SONIOX_API_KEY is required");

  const passcode = env.APP_PASSCODE || undefined;
  if (!passcode) {
    if (env.NODE_ENV === "production" && env.ALLOW_NO_PASSCODE !== "1") {
      throw new Error("APP_PASSCODE is required in production (or set ALLOW_NO_PASSCODE=1 to run without one)");
    }
    warnings.push("APP_PASSCODE not set: dev mode, no passcode screen, anyone who can reach the server can use it");
  } else if (passcode.length < 8) {
    warnings.push("APP_PASSCODE should be at least 8 characters");
  }

  let sessionSecret = env.SESSION_SECRET ?? "";
  if (sessionSecret.length < 32) {
    sessionSecret = randomBytes(32).toString("hex");
    warnings.push("SESSION_SECRET missing or < 32 chars: using a random one (sessions reset on restart)");
  }

  return { apiKey, passcode, sessionSecret, port: Number(env.PORT) || 3000, warnings };
}
