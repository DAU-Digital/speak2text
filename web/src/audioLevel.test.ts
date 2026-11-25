import { expect, test } from "vitest";
import { levelToMeter, pcmLevel } from "./audioLevel";

const pcm = (...samples: number[]) => new Int16Array(samples).buffer;

test("pcmLevel: im lặng = 0, tối đa ≈ 1, nửa biên độ ≈ 0.5", () => {
  expect(pcmLevel(pcm(0, 0, 0, 0))).toBe(0);
  expect(pcmLevel(pcm(32767, -32768, 32767, -32768))).toBeCloseTo(1, 2);
  expect(pcmLevel(pcm(16384, -16384))).toBeCloseTo(0.5, 2);
  expect(pcmLevel(new ArrayBuffer(0))).toBe(0);
});

test("levelToMeter: dưới -50 dB = 0, từ -10 dB trở lên = 1, ở giữa tăng dần", () => {
  expect(levelToMeter(0)).toBe(0);
  expect(levelToMeter(10 ** (-60 / 20))).toBe(0);
  expect(levelToMeter(10 ** (-10 / 20))).toBe(1);
  expect(levelToMeter(1)).toBe(1);
  expect(levelToMeter(10 ** (-30 / 20))).toBeCloseTo(0.5, 5);
});
