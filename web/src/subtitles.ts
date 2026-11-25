// Groups the Soniox token stream into subtitle lines.
//
// Observed order in real traces: NOT YET CAPTURED (Soniox account had no balance on 2026-11-25).
// Rule until traces exist: final VI tokens go to the newest line of the current segment
// (segment = tokens between two `<end>`s); if VI arrives after `<end>` and before the next
// original token, it goes to the last line.
import type { RealtimeToken } from "@soniox/client";

export type Lang = "en" | "ja";
export type Line = { id: number; original: string; vi: string; closed: boolean };
export type Transcript = {
  lines: Line[];
  interimOriginal: string;
  interimVi: string;
  nextId: number;
  segLineId: number | null;
};

export const MAX_LINES = 300;
export const CHAR_LIMIT: Record<Lang, number> = { en: 180, ja: 70 };

export function emptyTranscript(): Transcript {
  return { lines: [], interimOriginal: "", interimVi: "", nextId: 1, segLineId: null };
}

const isTranslation = (t: RealtimeToken) => t.translation_status === "translation";

export function applyTokens(t: Transcript, tokens: RealtimeToken[], lang: Lang): Transcript {
  const lines = t.lines.slice();
  let { nextId, segLineId } = t;
  let interimOriginal = "";
  let interimVi = "";

  const last = () => lines[lines.length - 1];
  const replaceLast = (patch: Partial<Line>) => {
    lines[lines.length - 1] = { ...last(), ...patch };
  };
  const openLine = () => {
    const line: Line = { id: nextId++, original: "", vi: "", closed: false };
    lines.push(line);
    return line;
  };

  for (const tok of tokens) {
    if (!tok.is_final) {
      if (isTranslation(tok)) interimVi += tok.text;
      else interimOriginal += tok.text;
      continue;
    }
    if (tok.text === "<end>") {
      const l = last();
      if (l && !l.closed) replaceLast({ closed: true });
      segLineId = null;
      continue;
    }
    if (isTranslation(tok)) {
      let idx = segLineId === null ? -1 : lines.findIndex((l) => l.id === segLineId);
      if (idx === -1) idx = lines.length - 1;
      if (idx === -1) {
        openLine();
        idx = 0;
      }
      lines[idx] = { ...lines[idx], vi: lines[idx].vi + tok.text };
      continue;
    }
    let l = last();
    if (!l || l.closed) {
      l = openLine();
      segLineId = l.id;
    }
    const original = l.original + tok.text;
    replaceLast({ original, closed: original.trim().length >= CHAR_LIMIT[lang] });
  }

  return {
    lines: lines.length > MAX_LINES ? lines.slice(lines.length - MAX_LINES) : lines,
    interimOriginal,
    interimVi,
    nextId,
    segLineId,
  };
}

export function closeOpenLine(t: Transcript): Transcript {
  const lines = t.lines.slice();
  const l = lines[lines.length - 1];
  if (l && !l.closed) lines[lines.length - 1] = { ...l, closed: true };
  return { ...t, lines, interimOriginal: "", interimVi: "", segLineId: null };
}
