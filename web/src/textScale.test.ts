import { expect, test } from "vitest";
import { stepScale, TEXT_SCALES } from "./textScale";

test("cỡ chữ tăng/giảm theo nấc, dừng ở hai đầu", () => {
  expect(TEXT_SCALES[0]).toBeLessThan(1);
  expect(TEXT_SCALES).toContain(1);
  expect(stepScale(1, 1)).toBeGreaterThan(1);
  expect(stepScale(1, -1)).toBeLessThan(1);
  const max = TEXT_SCALES[TEXT_SCALES.length - 1];
  expect(stepScale(max, 1)).toBe(max);
  expect(stepScale(TEXT_SCALES[0], -1)).toBe(TEXT_SCALES[0]);
});

test("giá trị lạ → về nấc gần nhất", () => {
  expect(TEXT_SCALES).toContain(stepScale(1.07, 0));
  expect(stepScale(Number.NaN, 0)).toBe(1);
  expect(stepScale(99, 0)).toBe(TEXT_SCALES[TEXT_SCALES.length - 1]);
});
