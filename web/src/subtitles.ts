// Groups the Soniox token stream into subtitle lines.
//
// Observed order in real traces: NOT YET CAPTURED (Soniox account had no balance on 2026-11-25).
// Rule until traces exist: final translation tokens go to the newest line of the current segment
// (segment = tokens between two `<end>`s); if VI arrives after `<end>` and before the next
// original token, it goes to the last line.
import type { RealtimeToken } from "@soniox/client";
import type { Lang } from "./languages";

export type { Lang } from "./languages";
export type Line = { id: number; original: string; translation: string; closed: boolean };
export type Transcript = {
  lines: Line[];
  interimOriginal: string;
  interimTranslation: string;
  nextId: number;
  segLineId: number | null;
};

export const MAX_LINES = 300;
export const CHAR_LIMIT: Record<Lang, number> = { en: 180, vi: 180, ja: 70, zh: 70, ko: 100 };

export function emptyTranscript(): Transcript {
  return { lines: [], interimOriginal: "", interimTranslation: "", nextId: 1, segLineId: null };
}

const isTranslation = (t: RealtimeToken) => t.translation_status === "translation";

export function applyTokens(t: Transcript, tokens: RealtimeToken[], lang: Lang): Transcript {
  const lines = t.lines.slice();
  let { nextId, segLineId } = t;
  let interimOriginal = "";
  let interimTranslation = "";

  const last = () => lines[lines.length - 1];
  const replaceLast = (patch: Partial<Line>) => {
    lines[lines.length - 1] = { ...last(), ...patch };
  };
  const openLine = () => {
    const line: Line = { id: nextId++, original: "", translation: "", closed: false };
    lines.push(line);
    return line;
  };

  for (const tok of tokens) {
    if (!tok.is_final) {
      if (isTranslation(tok)) interimTranslation += tok.text;
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
      // No line to attach to (e.g. the screen was just cleared): drop it rather than show VI alone.
      if (idx === -1) continue;
      lines[idx] = { ...lines[idx], translation: lines[idx].translation + tok.text };
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
    interimTranslation,
    nextId,
    segLineId,
  };
}

export function closeOpenLine(t: Transcript): Transcript {
  const lines = t.lines.slice();
  const l = lines[lines.length - 1];
  if (l && !l.closed) lines[lines.length - 1] = { ...l, closed: true };
  return { ...t, lines, interimOriginal: "", interimTranslation: "", segLineId: null };
}

/** Empties the screen but keeps the id counter, so React keys never repeat. */
export function clearTranscript(t: Transcript): Transcript {
  return { ...emptyTranscript(), nextId: t.nextId };
}

export type Subtitle = { original: string; translation: string; live: boolean };

/** The single subtitle to show: the sentence being spoken, else the last finished one. */
export function currentSubtitle(t: Transcript): Subtitle | null {
  const last = t.lines[t.lines.length - 1];
  const open = last && !last.closed ? last : null;
  const hasInterim = (t.interimOriginal + t.interimTranslation).trim().length > 0;
  let sub: Subtitle | null = null;
  if (open || hasInterim) {
    sub = {
      original: ((open?.original ?? "") + t.interimOriginal).trim(),
      translation: ((open?.translation ?? "") + t.interimTranslation).trim(),
      live: true,
    };
  } else if (last) {
    sub = { original: last.original.trim(), translation: last.translation.trim(), live: false };
  }
  return sub && (sub.original || sub.translation) ? sub : null;
}
