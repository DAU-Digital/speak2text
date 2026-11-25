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
