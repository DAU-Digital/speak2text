# Nhiều ngôn ngữ đầu ra, mỗi ngôn ngữ một trang — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chọn ngôn ngữ người nói và nhiều ngôn ngữ đầu ra. Mỗi ngôn ngữ đầu ra là một phiên Soniox riêng và có trang `/sub?lang=xx` riêng.

**Architecture:**
- Một micro dùng chung (`SharedMic`) chia PCM cho N phiên.
- `Listener` quản lý N recording như một nhóm: trạng thái gộp, lỗi một phiên thì dừng cả nhóm.
- Tab ghi âm phát phụ đề qua `BroadcastChannel`. Các trang `/sub` nghe kênh đó và xin trạng thái hiện tại khi mở.

**Tech Stack:** như cũ (React 19, Vite, Vitest, `@soniox/client` 2.6). `BroadcastChannel` có sẵn trong trình duyệt và trong Node ≥ 18 (dùng được trong test).

**Spec:** `docs/superpowers/specs/2026-11-25-multi-language-pages-design.md` (nền: `2026-11-25-live-subtitles-design.md`)

## Global Constraints

- Ngôn ngữ: `en` Anh, `ja` Nhật, `vi` Việt, `zh` Trung, `ko` Hàn.
- Một phiên Soniox cho mỗi ngôn ngữ đầu ra. Mỗi phiên dùng `translation: { type: "one_way", target_language: <đầu ra> }` và `language_hints: [<người nói>]`.
- Ngưỡng chốt dòng: `en`/`vi` 180, `ja`/`zh` 70, `ko` 100.
- Server: tối đa 30 temporary key mỗi phút cho mỗi session token.
- Trang `/sub` không cần passcode và không gọi API.
- Giữ real-time (chữ tạm hiện ngay), mỗi trang một phụ đề, bản dịch ở trên, câu gốc ở dưới.
- Không thêm router, state library hay database.

## Review Focus

1. Trang mở **sau** khi đã nói → hiện ngay phụ đề hiện tại, không chờ câu sau (Task 4).
2. Một phiên lỗi (ví dụ 402) trong khi các phiên khác chạy → tất cả dừng, chỉ một thông báo lỗi (Task 3).
3. Đổi người nói sang một ngôn ngữ đang được chọn làm đầu ra → bỏ ngôn ngữ đó khỏi đầu ra; nếu không còn đầu ra nào thì dùng mặc định (Task 1).
4. Sau khi đổi cấu hình khi đang nghe, kết quả muộn của phiên cũ không lọt vào transcript mới (Task 3).
5. Trang của ngôn ngữ không được chọn → để trống, không lỗi (Task 4).

---

### Task 1: Ngôn ngữ, đổi tên field dịch, server 30 key/phút

**Files:**
- Create: `web/src/languages.ts`, `web/src/languages.test.ts`
- Modify: `web/src/subtitles.ts`, `web/src/subtitles.test.ts`, `web/src/messages.ts`, `web/src/SubtitleView.tsx`, `web/src/index.css`, `web/src/App.tsx` (chỉ sửa cho compile)
- Modify: `server/src/app.ts`, `server/test/app.test.ts`

**Interfaces:**
- Produces:
  - `type Lang = "en" | "ja" | "vi" | "zh" | "ko"`, chuyển từ `subtitles.ts` sang `languages.ts`. `subtitles.ts` re-export lại.
  - `LANGS: { code: Lang; short: string; name: string }[]` theo thứ tự en, ja, vi, zh, ko. `short` là "Anh"/"Nhật"/"Việt"/"Trung"/"Hàn"; `name` là "tiếng Anh"/….
  - `langName(l: Lang): string`
  - `sanitizeTargets(source: Lang, targets: Lang[]): Lang[]`: bỏ trùng, bỏ `source`, xếp theo thứ tự `LANGS`. Nếu rỗng thì trả `source === "vi" ? ["en"] : ["vi"]`.
  - Trong `Line`, `Transcript` và `Subtitle`: `vi` đổi thành `translation`, `interimVi` đổi thành `interimTranslation`. CSS class `.vi` đổi thành `.tr`.
  - `CHAR_LIMIT: Record<Lang, number>` theo Global Constraints.

- [ ] **Step 1: Test trước**
  - `languages.test.ts`:
    - `sanitizeTargets("ja", ["vi","en","vi"])` → `["en","vi"]`
    - `sanitizeTargets("vi", ["vi"])` → `["en"]`
    - `sanitizeTargets("en", [])` → `["vi"]`
    - `langName("ko")` → `"tiếng Hàn"`
  - `subtitles.test.ts`: đổi `vi`/`interimVi` thành tên mới. Thêm test: `ko` vượt 100 ký tự → chốt dòng.
  - `server/test/app.test.ts`: test "key thứ 11" đổi thành "key thứ 31 trong một phút → 429" (30 lần 200, lần 31 là 429).
