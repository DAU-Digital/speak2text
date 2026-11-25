# Design: Phòng phụ đề — chủ phòng nói, người xem mở link chọn ngôn ngữ

Ngày: 2026-11-25 · Nền: `2026-11-25-live-subtitles-design.md`, `2026-11-25-multi-language-pages-design.md` (đã build, đang chạy) · Trạng thái: chờ duyệt (đã qua builder check)

## Mục đích

Chủ phòng gõ một mã phòng tuỳ ý, chọn ngôn ngữ mình nói, bấm nghe, rồi bấm **Chia sẻ** để lấy link. Người khác mở link trên máy của họ, chọn một hoặc nhiều ngôn ngữ muốn đọc. Mỗi ngôn ngữ hiện thành một cột phụ đề real-time. Ngôn ngữ nào cũng chọn được: khi có người xem chọn một ngôn ngữ chưa ai dùng, máy chủ phòng tự mở thêm một phiên dịch cho ngôn ngữ đó.

Giữ nguyên các yêu cầu cũ:
- Real-time: chữ hiện ngay khi người nói đang nói.
- Mỗi câu: bản dịch to ở trên, câu gốc nhỏ ở dưới. Nhiều dòng, tự cuộn tới câu mới nhất.
- Làm nhanh, UI tối giản, chữ trên giao diện bằng tiếng Việt.

## Quyết định của anh

- Người xem được chọn **bất kỳ** ngôn ngữ nào (cách 2). Máy chủ phòng tự mở hoặc đóng phiên Soniox theo nhu cầu.
- Người xem có thể **chia màn hình thành nhiều cột**, mỗi cột một ngôn ngữ.
- Deploy lên **VPS** bằng Docker (bỏ Vercel). Server giữ phòng trong bộ nhớ và gửi chữ qua WebSocket.

## Approaches đã cân nhắc

1. **Chọn — VPS, một process Node giữ phòng trong RAM, WebSocket.** Không cần dịch vụ ngoài. Docker và nginx mẫu đã có sẵn.
2. Supabase Realtime (kênh + presence) trên Vercel. Ít code server, nhưng thêm dịch vụ ngoài, và ai biết mã phòng cũng có thể gửi chữ giả.
3. Convex trên Vercel. Chặt chẽ hơn, nhưng phải viết thêm cả một backend.

## Giới hạn

- Micro và các phiên Soniox chạy trong **trình duyệt của chủ phòng**. Tab chủ phòng phải mở suốt buổi. Server chỉ chuyển chữ đi, không chạm vào âm thanh.
- Mỗi ngôn ngữ dịch là một phiên Soniox. Có 5 ngôn ngữ (Anh, Nhật, Việt, Trung, Hàn) và trừ ngôn ngữ người nói ra, nên một phòng **tự nhiên tối đa 4 phiên**. Không cần thêm giới hạn hay thông báo "đã đủ". Chi phí tính theo số ngôn ngữ đang chạy, không theo số người xem.
- Soniox mặc định cho **10 phiên cùng lúc trên cả tài khoản**, tính tổng mọi phòng. Một phòng 4 phiên thì chỉ chạy được khoảng 2 phòng như vậy cùng lúc; muốn nhiều hơn thì anh nâng giới hạn trong Soniox Console. Khi chạm giới hạn, Soniox trả lỗi `max_concurrent_connections_reached`, và trang chủ phòng hiện "Tài khoản Soniox đã chạm giới hạn số phiên cùng lúc. Đóng bớt phòng hoặc nâng giới hạn trong Soniox Console." *(em tự quyết)*
- Server là một process duy nhất, phòng nằm trong RAM. Restart server thì mất các phòng đang mở (chủ phòng tự nối lại, xem dưới). Không có database.
- BR-08 vẫn giữ: `SONIOX_API_KEY` chỉ ở server.

## Thiết kế

### Mã phòng
- Chủ phòng gõ tuỳ ý. Chuẩn hoá về chữ thường; chỉ cho `a-z`, `0-9`, `-`; dài 3–32 ký tự. Ví dụ `hop-thu-2`.
- Link chia sẻ: `https://<domain>/r/<mã>`.
- **Giành phòng:** lần đầu tạo, server trả cho chủ phòng một `hostKey` bí mật (ngẫu nhiên), lưu trong `localStorage` của chủ phòng. Chỉ kết nối có `hostKey` đúng mới được gửi phụ đề vào phòng.
- Mã đang có chủ phòng khác giữ (đúng hơn: phòng còn sống và `hostKey` không khớp) thì báo **"Mã phòng này đang có người dùng. Chọn mã khác."**
- Chủ phòng tải lại trang hoặc rớt mạng: nối lại bằng `hostKey` cũ, giữ được phòng và người xem.

