// Interface language: English by default, Vietnamese on request; remembered per device.
import { useSyncExternalStore } from "react";
import type { Lang } from "./languages";

export type UiLang = "en" | "vi";
export const UI_LANGS: UiLang[] = ["en", "vi"];

const EN = {
  langShort: { en: "English", ja: "Japanese", vi: "Vietnamese", zh: "Chinese", ko: "Korean" } as Record<Lang, string>,
  langName: { en: "English", ja: "Japanese", vi: "Vietnamese", zh: "Chinese", ko: "Korean" } as Record<Lang, string>,

  brandSub: "Live subtitles",
  heroTitle: ["Live subtitles", "for every lecture"],
  heroText: "Whatever language the speaker uses, every listener reads it in their own, as the words are spoken.",
  copyright: "@CAIRA - Copy right Đại Học Kiến Trúc Đà Nẵng",
  welcome: "Welcome to",
  welcomeName: "DAU Subtitle Rooms",
  uiLangLabel: "Interface language",

  loginLead: "Enter the passcode to open a subtitle room.",
  passcode: "Passcode",
  enter: "Continue",

  landingLead: "Pick any room code and press Open room. Viewers open the shared link and choose the language they want to read.",
  roomCode: "Room code",
  roomPlaceholder: "e.g. lecture-2",
  openRoom: "Open room",
  howTo: "How it works",
  steps: [
    "Open a room with an easy-to-remember code.",
    "Choose the speaker's language, press the mic and start talking.",
    "Press Share and send the link to your viewers.",
  ],

  hostTitle: "Live subtitles | DAU Digital",
  room: "Room",
  viewers: (n: number) => (n === 1 ? "1 viewer" : `${n} viewers`),
  connectingRoom: "Connecting room…",
  share: "Share",
  copied: "Link copied",
  shareTitle: (code: string) => `Live subtitles — room ${code}`,
  leave: "Leave room",
  speaker: "Speaker",
  translateTo: "Translate to",
  viewerBadge: "viewers",
  clear: "Clear",
  floating: "Subtitle window",
  floatingTitle: "Subtitles",
  emptyTitle: "Subtitles will appear here",
  emptyHint: "Press the mic below to start listening.",
  micStart: "Start listening",
  micStop: "Stop listening",
  connecting: "Connecting…",
  stopping: "Stopping…",
  openRoomFirst: "Open a room first, then press the mic to listen.",
  original: "original",

  roomInvalid: "Room codes use lowercase letters, digits and -, 3–32 characters.",
  roomTaken: "This room code is in use. Pick another one.",
  roomReplaced: "This room was just opened in another tab or device, so this tab left it.",
  roomFull: "The server is busy, try again later.",
  roomFailed: "Couldn't open the room.",
  targetFailed: (l: Lang, limit: boolean) =>
    `Couldn't turn on ${EN.langName[l]} translation${limit ? ": the Soniox account hit its concurrent session limit." : "."}`,
  concurrency: "The Soniox account hit its concurrent session limit. Close some rooms or raise the limit in Soniox Console.",

  MSG01: "Wrong passcode. Try again.",
  MSG02: "The app can't use the microphone. Allow microphone access for this site in your browser settings, then press the mic again.",
  MSG03: (l: Lang) => `Listening to ${EN.langName[l]}. Subtitles appear while the speaker is talking.`,
  MSG04: "Connection lost, reconnecting…",
  MSG05: "Couldn't reconnect. Check your network, then press the mic to continue.",
  MSG08: "Too many wrong attempts. Try again in 5 minutes.",
  MSG09: "Your session expired. Enter the passcode again.",
  MSG10: "The speech service is having problems. Try again in a few minutes.",
  MSG11: (l: Lang) => `Press the mic to listen to ${EN.langName[l]}.`,

  viewerTitle: (code: string) => `Room ${code} — Live subtitles`,
  show: "Show",
  vInvalid: "Invalid room code. Check the link.",
  vFull: "The room or server is full, try again in a few minutes.",
  vFailed: "Couldn't join the room.",
  vConnecting: "Connecting…",
  vReconnecting: "Reconnecting…",
  vNotOpen: "Room not open yet, or it has ended",
  vHostLost: "The host lost connection…",
  vListening: (l: Lang) => `Listening to ${EN.langName[l]}`,
  vPaused: "The host has paused",
  vPickOne: "Choose at least one language to see subtitles.",
  vStarting: (l: Lang) => `Turning on ${EN.langName[l]} translation…`,
  vNoSubs: "No subtitles yet.",

  textSmaller: "Smaller text",
  textLarger: "Larger text",
  fullscreen: "Full screen",
  exitFullscreen: "Exit full screen",
  scanToWatch: "Scan to watch live subtitles",
  shareHint: "Show this code on the projector, or send the link. Viewers pick their own language.",
  copyLink: "Copy link",
  shareVia: "Share…",
  close: "Close",
  micShortcut: "Space",
  loginOpenLead: "Enter the passcode and a room code to start.",
};

