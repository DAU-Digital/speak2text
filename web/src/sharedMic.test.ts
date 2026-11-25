import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { AudioPermissionError } from "@soniox/client";
import { SharedMic } from "./sharedMic";

type FakeNode = { name: string; connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn>; gain?: { value: number } };

const node = (name: string): FakeNode => ({ name, connect: vi.fn(), disconnect: vi.fn() });

let calls: string[];
let destination: FakeNode;
let worklet: FakeNode & { port: { onmessage: unknown } };
let gains: FakeNode[];
let ctx: AudioContext;
let gum: ReturnType<typeof vi.fn>;
let closeCtx: ReturnType<typeof vi.fn>;

beforeEach(() => {
  calls = [];
  destination = node("destination");
  gains = [];
  const fakeCtx = {
    state: "suspended",
    destination,
    sampleRate: 48000,
    audioWorklet: { addModule: vi.fn(async () => void calls.push("addModule")) },
    resume: vi.fn(async () => void calls.push("resume")),
    close: (closeCtx = vi.fn(async () => {})),
    createMediaStreamSource: vi.fn(() => node("input")),
    createGain: vi.fn(() => {
      const g = { ...node("gain"), gain: { value: 1 } };
      gains.push(g);
      return g;
    }),
  };
  ctx = fakeCtx as unknown as AudioContext;
  vi.stubGlobal(
    "AudioWorkletNode",
    class {
      constructor() {
        worklet = { ...node("worklet"), port: { onmessage: null } };
        return worklet;
      }
    },
  );
  vi.stubGlobal("navigator", {
    mediaDevices: {
      getUserMedia: (gum = vi.fn(async () => {
        calls.push("getUserMedia");
        return { getAudioTracks: () => [], getTracks: () => [] };
      })),
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const handlers = () => ({ onData: vi.fn(), onError: vi.fn() });

test("worklet được nối tới destination qua gain 0 để Safari chịu chạy process()", async () => {
  await new SharedMic(ctx).source().start(handlers());
  const mute = gains.find((g) => worklet.connect.mock.calls.some(([target]) => target === g));
  expect(mute).toBeDefined();
  expect(mute!.gain!.value).toBe(0);
  expect(mute!.connect).toHaveBeenCalledWith(destination);
});

test("resume AudioContext sau khi có quyền micro", async () => {
  await new SharedMic(ctx).source().start(handlers());
  expect(calls.indexOf("resume")).toBeGreaterThan(calls.indexOf("getUserMedia"));
});

test("stop ngắt cả gain khỏi destination", async () => {
  const src = new SharedMic(ctx).source();
  await src.start(handlers());
  src.stop();
  expect(gains[0].disconnect).toHaveBeenCalled();
});

test("hai source chỉ gọi getUserMedia một lần", async () => {
  const mic = new SharedMic(ctx);
  await Promise.all([mic.source().start(handlers()), mic.source().start(handlers())]);
  expect(gum).toHaveBeenCalledTimes(1);
});

test("khối PCM tới cả hai source", async () => {
  const mic = new SharedMic(ctx);
  const h1 = handlers();
  const h2 = handlers();
  await mic.source().start(h1);
  await mic.source().start(h2);
  const buf = new ArrayBuffer(8);
  (worklet.port.onmessage as (e: { data: ArrayBuffer }) => void)({ data: buf });
  expect(h1.onData).toHaveBeenCalledWith(buf);
  expect(h2.onData).toHaveBeenCalledWith(buf);
});

test("stop một source thì micro vẫn chạy; stop source cuối mới đóng ctx", async () => {
  const mic = new SharedMic(ctx);
  const a = mic.source();
  const b = mic.source();
  const hb = handlers();
  await a.start(handlers());
  await b.start(hb);
  a.stop();
  expect(closeCtx).not.toHaveBeenCalled();
  const buf = new ArrayBuffer(4);
  (worklet.port.onmessage as (e: { data: ArrayBuffer }) => void)({ data: buf });
  expect(hb.onData).toHaveBeenCalledWith(buf);
  b.stop();
  expect(closeCtx).toHaveBeenCalled();
});

test("từ chối quyền → AudioPermissionError ở mọi source", async () => {
  gum.mockImplementation(async () => {
    throw new DOMException("denied", "NotAllowedError");
  });
  const mic = new SharedMic(ctx);
  const results = await Promise.allSettled([mic.source().start(handlers()), mic.source().start(handlers())]);
  for (const r of results) {
    expect(r.status).toBe("rejected");
    expect((r as PromiseRejectedResult).reason).toBeInstanceOf(AudioPermissionError);
  }
});

test("sampleRate lấy từ AudioContext", () => {
  expect(new SharedMic(ctx).sampleRate).toBe(48000);
});
