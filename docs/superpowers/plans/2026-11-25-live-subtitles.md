# App phụ đề trực tiếp EN/JA → VI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Một PWA tối giản: nhập passcode, bấm micro, nghe EN hoặc JA và hiện phụ đề VI kèm câu gốc.

**Architecture:** `server/` (Express + TS) giữ `SONIOX_API_KEY`, kiểm passcode, cấp temporary key 60 giây và serve `web/dist`. `web/` (Vite + React + TS) thu âm PCM qua AudioWorklet, mở WebSocket thẳng tới Soniox bằng `@soniox/client`, rồi gom token thành dòng phụ đề bằng một module thuần có test.

**Tech Stack:** Node 24+, Express 5, `@soniox/node` 2.6, `@soniox/client` 2.6, React 19, Vite, Vitest, Supertest.

**Spec:** `docs/superpowers/specs/2026-11-25-live-subtitles-design.md` (bản rút gọn của `~/Downloads/Spec App phụ đề trực tiếp EN JA → VI.md`, đọc cả hai)

## Global Constraints

- Model Soniox: `stt-rt-v6`. Translation: `{ type: "one_way", target_language: "vi" }`. `language_hints` là `["en"]` hoặc `["ja"]`. `enable_endpoint_detection: true`.
- Temporary key: `usage_type: "transcribe_websocket"`, `expires_in_seconds: 60`.
- `SONIOX_API_KEY` chỉ được đọc trong `server/`. Không xuất hiện trong `web/dist` hay trong response.
- Session token có hạn 30 ngày. Sai passcode 5 lần liên tiếp từ một IP thì khoá IP đó 5 phút. Mỗi session token xin tối đa 10 key mỗi phút.
- Ngưỡng chốt dòng: 180 ký tự (EN), 70 ký tự (JA). Giữ tối đa 300 dòng.
- Không database, router hay state library. Chữ trên UI bằng tiếng Việt, message copy nguyên văn từ spec gốc mục 5.
- Vùng bấm ≥ 44 px, nút micro tròn 64 px. UI tối giản, không cần đẹp.
- Làm việc trên branch `feat/live-subtitles`, không làm trên `main`.

## Review Focus

1. Nhập **đúng** passcode trong lúc đang bị khoá → vẫn 429, không được vào (Task 1).
2. Sau nginx, hai người ở hai IP khác nhau (`X-Forwarded-For`) không bị khoá chung (Task 1).
3. Token dịch về **sau** `<end>` → gắn vào câu nó dịch, không lấn sang câu kế tiếp (Task 3, dùng trace thật).
4. Đổi ngôn ngữ hoặc dừng khi đang nói dở → phần câu đã final được giữ thành một dòng, không mất (Task 3).
5. `<end>` khi chưa có chữ nào → không tạo dòng rỗng (Task 3).

---

### Task 1: Server — API, passcode, temporary key

**Files:**
- Create: `.gitignore` (`node_modules`, `dist`, `.env`), `server/package.json`, `server/tsconfig.json`, `server/.env.example`
- Create: `server/src/session.ts`, `server/src/limits.ts`, `server/src/app.ts`, `server/src/index.ts`
- Test: `server/test/app.test.ts`

**Interfaces:**
- Produces:
  - `signToken(secret: string, expiresAtMs: number): string`. Định dạng `${expiresAtMs}.${base64url(HMAC-SHA256(secret, String(expiresAtMs)))}`.
  - `verifyToken(secret: string, token: string, nowMs: number): boolean`. So sánh bằng `timingSafeEqual`.
  - `createLoginGuard(opts: { maxFails: number; lockMs: number })` trả `{ isLocked(ip: string, now: number): boolean; fail(ip: string, now: number): void; reset(ip: string): void }`.
  - `createKeyLimiter(opts: { max: number; windowMs: number })` trả `{ allow(key: string, now: number): boolean }`.
  - `type AppDeps = { passcode?: string; sessionSecret: string; createSttKey: () => Promise<{ apiKey: string; expiresAt: string }>; now?: () => number; staticDir?: string }`
  - `createApp(deps: AppDeps): express.Express`. Gọi `app.set('trust proxy', 1)`.
  - HTTP: `GET /healthz` → 200 `{ ok: true }`. `POST /api/login {passcode}` → 200 `{ token, expiresAt }` / 401 `{ error: "bad_passcode" }` / 429 `{ error: "locked" }`. `POST /api/stt-key` (Bearer) → 200 `{ apiKey, expiresAt }` / 401 `{ error: "unauthorized" }` / 429 `{ error: "rate_limited" }` / 502 `{ error: "upstream" }`.
  - Script: `npm run dev` chạy `tsx watch --env-file=.env src/index.ts` ở cổng `PORT` (mặc định 3000).

