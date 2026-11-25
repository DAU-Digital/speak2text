import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { PcmMicSource } from "./pcmSource";

type FakeNode = { name: string; connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn>; gain?: { value: number } };

const node = (name: string): FakeNode => ({ name, connect: vi.fn(), disconnect: vi.fn() });

let calls: string[];
let destination: FakeNode;
let worklet: FakeNode & { port: { onmessage: unknown } };
let gains: FakeNode[];
let ctx: AudioContext;

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
    close: vi.fn(async () => {}),
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
      getUserMedia: vi.fn(async () => {
        calls.push("getUserMedia");
        return { getAudioTracks: () => [], getTracks: () => [] };
      }),
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const handlers = { onData: vi.fn(), onError: vi.fn() };

test("worklet được nối tới destination qua gain 0 để Safari chịu chạy process()", async () => {
  await new PcmMicSource(ctx).start(handlers);
  const mute = gains.find((g) => worklet.connect.mock.calls.some(([target]) => target === g));
  expect(mute).toBeDefined();
  expect(mute!.gain!.value).toBe(0);
  expect(mute!.connect).toHaveBeenCalledWith(destination);
});

test("resume AudioContext sau khi có quyền micro", async () => {
  await new PcmMicSource(ctx).start(handlers);
  expect(calls.indexOf("resume")).toBeGreaterThan(calls.indexOf("getUserMedia"));
});

test("stop ngắt cả gain khỏi destination", async () => {
  const src = new PcmMicSource(ctx);
  await src.start(handlers);
  src.stop();
  expect(gains[0].disconnect).toHaveBeenCalled();
});
