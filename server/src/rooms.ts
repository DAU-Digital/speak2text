// In-memory subtitle rooms: one host per room (proved by a secret hostKey), many viewers.
// No sockets here — roomsWs.ts wires this to WebSocket connections.

export type Lang = "en" | "ja" | "vi" | "zh" | "ko";
export const LANGS: Lang[] = ["en", "ja", "vi", "zh", "ko"];
export const isLang = (x: unknown): x is Lang => LANGS.includes(x as Lang);

export type Line = { id: number; original: string; translation: string; live: boolean };
export type RoomInfo = {
  exists: boolean;
  source: Lang | null;
  listening: boolean;
  hostOnline: boolean;
  activeLangs: Lang[];
};

export const MAX_LINES = 50;
export const MAX_LINE_CHARS = 1000;
const CODE_RE = /^[a-z0-9-]{3,32}$/;

export function normalizeRoomCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const code = raw.trim().toLowerCase();
  return CODE_RE.test(code) ? code : null;
}

type Room = {
  hostKey: string | null; // null = waiting room created by viewers, no host yet
  hostOnline: boolean;
  hostLeftAt: number | null;
  source: Lang | null;
  listening: boolean;
  activeLangs: Lang[];
  lines: Map<Lang, Line[]>;
  viewers: Map<string, Lang[]>;
};

type Options = { maxRooms: number; maxViewers: number; graceMs: number; now: () => number; newKey: () => string };

const emptyRoom = (): Room => ({
  hostKey: null,
  hostOnline: false,
  hostLeftAt: null,
  source: null,
  listening: false,
  activeLangs: [],
  lines: new Map(),
  viewers: new Map(),
});

export class RoomRegistry {
  private readonly rooms = new Map<string, Room>();

  constructor(private readonly opts: Options) {}

  claimHost(code: string, hostKey?: string): { ok: true; hostKey: string } | { ok: false; code: "taken" | "full" } {
    this.expire(code);
    let room = this.rooms.get(code);
    if (!room) {
      if (this.rooms.size >= this.opts.maxRooms) return { ok: false, code: "full" };
      room = emptyRoom();
      this.rooms.set(code, room);
    }
    if (room.hostKey !== null && room.hostKey !== hostKey) return { ok: false, code: "taken" };
    room.hostKey ??= this.opts.newKey();
    room.hostOnline = true;
    room.hostLeftAt = null;
    return { ok: true, hostKey: room.hostKey };
  }

  hostLeft(code: string): void {
    const room = this.rooms.get(code);
    if (!room || room.hostKey === null) return;
    room.hostOnline = false;
    room.listening = false;
    room.hostLeftAt = this.opts.now();
  }

  setState(code: string, s: { source: Lang; listening: boolean; activeLangs: Lang[] }): void {
    const room = this.rooms.get(code);
    if (!room || room.hostKey === null) return;
    room.source = s.source;
    room.listening = s.listening;
    room.activeLangs = LANGS.filter((l) => s.activeLangs.includes(l));
  }

  setLines(code: string, lang: Lang, lines: Line[]): Line[] {
    const room = this.rooms.get(code);
    if (!room || room.hostKey === null) return [];
    const clip = (s: unknown) => (typeof s === "string" ? s.slice(0, MAX_LINE_CHARS) : "");
    const stored = lines.slice(-MAX_LINES).map((l) => ({
      id: Number.isFinite(l.id) ? l.id : 0,
      original: clip(l.original),
      translation: clip(l.translation),
      live: !!l.live,
    }));
    room.lines.set(lang, stored);
    return stored;
  }

  addViewer(code: string, id: string, langs: Lang[]): { ok: true } | { ok: false; code: "full" } {
    let room = this.rooms.get(code);
    if (!room) {
      if (this.rooms.size >= this.opts.maxRooms) return { ok: false, code: "full" };
      room = emptyRoom();
      this.rooms.set(code, room);
    }
    if (room.viewers.size >= this.opts.maxViewers) return { ok: false, code: "full" };
    room.viewers.set(id, langs);
    return { ok: true };
  }

  setViewerLangs(code: string, id: string, langs: Lang[]): void {
    const room = this.rooms.get(code);
    if (room?.viewers.has(id)) room.viewers.set(id, langs);
  }

  removeViewer(code: string, id: string): void {
    const room = this.rooms.get(code);
    if (!room) return;
    room.viewers.delete(id);
    if (room.hostKey === null && room.viewers.size === 0) this.rooms.delete(code);
  }

  info(code: string): RoomInfo {
    const room = this.rooms.get(code);
    if (!room || room.hostKey === null) {
      return { exists: false, source: null, listening: false, hostOnline: false, activeLangs: [] };
    }
    return {
      exists: true,
      source: room.source,
      listening: room.hostOnline && room.listening,
      hostOnline: room.hostOnline,
      activeLangs: [...room.activeLangs],
    };
  }

  lines(code: string, lang: Lang): Line[] {
    return this.rooms.get(code)?.lines.get(lang) ?? [];
  }

  demand(code: string): Lang[] {
    const room = this.rooms.get(code);
    if (!room) return [];
    const wanted = new Set<Lang>();
    for (const langs of room.viewers.values()) langs.forEach((l) => wanted.add(l));
    return LANGS.filter((l) => wanted.has(l) && l !== room.source);
  }

  viewerCount(code: string): number {
    return this.rooms.get(code)?.viewers.size ?? 0;
  }

  /** Expires rooms whose host left more than graceMs ago. Returns the codes that changed. */
  sweep(): string[] {
    const changed: string[] = [];
    for (const code of [...this.rooms.keys()]) if (this.expire(code)) changed.push(code);
    return changed;
  }

  private expire(code: string): boolean {
    const room = this.rooms.get(code);
    if (!room || room.hostKey === null || room.hostOnline || room.hostLeftAt === null) return false;
    if (this.opts.now() - room.hostLeftAt <= this.opts.graceMs) return false;
    if (room.viewers.size === 0) {
      this.rooms.delete(code);
    } else {
      const viewers = room.viewers;
      this.rooms.set(code, { ...emptyRoom(), viewers });
    }
    return true;
  }
}
