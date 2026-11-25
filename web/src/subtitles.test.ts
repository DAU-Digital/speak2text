import { describe, expect, test } from "vitest";
import type { RealtimeToken } from "@soniox/client";
import {
  applyTokens,
  clearTranscript,
  closeOpenLine,
  displayLines,
  DISPLAY_MAX,
  emptyTranscript,
  MAX_LINES,
  type Lang,
  type Transcript,
} from "./subtitles";

const tok = (text: string, is_final: boolean, translation_status?: RealtimeToken["translation_status"]): RealtimeToken => ({
  text,
  is_final,
  confidence: 1,
  translation_status,
});
const o = (text: string) => tok(text, true, "original");
const v = (text: string) => tok(text, true, "translation");
const end = () => tok("<end>", true);
const po = (text: string) => tok(text, false, "original");
const pv = (text: string) => tok(text, false, "translation");

const run = (batches: RealtimeToken[][], lang: Lang = "en", start: Transcript = emptyTranscript()) =>
  batches.reduce((s, toks) => applyTokens(s, toks, lang), start);

// Real Soniox traces, captured by server/scripts/trace.ts. Present only after a successful capture.
const fixtures = import.meta.glob<RealtimeToken[][]>("./fixtures/trace-*.json", { eager: true, import: "default" });
const traceEn = fixtures["./fixtures/trace-en.json"];
const traceJa = fixtures["./fixtures/trace-ja.json"];

describe.skipIf(!traceEn)("trace EN thật", () => {
  test("trace EN thật → 2 dòng, mỗi dòng có bản dịch", () => {
    const done = closeOpenLine(run(traceEn!, "en")).lines;
    expect(done).toHaveLength(2);
    expect(done[0].original).toMatch(/good morning/i);
    expect(done[1].original).toMatch(/product/i);
    expect(done.every((l) => l.translation.trim().length > 0)).toBe(true);
  });
});

describe.skipIf(!traceJa)("trace JA thật", () => {
  test("trace JA thật → 2 dòng, đều có VI", () => {
    const done = closeOpenLine(run(traceJa!, "ja")).lines;
    expect(done).toHaveLength(2);
    expect(done[0].original).toMatch(/おはよう/);
    expect(done[1].original).toMatch(/新製品/);
    expect(done.every((l) => l.translation.trim().length > 0)).toBe(true);
  });
});

describe("applyTokens", () => {
  test("token chưa final chỉ vào interim và bị thay ở lần sau", () => {
    let t = run([[po("Hel"), pv("Xin")]]);
    expect(t.interimOriginal).toBe("Hel");
    expect(t.interimTranslation).toBe("Xin");
    expect(t.lines).toEqual([]);
    t = run([[po("Hello")]], "en", t);
    expect(t.interimOriginal).toBe("Hello");
    expect(t.interimTranslation).toBe("");
  });

  test("<end> chốt dòng", () => {
    const t = run([[o("Hi"), end()]]);
    expect(t.lines).toHaveLength(1);
    expect(t.lines[0]).toMatchObject({ original: "Hi", closed: true });
  });

  test("<end> khi chưa có chữ → không tạo dòng", () => {
    expect(run([[end()], [end()]]).lines).toEqual([]);
  });

  test("bản dịch về trước <end> → vào dòng đang mở", () => {
    const t = run([[o("Hi"), v("Chào")], [end()]]);
    expect(t.lines).toHaveLength(1);
    expect(t.lines[0]).toMatchObject({ original: "Hi", translation: "Chào", closed: true });
  });

  test("token dịch về sau <end> → gắn vào dòng vừa chốt", () => {
    const t = run([[o("Hi"), end()], [v("Chào")]]);
    expect(t.lines).toHaveLength(1);
    expect(t.lines[0].translation).toBe("Chào");
  });

  test("câu thứ hai mở dòng mới", () => {
    const t = run([[o("Hi"), v("Chào"), end()], [o(" Bye"), v("Tạm biệt"), end()]]);
    expect(t.lines.map((l) => [l.original, l.translation])).toEqual([
      ["Hi", "Chào"],
      [" Bye", "Tạm biệt"],
    ]);
  });

  test("vượt 70 ký tự JA → chốt dòng, chữ tiếp theo sang dòng mới", () => {
    const t = run([[o("あ".repeat(70)), o("い")]], "ja");
    expect(t.lines).toHaveLength(2);
    expect(t.lines[0]).toMatchObject({ original: "あ".repeat(70), closed: true });
    expect(t.lines[1]).toMatchObject({ original: "い", closed: false });
  });

  test("vượt 100 ký tự KO → chốt dòng", () => {
    const t = run([[o("가".repeat(100)), o("나")]], "ko");
    expect(t.lines).toHaveLength(2);
    expect(t.lines[0].closed).toBe(true);
  });

  test("vượt 180 ký tự EN → chốt dòng", () => {
    const t = run([[o("a".repeat(179))], [o("b")]], "en");
    expect(t.lines).toHaveLength(1);
    expect(t.lines[0].closed).toBe(true);
  });

  test("chưa đủ 180 ký tự EN → dòng vẫn mở", () => {
    const t = run([[o("a".repeat(179))]], "en");
    expect(t.lines[0].closed).toBe(false);
  });

  test("token translation_status 'none' hoặc không có coi như câu gốc", () => {
    const t = run([[tok("Hi", true, "none"), tok(" there", true)]]);
    expect(t.lines[0].original).toBe("Hi there");
  });

  test("giữ tối đa 300 dòng gần nhất", () => {
    const batches = Array.from({ length: MAX_LINES + 1 }, (_, i) => [o(`s${i}`), end()]);
    const t = run(batches);
    expect(t.lines).toHaveLength(MAX_LINES);
    expect(t.lines[0].original).toBe("s1");
  });

  test("id các dòng không trùng nhau", () => {
    const t = run([[o("a"), end()], [o("b"), end()], [o("c")]]);
    expect(new Set(t.lines.map((l) => l.id)).size).toBe(3);
  });

  test("không làm thay đổi transcript cũ", () => {
    const before = run([[o("Hi")]]);
    const snapshot = JSON.stringify(before);
    run([[o(" there"), end()]], "en", before);
    expect(JSON.stringify(before)).toBe(snapshot);
  });
});