- [ ] **Step 1: Tạo branch và scaffold `server/`**

```bash
git checkout -b feat/live-subtitles
git add docs && git commit -m "docs: design and plan for live subtitles"
```

Các package: `express @soniox/node` và dev `typescript tsx vitest supertest @types/express @types/supertest @types/node`. Đặt `"type": "module"`, scripts `dev`, `build` (`tsc`), `start` (`node dist/index.js`), `test` (`vitest run`). `.env.example` liệt kê `SONIOX_API_KEY`, `APP_PASSCODE`, `SESSION_SECRET`, `PORT`.

- [ ] **Step 2: Viết test thất bại trong `server/test/app.test.ts`**

Dùng `createApp` với `createSttKey` giả trả `{ apiKey: "tmp-123", expiresAt: "2026-11-25T00:01:00Z" }` và `now` điều khiển được (`let t = 1_700_000_000_000`). Passcode `"secret-pass"`, secret dài 32 ký tự.

```ts
test("healthz", ...)                       // 200, { ok: true }
test("login sai → 401", ...)               // body.error === "bad_passcode"
test("login đúng → token 30 ngày", ...)    // Date.parse(body.expiresAt) === t + 30*24*3600*1000
test("sai 5 lần → lần 6 bị 429 kể cả passcode đúng", ...)   // lần 1..5: 401; lần 6 (đúng): 429, error "locked"
test("hết 5 phút thì login lại được", ...) // t += 5*60*1000 + 1 → 200
test("login đúng xoá bộ đếm sai", ...)     // 4 sai, 1 đúng, 4 sai → vẫn 401 (không phải 429)
test("hai IP khác nhau không khoá chung", ...)  // 5 sai với X-Forwarded-For 1.1.1.1; IP 2.2.2.2 đúng → 200
test("stt-key không có token → 401", ...)
test("stt-key token sai chữ ký → 401", ...)
test("stt-key token hết hạn → 401", ...)   // t += 30 ngày + 1
test("stt-key hợp lệ → apiKey", ...)       // body.apiKey === "tmp-123"
test("key thứ 11 trong một phút → 429", ...) // 10 lần 200, lần 11: 429; t += 60_001 → 200
test("Soniox lỗi → 502", ...)              // createSttKey ném lỗi → 502, error "upstream"
test("không đặt passcode → passcode nào cũng vào", ...)  // passcode: undefined
```

- [ ] **Step 3: Chạy test, xác nhận thất bại**

Run: `cd server && npx vitest run`
Expected: FAIL, không tìm thấy module `../src/app`

- [ ] **Step 4: Cài `session.ts`, `limits.ts`, `app.ts`**

`fail()` đếm số lần sai liên tiếp, đến `maxFails` thì đặt `lockedUntil = now + lockMs`. `createKeyLimiter` đếm theo cửa sổ cố định `windowMs` cho mỗi key, key là chính chuỗi token. Nếu có `staticDir` thì `app.use(express.static(staticDir))` và thêm fallback trả `index.html` cho `GET` không bắt đầu bằng `/api`. Request login bị khoá thì trả 429 trước khi so passcode.

- [ ] **Step 5: Chạy test, xác nhận qua**

Run: `cd server && npx vitest run`
Expected: tất cả PASS

- [ ] **Step 6: Cài `index.ts` và thử bằng key thật**

Đọc env. Thiếu `SONIOX_API_KEY` thì thoát kèm thông báo. Thiếu `SESSION_SECRET` thì sinh ngẫu nhiên 32 byte và cảnh báo (token mất hiệu lực khi restart). Thiếu `APP_PASSCODE` thì cảnh báo "dev mode: không có passcode". `createSttKey` dùng `new SonioxNodeClient({ api_key })` rồi `client.auth.createTemporaryKey({ usage_type: "transcribe_websocket", expires_in_seconds: 60 })` và map `{ api_key, expires_at }` sang `{ apiKey, expiresAt }`. `staticDir` là `../web/dist`, tính theo vị trí file, chỉ dùng khi thư mục tồn tại.

