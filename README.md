# speak2text — Phụ đề trực tiếp EN/JA → VI

Web app mở trên điện thoại: bấm micro, nghe tiếng Anh hoặc tiếng Nhật, hiện phụ đề tiếng Việt kèm câu gốc.
Nhận giọng nói và dịch bằng Soniox real-time (`stt-rt-v6`). Audio đi thẳng từ trình duyệt tới Soniox, server chỉ giữ API key và cấp temporary key 60 giây.

- Thiết kế: `docs/superpowers/specs/2026-11-25-live-subtitles-design.md`
- Kế hoạch: `docs/superpowers/plans/2026-11-25-live-subtitles.md`

## Cấu hình

Tạo `.env` ở thư mục gốc (xem `.env.example`):

| Biến | Ý nghĩa |
| --- | --- |
| `SONIOX_API_KEY` | API key Soniox (bắt buộc) |
| `APP_PASSCODE` | Passcode dùng chung, ≥ 8 ký tự. Bỏ trống thì app vào thẳng, không hỏi passcode. Riêng production (`NODE_ENV=production`: Docker, Vercel) bắt buộc phải đặt, trừ khi đặt `ALLOW_NO_PASSCODE=1` |
| `SESSION_SECRET` | Chuỗi ngẫu nhiên ≥ 32 ký tự. Bỏ trống thì mỗi lần restart phải đăng nhập lại |
| `PORT` | Mặc định 3000 |

## Chạy dev

```bash
cd server && npm i && npm run dev      # API ở :3000
cd web && npm i && npm run dev         # giao diện ở :5173, proxy /api sang :3000
```

Test: `cd server && npm test`, `cd web && npm test`.

Ghi lại token stream thật của Soniox (dùng giọng đọc macOS, không cần micro):

```bash
cd server && npx tsx --env-file=../.env scripts/trace.ts en   # và ja
```

File ghi ra ở `web/src/fixtures/`; khi có file, test `trace EN/JA thật` trong `web/src/subtitles.test.ts` sẽ chạy.

## Nhiều ngôn ngữ và trang chiếu

- **Màn hình ghi âm:** chọn "Người nói" (Anh, Nhật, Việt, Trung, Hàn) và một hoặc nhiều ngôn ngữ "Dịch sang".
  - Mỗi ngôn ngữ đầu ra là một phiên Soniox riêng, dùng chung micro, nên chi phí nhân theo số ngôn ngữ.
  - Soniox cho tối đa 10 phiên cùng lúc.
- **Trang chiếu:** "Mở trang <ngôn ngữ>" mở cửa sổ `/sub?lang=xx`, chỉ hiện phụ đề ngôn ngữ đó (bản dịch ở trên, câu gốc ở dưới).
  - Kéo cửa sổ sang màn hình hoặc máy chiếu cần dùng.
  - Trang nhận chữ từ tab ghi âm trên cùng trình duyệt, nên tab ghi âm phải luôn mở.
- **Đè lên slide toàn màn hình:** dùng "Cửa sổ phụ đề" (ở màn hình ghi âm) hoặc "Nổi lên trên" (ở trang chiếu).
  - Cửa sổ này luôn nằm trên cùng, chỉ có trên Chrome/Edge máy tính.
  - Mỗi lúc chỉ mở được một cửa sổ nổi.

## Deploy lên Vercel

Lúc import repo trên Vercel:

| Mục | Giá trị |
| --- | --- |
| Application Preset | **Express** |
| Root Directory | `server` (giữ bật "Include files outside the root directory" vì build cần `web/`) |
| Build Command | để mặc định (đọc từ `server/vercel.json`: `npm run vercel-build`) |

Environment Variables cho môi trường Production:

| Biến | Giá trị |
| --- | --- |
| `SONIOX_API_KEY` | key Soniox |
| `SESSION_SECRET` | chuỗi ngẫu nhiên ≥ 32 ký tự (bắt buộc: Vercel chạy nhiều instance) |
| `APP_PASSCODE` | passcode ≥ 8 ký tự, **hoặc** thay bằng `ALLOW_NO_PASSCODE=1` để ai có link cũng dùng được |

Lưu ý:
- `vercel-build` build `web/` rồi copy vào `server/public/`, và Vercel phục vụ thư mục này qua CDN.
- `server/src/index.ts` export app cho Vercel.
- Giới hạn đoán passcode và giới hạn xin key chỉ tính trong từng instance.

## Deploy lên VPS

```bash
docker build -t speak2text .
docker run -d --restart unless-stopped -p 127.0.0.1:3000:3000 --env-file .env --name speak2text speak2text
```

Đặt nginx phía trước theo `deploy/nginx.conf.example` và bật HTTPS bằng certbot. Trình duyệt chỉ cho dùng micro trên HTTPS.

## Kiểm tra trên máy thật

1. Android Chrome và iPhone Safari: nói vài câu EN, mỗi câu ra một dòng VI.
2. Đổi sang "Nhật → Việt" khi đang nghe, nói tiếng Nhật: phụ đề vẫn ra mà không bấm micro lại.
3. Bật chế độ máy bay vài giây khi đang nghe rồi tắt: thấy "Mất kết nối, đang nối lại…", sau đó nghe tiếp.
4. Để máy nghe 10 phút không chạm: màn hình không tắt.
5. Nhập sai passcode 5 lần: thấy "Nhập sai quá nhiều lần. Thử lại sau 5 phút."