- [ ] **Step 2: Chạy, xác nhận thất bại** — `cd web && npx vitest run`, `cd server && npx vitest run`
- [ ] **Step 3: Cài đặt** — đổi tên field, thêm `languages.ts`, sửa `createKeyLimiter({ max: 30 })`, `MSG03`/`MSG11` dùng `langName`
- [ ] **Step 4: Chạy lại, xác nhận qua, `npx tsc --noEmit` sạch**
- [ ] **Step 5: Commit** — `feat: five languages, neutral translation field, 30 keys/min`

---

### Task 2: Micro dùng chung cho nhiều phiên

**Files:**
- Create: `web/src/sharedMic.ts` (thay `pcmSource.ts`), `web/src/sharedMic.test.ts` (thay `pcmSource.test.ts`)
- Delete: `web/src/pcmSource.ts`, `web/src/pcmSource.test.ts`

**Interfaces:**
- Produces: `class SharedMic { constructor(ctx: AudioContext); source(): AudioSource; readonly sampleRate: number }`
  - `start()` của mọi source con dùng chung một lần `getUserMedia`, một worklet, một gain 0 nối tới destination, và `ctx.resume()` sau khi có quyền.
  - Mỗi khối PCM được gửi tới `onData` của mọi source con đang chạy.
  - `stop()` của source con cuối cùng mới dừng track, ngắt các node và đóng `ctx`.
  - Lỗi quyền micro thì ném `AudioPermissionError` từ `start()` của mọi source con.

- [ ] **Step 1: Test trước** (dùng lại fake ctx của `pcmSource.test.ts`)
  - Giữ nguyên 3 test cũ: nối qua gain 0, resume sau `getUserMedia`, stop ngắt gain.
  - "hai source chỉ gọi getUserMedia một lần"
  - "khối PCM tới cả hai source": gọi `worklet.port.onmessage({ data: buf })`, kiểm tra `onData` của cả hai được gọi với `buf`.
  - "stop một source thì micro vẫn chạy; stop source cuối mới đóng ctx"
  - "từ chối quyền → AudioPermissionError ở mọi source": `getUserMedia` ném `DOMException("x","NotAllowedError")`.
- [ ] **Step 2: Chạy, xác nhận thất bại**
- [ ] **Step 3: Cài `SharedMic`**
- [ ] **Step 4: Chạy lại, xác nhận qua**
- [ ] **Step 5: Commit** — `feat(web): shared microphone for parallel sessions`

---

### Task 3: Listener chạy nhiều phiên như một nhóm

**Files:**
- Modify: `web/src/listener.ts`, `web/src/listener.test.ts`

**Interfaces:**
- Consumes: `Lang`, `applyTokens`, `closeOpenLine`, `Transcript` (Task 1)
- Produces:
  - `type ListenConfig = { source: Lang; targets: Lang[] }`
  - `ListenerDeps`:
    - `createRecording(source: Lang, target: Lang, ctx: AudioContext, noteApiError: (e: ApiError) => void): RecordingLike`
    - `onStatus(s: Status)`
    - `onTranscript(target: Lang, update: (t: Transcript) => Transcript)`
    - `onError(kind: ErrorKind, err?: unknown)`
  - `Listener.start(cfg: ListenConfig, ctx: AudioContext): void` tạo một recording cho mỗi target.
  - `stop(): Promise<void>` chờ mọi recording `stop()` xong.
  - `cancel(): void`.
  - `restart(cfg: ListenConfig, ctx: AudioContext): Promise<void>` thay cho `switchLang`, cùng luật: đang nghe thì dừng êm rồi start; idle thì đóng ctx; trạng thái khác thì cancel rồi start.
  - Trạng thái gộp:
    - đang dừng → `stopping`
    - có phiên `reconnecting` → `reconnecting`
    - có phiên `connecting` → `connecting`
    - mọi phiên `listening` → `listening`
  - Một phiên lỗi → huỷ cả nhóm, `onError` đúng một lần. Một phiên về idle ngoài ý muốn (không phải do stop/cancel) → huỷ cả nhóm, về idle, không báo lỗi.

- [ ] **Step 1: Test trước** — sửa các test cũ sang API mới (một target), thêm:
  - "mở một recording cho mỗi ngôn ngữ đầu ra": targets `["en","vi"]` → 2 recording, đúng `target`, cùng `source`.
  - "listening chỉ khi mọi phiên đã recording": phiên 1 `recording`, phiên 2 còn `connecting` → status `connecting`.
  - "một phiên lỗi → huỷ tất cả, báo lỗi một lần"
  - "kết quả từng phiên vào đúng transcript của ngôn ngữ đó"
  - "stop chờ mọi phiên xong mới về idle"
  - "restart khi đang nghe: stop êm rồi mở lại; kết quả muộn của phiên cũ bị bỏ qua"