### Vòng đời phòng
- Phòng tồn tại khi chủ phòng đang kết nối, và thêm **30 phút** sau khi chủ phòng ngắt kết nối. Hết 30 phút thì server xoá phòng và mã được giải phóng.
- Mỗi ngôn ngữ trong phòng giữ **50 câu gần nhất**. Người xem vào muộn thấy ngay 50 câu đó.
- Trạng thái phòng hiện cho người xem:
  - "Đang nghe {ngôn ngữ người nói}".
  - "Chủ phòng đang tạm dừng": phòng còn, chủ phòng đã kết nối nhưng không nghe.
  - "Phòng chưa mở hoặc đã kết thúc": không có phòng với mã đó.

### Chủ phòng (trang `/`)
Giữ màn hình ghi âm hiện tại, thêm các thành phần sau:
- **Ô "Mã phòng"** và nút **"Mở phòng"**. Phải mở phòng trước khi bấm micro. Mã phòng gần nhất được nhớ.
- Sau khi mở phòng:
  - Nút **"Chia sẻ"**: dùng `navigator.share` nếu trình duyệt có, ngược lại copy link và đổi nhãn thành "Đã chép link" trong 1,5 giây.
  - Dòng "**N** người đang xem".
- **Ngôn ngữ đầu ra = hợp của:**
  - các ngôn ngữ chủ phòng tự bật (bộ chọn "Dịch sang" hiện có);
  - các ngôn ngữ người xem đang yêu cầu.

  Bộ chọn hiện rõ ngôn ngữ nào đang chạy vì người xem yêu cầu (ví dụ có nhãn "người xem").
- **Thêm hoặc bớt ngôn ngữ khi đang nghe không được làm gián đoạn các ngôn ngữ khác.**
  - Thêm ngôn ngữ: mở thêm một phiên, dùng chung micro.
  - Bớt ngôn ngữ: đóng êm đúng phiên đó.
  - Khác với hiện tại (đổi cấu hình là khởi động lại cả nhóm).
  - Đổi **người nói** thì vẫn khởi động lại cả nhóm như hiện tại.
- **Khi không còn người xem nào cần một ngôn ngữ** (và chủ phòng cũng không tự bật nó): đóng phiên đó sau **60 giây**, để người xem đổi qua đổi lại không làm phiên bật tắt liên tục. Riêng phiên gốc không bao giờ bị đóng theo cách này.
- **Đổi người nói khi đang nghe:** khởi động lại mọi phiên như hiện tại. Server **giữ** lịch sử các cột (bản dịch cũ vẫn đúng), chỉ cột câu gốc đổi nhãn sang ngôn ngữ mới. *(em tự quyết)*
- Bỏ trang `/sub` và cơ chế `BroadcastChannel`. Trang người xem thay thế chúng, kể cả khi mở trên cùng máy. Giữ nút **Cửa sổ phụ đề** (cửa sổ nổi) trên trang chủ phòng. Cửa sổ này hiện transcript ngay trên máy chủ phòng, của ngôn ngữ đầu ra đầu tiên, giống bây giờ, và không mở kết nối riêng. *(em tự quyết)*

### Người xem (trang `/r/<mã>`)
- Không cần passcode, không gọi API Soniox.
- **Thanh trên:**
  - tên phòng và trạng thái phòng;
  - nút bật/tắt cho 5 ngôn ngữ, mỗi ngôn ngữ đang bật là một cột;
  - nút **Xoá**: chỉ làm trống màn hình của người xem đó.
- **Ngôn ngữ người nói** cũng chọn được làm cột: cột đó chỉ hiện câu gốc.
- **Mặc định khi mở lần đầu:**
  - một cột tiếng Việt;
  - nếu người nói đang nói tiếng Việt thì mặc định cột câu gốc.

  Lựa chọn được nhớ theo máy, trong `localStorage`.
