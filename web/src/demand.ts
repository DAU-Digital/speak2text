import { LANGS, type Lang } from "./languages";

/** How long a language nobody asks for any more keeps its session, so quick toggles don't churn. */
export const LINGER_MS = 60_000;

/**
 * Output languages the host should run: its own picks plus viewers' current demand, plus anything
 * wanted within the last LINGER_MS. Never the speaker's language; in LANGS order.
 */
export function effectiveTargets(a: {
  source: Lang;
  hostTargets: Lang[];
  demand: Lang[];
  lastWanted: Partial<Record<Lang, number>>;
  now: number;
}): { targets: Lang[]; lastWanted: Partial<Record<Lang, number>> } {
  const lastWanted = { ...a.lastWanted };
  for (const l of [...a.hostTargets, ...a.demand]) lastWanted[l] = a.now;
  const targets = LANGS.map((x) => x.code).filter((l) => {
    const at = lastWanted[l];
    return l !== a.source && at !== undefined && a.now - at <= LINGER_MS;
  });
  return { targets, lastWanted };
}
