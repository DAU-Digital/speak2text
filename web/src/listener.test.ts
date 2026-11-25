import { beforeEach, expect, test } from "vitest";
import { AudioPermissionError, type RealtimeToken } from "@soniox/client";
import { ApiError } from "./api";
import { Listener, type ErrorKind, type ListenConfig, type RecordingLike, type Status } from "./listener";
import { emptyTranscript, type Lang, type Transcript } from "./subtitles";

class FakeRecording {
  handlers = new Map<string, (arg: unknown) => void>();
  canceled = false;
  stopCalled = false;
  private finishStop!: () => void;
  constructor(
    public source: Lang,
    public target: Lang,
    public noteApiError: (e: ApiError) => void,
  ) {}
  on(event: string, h: (arg: unknown) => void) {
    this.handlers.set(event, h);
    return this;
  }
  emit(event: string, arg?: unknown) {
    this.handlers.get(event)?.(arg);
  }
  state(new_state: string) {
    this.emit("state_change", { new_state });
  }
  stop() {
    this.stopCalled = true;
    this.state("stopping");
    return new Promise<void>((resolve) => {
      this.finishStop = () => {
        this.state("stopped");
        resolve();
      };
    });
  }
  resolveStop() {
    this.finishStop();
  }
  cancel() {
    this.canceled = true;
    this.state("canceled");
  }
}

const o = (text: string): RealtimeToken => ({ text, is_final: true, confidence: 1, translation_status: "original" });

let recs: FakeRecording[];
let statuses: Status[];
let errors: ErrorKind[];
let transcripts: Partial<Record<Lang, Transcript>>;
let closedCtx: number;
let listener: Listener;

const ctx = () => ({ close: () => void closedCtx++, state: "running" }) as unknown as AudioContext;
const status = () => statuses[statuses.length - 1];
const cfg = (targets: Lang[] = ["vi"], source: Lang = "en"): ListenConfig => ({ source, targets });
const lines = (l: Lang) => (transcripts[l] ?? emptyTranscript()).lines;

beforeEach(() => {
  recs = [];
  statuses = [];
  errors = [];
  transcripts = {};
  closedCtx = 0;
  listener = new Listener({
    createRecording: (source, target, _ctx, noteApiError) => {
      const r = new FakeRecording(source, target, noteApiError);
      recs.push(r);
      return r as unknown as RecordingLike;
    },
    onStatus: (s) => statuses.push(s),
    onTranscript: (target, f) => (transcripts[target] = f(transcripts[target] ?? emptyTranscript())),
    onError: (k) => errors.push(k),
  });
});

/** Starts and drives every new recording to `recording`. */
function listen(c: ListenConfig = cfg()) {
  const before = recs.length;
  listener.start(c, ctx());
  const created = recs.slice(before);
  for (const r of created) {
    r.state("connecting");
    r.state("recording");
  }
  return created;
}

test("mở một recording cho mỗi ngôn ngữ đầu ra", () => {
  listen(cfg(["en", "vi"], "ja"));
  expect(recs.map((r) => [r.source, r.target])).toEqual([
    ["ja", "en"],
    ["ja", "vi"],
  ]);
  expect(status()).toBe("listening");
});

test("listening chỉ khi mọi phiên đã recording", () => {
  listener.start(cfg(["en", "vi"], "ja"), ctx());
  recs[0].state("recording");
  recs[1].state("connecting");
  expect(status()).toBe("connecting");
  recs[1].state("recording");
  expect(status()).toBe("listening");
});

test("một phiên nối lại → reconnecting cho cả nhóm", () => {
  const [a] = listen(cfg(["en", "vi"], "ja"));
  a.state("reconnecting");
  expect(status()).toBe("reconnecting");
});

test("một phiên lỗi → huỷ tất cả, báo lỗi một lần", () => {
  const [a, b] = listen(cfg(["en", "vi"], "ja"));
  a.emit("error", new Error("boom"));
  b.emit("error", new Error("boom too"));
  a.state("error");
  expect(errors).toEqual(["service"]);
  expect(a.canceled && b.canceled).toBe(true);
  expect(status()).toBe("idle");
});

test("kết quả từng phiên vào đúng transcript của ngôn ngữ đó", () => {
  const [a, b] = listen(cfg(["en", "vi"], "ja"));
  a.emit("result", { tokens: [o("A")] });
  b.emit("result", { tokens: [o("B")] });
  expect(lines("en").map((l) => l.original)).toEqual(["A"]);
  expect(lines("vi").map((l) => l.original)).toEqual(["B"]);
});

