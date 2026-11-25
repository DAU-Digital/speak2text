// Space toggles the host's mic, except while typing or when a button has focus (Space clicks it).

type KeyLike = {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  repeat: boolean;
  target: unknown;
};

const SKIP = ["INPUT", "TEXTAREA", "SELECT", "BUTTON"];

export function isMicShortcut(e: KeyLike): boolean {
  if (e.key !== " " || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return false;
  const t = e.target as { tagName?: string; isContentEditable?: boolean } | null;
  return !t || (!t.isContentEditable && !SKIP.includes(t.tagName ?? ""));
}
