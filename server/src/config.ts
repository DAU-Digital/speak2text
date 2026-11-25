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
    if (env.NODE_ENV === "production") throw new Error("APP_PASSCODE is required in production");
    warnings.push("APP_PASSCODE not set: dev mode, any passcode is accepted");
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