Run (anh đã đặt key vào `server/.env`):
```bash
cd server && npm run dev &
curl -s localhost:3000/healthz
TOKEN=$(curl -s -XPOST localhost:3000/api/login -H 'content-type: application/json' -d "{\"passcode\":\"$APP_PASSCODE\"}" | node -pe 'JSON.parse(require("fs").readFileSync(0)).token')
curl -s -XPOST localhost:3000/api/stt-key -H "authorization: Bearer $TOKEN"
```
Expected: `{"ok":true}`, sau đó `{"apiKey":"…","expiresAt":"…"}` với apiKey khác `SONIOX_API_KEY`

- [ ] **Step 7: Commit**

```bash
git add .gitignore server && git commit -m "feat(server): login, temporary key endpoint, rate limits"
```

---

### Task 2: Ghi lại token stream thật từ Soniox

Mục đích: biết chính xác thứ tự token gốc, token dịch và `<end>` trước khi viết bộ gom dòng. Dữ liệu là audio do macOS `say` tạo ra, không cần micro.

**Files:**
- Create: `server/scripts/trace.ts`
- Create (output): `web/src/fixtures/trace-en.json`, `web/src/fixtures/trace-ja.json`

**Interfaces:**
- Consumes: `server/.env` (`SONIOX_API_KEY`)
- Produces: mỗi fixture là `RealtimeToken[][]`, một mảng `tokens` cho mỗi event `result`, đúng thứ tự nhận.

- [ ] **Step 1: Viết `trace.ts`**

Tham số: `lang` (`en` | `ja`). Tạo audio:
- EN: `say -v Samantha -o /tmp/x.aiff "Good morning everyone. [[slnc 2500]] Today we will talk about the new product launch."`
- JA: `say -v Kyoko -o /tmp/x.aiff "皆さん、おはようございます。[[slnc 2500]] 今日は新製品の発売について話します。"`

Đổi sang PCM: `ffmpeg -y -i x.aiff -ac 1 -ar 16000 -f s16le x.raw`. Thư mục tạm lấy từ `os.tmpdir()`. Mở session bằng `new SonioxNodeClient().realtime.stt({ model: "stt-rt-v6", audio_format: "pcm_s16le", sample_rate: 16000, num_channels: 1, language_hints: [lang], enable_endpoint_detection: true, translation: { type: "one_way", target_language: "vi" } })`. Gửi khối 3200 byte (100 ms), mỗi 100 ms một khối, để giả lập real-time. Thêm 3 giây im lặng ở cuối, rồi `finish()`. Mỗi event `result` thì push `result.tokens`. Ghi ra `web/src/fixtures/trace-<lang>.json`.

- [ ] **Step 2: Chạy cho cả hai ngôn ngữ**

Run: `cd server && npx tsx --env-file=.env scripts/trace.ts en && npx tsx --env-file=.env scripts/trace.ts ja`
Expected: hai file JSON. Mỗi file có đúng 2 token final `<end>`, có token final `translation_status: "translation"` chứa chữ tiếng Việt.

- [ ] **Step 3: Đọc trace và ghi lại thứ tự quan sát được**

Ghi một dòng vào đầu `web/src/subtitles.ts` (Task 3): token dịch final của câu 1 về trước hay sau `<end>` của câu 1, và trước hay sau token gốc final đầu tiên của câu 2.

- [ ] **Step 4: Commit**

```bash
git add server/scripts web/src/fixtures && git commit -m "chore: capture real Soniox token traces for EN and JA"
```

---

### Task 3: Bộ gom token thành dòng phụ đề

**Files:**
- Create: scaffold `web/` (`npm create vite@latest web -- --template react-ts`), thêm dev dependency `vitest`, thêm dependency `@soniox/client`
- Create: `web/src/subtitles.ts`
- Test: `web/src/subtitles.test.ts`

