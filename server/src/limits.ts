export function createLoginGuard(opts: { maxFails: number; lockMs: number }) {
  const state = new Map<string, { fails: number; lockedUntil: number }>();
  return {
    isLocked(ip: string, now: number): boolean {
      const s = state.get(ip);
      if (!s || s.lockedUntil === 0) return false;
      if (now < s.lockedUntil) return true;
      state.delete(ip);
      return false;
    },
    fail(ip: string, now: number): void {
      const s = state.get(ip) ?? { fails: 0, lockedUntil: 0 };
      s.fails += 1;
      if (s.fails >= opts.maxFails) {
        s.fails = 0;
        s.lockedUntil = now + opts.lockMs;
      }
      state.set(ip, s);
    },
    reset(ip: string): void {
      state.delete(ip);
    },
  };
}

export function createKeyLimiter(opts: { max: number; windowMs: number }) {
  const windows = new Map<string, { start: number; count: number }>();
  return {
    allow(key: string, now: number): boolean {
      let w = windows.get(key);
      if (!w || now - w.start >= opts.windowMs) {
        w = { start: now, count: 0 };
        windows.set(key, w);
      }
      if (w.count >= opts.max) return false;
      w.count += 1;
      return true;
    },
  };
}
