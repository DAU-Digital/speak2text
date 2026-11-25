# Design: App phụ đề trực tiếp EN/JA → VI (bản rút gọn)

Ngày: 2026-11-25 · Nguồn: `Spec App phụ đề trực tiếp EN JA → VI.md` (spec gốc của anh Phú) · Trạng thái: đã duyệt

## Mục đích

PWA mở trên điện thoại: bấm micro, nghe EN hoặc JA, hiện phụ đề VI kèm câu gốc. Thay bản thử chỉ chạy được trên Chrome, phải chạy được trên iPhone. Hạn: trước 26/11/2026.

Chỉ đạo của anh khi duyệt: **làm nhanh, không cần UI đẹp, chỉ cần nghe và hiện phụ đề.**

## Phạm vi bản này

Giữ:
- US-01 nghe và hiện phụ đề (dòng tạm + dòng đã chốt; VI chữ lớn, câu gốc chữ nhỏ)
- US-02 đổi EN ↔ JA, kể cả khi đang nghe
- US-05 passcode + backend cấp temporary key (BR-06, BR-07, BR-08) — giữ vì đây là thứ bảo vệ tiền API; không có nó thì không deploy công khai được
- BR-05 tự nối lại (dùng cơ chế có sẵn của SDK)
- BR-10 giới hạn 300 dòng
- Wake lock khi đang nghe (vài dòng code, cần khi đặt máy trên bàn)
- Dockerfile cho VPS

Bỏ khỏi bản này (để sau): A−/A+, Sao chép, Xoá, manifest/icon PWA, light/dark tinh chỉnh, xử lý tab ẩn (MSG-06), dòng "Ví dụ" khi trống. UI dùng style mặc định tối giản.

## Approaches đã cân nhắc

1. **Chọn — theo stack của spec:** Vite + React + TS (`web/`), Express + TS (`server/`), `@soniox/client` + `@soniox/node`. Ít code nhất, một nhà cung cấp cho cả nhận giọng và dịch.
2. Tự viết WebSocket tới Soniox, không dùng SDK: nhiều code hơn, phải tự làm reconnect.
3. Soniox chỉ nhận giọng + LLM dịch qua backend: hai dịch vụ, không kịp hạn. Giữ làm phương án dự phòng nếu chất lượng JA → VI không đạt (OQ-02).

## Các TBD đã giải từ docs Soniox (đọc ngày 2026-11-25)

- Model: `stt-rt-v6` (v5 bị gỡ 15/12/2026).
- Một session real-time tối đa 300 phút; hết hạn thì mở session mới.
- Token: `translation_status` ∈ `none` | `original` | `translation`. Token dịch không có `start_ms`/`end_ms`, không khớp 1:1 với token gốc.
- `enable_endpoint_detection: true` → Soniox gửi token `<end>` (luôn final) khi hết câu.
- Temporary key: `POST /v1/auth/temporary-api-key`, `usage_type: "transcribe_websocket"`, `expires_in_seconds: 60`. Node SDK: `client.auth.createTemporaryKey(...)` trả `{ api_key, expires_at }`.
- Web SDK: `new SonioxClient({ config: async () => ({ api_key }) })` — hàm `config` được gọi cho mỗi session mới, nên mỗi lần nối lại tự xin key mới (đúng BR-05). `client.realtime.record({...})` trả `Recording` với event `result`, `error`, `state_change`, `reconnecting`, `reconnected`; `stop()` chờ kết quả final, `cancel()` đóng ngay.

## Quyết định của em (anh có thể đổi)

- **Thu âm PCM qua AudioWorklet** (nguồn `AudioSource` tự viết, gửi `pcm_s16le`, 16 kHz, mono) thay cho `MicrophoneSource` mặc định của SDK. Lý do: `MicrophoneSource` dùng MediaRecorder; iOS Safari ghi ra mp4, mà mp4 không có trong danh sách định dạng `audio_format: "auto"` của Soniox. Chạy PCM trên mọi trình duyệt cho đồng nhất.
- **Gom token theo dòng:** token `original`/`none` final cộng vào câu gốc của dòng hiện tại; token `translation` final cộng vào phần VI. Khi gặp `<end>` (hoặc vượt 180 ký tự EN / 70 ký tự JA, hoặc user dừng) thì chốt câu gốc và mở dòng mới. Token dịch về sau khi đã chốt vẫn được gắn vào dòng cũ chưa có đủ bản dịch (dòng gần nhất còn thiếu VI), vì bản dịch có thể về chậm hơn `<end>`.
- **Nối lại:** dùng event `reconnecting`/`reconnected` của SDK, giới hạn 3 lần; hết lần thử thì về `idle` + MSG-05.
- **Passcode tắt được khi chạy local:** nếu `APP_PASSCODE` không đặt thì bỏ qua đăng nhập (chỉ để dev). Production bắt buộc đặt.
- **Session token:** HMAC-SHA256 bằng `SESSION_SECRET` (không thêm thư viện JWT). Rate limit đếm trong bộ nhớ.
- Tên app tạm: "Phụ đề" (OQ-01 chưa có).

## Để lại cho builder

- Tên field chính xác của `AudioSource` interface: đọc trong `@soniox/client` `index.d.mts` lúc build.
- Cách trình bày tối giản của màn hình — miễn đọc được trên điện thoại, nút bấm ≥ 44 px.

## Kiểm tra

- `GET /healthz` → 200; curl `/api/login`, `/api/stt-key` ra key và đúng mã 401/429.
- Trên máy tính: nói một câu EN và một câu JA đều ra phụ đề VI; đổi ngôn ngữ khi đang nghe không phải bấm lại.
- `SONIOX_API_KEY` không có trong bundle `web/dist`.
- iPhone Safari: anh test máy thật (em không có thiết bị).