**Interfaces:**
- Consumes: `RealtimeToken` từ `@soniox/client` (`text`, `is_final`, `translation_status?: 'none' | 'original' | 'translation'`). Fixtures từ Task 2.
- Produces:
  - `type Lang = "en" | "ja"`
  - `type Line = { id: number; original: string; vi: string; closed: boolean }`
  - `type Transcript = { lines: Line[]; interimOriginal: string; interimVi: string; nextId: number; segLineId: number | null }`
  - `const MAX_LINES = 300`, `const CHAR_LIMIT: Record<Lang, number> = { en: 180, ja: 70 }`
  - `emptyTranscript(): Transcript`
  - `applyTokens(t: Transcript, tokens: RealtimeToken[], lang: Lang): Transcript`. Hàm thuần, trả object mới.
  - `closeOpenLine(t: Transcript): Transcript`. Chốt dòng đang mở và xoá interim. Dùng khi dừng, khi đổi ngôn ngữ, khi `session_restart`.

- [ ] **Step 1: Viết test thất bại**

```ts
test("trace EN thật → 2 dòng, mỗi dòng có bản dịch", () => {
  const t = traceEn.reduce((s, toks) => applyTokens(s, toks, "en"), emptyTranscript());
  const done = closeOpenLine(t).lines;
  expect(done).toHaveLength(2);
  expect(done[0].original).toMatch(/good morning/i);
  expect(done[1].original).toMatch(/product/i);
  expect(done.every(l => l.vi.trim().length > 0)).toBe(true);
});
test("trace JA thật → 2 dòng, dòng 1 chứa おはよう, dòng 2 chứa 新製品, đều có VI", ...);
test("token chưa final chỉ vào interim và bị thay ở lần sau", ...);
  // apply [{text:"Hel",is_final:false,translation_status:"original"}] → interimOriginal "Hel", lines []
  // apply [{text:"Hello",is_final:false,...}] → interimOriginal "Hello"
test("<end> chốt dòng", ...);       // finals "Hi" + "<end>" → lines[0] = {original:"Hi", closed:true}
test("<end> khi chưa có chữ → không tạo dòng", ...);   // chỉ "<end>" → lines []
test("vượt 70 ký tự JA → chốt dòng, chữ tiếp theo sang dòng mới", ...);
test("vượt 180 ký tự EN → chốt dòng", ...);
test("token dịch về sau <end> → gắn vào dòng vừa chốt", ...);
  // finals: orig "Hi", "<end>", translation "Chào" → lines[0].vi === "Chào", lines.length === 1
test("dừng giữa câu → phần final giữ thành dòng đã chốt", ...);   // final "Half of" rồi closeOpenLine → lines[0].closed
test("giữ tối đa 300 dòng gần nhất", ...);   // 301 câu → lines.length 300, lines[0].original là câu thứ 2
test("token translation_status 'none' coi như câu gốc", ...);
```

- [ ] **Step 2: Chạy test, xác nhận thất bại**

Run: `cd web && npx vitest run src/subtitles.test.ts`
Expected: FAIL, module chưa có

- [ ] **Step 3: Cài `subtitles.ts`**

Luật xử lý, áp lần lượt từng token theo thứ tự:
- Token chưa final: dựng lại `interimOriginal` / `interimVi` từ đầu ở mỗi lần gọi (token gốc vào `interimOriginal`, token dịch vào `interimVi`).
- `<end>` final: chốt dòng đang mở nếu có chữ, rồi đặt `segLineId = null`.
- Token gốc final (`original` hoặc `none`/không có): nếu không có dòng mở thì tạo dòng mới và đặt `segLineId` bằng id dòng đó. Nối text vào. Nếu `original.trim().length >= CHAR_LIMIT[lang]` thì chốt dòng, nhưng giữ `segLineId`.
- Token dịch final: nối vào dòng `segLineId` nếu còn trong danh sách, không thì nối vào dòng cuối cùng. Nếu chưa có dòng nào thì tạo một dòng mở.
- Cắt `lines` về `MAX_LINES` dòng cuối.

Nếu trace ở Task 2 cho thấy thứ tự mà luật này làm sai hai test trace, sửa luật dòng dịch cho hai test trace qua mà không làm hỏng test khác. Ghi luật cuối cùng vào comment đầu file.

- [ ] **Step 4: Chạy test, xác nhận qua**

Run: `cd web && npx vitest run`
Expected: tất cả PASS

- [ ] **Step 5: Commit**

```bash
git add web && git commit -m "feat(web): token-to-subtitle assembler with real-trace tests"
```

---

### Task 4: Màn hình nghe và hiện phụ đề