test("stop chờ mọi phiên xong mới về idle", async () => {
  const [a, b] = listen(cfg(["en", "vi"], "ja"));
  const done = listener.stop();
  expect(status()).toBe("stopping");
  a.resolveStop();
  await Promise.resolve();
  expect(status()).toBe("stopping");
  b.resolveStop();
  await done;
  expect(status()).toBe("idle");
});

test("một phiên tự kết thúc ngoài ý muốn → dừng cả nhóm, không báo lỗi", () => {
  const [a, b] = listen(cfg(["en", "vi"], "ja"));
  a.state("stopped");
  expect(b.canceled).toBe(true);
  expect(status()).toBe("idle");
  expect(errors).toEqual([]);
});

test("bấm micro trong lúc đang dừng không mở thêm recording", () => {
  listen();
  void listener.stop();
  listener.start(cfg(), ctx());
  expect(recs).toHaveLength(1);
  expect(closedCtx).toBe(1);
});

test("stop cũ xong muộn không ghi đè status của recording mới", async () => {
  const [a] = listen();
  const done = listener.stop();
  listener.cancel();
  const [b] = listen();
  a.resolveStop();
  await done;
  expect(status()).toBe("listening");
  expect(b.canceled).toBe(false);
});

test("restart khi đang nghe: stop êm, chữ về trong lúc dừng vẫn giữ, rồi mở lại với cấu hình mới", async () => {
  const [a] = listen(cfg(["vi"], "en"));
  a.emit("result", { tokens: [o("Hello")] });
  const done = listener.restart(cfg(["en", "vi"], "ja"), ctx());
  expect(a.stopCalled).toBe(true);
  expect(a.canceled).toBe(false);
  a.emit("result", { tokens: [o(" world")] });
  a.resolveStop();
  await done;
  expect(lines("vi").map((l) => [l.original, l.closed])).toEqual([["Hello world", true]]);
  expect(recs.slice(1).map((r) => [r.source, r.target])).toEqual([
    ["ja", "en"],
    ["ja", "vi"],
  ]);
});

test("restart: kết quả muộn của phiên cũ bị bỏ qua", async () => {
  const [a] = listen(cfg(["vi"], "en"));
  const done = listener.restart(cfg(["vi"], "ja"), ctx());
  a.resolveStop();
  await done;
  const before = JSON.stringify(transcripts);
  a.emit("result", { tokens: [o("late")] });
  expect(JSON.stringify(transcripts)).toBe(before);
});

test("restart hai lần liên tiếp chỉ còn một nhóm sống", async () => {
  const [a] = listen(cfg(["vi"], "en"));
  const first = listener.restart(cfg(["vi"], "ja"), ctx());
  const second = listener.restart(cfg(["vi"], "ko"), ctx());
  a.resolveStop();
  await Promise.all([first, second]);
  const alive = recs.filter((r) => !r.canceled);
  expect(alive).toHaveLength(1);
  expect(alive[0].source).toBe("ko");
});

test("restart khi idle không mở recording và đóng ctx thừa", async () => {
  await listener.restart(cfg(), ctx());
  expect(recs).toHaveLength(0);
  expect(closedCtx).toBe(1);
});

test("lỗi 401 khi xin key → expired", () => {
  listener.start(cfg(), ctx());
  recs[0].noteApiError(new ApiError(401));
  recs[0].emit("error", new Error("config failed"));
  expect(errors).toEqual(["expired"]);
  expect(status()).toBe("idle");
});

test("từ chối micro → permission", () => {
  listener.start(cfg(), ctx());
  recs[0].emit("error", new AudioPermissionError("denied"));
  expect(errors).toEqual(["permission"]);
});

test("lỗi sau khi đang nối lại → network", () => {
  const [r] = listen();
  r.state("reconnecting");
  r.emit("error", new Error("gave up"));
  expect(errors).toEqual(["network"]);
});

test("dừng giữa câu → phần đã final thành dòng đã chốt", async () => {
  const [a] = listen();
  a.emit("result", { tokens: [o("Half")] });
  const done = listener.stop();
  a.resolveStop();
  await done;
  expect(lines("vi")[0]).toMatchObject({ original: "Half", closed: true });
});

test("kết quả của recording đã huỷ bị bỏ qua", () => {
  const [a] = listen();
  listener.cancel();
  a.emit("result", { tokens: [o("late")] });
  expect(lines("vi")).toEqual([]);
});