- **Bố cục:**
  - Màn hình rộng ≥ 700 px: các cột xếp ngang, chia đều bề rộng.
  - Màn hình hẹp (điện thoại): các cột xếp dọc, chia đều chiều cao.
  - Mỗi cột có nhãn ngôn ngữ, cuộn riêng, tự cuộn tới câu mới nhất (dùng lại `SubtitleList`).
- **Cột của ngôn ngữ vừa được yêu cầu:** trong lúc máy chủ phòng đang mở phiên, hiện "Đang bật bản dịch {ngôn ngữ}…".
- **Cột của ngôn ngữ mở sau:** cột chỉ có chữ từ lúc phiên đó bắt đầu, không có bản dịch cho phần đã nói trước. Các cột không thẳng hàng từng câu với nhau. *(em tự quyết, vì server không giữ âm thanh)*
- **Chủ phòng đang tạm dừng hoặc mất kết nối:** yêu cầu ngôn ngữ của người xem vẫn được ghi nhận. Lần sau chủ phòng bấm nghe thì các phiên mở theo nhu cầu lúc đó. Trong lúc chờ, cột hiện trạng thái phòng ("Chủ phòng đang tạm dừng"), không hiện "Đang bật bản dịch…". *(em tự quyết)*
- Rớt mạng thì tự nối lại WebSocket (thử lại sau 1, 2, 4, 8 giây, rồi mỗi 10 giây). Nối lại được thì nhận lại 50 câu gần nhất.

### Giao thức WebSocket (`/ws`)
- **Xác thực chủ phòng:** khi `APP_PASSCODE` được đặt, tin `host` phải kèm session token hợp lệ (cùng token dùng cho `/api/stt-key`); sai thì server đóng kết nối. Khi không đặt passcode thì không kiểm. Người xem không bao giờ cần token. *(em tự quyết)*
- **Một kết nối = một vai.**
  - Chủ phòng: `host` kèm `{ room, hostKey? }`.
  - Người xem: `viewer` kèm `{ room, langs[] }`.
- **Chủ phòng gửi lên server:**
  - `state { source, listening }`;
  - `lines { lang, lines[] }`: 50 câu gần nhất của một ngôn ngữ. Gửi mỗi khi transcript ngôn ngữ đó đổi, gom tối đa 5 lần mỗi giây cho mỗi ngôn ngữ.
- **Server gửi cho chủ phòng:** `demand { langs[], viewers }`, tức các ngôn ngữ người xem đang cần và số người xem. Gửi mỗi khi có thay đổi.
- **Người xem gửi lên server:** `langs { langs[] }` khi đổi cột.
- **Server gửi cho người xem:**
  - `room { source, listening, hostOnline, activeLangs[] }`;
  - `lines { lang, lines[] }`, chỉ cho các ngôn ngữ người xem đó đang chọn.
- **Server kiểm tra mọi tin nhắn:**
  - đúng vai;
  - mã phòng hợp lệ;
  - `lang` thuộc 5 ngôn ngữ;
  - tối đa 50 dòng, mỗi dòng tối đa 1000 ký tự.

  Tin nhắn không hợp lệ thì bỏ qua.
- **Dạng một dòng:** đúng `DisplayLine` hiện có, tức `{ id, original, translation, live }`. Câu đang nói (gồm cả chữ tạm chưa chốt) là **dòng cuối với `live: true`**, nên người xem thấy chữ ngay khi người nói đang nói. `lines` luôn là 50 dòng gần nhất của ngôn ngữ đó, gửi đè toàn bộ; người xem dùng `id` làm key. Với cột câu gốc, `translation` để rỗng và giao diện hiện `original`. *(đã có sẵn trong code)*
- **Câu gốc: một "phiên gốc" cố định.** *(em tự quyết)*
  - Phiên mở đầu tiên khi chủ phòng bấm nghe là phiên gốc. Phiên này **không bị đóng** cho tới khi chủ phòng dừng, kể cả khi hết người cần ngôn ngữ dịch của nó.
  - Câu gốc của phiên này được gửi dưới dạng `lines` với `lang = source`.
  - Nếu ngôn ngữ dịch của phiên gốc không còn ai cần, phiên vẫn chạy để giữ câu gốc liền mạch, chỉ ngừng gửi phần dịch. Tốn thêm nhiều nhất một phiên.
  - Ngôn ngữ dịch của phiên gốc: ngôn ngữ đầu tiên đang được cần. Nếu chưa ai cần thì là `vi`, hoặc `en` khi người nói nói tiếng Việt.