export type Strings = typeof EN;

const VI_NAME: Record<Lang, string> = { en: "tiếng Anh", ja: "tiếng Nhật", vi: "tiếng Việt", zh: "tiếng Trung", ko: "tiếng Hàn" };

const VI: Strings = {
  langShort: { en: "Anh", ja: "Nhật", vi: "Việt", zh: "Trung", ko: "Hàn" },
  langName: VI_NAME,

  brandSub: "Phụ đề trực tiếp",
  heroTitle: ["Phụ đề trực tiếp", "cho mọi bài giảng"],
  heroText: "Người nói dùng ngôn ngữ nào, người nghe cũng đọc được tiếng của mình, ngay khi lời vừa nói ra.",
  copyright: "@CAIRA - Copy right Đại Học Kiến Trúc Đà Nẵng",
  welcome: "Chào mừng bạn đến với",
  welcomeName: "Phòng phụ đề DAU",
  uiLangLabel: "Ngôn ngữ giao diện",

  loginLead: "Nhập passcode để mở phòng phụ đề.",
  passcode: "Passcode",
  enter: "Vào",

  landingLead: "Nhập một mã phòng tuỳ ý rồi bấm Mở phòng. Người xem mở link chia sẻ và chọn ngôn ngữ muốn đọc.",
  roomCode: "Mã phòng",
  roomPlaceholder: "ví dụ: hop-thu-2",
  openRoom: "Mở phòng",
  howTo: "Cách dùng",
  steps: [
    "Mở phòng với một mã dễ nhớ.",
    "Chọn ngôn ngữ người nói, bấm micro và bắt đầu nói.",
    "Bấm Chia sẻ, gửi link cho người xem.",
  ],

  hostTitle: "Phụ đề trực tiếp | DAU Digital",
  room: "Phòng",
  viewers: (n) => `${n} người đang xem`,
  connectingRoom: "Đang kết nối phòng…",
  share: "Chia sẻ",
  copied: "Đã chép link",
  shareTitle: (code) => `Phụ đề trực tiếp — phòng ${code}`,
  leave: "Rời phòng",
  speaker: "Người nói",
  translateTo: "Dịch sang",
  viewerBadge: "người xem",
  clear: "Xoá",
  floating: "Cửa sổ phụ đề",
  floatingTitle: "Phụ đề",
  emptyTitle: "Phụ đề sẽ hiện ở đây",
  emptyHint: "Bấm micro bên dưới để bắt đầu nghe.",
  micStart: "Bắt đầu nghe",
  micStop: "Dừng nghe",
  connecting: "Đang kết nối…",
  stopping: "Đang dừng…",
  openRoomFirst: "Mở phòng trước, rồi bấm micro để nghe.",
  original: "gốc",

  roomInvalid: "Mã phòng chỉ gồm chữ thường, số và dấu -, dài 3–32 ký tự.",
  roomTaken: "Mã phòng này đang có người dùng. Chọn mã khác.",
  roomReplaced: "Phòng này vừa được mở ở tab hoặc máy khác, tab này đã rời phòng.",
  roomFull: "Máy chủ đang quá tải, thử lại sau.",
  roomFailed: "Không mở được phòng.",
  targetFailed: (l, limit) =>
    `Không bật được bản dịch ${VI_NAME[l]}${limit ? ": tài khoản Soniox đã chạm giới hạn số phiên cùng lúc." : "."}`,
  concurrency: "Tài khoản Soniox đã chạm giới hạn số phiên cùng lúc. Đóng bớt phòng hoặc nâng giới hạn trong Soniox Console.",

  MSG01: "Passcode chưa đúng. Thử lại.",
  MSG02: "App chưa được phép dùng micro. Bật quyền micro cho trang này trong cài đặt trình duyệt rồi bấm micro lại.",
  MSG03: (l) => `Đang nghe ${VI_NAME[l]}. Phụ đề hiện ngay khi người nói đang nói.`,
  MSG04: "Mất kết nối, đang nối lại…",
  MSG05: "Không nối lại được. Kiểm tra mạng rồi bấm micro để nghe tiếp.",
  MSG08: "Nhập sai quá nhiều lần. Thử lại sau 5 phút.",
  MSG09: "Phiên đăng nhập đã hết hạn. Nhập lại passcode.",
  MSG10: "Dịch vụ nhận giọng nói đang lỗi. Thử lại sau ít phút.",
  MSG11: (l) => `Bấm micro để nghe ${VI_NAME[l]}.`,

  viewerTitle: (code) => `Phòng ${code} — Phụ đề`,
  show: "Xem",
  vInvalid: "Mã phòng không hợp lệ. Kiểm tra lại link.",
  vFull: "Phòng hoặc máy chủ đang đầy, thử lại sau ít phút.",
  vFailed: "Không vào được phòng.",
  vConnecting: "Đang kết nối…",
  vReconnecting: "Đang kết nối lại…",
  vNotOpen: "Phòng chưa mở hoặc đã kết thúc",
  vHostLost: "Chủ phòng đang mất kết nối…",
  vListening: (l) => `Đang nghe ${VI_NAME[l]}`,
  vPaused: "Chủ phòng đang tạm dừng",
  vPickOne: "Chọn ít nhất một ngôn ngữ để xem phụ đề.",
  vStarting: (l) => `Đang bật bản dịch ${VI_NAME[l]}…`,
  vNoSubs: "Chưa có phụ đề.",

  textSmaller: "Chữ nhỏ hơn",
  textLarger: "Chữ to hơn",
  fullscreen: "Toàn màn hình",
  exitFullscreen: "Thoát toàn màn hình",
  scanToWatch: "Quét để xem phụ đề trực tiếp",
  shareHint: "Chiếu mã này lên màn hình hoặc gửi link. Người xem tự chọn ngôn ngữ.",
  copyLink: "Chép link",
  shareVia: "Chia sẻ…",
  close: "Đóng",
  micShortcut: "Space",
  loginOpenLead: "Nhập passcode và mã phòng để bắt đầu.",
};

const STRINGS: Record<UiLang, Strings> = { en: EN, vi: VI };
const KEY = "s2t.ui";
const listeners = new Set<() => void>();

function stored(): UiLang {
  try {
    return localStorage.getItem(KEY) === "vi" ? "vi" : "en";
  } catch {
    return "en";
  }
}

let current: UiLang = stored();
if (typeof document !== "undefined") document.documentElement.lang = current;

export const uiLang = (): UiLang => current;

/** Strings for the current interface language; safe to call from event handlers. */
export const tr = (): Strings => STRINGS[current];

export function setUiLang(l: UiLang): void {
  current = l;
  try {
    localStorage.setItem(KEY, l);
  } catch {
    // private mode: the choice lasts for this page only
  }
  document.documentElement.lang = l;
  listeners.forEach((f) => f());
}

const subscribe = (f: () => void) => {
  listeners.add(f);
  return () => listeners.delete(f);
};

/** Re-renders the component when the interface language changes. */
export function useT(): Strings {
  return STRINGS[useSyncExternalStore(subscribe, uiLang)];
}
