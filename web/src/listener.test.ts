import { beforeEach, expect, test, vi } from "vitest";
import { AudioPermissionError, type RealtimeToken } from "@soniox/client";
import { ApiError } from "./api";
import { Listener, type ErrorKind, type RecordingLike, type Status } from "./listener";
import { emptyTranscript, type Lang, type Transcript } from "./subtitles";

class FakeRecording {
  handlers = new Map<string, (arg: unknown) => void>();
  canceled = false;
  stopCalled = false;
  private finishStop!: () => void;
  constructor(public lang: Lang, public noteApiError: (e: ApiError) => void) {}
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
let transcript: Transcript;
let closedCtx: number;
let listener: Listener;

const ctx = () => ({ close: () => void closedCtx++, state: "running" }) as unknown as AudioContext;
const status = () => statuses[statuses.length - 1];
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  recs = [];
  statuses = [];
  errors = [];
  transcript = emptyTranscript();
  closedCtx = 0;
  listener = new Listener({
    createRecording: (lang, _ctx, noteApiError) => {
      const r = new FakeRecording(lang, noteApiError);
      recs.push(r);
      return r as unknown as RecordingLike;
    },
    onStatus: (s) => statuses.push(s),
    onTranscript: (f) => (transcript = f(transcript)),
    onError: (k) => errors.push(k),
  });
});

function listen(lang: Lang = "en") {
  listener.start(lang, ctx());
  const r = recs[recs.length - 1];
  r.state("connecting");
  r.state("recording");
  return r;
}

test("trong lúc dừng status là stopping, dừng xong mới về idle", async () => {
  const a = listen();
  const done = listener.stop();
  expect(status()).toBe("stopping");
  a.resolveStop();
  await done;
  expect(status()).toBe("idle");
});

test("bấm micro trong lúc đang dừng không mở thêm recording", () => {
  listen();
  void listener.stop();
  listener.start("en", ctx());
  expect(recs).toHaveLength(1);
  expect(closedCtx).toBe(1);
});

test("stop cũ xong muộn không ghi đè status của recording mới", async () => {
  const a = listen();
  const done = listener.stop();
  listener.cancel();
  const b = listen();
  a.resolveStop();
  await done;
  expect(status()).toBe("listening");
  expect(b.canceled).toBe(false);
});

test("đổi ngôn ngữ khi đang nghe: chờ stop xong, chữ về trong lúc dừng vẫn được giữ, rồi mở recording mới", async () => {
  const a = listen("en");
  a.emit("result", { tokens: [o("Hello")] });
  const done = listener.switchLang("ja", ctx());
  expect(a.stopCalled).toBe(true);
  expect(a.canceled).toBe(false);
  a.emit("result", { tokens: [o(" world")] });
  a.resolveStop();
  await done;
  expect(transcript.lines.map((l) => [l.original, l.closed])).toEqual([["Hello world", true]]);
  expect(recs).toHaveLength(2);
  expect(recs[1].lang).toBe("ja");
});

test("đổi ngôn ngữ hai lần liên tiếp chỉ còn một recording sống", async () => {
  const a = listen("en");
  const first = listener.switchLang("ja", ctx());
  const second = listener.switchLang("en", ctx());
  a.resolveStop();
  await Promise.all([first, second]);
  const alive = recs.filter((r) => !r.canceled);
  expect(alive).toHaveLength(1);
  expect(alive[0].lang).toBe("en");
});

test("đổi ngôn ngữ khi idle không mở recording và đóng ctx thừa", async () => {
  await listener.switchLang("ja", ctx());
  expect(recs).toHaveLength(0);
  expect(closedCtx).toBe(1);
});

test("lỗi 401 khi xin key → expired", async () => {
  listener.start("en", ctx());
  const r = recs[0];
  r.noteApiError(new ApiError(401));
  r.emit("error", new Error("config failed"));
  await flush();
  expect(errors).toEqual(["expired"]);
  expect(status()).toBe("idle");
});

test("từ chối micro → permission", () => {
  listener.start("en", ctx());
  recs[0].emit("error", new AudioPermissionError("denied"));
  expect(errors).toEqual(["permission"]);
});

test("lỗi sau khi đang nối lại → network", () => {
  const r = listen();
  r.state("reconnecting");
  expect(status()).toBe("reconnecting");
  r.emit("error", new Error("gave up"));
  expect(errors).toEqual(["network"]);
  expect(status()).toBe("idle");
});

test("lỗi khác → service, chỉ báo một lần dù state error đến sau", () => {
  const r = listen();
  r.emit("error", new Error("boom"));
  r.state("error");
  expect(errors).toEqual(["service"]);
});

test("dừng giữa câu → phần đã final thành dòng đã chốt", async () => {
  const a = listen();
  a.emit("result", { tokens: [o("Half")] });
  const done = listener.stop();
  a.resolveStop();
  await done;
  expect(transcript.lines[0]).toMatchObject({ original: "Half", closed: true });
});

test("kết quả của recording đã huỷ bị bỏ qua", () => {
  const a = listen();
  listener.cancel();
  a.emit("result", { tokens: [o("late")] });
  expect(transcript.lines).toEqual([]);
});