- [ ] **Step 2: Chạy, xác nhận thất bại**
- [ ] **Step 3: Cài đặt** — mỗi phiên có biến trạng thái riêng trong closure của `start`, cùng một `gen`
- [ ] **Step 4: Chạy lại, xác nhận qua**
- [ ] **Step 5: Commit** — `feat(web): listener runs one session per output language`

---

### Task 4: Kênh phát phụ đề giữa các trang

**Files:**
- Create: `web/src/broadcast.ts`, `web/src/broadcast.test.ts`

**Interfaces:**
- Consumes: `Subtitle` (Task 1), `Lang`
- Produces:
  - `const CHANNEL = "s2t-subtitles"`
  - `type SubtitleState = { source: Lang; subs: Partial<Record<Lang, Subtitle | null>> }`
  - `createPublisher(): { publish(state: SubtitleState): void; close(): void }` nhớ trạng thái cuối và trả lời mọi tin `{ type: "hello" }` bằng trạng thái đó.
  - `subscribe(lang: Lang, onSub: (sub: Subtitle | null) => void): () => void` gửi `{ type: "hello" }` khi bắt đầu, gọi `onSub(state.subs[lang] ?? null)` mỗi khi nhận `{ type: "state" }`, trả về hàm huỷ.

- [ ] **Step 1: Test trước** (dùng `BroadcastChannel` thật của Node, chờ bằng `await vi.waitFor(...)`)
  - "trang nhận phụ đề của đúng ngôn ngữ"
  - "trang mở sau vẫn nhận ngay trạng thái hiện tại"
  - "ngôn ngữ không có trong state → null"
  - "huỷ đăng ký thì không nhận nữa"
- [ ] **Step 2: Chạy, xác nhận thất bại**
- [ ] **Step 3: Cài đặt**
- [ ] **Step 4: Chạy lại, xác nhận qua**. Đóng mọi channel trong `afterEach` để vitest thoát được.
- [ ] **Step 5: Commit** — `feat(web): broadcast subtitles to output pages`

---

### Task 5: Giao diện — bộ chọn, trang `/sub`, cửa sổ nổi

**Files:**
- Create: `web/src/SubPage.tsx`
- Modify: `web/src/App.tsx`, `web/src/main.tsx`, `web/src/index.css`, `README.md`

**Interfaces:**
- Consumes: Task 1–4. `SubtitleView`, `openFloatingWindow`, `floatingSupported` (đã có).

- [ ] **Step 1: `main.tsx`** — `location.pathname === "/sub"` thì render `<SubPage lang={…} />`, ngược lại render `<App />`. `lang` lấy từ `?lang=`; mã không hợp lệ thì dùng `"vi"`.
- [ ] **Step 2: `SubPage.tsx`**
  - `subscribe(lang, setSub)`.
  - Toàn trang là `<SubtitleView sub={sub} />` với cỡ chữ co theo cửa sổ (class `sub floating`), title là `Phụ đề — <short>`.
  - Một nút nhỏ "Nổi lên trên" ở góc, chỉ hiện khi `floatingSupported()`, mở cửa sổ nổi render cùng phụ đề.
- [ ] **Step 3: `App.tsx`**
  - Header: `<select>` "Người nói" gồm 5 ngôn ngữ, và nút bật/tắt "Dịch sang" cho từng ngôn ngữ khác người nói. Lưu `s2t.source`, `s2t.targets` sau khi qua `sanitizeTargets`.
  - Mỗi ngôn ngữ đầu ra có nút "Mở trang <short>" gọi `window.open("/sub?lang=xx", "s2t-sub-xx", "popup,width=960,height=180")`.
  - State `transcripts: Partial<Record<Lang, Transcript>>`.
  - Đổi cấu hình khi không idle thì gọi `listener.restart(cfg, newAudioContext())`.
  - `createRecording` lấy `SharedMic` theo `ctx` qua `WeakMap`. Giữ temporary key trong 30 giây để các phiên mở cùng lúc dùng chung.
  - Stage: mỗi đầu ra một hàng bản dịch kèm nhãn `short`, câu gốc (của đầu ra đầu tiên) ở dưới cùng.
  - Xoá thì `clearTranscript` mọi đầu ra.
  - Cửa sổ nổi hiện đầu ra đầu tiên.
  - Mỗi lần transcripts đổi thì `publish({ source, subs })`.
- [ ] **Step 4: Kiểm tra**
  - Run: `cd web && npx tsc --noEmit && npx vitest run && npm run build`. Expected: sạch, PASS, build xong.
  - Trên Chrome: mở `http://localhost:3000`, chọn Nhật → (Anh, Việt), bấm "Mở trang Anh". Từ tab chính chạy `new BroadcastChannel("s2t-subtitles").postMessage({type:"state",source:"ja",subs:{en:{original:"テスト",translation:"Test",live:true}}})`. Expected: trang Anh hiện "Test" / "テスト".
- [ ] **Step 5: README** thêm mục "Nhiều ngôn ngữ và trang chiếu". Commit `feat(web): language pickers, per-language output pages`
