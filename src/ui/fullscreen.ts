// Full screen on phones. Android and iPad have the Fullscreen API (it needs a tap to start). An iPhone
// has none for web pages: there the only way to lose the browser bars is to add the office to the
// home screen (public/manifest.webmanifest) and open it from that icon.
type FsDoc = Document & {
  webkitFullscreenEnabled?: boolean;
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => void;
};
type FsEl = HTMLElement & { webkitRequestFullscreen?: () => void };

const doc = document as FsDoc;

export const canFullscreen = (): boolean => !!(doc.fullscreenEnabled || doc.webkitFullscreenEnabled);
export const isFullscreen = (): boolean => !!(doc.fullscreenElement || doc.webkitFullscreenElement);

/** Opened from the home-screen icon: no browser bars at all. */
export const isInstalled = (): boolean =>
  matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;

/** iPhone / iPad (iPadOS calls itself a Mac). */
export const isIos = (): boolean =>
  /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);

/** The phone is turned sideways — from the screen, not the window (an open keyboard makes a portrait window wide). */
export function isLandscape(): boolean {
  const t = screen.orientation?.type;
  if (t) return t.startsWith('landscape');
  return window.innerWidth > window.innerHeight;
}

/** Must run inside a tap. */
export async function enterFullscreen(): Promise<boolean> {
  if (isFullscreen()) return true;
  const el = document.documentElement as FsEl;
  try {
    if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' });
    else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
    else return false;
    return true;
  } catch {
    return false;
  }
}

export function exitFullscreen() {
  if (doc.fullscreenElement) void doc.exitFullscreen().catch(() => {});
  else doc.webkitExitFullscreen?.();
}

/** Calls `f` on entering / leaving full screen; returns the unsubscribe. */
export function onFullscreenChange(f: () => void): () => void {
  document.addEventListener('fullscreenchange', f);
  document.addEventListener('webkitfullscreenchange', f);
  return () => {
    document.removeEventListener('fullscreenchange', f);
    document.removeEventListener('webkitfullscreenchange', f);
  };
}