describe("closeOpenLine", () => {
  test("dừng giữa câu → phần final giữ thành dòng đã chốt", () => {
    const t = closeOpenLine(run([[o("Half of"), po(" it")]]));
    expect(t.lines).toHaveLength(1);
    expect(t.lines[0]).toMatchObject({ original: "Half of", closed: true });
    expect(t.interimOriginal).toBe("");
    expect(t.interimTranslation).toBe("");
  });

  test("câu sau khi chốt bằng closeOpenLine mở dòng mới", () => {
    const t = run([[o("B")]], "en", closeOpenLine(run([[o("A")]])));
    expect(t.lines.map((l) => l.original)).toEqual(["A", "B"]);
  });

  test("không có dòng mở thì giữ nguyên danh sách", () => {
    const t = closeOpenLine(run([[o("A"), end()]]));
    expect(t.lines).toHaveLength(1);
  });
});

describe("clearTranscript", () => {
  test("xoá hết dòng và chữ tạm nhưng giữ bộ đếm id", () => {
    const before = run([[o("A"), end()], [o("B"), po(" c"), pv("d")]]);
    const t = clearTranscript(before);
    expect(t.lines).toEqual([]);
    expect(t.interimOriginal).toBe("");
    expect(t.interimTranslation).toBe("");
    expect(t.nextId).toBe(before.nextId);
  });

  test("câu sau khi xoá có id mới, không trùng id cũ", () => {
    const before = run([[o("A")]]);
    const t = run([[o("B")]], "en", clearTranscript(before));
    expect(t.lines[0].id).not.toBe(before.lines[0].id);
  });

  test("bản dịch về muộn cho câu đã xoá bị bỏ, không hiện lại", () => {
    const t = run([[v("Chào")]], "en", clearTranscript(run([[o("Hi"), end()]])));
    expect(t.lines).toEqual([]);
    expect(displayLines(t)).toEqual([]);
  });
});

describe("displayLines", () => {
  test("chưa có gì → rỗng", () => {
    expect(displayLines(emptyTranscript())).toEqual([]);
  });

  test("các câu đã chốt rồi tới câu đang nói (cộng chữ tạm) ở cuối", () => {
    const t = run([[o("Hi"), v("Chào"), end()], [o(" How"), v("Bạn"), po(" are"), pv(" khoẻ")]]);
    expect(displayLines(t).map(({ original, translation, live }) => ({ original, translation, live }))).toEqual([
      { original: "Hi", translation: "Chào", live: false },
      { original: "How are", translation: "Bạn khoẻ", live: true },
    ]);
  });

  test("câu mới mới chỉ có chữ tạm → thêm một dòng live ở cuối", () => {
    const t = run([[o("Hi"), v("Chào"), end()], [po("Next")]]);
    const lines = displayLines(t);
    expect(lines).toHaveLength(2);
    expect(lines[1]).toMatchObject({ original: "Next", translation: "", live: true });
  });

  test("id các dòng không trùng, kể cả dòng live", () => {
    const t = run([[o("A"), end()], [o("B"), end()], [po("c")]]);
    const ids = displayLines(t).map((l) => l.id);
    expect(new Set(ids).size).toBe(3);
  });

  test("bỏ dòng rỗng", () => {
    const t = run([[o("  "), end()], [o("A"), end()]]);
    expect(displayLines(t).map((l) => l.original)).toEqual(["A"]);
  });

  test("chỉ giữ DISPLAY_MAX dòng gần nhất", () => {
    const batches = Array.from({ length: DISPLAY_MAX + 5 }, (_, i) => [o(`s${i}`), end()]);
    const lines = displayLines(run(batches));
    expect(lines).toHaveLength(DISPLAY_MAX);
    expect(lines[0].original).toBe("s5");
  });

  test("sau khi xoá → rỗng", () => {
    expect(displayLines(clearTranscript(run([[o("Hi"), end()]])))).toEqual([]);
  });
});
