import { beforeEach, expect, test, vi } from "vitest";
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
let failedTargets: [Lang, ErrorKind][];

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
  failedTargets = [];
  listener = new Listener({
    onTargetFailed: (t, k) => failedTargets.push([t, k]),
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

test("listening khi phiên gốc đã recording, kể cả khi phiên khác còn connecting", () => {
  listener.start(cfg(["en", "vi"], "ja"), ctx());
  recs[1].state("recording");
  expect(status()).toBe("connecting");
  recs[0].state("recording");
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

// SDK 2.6 strips <end> from result tokens and fires a separate "endpoint" event right after.
test("endpoint của SDK kết thúc câu: câu sau sang dòng mới", () => {
  const [a] = listen(cfg(["vi"], "en"));
  a.emit("result", { tokens: [o("Good morning.")] });
  a.emit("endpoint");
  a.emit("result", { tokens: [o(" Today")] });
  expect(lines("vi").map((l) => [l.original, l.closed])).toEqual([
    ["Good morning.", true],
    [" Today", false],
  ]);
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

test("stop treo quá 5 giây → huỷ cả nhóm, về idle", async () => {
  vi.useFakeTimers();
  try {
    const [a, b] = listen(cfg(["en", "vi"], "ja"));
    const done = listener.stop();
    a.resolveStop();
    await vi.advanceTimersByTimeAsync(5000);
    await done;
    expect(b.canceled).toBe(true);
    expect(status()).toBe("idle");
  } finally {
    vi.useRealTimers();
  }
});

test("start với targets rỗng → phiên gốc vi (hoặc en khi nói tiếng Việt)", () => {
  listener.start(cfg([], "ja"), ctx());
  expect(recs.map((r) => r.target)).toEqual(["vi"]);
  listener.cancel();
  listener.start(cfg([], "vi"), ctx());
  expect(recs.at(-1)!.target).toBe("en");
});

test("setTargets thêm ngôn ngữ mở đúng một phiên, phiên cũ không bị dừng", () => {
  const [a] = listen(cfg(["vi"], "en"));
  listener.setTargets(["vi", "ja"]);
  expect(recs.map((r) => r.target)).toEqual(["vi", "ja"]);
  expect(a.stopCalled || a.canceled).toBe(false);
  expect(listener.running).toEqual(["vi", "ja"]);
});

test("status vẫn listening khi phiên mới đang connecting", () => {
  listen(cfg(["vi"], "en"));
  listener.setTargets(["vi", "ja"]);
  recs[1].state("connecting");
  expect(status()).toBe("listening");
});

test("setTargets bớt ngôn ngữ dừng êm đúng phiên đó", () => {
  const [a, b] = listen(cfg(["vi", "ja"], "en"));
  listener.setTargets(["vi"]);
  expect(b.stopCalled).toBe(true);
  expect(a.stopCalled || a.canceled).toBe(false);
  expect(listener.running).toEqual(["vi"]);
  b.resolveStop(); // its "stopped" must not end the group
  expect(status()).toBe("listening");
});

test("không bao giờ bỏ phiên gốc", () => {
  const [a] = listen(cfg(["vi", "ja"], "en"));
  listener.setTargets(["ja"]);
  expect(a.stopCalled).toBe(false);
  expect(listener.pinned).toBe("vi");
  expect(listener.running).toEqual(["vi", "ja"]);
});

test("kết quả phiên mới vào transcript ngôn ngữ đó", () => {
  listen(cfg(["vi"], "en"));
  listener.setTargets(["vi", "ko"]);
  recs[1].emit("result", { tokens: [o("Hi")] });
  expect(lines("ko").map((l) => l.original)).toEqual(["Hi"]);
});

test("setTargets khi idle không làm gì", () => {
  listener.setTargets(["vi"]);
  expect(recs).toHaveLength(0);
});

test("phiên không phải phiên gốc bị lỗi → chỉ bỏ ngôn ngữ đó, phiên gốc vẫn chạy", () => {
  const [a] = listen(cfg(["vi"], "en"));
  listener.setTargets(["vi", "ja"]);
  recs[1].emit("error", new Error("max_concurrent"));
  expect(a.canceled).toBe(false);
  expect(status()).toBe("listening");
  expect(listener.running).toEqual(["vi"]);
  expect(failedTargets).toEqual([["ja", "service"]]);
  expect(errors).toEqual([]);
});

test("ngôn ngữ đã lỗi không bị mở lại liên tục khi setTargets", () => {
  listen(cfg(["vi"], "en"));
  listener.setTargets(["vi", "ja"]);
  recs[1].emit("error", new Error("boom"));
  listener.setTargets(["vi", "ja"]);
  expect(recs).toHaveLength(2);
});

test("phiên gốc bị lỗi → huỷ cả nhóm", () => {
  const [a] = listen(cfg(["vi"], "en"));
  listener.setTargets(["vi", "ja"]);
  a.emit("error", new Error("boom"));
  expect(recs[1].canceled).toBe(true);
  expect(status()).toBe("idle");
  expect(errors).toEqual(["service"]);
});