- Server gửi ping mỗi 30 giây để nginx không cắt kết nối.

### Server
- Thêm `ws` vào Express trên cùng một cổng. Đường dẫn `/ws`.
- API hiện có giữ nguyên: `/api/config`, `/api/login`, `/api/stt-key`, passcode tuỳ chọn, giới hạn 60 key mỗi phút.
- **Giới hạn chống lạm dụng:**
  - tối đa 200 phòng;
  - tối đa 500 người xem mỗi phòng;
  - tối đa 20 kết nối WebSocket mỗi IP.
- Gỡ phần dành riêng cho Vercel: `rootRedirect`, `vercel.json`, `vercel-build`, `.vercelignore`. `/` phục vụ lại `index.html` như trước. `/r/<mã>` dùng chung SPA fallback.

### Passcode
- Theo cấu hình hiện tại: chỉ trang **chủ phòng** (`/`) cần passcode, khi `APP_PASSCODE` được đặt. Trang người xem không bao giờ cần passcode.
- Docker production vẫn bắt buộc `APP_PASSCODE`, hoặc `ALLOW_NO_PASSCODE=1`. Nếu chạy không passcode, ai vào `/` cũng làm chủ phòng được và tiêu tiền Soniox.

### Deploy VPS (đã khảo sát `higio@42.115.41.70`)
- **Máy:** Ubuntu 22.04, 16 CPU, 31 GB RAM, Docker 29. Đăng nhập bằng key `~/.ssh/id_ed25519_higio_vps`, sudo không cần mật khẩu. Máy đang chạy **nhiều app khác** (DAU, mmvtravel, caira, shellx…), nên tuyệt đối không đụng vào container, volume hay cấu hình của chúng.
- **Reverse proxy có sẵn:** container `proxy` (`jwilder/nginx-proxy`) cùng `nginx-letsencrypt-1` (acme companion), trên Docker network `nginx-proxy`, compose ở `/home/higio/nginx`. App mới chỉ cần chạy trên network đó với các biến sau, không phải sửa nginx:
  - `VIRTUAL_HOST=s2t.coregenaihub.com`
  - `VIRTUAL_PORT=3000`
  - `LETSENCRYPT_HOST=s2t.coregenaihub.com`
- **WebSocket:** nginx-proxy đã tự chuyển header `Upgrade`/`Connection`. Timeout đọc mặc định là 60 giây, nên server ping mỗi 30 giây để giữ kết nối.
- **Cách chạy:** thư mục `/home/higio/speak2text` gồm mã nguồn (đồng bộ bằng `rsync`, bỏ `node_modules`, `dist`, `.env*`), một `docker-compose.yml` mới (service `speak2text`, `restart: always`, network ngoài `nginx-proxy`, không mở cổng ra máy chủ) và `.env` riêng cho production. Build image ngay trên VPS (`docker compose build`), không cần Docker trên máy em.
- **`.env` production:** `SONIOX_API_KEY` copy từ `.env` của anh lên bằng `scp`, `SESSION_SECRET` sinh ngẫu nhiên, `ALLOW_NO_PASSCODE=1` theo lựa chọn của anh.
- **DNS:** `s2t.coregenaihub.com` đang CNAME sang Vercel. Anh phải đổi ở Mắt Bão thành **bản ghi A → `42.115.41.70`** trước, thì Let's Encrypt mới cấp được chứng chỉ. Trong lúc chờ DNS, em kiểm tra bằng `curl --resolve`.
- Sau khi chạy ổn trên VPS: gỡ phần dành riêng cho Vercel trong code (xem mục Server). Project Vercel `speak2text` thì anh tự quyết giữ hay xoá.

## Không làm (để sau)

- Lưu lịch sử phòng sau khi phòng bị xoá, tài khoản, nhiều chủ phòng chung một phòng.
- Chạy nhiều process server (cần Redis). Một VPS một process là đủ cho quy mô này.
- Khoá phòng bằng mật khẩu riêng cho người xem.

## Để lại cho builder

- Cách lưu và hiển thị số người xem, chữ trên nút, màu nhãn "người xem".
- Gom `lines` theo `requestAnimationFrame` hay theo timer, miễn ≤ 5 lần mỗi giây cho mỗi ngôn ngữ.
- Cấu trúc file server (`rooms.ts`, `ws.ts`, …) và cách test WebSocket (dùng client `ws` trong vitest).
