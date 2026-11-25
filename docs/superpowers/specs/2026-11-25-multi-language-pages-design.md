# Design: Chọn ngôn ngữ người nói, nhiều trang đầu ra (mỗi trang một ngôn ngữ)

Ngày: 2026-11-25 · Nền: `2026-11-25-live-subtitles-design.md` (đã build) · Trạng thái: chờ duyệt

## Mục đích

Ở màn hình ghi âm, người dùng chọn ngôn ngữ người nói và một hoặc nhiều ngôn ngữ đầu ra. Mỗi ngôn ngữ đầu ra có một trang riêng chỉ hiện phụ đề ngôn ngữ đó. Ví dụ: người nói tiếng Nhật, một trang hiện tiếng Anh, một trang hiện tiếng Việt. Các trang dùng để kéo sang màn hình hoặc máy chiếu.

Yêu cầu giữ nguyên từ trước:
- Real-time: chữ gốc và bản dịch hiện ngay khi người nói đang nói.
- Mỗi trang chỉ một phụ đề: bản dịch to màu xanh ở trên, câu gốc xám ở dưới, mỗi thứ một hàng.
- Nút Xoá.
- Làm nhanh, UI tối giản.

## Approaches

1. **Chọn — các trang chạy trên cùng máy với tab ghi âm.** Tab ghi âm gửi phụ đề sang các trang qua `BroadcastChannel`, không cần sửa server và không cần deploy.
2. Khán giả mở link trên điện thoại của họ. Server phải relay chữ tới người xem và cần HTTPS. Không chọn: anh dùng trong phòng họp có màn chiếu.

## Giới hạn đã biết

- Soniox chỉ dịch sang **một** ngôn ngữ mỗi phiên. Vì vậy app mở **một phiên Soniox cho mỗi ngôn ngữ đầu ra**, tất cả dùng chung một micro.
  - Chi phí tăng theo số ngôn ngữ (khoảng 0,24 USD/giờ mỗi ngôn ngữ).
  - Soniox giới hạn tối đa 10 phiên cùng lúc.
  - Không chọn cách dịch từng câu bằng dịch vụ khác, vì bản dịch sẽ chỉ hiện sau khi hết câu.
- Chrome chỉ cho mở **một** cửa sổ nổi tại một thời điểm. Các trang khác là cửa sổ thường, không đè được lên slide toàn màn hình.

## Thiết kế

- **Ngôn ngữ:** Anh `en`, Nhật `ja`, Việt `vi`, Trung `zh`, Hàn `ko`.
  - Người nói: chọn đúng một.
  - Đầu ra: chọn một hoặc nhiều ngôn ngữ trong các ngôn ngữ còn lại. Mặc định là Việt, hoặc Anh nếu người nói là tiếng Việt.
  - Lựa chọn được nhớ trong `localStorage`.
- **Màn hình ghi âm:**
  - Chọn ngôn ngữ người nói và các ngôn ngữ đầu ra.
  - Một nút "Mở trang" cho mỗi ngôn ngữ đầu ra.
  - Nút Xoá, nút Cửa sổ phụ đề, nút micro.
  - Vùng phụ đề: mỗi ngôn ngữ đầu ra một hàng bản dịch, có nhãn ngôn ngữ, và câu gốc một lần ở dưới cùng.
- **Trang đầu ra** `/sub?lang=xx`:
  - Mở bằng nút "Mở trang" thành một cửa sổ popup.
  - Không cần passcode, chỉ nhận dữ liệu từ tab ghi âm.
  - Hiện bản dịch xx ở trên, câu gốc ở dưới, một hàng mỗi thứ, cỡ chữ co giãn theo cửa sổ.
  - Có nút "Nổi lên trên" để mở cửa sổ nổi riêng cho ngôn ngữ đó.
  - Khi tab ghi âm chưa gửi gì hoặc đã đóng, trang để trống.
  - Trang mới mở xin trạng thái hiện tại ngay, nên không phải chờ câu tiếp theo.
- **Nhiều phiên:**
  - Mỗi ngôn ngữ đầu ra có một `Listener` và một `Transcript` riêng.
  - Một bộ thu micro dùng chung chia âm thanh cho các phiên.
  - Trạng thái chung:
    - Có phiên đang kết nối → `connecting`.
    - Có phiên đang nối lại → `reconnecting`.
    - Tất cả đang nghe → `listening`.
  - Một phiên lỗi thì dừng tất cả và báo lỗi.
- **Đổi ngôn ngữ khi đang nghe:** đổi người nói hoặc bộ ngôn ngữ đầu ra thì dừng êm mọi phiên (giữ chữ cuối) rồi mở lại với cấu hình mới.
- **Temporary key:** các phiên mở cùng lúc dùng chung một key. Key Soniox mở được nhiều phiên trong 60 giây, nên frontend giữ key khoảng 30 giây. Giới hạn ở server nâng từ 10 lên 30 key mỗi phút cho mỗi session token, vì mỗi lần nối lại các phiên đều xin key.
- **Ngưỡng chốt dòng theo ngôn ngữ người nói:** `en`, `vi` là 180 ký tự; `ja`, `zh` là 70; `ko` là 100.
- **Câu chữ:**
  - MSG-03 và MSG-11 dùng tên ngôn ngữ người nói.
  - Nút "Anh → Việt" và "Nhật → Việt" được thay bằng bộ chọn ở trên.

## Để lại cho builder

- Cách trình bày bộ chọn ngôn ngữ (select hoặc nút bật/tắt), miễn vùng bấm ≥ 44 px.
- Đổi tên field `vi` trong `Line`/`Transcript`/`Subtitle` thành tên trung tính (`translation`) vì không còn chỉ là tiếng Việt.
