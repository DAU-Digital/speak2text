import { useEffect, useState } from "react";
// Always-on-top subtitle window via Document Picture-in-Picture (Chrome/Edge desktop).
type DocumentPip = { requestWindow(options?: { width?: number; height?: number }): Promise<Window> };

const api = () => (window as unknown as { documentPictureInPicture?: DocumentPip }).documentPictureInPicture;

export const floatingSupported = (): boolean => !!api();

/** Must be called from a click. Copies the page's styles into the new window. */
export async function openFloatingWindow(): Promise<Window> {
  const pip = await api()!.requestWindow({ width: 960, height: 150 });
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      const style = pip.document.createElement("style");
      style.textContent = Array.from(sheet.cssRules, (r) => r.cssText).join("\n");
      pip.document.head.appendChild(style);
    } catch {
      if (!sheet.href) continue;
      const link = pip.document.createElement("link");
      link.rel = "stylesheet";
      link.href = sheet.href;
      pip.document.head.appendChild(link);
    }
  }
  pip.document.title = "Phụ đề";
  pip.document.body.className = "pip";
  return pip;
}

/** Open/close state of the floating window; it resets when the user closes the window. */
export function useFloatingWindow(): [Window | null, () => void] {
  const [win, setWin] = useState<Window | null>(null);

  useEffect(() => {
    if (!win) return;
    const onClose = () => setWin(null);
    win.addEventListener("pagehide", onClose);
    return () => {
      win.removeEventListener("pagehide", onClose);
      win.close();
    };
  }, [win]);

  const toggle = () => {
    if (win) return setWin(null);
    openFloatingWindow().then(setWin, (err) => console.error(err));
  };
  return [win, toggle];
}
