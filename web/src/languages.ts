export type Lang = "en" | "ja" | "vi" | "zh" | "ko";

export const LANGS: { code: Lang; short: string; name: string }[] = [
  { code: "en", short: "Anh", name: "tiếng Anh" },
  { code: "ja", short: "Nhật", name: "tiếng Nhật" },
  { code: "vi", short: "Việt", name: "tiếng Việt" },
  { code: "zh", short: "Trung", name: "tiếng Trung" },
  { code: "ko", short: "Hàn", name: "tiếng Hàn" },
];

export const isLang = (x: unknown): x is Lang => LANGS.some((l) => l.code === x);

export const langName = (l: Lang): string => LANGS.find((x) => x.code === l)!.name;
export const langShort = (l: Lang): string => LANGS.find((x) => x.code === l)!.short;

/** Output languages: unique, never the speaker's language, in LANGS order; default when empty. */
export function sanitizeTargets(source: Lang, targets: Lang[]): Lang[] {
  const out = LANGS.map((l) => l.code).filter((c) => c !== source && targets.includes(c));
  return out.length ? out : [source === "vi" ? "en" : "vi"];
}
