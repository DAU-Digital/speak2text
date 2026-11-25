// Shared look in the DAU Digital style: brand mark, split landing layout, line icons.
import type { ReactNode } from "react";
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
