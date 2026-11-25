// Records the raw Soniox token stream for a synthetic two-sentence utterance.
// Usage: npx tsx --env-file=../.env scripts/trace.ts en|ja
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SonioxNodeClient, type RealtimeToken } from "@soniox/node";

const lang = process.argv[2];
if (lang !== "en" && lang !== "ja") throw new Error("usage: trace.ts en|ja");

const TEXT = {
  en: { voice: "Samantha", text: "Good morning everyone. [[slnc 2500]] Today we will talk about the new product launch." },
  ja: { voice: "Kyoko", text: "皆さん、おはようございます。[[slnc 2500]] 今日は新製品の発売について話します。" },
}[lang];

const dir = mkdtempSync(path.join(os.tmpdir(), "s2t-trace-"));
const aiff = path.join(dir, "x.aiff");
const raw = path.join(dir, "x.raw");
execFileSync("say", ["-v", TEXT.voice, "-o", aiff, TEXT.text]);
execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-i", aiff, "-ac", "1", "-ar", "16000", "-f", "s16le", raw]);

const CHUNK = 3200; // 100 ms of 16 kHz s16le mono
const pcm = Buffer.concat([readFileSync(raw), Buffer.alloc(CHUNK * 30)]); // + 3 s silence

async function* chunks() {
  for (let i = 0; i < pcm.length; i += CHUNK) yield pcm.subarray(i, i + CHUNK);
}

const session = new SonioxNodeClient().realtime.stt({
  model: "stt-rt-v6",
  audio_format: "pcm_s16le",
  sample_rate: 16000,
  num_channels: 1,
  language_hints: [lang],
  enable_endpoint_detection: true,
  translation: { type: "one_way", target_language: "vi" },
});

const results: RealtimeToken[][] = [];
session.on("result", (r) => {
  if (r.tokens.length) results.push(r.tokens);
});
// The SDK strips <end> from result tokens and fires "endpoint" right after that result instead;
// record it the way the web app feeds it to applyTokens.
session.on("endpoint", () => results.push([{ text: "<end>", is_final: true } as RealtimeToken]));
session.on("error", (e) => console.error("error:", e));

await session.connect();
await session.sendStream(chunks(), { pace_ms: 100, finish: true });

const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), `../../web/src/fixtures/trace-${lang}.json`);
writeFileSync(out, JSON.stringify(results, null, 1));

const finals = results.flat().filter((t) => t.is_final);
console.log(`results: ${results.length}, finals: ${finals.length}, <end>: ${finals.filter((t) => t.text === "<end>").length}`);
console.log("final order:", finals.map((t) => (t.text === "<end>" ? "⏎" : t.translation_status === "translation" ? `[${t.text}]` : t.text)).join(""));
