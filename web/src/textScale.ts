// Subtitle text size steps (A− / A+), remembered per device.

export const TEXT_SCALES = [0.8, 0.9, 1, 1.15, 1.3, 1.5, 1.75];
const KEY = "s2t.textScale";

/** Moves `dir` steps from the step nearest to `current`, stopping at both ends. */
export function stepScale(current: number, dir: number): number {
  const value = Number.isFinite(current) ? current : 1;
  let i = 0;
  TEXT_SCALES.forEach((s, j) => {
    if (Math.abs(s - value) < Math.abs(TEXT_SCALES[i] - value)) i = j;
  });
  return TEXT_SCALES[Math.min(TEXT_SCALES.length - 1, Math.max(0, i + dir))];
}

export function loadScale(): number {
  try {
    const v = localStorage.getItem(KEY);
    return stepScale(v === null ? 1 : Number(v), 0);
  } catch {
    return 1;
  }
}

export function saveScale(v: number): void {
  try {
    localStorage.setItem(KEY, String(v));
  } catch {
    // private mode: the size lasts for this page only
  }
}
