// WebSocket relay for subtitle rooms at /ws. The host's browser sends recent lines per language;
// the server keeps the last 50 and forwards them to viewers who chose that language.
import { randomUUID } from "node:crypto";
import type http from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import { isLang, normalizeRoomCode, type Lang, type Line, type RoomRegistry } from "./rooms.js";

type Options = {
  registry: RoomRegistry;
  /** Set only when a passcode is configured: checks the session token a host sends. */
  hostAuth?: (token: string | undefined) => boolean;
  maxConnsPerIp: number;
  pingMs: number;
  sweepMs: number;
};

type Conn = {
  ws: WebSocket;
  ip: string;
  alive: boolean;
  role: "host" | "viewer" | null;
  room: string | null;
  viewerId: string | null;
  langs: Lang[];
};

type Incoming = Record<string, unknown>;

function clientIp(req: http.IncomingMessage): string {
  const fwd = req.headers["x-forwarded-for"];
  const last = (Array.isArray(fwd) ? fwd.join(",") : (fwd ?? "")).split(",").pop()?.trim();
  return last || req.socket.remoteAddress || "unknown";
}

const langsOf = (x: unknown): Lang[] | null => (Array.isArray(x) ? [...new Set(x.filter(isLang))] : null);
const linesOf = (x: unknown): Line[] | null =>
  Array.isArray(x) ? (x.filter((l) => l && typeof l === "object") as Line[]) : null;

export function attachRooms(server: http.Server, opts: Options): { close(): void } {
  const { registry } = opts;
  const wss = new WebSocketServer({ server, path: "/ws", maxPayload: 256 * 1024 });
  const perIp = new Map<string, number>();
  const hosts = new Map<string, Conn>();
  const viewers = new Map<string, Set<Conn>>();

  const send = (c: Conn, msg: object) => {
    if (c.ws.readyState === WebSocket.OPEN) c.ws.send(JSON.stringify(msg));
  };
  const fail = (c: Conn, code: string) => {
    send(c, { t: "error", code });
    c.ws.close();
  };
  const broadcastRoom = (room: string) => {
    const info = registry.info(room);
    viewers.get(room)?.forEach((v) => send(v, { t: "room", ...info }));
  };
  const sendDemand = (room: string) => {
    const h = hosts.get(room);
    if (h) send(h, { t: "demand", langs: registry.demand(room), viewers: registry.viewerCount(room) });
  };
  const sendLines = (c: Conn, room: string, lang: Lang) => {
    const lines = registry.lines(room, lang);
    if (lines.length) send(c, { t: "lines", lang, lines });
  };

  function handshake(c: Conn, m: Incoming) {
    const room = normalizeRoomCode(m.room);
    if (m.t === "host") {
      if (!room) return fail(c, "invalid");
      if (opts.hostAuth && !opts.hostAuth(typeof m.token === "string" ? m.token : undefined)) {
        return fail(c, "unauthorized");
      }
      const claim = registry.claimHost(room, typeof m.hostKey === "string" ? m.hostKey : undefined);
      if (!claim.ok) return fail(c, claim.code);
      const previous = hosts.get(room);
      c.role = "host";
      c.room = room;
      hosts.set(room, c);
      if (previous && previous !== c) {
        previous.room = null; // its close must not mark the room as left
        previous.ws.close(4000, "replaced by a newer host connection");
      }
      send(c, { t: "hello", hostKey: claim.hostKey });
      sendDemand(room);
      broadcastRoom(room);
      return;
    }
    if (m.t === "viewer") {
      const langs = langsOf(m.langs);
      if (!room || !langs) return fail(c, "invalid");
      const id = randomUUID();
      const added = registry.addViewer(room, id, langs);
      if (!added.ok) return fail(c, added.code);
      c.role = "viewer";
      c.room = room;
      c.viewerId = id;
      c.langs = langs;
      if (!viewers.has(room)) viewers.set(room, new Set());
      viewers.get(room)!.add(c);
      send(c, { t: "room", ...registry.info(room) });
      langs.forEach((l) => sendLines(c, room, l));
      sendDemand(room);
      return;
    }
    fail(c, "invalid");
  }

  function onHost(c: Conn, room: string, m: Incoming) {
    if (m.t === "state") {
      const activeLangs = langsOf(m.activeLangs);
      if (!isLang(m.source) || typeof m.listening !== "boolean" || !activeLangs) return;
      registry.setState(room, { source: m.source, listening: m.listening, activeLangs });
      broadcastRoom(room);
      sendDemand(room);
    } else if (m.t === "lines") {
      const lines = linesOf(m.lines);
      if (!isLang(m.lang) || !lines) return;
      const lang = m.lang;
      const stored = registry.setLines(room, lang, lines);
      viewers.get(room)?.forEach((v) => {
        if (v.langs.includes(lang)) send(v, { t: "lines", lang, lines: stored });
      });
    }
  }

  function onViewer(c: Conn, room: string, m: Incoming) {
    if (m.t !== "langs") return;
    const langs = langsOf(m.langs);
    if (!langs) return;
    const added = langs.filter((l) => !c.langs.includes(l));
    c.langs = langs;
    registry.setViewerLangs(room, c.viewerId!, langs);
    added.forEach((l) => sendLines(c, room, l));
    sendDemand(room);
  }

  function cleanup(c: Conn) {
    const room = c.room;
    if (!room) return;
    if (c.role === "host" && hosts.get(room) === c) {
      hosts.delete(room);
      registry.hostLeft(room);
      broadcastRoom(room);
    } else if (c.role === "viewer") {
      viewers.get(room)?.delete(c);
      if (viewers.get(room)?.size === 0) viewers.delete(room);
      registry.removeViewer(room, c.viewerId!);
      sendDemand(room);
    }
  }

  wss.on("connection", (ws, req) => {
    const ip = clientIp(req);
    const count = (perIp.get(ip) ?? 0) + 1;
    if (count > opts.maxConnsPerIp) {
      ws.close(1008, "too many connections");
      return;
    }
    perIp.set(ip, count);
    const c: Conn = { ws, ip, alive: true, role: null, room: null, viewerId: null, langs: [] };

    ws.on("pong", () => (c.alive = true));
    ws.on("error", () => {});
    ws.on("message", (data) => {
      let m: unknown;
      try {
        m = JSON.parse(String(data));
      } catch {
        if (!c.role) fail(c, "invalid");
        return;
      }
      if (!m || typeof m !== "object") return;
      if (!c.role) return handshake(c, m as Incoming);
      if (!c.room) return;
      if (c.role === "host") onHost(c, c.room, m as Incoming);
      else onViewer(c, c.room, m as Incoming);
    });
    ws.on("close", () => {
      const left = (perIp.get(ip) ?? 1) - 1;
      if (left > 0) perIp.set(ip, left);
      else perIp.delete(ip);
      cleanup(c);
    });
  });

  // Keeps connections alive through proxies (nginx cuts idle ones after 60 s) and drops dead ones.
  const ping = setInterval(() => {
    for (const ws of wss.clients) {
      const c = [...hosts.values(), ...[...viewers.values()].flatMap((s) => [...s])].find((x) => x.ws === ws);
      if (c && !c.alive) {
        ws.terminate();
        continue;
      }
      if (c) c.alive = false;
      ws.ping();
    }
  }, opts.pingMs);
  const sweep = setInterval(() => registry.sweep().forEach(broadcastRoom), opts.sweepMs);

  return {
    close() {
      clearInterval(ping);
      clearInterval(sweep);
      for (const ws of wss.clients) ws.terminate();
      wss.close();
    },
  };
}
