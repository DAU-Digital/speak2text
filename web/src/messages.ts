import type { Lang } from "./subtitles";

const langName = (lang: Lang) => (lang === "en" ? "tiếng Anh" : "tiếng Nhật");

// Copy verbatim from the spec, section 5 (MSG-06 and MSG-07 are out of scope for this version).
export const MSG = {
  MSG01: "Passcode chưa đúng. Thử lại.",
  MSG02: "App chưa được phép dùng micro. Bật quyền micro cho trang này trong cài đặt trình duyệt rồi bấm micro lại.",
  MSG03: (lang: Lang) => `Đang nghe ${langName(lang)}. Phụ đề hiện sau mỗi câu.`,
  MSG04: "Mất kết nối, đang nối lại…",
  MSG05: "Không nối lại được. Kiểm tra mạng rồi bấm micro để nghe tiếp.",
  MSG08: "Nhập sai quá nhiều lần. Thử lại sau 5 phút.",
  MSG09: "Phiên đăng nhập đã hết hạn. Nhập lại passcode.",
  MSG10: "Dịch vụ nhận giọng nói đang lỗi. Thử lại sau ít phút.",
  MSG11: (lang: Lang) => `Bấm micro để nghe ${langName(lang)}.`,
};