**Files:**
- Create: `web/public/pcm-worklet.js`, `web/src/pcmSource.ts`, `web/src/api.ts`, `web/src/messages.ts`
- Modify: `web/src/App.tsx`, `web/src/main.tsx`, `web/src/index.css` (thay CSS mẫu của Vite), `web/vite.config.ts` (proxy `/api` → `http://localhost:3000`), `web/index.html` (title "Phụ đề", `lang="vi"`)
- Test: `web/src/api.test.ts`

**Interfaces:**
- Consumes: `applyTokens`, `closeOpenLine`, `emptyTranscript`, `Lang` (Task 3). Các endpoint của Task 1.
- Produces:
  - `class ApiError extends Error { status: number }`
  - `login(passcode: string): Promise<{ token: string; expiresAt: string }>`
  - `fetchSttKey(token: string): Promise<string>`. Trả `apiKey`. Status khác 2xx thì ném `ApiError(status)`.
  - `class PcmMicSource implements AudioSource` với `constructor(ctx: AudioContext)`. Gửi PCM Int16 little-endian mono theo `ctx.sampleRate`, khoảng 100 ms mỗi khối. `getUserMedia` bị từ chối thì ném `AudioPermissionError` của `@soniox/client`. `stop()` ngắt node, dừng track, đóng `ctx`, gọi nhiều lần vẫn an toàn.
  - `MSG`: object có các khoá `MSG01`…`MSG11` (trừ `MSG06`, `MSG07`), nội dung nguyên văn spec gốc. Message có `{tiếng Anh / tiếng Nhật}` là hàm `(lang: Lang) => string`.

- [ ] **Step 1: Viết test thất bại cho `api.ts`**

```ts
test("fetchSttKey trả apiKey khi 200", ...)        // fetch giả trả {apiKey:"k"} → "k", header Authorization "Bearer tok"
test("fetchSttKey 401 → ApiError status 401", ...)
test("fetchSttKey 502 → ApiError status 502", ...)
test("login 429 → ApiError status 429", ...)
```

- [ ] **Step 2: Chạy, xác nhận thất bại, cài `api.ts`, chạy lại, xác nhận qua**

Run: `cd web && npx vitest run src/api.test.ts`
Expected: FAIL rồi PASS

- [ ] **Step 3: Cài `pcm-worklet.js` và `pcmSource.ts`**

Worklet `registerProcessor("pcm-capture", …)`: gom Float32 kênh 0, đến `Math.round(sampleRate / 10)` mẫu thì đổi sang Int16 (kẹp trong khoảng −1..1) và `port.postMessage(buffer, [buffer])`. `getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } })`. Nạp worklet bằng `ctx.audioWorklet.addModule("/pcm-worklet.js")`. Nối `MediaStreamSource → AudioWorkletNode`, không nối ra loa.

- [ ] **Step 4: Cài `App.tsx`**

- Trạng thái lưu `localStorage`: `s2t.token`, `s2t.expiresAt`, `s2t.lang` (mặc định `"en"`).
- Chưa có token còn hạn thì hiện form passcode (ô password, nút "Vào", vùng lỗi). Lỗi 401 hiện `MSG01` và giữ focus ô nhập. Lỗi 429 hiện `MSG08`.
- Màn hình chính từ trên xuống:
  - Hai nút "Anh → Việt" / "Nhật → Việt" (nút đang chọn có `aria-pressed`).
  - Danh sách dòng: VI chữ to, câu gốc chữ nhỏ. Dòng mới nhất có màu nhấn.
  - Khối "đang nghe" in nghiêng, gồm chữ của dòng đang mở cộng `interimOriginal` / `interimVi`.
  - Dòng status và nút micro tròn 64 px.
- `status: "idle" | "connecting" | "listening" | "reconnecting"`, map từ `state_change.new_state`:
  - `starting` / `connecting` → `connecting`
  - `recording` → `listening`
  - `reconnecting` → `reconnecting`
  - các state còn lại → `idle`
- Khi bấm micro (trong user gesture, để iOS cho phép):
  - Tạo `ctx = new AudioContext()` rồi `await ctx.resume()`.
  - `new SonioxClient({ config: async () => ({ api_key: await fetchSttKey(token) }) })`.
  - `client.realtime.record({ model: "stt-rt-v6", source: new PcmMicSource(ctx), audio_format: "pcm_s16le", sample_rate: ctx.sampleRate, num_channels: 1, language_hints: [lang], enable_endpoint_detection: true, translation: { type: "one_way", target_language: "vi" }, max_reconnect_attempts: 3, reconnect_base_delay_ms: 1000 })`.
  - `result` → `applyTokens`. `session_restart` → `closeOpenLine`.
