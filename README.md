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

## Phòng phụ đề

- **Chủ phòng** mở `/`:
  - gõ mã phòng tuỳ ý (chữ thường, số, `-`, dài 3–32 ký tự), bấm **Mở phòng**, chọn người nói, rồi bấm micro;
  - bấm **Chia sẻ** để lấy link `/r/<mã>`.
- **Người xem** mở link, chọn một hoặc nhiều ngôn ngữ. Mỗi ngôn ngữ là một cột: máy tính xếp cột ngang, điện thoại xếp dọc.
- **Phiên Soniox:**
  - Ngôn ngữ nào có người xem cần thì máy chủ phòng tự mở phiên cho ngôn ngữ đó. Hết người cần thì phiên tự đóng sau 60 giây.
  - Mỗi ngôn ngữ là một phiên Soniox, và tài khoản Soniox mặc định cho tối đa 10 phiên cùng lúc, tính chung mọi phòng.
- **Tab chủ phòng phải luôn mở:** micro và các phiên chạy trên trình duyệt của chủ phòng. Server (`/ws`) chỉ chuyển chữ đi và giữ 50 câu gần nhất của mỗi ngôn ngữ.
- **Cửa sổ nổi:** nút **Cửa sổ phụ đề** trên máy chủ phòng mở một cửa sổ luôn nằm trên cùng để chiếu đè lên slide (Chrome/Edge máy tính).

## Deploy lên VPS

VPS hiện tại: `higio@42.115.41.70` (key `~/.ssh/id_ed25519_higio_vps`).
- VPS có sẵn `jwilder/nginx-proxy` và acme companion trên network `nginx-proxy`, nên HTTPS và WebSocket tự có.
- Domain: `s2t.coregenaihub.com`, bản ghi A trỏ về `42.115.41.70`.

```bash
# trên máy dev
rsync -az --delete --exclude node_modules --exclude dist --exclude server/public \
  --exclude '.env' --exclude '.env.*' --exclude .git --exclude .superpowers --exclude .vercel \
  -e "ssh -i ~/.ssh/id_ed25519_higio_vps" ./ higio@42.115.41.70:/home/higio/speak2text/
# trên VPS
cd /home/higio/speak2text && docker compose -f deploy/docker-compose.vps.yml up -d --build
```

`/home/higio/speak2text/.env` trên VPS chứa `SONIOX_API_KEY`, `SESSION_SECRET` và `ALLOW_NO_PASSCODE=1`. Muốn bật passcode cho chủ phòng thì thay `ALLOW_NO_PASSCODE` bằng `APP_PASSCODE=...` rồi chạy lại lệnh `up -d`.

## Kiểm tra trên máy thật

1. Android Chrome và iPhone Safari: nói vài câu EN, mỗi câu ra một dòng VI.
2. Đổi sang "Nhật → Việt" khi đang nghe, nói tiếng Nhật: phụ đề vẫn ra mà không bấm micro lại.
3. Bật chế độ máy bay vài giây khi đang nghe rồi tắt: thấy "Mất kết nối, đang nối lại…", sau đó nghe tiếp.
4. Để máy nghe 10 phút không chạm: màn hình không tắt.
5. Nhập sai passcode 5 lần: thấy "Nhập sai quá nhiều lần. Thử lại sau 5 phút."
