// Microphone level for the host's meter, computed from the PCM chunks the mic already produces.

/** RMS of one pcm_s16le chunk: 0 (silence) … 1 (full scale). */
export function pcmLevel(buf: ArrayBuffer): number {
  const s = new Int16Array(buf);
  if (!s.length) return 0;
  let sum = 0;
  for (const v of s) sum += (v / 32768) ** 2;
  return Math.sqrt(sum / s.length);
}

/** Meter fill 0…1 on a dB scale: -50 dB and below is empty, -10 dB and above is full. */
export function levelToMeter(rms: number): number {
  if (rms <= 0) return 0;
  const db = 20 * Math.log10(rms);
  return Math.min(1, Math.max(0, (db + 50) / 40));
}

/** Latest level of the live microphone; read by the meter on each animation frame. */
export const micLevel = { current: 0 };
