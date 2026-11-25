// Shared look in the DAU Digital style: brand mark, split landing layout, line icons.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { levelToMeter, micLevel } from "./audioLevel";
import { setUiLang, UI_LANGS, uiLang, useT } from "./i18n";
import type { Lang } from "./languages";

const YEAR = new Date().getFullYear();

export function BrandMark() {
  const t = useT();
  return (
    <div className="brand">
      <img src="/logo-dau.png" alt="" />
      <div>
        <div className="brand-name">DAU S2T</div>
        <div className="brand-sub">{t.brandSub}</div>
      </div>
    </div>
  );
}

/** Landing layout: brand panel on the left (hidden on phones), content and footer on the right. */
export function SplitLayout({ children }: { children: ReactNode }) {
  const t = useT();
  return (
    <div className="split">
      <aside className="hero">
        <div className="hero-brand">
          <img src="/logo-dau.png" alt="" />
          <div>
            <div className="hero-name">DAU Digital</div>
            <div className="hero-sub">Live subtitles</div>
          </div>
        </div>
        <div className="hero-copy">
          <h1>
            {t.heroTitle[0]}
            <br />
            {t.heroTitle[1]}
          </h1>
          <p>{t.heroText}</p>
        </div>
        <p className="hero-foot">{t.copyright(YEAR)}</p>
      </aside>
      <div className="split-main">
        <div className="split-top">
          <UiLangSwitch />
        </div>
        <div className="split-body">{children}</div>
        <footer className="split-foot">{t.copyright(YEAR)}</footer>
      </div>
    </div>
  );
}

const Svg = ({ children, size = 16, fill = false }: { children: ReactNode; size?: number; fill?: boolean }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill={fill ? "currentColor" : "none"}
    stroke={fill ? "none" : "currentColor"}
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {children}
  </svg>
);

export const MicIcon = () => (
  <Svg size={26}>
    <rect x="9" y="2" width="6" height="12" rx="3" />
    <path d="M5 10v1a7 7 0 0 0 14 0v-1M12 18v4M8 22h8" />
  </Svg>
);
export const StopIcon = () => (
  <Svg size={22} fill>
    <rect x="5" y="5" width="14" height="14" rx="1" />
  </Svg>
);
export const LinkIcon = () => (
  <Svg>
    <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" />
    <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />
  </Svg>
);
export const LeaveIcon = () => (
  <Svg>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
  </Svg>
);
export const ClearIcon = () => (
  <Svg>
    <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
  </Svg>
);
export const WindowIcon = () => (
  <Svg>
    <rect x="2" y="4" width="20" height="16" rx="1" />
    <rect x="11" y="12" width="8" height="5" />
  </Svg>
);
export const ArrowIcon = () => (
  <Svg>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </Svg>
);

/** Column title in the small-caps style, e.g. "VIETNAMESE", with a badge for the speaker's language. */
export function ColumnHead({ lang, original }: { lang: Lang; original: boolean }) {
  const t = useT();
  return (
    <div className="col-head">
      <span>{t.langName[lang]}</span>
      {original && <span className="badge">{t.original}</span>}
    </div>
  );
}

