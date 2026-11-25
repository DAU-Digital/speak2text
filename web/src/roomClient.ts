// WebSocket clients for subtitle rooms (server: server/src/roomsWs.ts). Both reconnect on their own
// after 1, 2, 4, 8 s and then every 10 s; the host replays its last state and lines after reconnecting.
import type { Lang } from "./languages";
import type { DisplayLine } from "./subtitles";

export type RoomInfo = {
  exists: boolean;
  source: Lang | null;
  listening: boolean;
  hostOnline: boolean;
  activeLangs: Lang[];
};
export type HostState = { source: Lang; listening: boolean; activeLangs: Lang[] };
export type LinkStatus = "connecting" | "open" | "closed";

const BACKOFF_MS = [1000, 2000, 4000, 8000, 10000];
const FATAL = new Set(["taken", "unauthorized", "invalid", "full"]);

/** Same rule as the server: lowercase a-z, 0-9 and "-", 3–32 characters. */
export function normalizeRoomCode(raw: string): string | null {
  const code = raw.trim().toLowerCase();
  return /^[a-z0-9-]{3,32}$/.test(code) ? code : null;
}

export const roomLink = (origin: string, code: string): string => `${origin}/r/${code}`;

/** Room code from a /r/<code> path (lowercased), or null for other paths. Never throws. */
export function parseRoomPath(pathname: string): string | null {
  const seg = /^\/r\/([^/]+)\/?$/.exec(pathname)?.[1];
  if (!seg) return null;
  try {
    return decodeURIComponent(seg).toLowerCase();
  } catch {
    return seg.toLowerCase();
  }
}

/** Close code the server uses when a newer host connection for the same room takes over. */
const REPLACED = 4000;

export function wsUrl(): string {
  return `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/ws`;
}

type SocketFactory = (url: string) => WebSocket;
type Common = { socket?: SocketFactory; url?: string; onStatus: (s: LinkStatus) => void };

/** Opens a socket, reconnecting with backoff until stop() or a fatal error. */
function reconnecting(
  o: Common,
  handlers: {
    onOpen(ws: WebSocket): void;
    onMessage(ws: WebSocket, m: Record<string, unknown>): void;
    onReplaced?(): void;
  },
) {
  const make = o.socket ?? ((url: string) => new WebSocket(url));
  let ws: WebSocket | null = null;
  let attempt = 0;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const connect = () => {
    if (stopped) return;
    o.onStatus("connecting");
    const sock = make(o.url ?? wsUrl());
    ws = sock;
    sock.onopen = () => handlers.onOpen(sock);
    sock.onmessage = (e: MessageEvent) => {
      let m: unknown;
      try {
        m = JSON.parse(String(e.data));
      } catch {
        return;
      }
      if (m && typeof m === "object") handlers.onMessage(sock, m as Record<string, unknown>);
    };
    sock.onerror = () => {};
    sock.onclose = (e: CloseEvent) => {
      if (ws !== sock) return;
      ws = null;
      o.onStatus("closed");
      if (e?.code === REPLACED && handlers.onReplaced) {
        stopped = true;
        handlers.onReplaced();
        return;
      }
      if (stopped) return;
      timer = setTimeout(connect, BACKOFF_MS[Math.min(attempt++, BACKOFF_MS.length - 1)]);
    };
  };

  connect();
  return {
    send(m: object) {
      if (ws && ws.readyState === 1) ws.send(JSON.stringify(m));
    },
    resetBackoff() {
      attempt = 0;
    },
    stop() {
      stopped = true;
      clearTimeout(timer);
      ws?.close();
    },
  };
}

export function connectHost(o: Common & {
  room: string;
  hostKey?: string;
  token?: string;
  onHello(hostKey: string): void;
  onDemand(d: { langs: Lang[]; viewers: number }): void;
  onError(code: string): void;
}): { sendState(s: HostState): void; sendLines(lang: Lang, lines: DisplayLine[]): void; close(): void } {
  let hostKey = o.hostKey;
  let ready = false; // true once the server said hello on the current socket
  let lastState: HostState | null = null;
  const lastLines = new Map<Lang, DisplayLine[]>();

  const link = reconnecting(
    { ...o, onStatus: (s) => (s !== "open" && (ready = false), o.onStatus(s)) },
    {
      onOpen() {
        link.send({ t: "host", room: o.room, ...(hostKey ? { hostKey } : {}), ...(o.token ? { token: o.token } : {}) });
      },
      onMessage(_ws, m) {
        if (m.t === "hello" && typeof m.hostKey === "string") {
          hostKey = m.hostKey;
          ready = true;
          link.resetBackoff();
          o.onStatus("open");
          o.onHello(hostKey);
          if (lastState) link.send({ t: "state", ...lastState });
          for (const [lang, lines] of lastLines) link.send({ t: "lines", lang, lines });
        } else if (m.t === "demand" && Array.isArray(m.langs)) {
          o.onDemand({ langs: m.langs as Lang[], viewers: Number(m.viewers) || 0 });
        } else if (m.t === "error" && typeof m.code === "string") {
          if (FATAL.has(m.code)) link.stop();
          o.onError(m.code);
        }
      },
      // Another tab took over this room: reconnecting would just kick it back, forever.
      onReplaced: () => o.onError("replaced"),
    },
  );

  return {
    sendState(s) {
      lastState = s;
      if (ready) link.send({ t: "state", ...s });
    },
    sendLines(lang, lines) {
      lastLines.set(lang, lines);
      if (ready) link.send({ t: "lines", lang, lines });
    },
    close() {
      link.stop();
    },
  };
}

export function connectViewer(o: Common & {
  room: string;
  langs: Lang[];
  onRoom(r: RoomInfo): void;
  onLines(lang: Lang, lines: DisplayLine[]): void;
  onError?(code: string): void;
}): { setLangs(langs: Lang[]): void; close(): void } {
  let langs = o.langs;
  let open = false;

  const link = reconnecting(
    { ...o, onStatus: (s) => (s !== "open" && (open = false), o.onStatus(s)) },
    {
      onOpen() {
        open = true;
        link.resetBackoff();
        o.onStatus("open");
        link.send({ t: "viewer", room: o.room, langs });
      },
      onMessage(_ws, m) {
        if (m.t === "room") {
          const { t: _t, ...info } = m;
          o.onRoom(info as unknown as RoomInfo);
        } else if (m.t === "lines" && typeof m.lang === "string" && Array.isArray(m.lines)) {
          o.onLines(m.lang as Lang, m.lines as DisplayLine[]);
        } else if (m.t === "error" && typeof m.code === "string") {
          if (FATAL.has(m.code)) link.stop();
          o.onError?.(m.code);
        }
      },
    },
  );

  return {
    setLangs(next) {
      langs = next;
      if (open) link.send({ t: "langs", langs });
    },
    close() {
      link.stop();
    },
  };
}
