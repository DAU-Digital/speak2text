export type Lang = "en" | "ja" | "vi" | "zh" | "ko";

/** Display names are per interface language, in i18n.ts. */
export const LANGS: { code: Lang }[] = [{ code: "en" }, { code: "ja" }, { code: "vi" }, { code: "zh" }, { code: "ko" }];

export const isLang = (x: unknown): x is Lang => LANGS.some((l) => l.code === x);


/** Output languages: unique, never the speaker's language, in LANGS order; default when empty. */
export function sanitizeTargets(source: Lang, targets: Lang[]): Lang[] {
  const out = LANGS.map((l) => l.code).filter((c) => c !== source && targets.includes(c));
  return out.length ? out : [source === "vi" ? "en" : "vi"];
}