/** EN | VI segmented switch for the interface language. */
export function UiLangSwitch() {
  const t = useT();
  const current = uiLang();
  return (
    <div className="ui-switch" role="group" aria-label={t.uiLangLabel}>
      {UI_LANGS.map((l) => (
        <button key={l} aria-pressed={l === current} onClick={() => setUiLang(l)}>
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

export const QrIcon = () => (
  <Svg>
    <rect x="3" y="3" width="7" height="7" />
    <rect x="14" y="3" width="7" height="7" />
    <rect x="3" y="14" width="7" height="7" />
    <path d="M14 14h3v3h-3zM20 14v7M14 20h3" />
  </Svg>
);
const ExpandIcon = () => (
  <Svg>
    <path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5" />
  </Svg>
);
const ShrinkIcon = () => (
  <Svg>
    <path d="M3 8h5V3M21 8h-5V3M3 16h5v5M21 16h-5v5" />
  </Svg>
);
const CloseIcon = () => (
  <Svg>
    <path d="M6 6l12 12M18 6L6 18" />
  </Svg>
);

/** Live microphone level bar; reads the level every frame without re-rendering React. */
export function MicMeter({ active }: { active: boolean }) {
  const fill = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!active) return;
    let id = 0;
    let shown = 0;
    const frame = () => {
      // Rise fast, fall slowly, like a VU meter.
      const target = levelToMeter(micLevel.current);
      shown = target > shown ? target : shown * 0.9 + target * 0.1;
      if (fill.current) fill.current.style.transform = `scaleX(${shown})`;
      id = requestAnimationFrame(frame);
    };
    id = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(id);
      if (fill.current) fill.current.style.transform = "scaleX(0)";
    };
  }, [active]);
  return (
    <div className={active ? "meter on" : "meter"} aria-hidden="true">
      <span ref={fill} />
    </div>
  );
}

/** A− / A+ for the subtitle text size. */
export function TextSizeControl({ onStep }: { onStep: (dir: number) => void }) {
  const t = useT();
  return (
    <div className="seg" role="group">
      <button onClick={() => onStep(-1)} aria-label={t.textSmaller} title={t.textSmaller}>
        A−
      </button>
      <button onClick={() => onStep(1)} aria-label={t.textLarger} title={t.textLarger}>
        A+
      </button>
    </div>
  );
}

/** Full-screen toggle for the viewer page (hidden where the browser has no full-screen API, e.g. iPhone). */
export function FullscreenButton() {
  const t = useT();
  const [on, setOn] = useState(!!document.fullscreenElement);
  useEffect(() => {
    const sync = () => setOn(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);
  if (!document.fullscreenEnabled) return null;
  const toggle = () =>
    void (on ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => {});
  return (
    <button onClick={toggle} aria-label={on ? t.exitFullscreen : t.fullscreen} title={on ? t.exitFullscreen : t.fullscreen}>
      {on ? <ShrinkIcon /> : <ExpandIcon />}
    </button>
  );
}

/** Share panel: a large QR code to put on the projector, the link, copy and the system share sheet. */
export function ShareDialog({ url, code, onClose }: { url: string; code: string; onClose: () => void }) {
  const t = useT();
  const dialog = useRef<HTMLDialogElement>(null);
  const [svg, setSvg] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    dialog.current?.showModal();
    let alive = true;
    // Loaded on demand: viewers never open this panel, so they don't download the QR encoder.
    import("qrcode")
      .then(({ default: QRCode }) =>
        QRCode.toString(url, { type: "svg", margin: 0, errorCorrectionLevel: "M", color: { dark: "#0f1729", light: "#ffffff" } }),
      )
      .then((s) => alive && setSvg(s))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [url]);

  async function copy() {
    await navigator.clipboard?.writeText(url).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <dialog
      ref={dialog}
      className="share"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) dialog.current?.close(); // click on the backdrop
      }}
    >
      <div className="share-body">
        <button className="share-close" onClick={() => dialog.current?.close()} aria-label={t.close}>
          <CloseIcon />
        </button>
        <span className="eyebrow">{t.scanToWatch}</span>
        <div className="share-code">
          {t.room} <strong>{code}</strong>
        </div>
        {/* SVG generated locally from our own room URL */}
        <div className="qr" dangerouslySetInnerHTML={{ __html: svg }} />
        <p className="share-hint">{t.shareHint}</p>
        <div className="share-link">
          <input readOnly value={url} onFocus={(e) => e.currentTarget.select()} aria-label="URL" />
          <button className="btn-primary" onClick={copy}>
            <LinkIcon /> {copied ? t.copied : t.copyLink}
          </button>
        </div>
        {typeof navigator.share === "function" && (
          <button className="share-native" onClick={() => void navigator.share({ title: t.shareTitle(code), url }).catch(() => {})}>
            {t.shareVia}
          </button>
        )}
      </div>
    </dialog>
  );
}