- Bấm micro khi `listening`: `await recording.stop()` rồi `closeOpenLine`. Bấm khi `reconnecting`: `recording.cancel()`.
- Đổi ngôn ngữ khi `listening`/`reconnecting`: `closeOpenLine`, `recording.cancel()`, rồi bắt đầu lại với ngôn ngữ mới. Không phải bấm micro lại.
- Lỗi (`error` event, hoặc lỗi ném ra từ `config`):
  - `AudioPermissionError` → `MSG02`.
  - `ApiError` 401 → xoá token, về form passcode với `MSG09`, huỷ recording.
  - `ApiError` ≥ 500 → `MSG10`.
  - Lỗi đến sau khi đã `reconnecting` → `MSG05`.
  - Lỗi khác → `MSG10`.
  - Mọi lỗi đều đưa status về `idle`.
- Status line: `idle` hiện lỗi gần nhất, hoặc `MSG11(lang)` nếu chưa có lỗi. `listening` hiện `MSG03(lang)`. `reconnecting` hiện `MSG04`.
- Wake lock: `navigator.wakeLock?.request("screen")` khi vào `listening`, release khi về `idle`. Nuốt mọi lỗi.
- Tự cuộn xuống cuối khi có dòng mới, chỉ khi user đang cách đáy dưới 48 px.
- CSS: `color-scheme: light dark`, font hệ thống, nút cao tối thiểu 44 px.

- [ ] **Step 5: Kiểm tra build và chạy thật trên máy tính**

Run: `cd web && npx tsc -b && npx vite build && npx vitest run`
Expected: build xong, test PASS.

Chạy `cd server && npm run dev` và `cd web && npx vite`. Mở `http://localhost:5173` trên Chrome, nhập passcode, bấm micro rồi phát `afplay` file aiff EN từ Task 2 ra loa. Expected: hiện 2 dòng VI kèm câu gốc. Đổi sang "Nhật → Việt" khi đang nghe, phát file JA. Expected: ra phụ đề VI mà không phải bấm micro lại. Anh tự nói thử thêm vài câu.

- [ ] **Step 6: Commit**

```bash
git add web && git commit -m "feat(web): login screen and live subtitle screen with PCM mic source"
```

---

### Task 5: Docker và deploy

**Files:**
- Create: `Dockerfile`, `.dockerignore`, `deploy/nginx.conf.example`
- Modify: `README.md` (cách chạy dev, biến môi trường, cách deploy, checklist test iPhone)

**Interfaces:**
- Consumes: `server` scripts `build`/`start`, `web` build ra `web/dist`.
- Produces: image chạy `node server/dist/index.js` trên `PORT` 3000, serve `web/dist`.

- [ ] **Step 1: Viết `Dockerfile` multi-stage**

Stage build `node:24-alpine`: `npm ci` và build cả `web` lẫn `server`. Stage runtime: chỉ copy `server/dist`, `server/package*.json` (cài `--omit=dev`) và `web/dist`, giữ đúng đường dẫn tương đối mà `index.ts` dùng để tìm `../web/dist`. `nginx.conf.example` gồm `server_name` để trống cho anh điền, chuyển `/` sang `127.0.0.1:3000` kèm `X-Forwarded-For`, và chỗ cấu hình HTTPS (certbot).

- [ ] **Step 2: Kiểm tra**

Run: `docker build -t speak2text . && docker run --rm -d -p 3000:3000 --env-file server/.env --name s2t speak2text && sleep 2 && curl -s localhost:3000/healthz && curl -s localhost:3000/ | head -c 200; docker stop s2t`
Expected: `{"ok":true}`, sau đó là HTML có `<title>Phụ đề</title>`. Nếu Docker daemon không chạy thì ghi rõ là bỏ qua bước này.

Run: `grep -rl "$(grep SONIOX_API_KEY server/.env | cut -d= -f2)" web/dist || echo "clean"`
Expected: `clean`

- [ ] **Step 3: Commit**

```bash
git add Dockerfile .dockerignore deploy README.md && git commit -m "chore: docker image, nginx example, README"
```
