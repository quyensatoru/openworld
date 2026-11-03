// Soft UI sounds (WebAudio, no files) and desktop notifications when the tab is in the background.

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  } catch {
    return null;
  }
}

type Chime = 'ping' | 'join' | 'near' | 'done' | 'wave' | 'pomo';

const NOTES: Record<Chime, [number, number][]> = {
  ping: [[880, 0], [1320, 0.09]],
  join: [[660, 0], [990, 0.08]],
  near: [[523, 0], [784, 0.1]],
  done: [[784, 0], [988, 0.1], [1318, 0.2]],
  wave: [[988, 0], [1318, 0.08], [988, 0.16]],
  pomo: [[659, 0], [784, 0.15], [1047, 0.3], [784, 0.45]],
};

export function chime(kind: Chime, volume = 0.12): void {
  const a = audio();
  if (!a) return;
  const t0 = a.currentTime + 0.01;
  for (const [freq, at] of NOTES[kind]) {
    const o = a.createOscillator();
    const g = a.createGain();
    o.type = 'sine';
    o.frequency.value = freq;
    g.gain.setValueAtTime(0, t0 + at);
    g.gain.linearRampToValueAtTime(volume, t0 + at + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + 0.45);
    o.connect(g).connect(a.destination);
    o.start(t0 + at);
    o.stop(t0 + at + 0.5);
  }
}

export function askNotificationPermission(): void {
  if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {});
}

export function notify(title: string, body: string): void {
  if (!document.hidden || !('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    const n = new Notification(title, { body, tag: title, silent: true });
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } catch {
    /* some browsers only allow notifications from a service worker */
  }
}

let flashTimer: number | undefined;
let baseTitle = document.title;
export function flashTitle(text: string): void {
  if (!document.hidden) return;
  baseTitle = baseTitle || document.title;
  clearInterval(flashTimer);
  let on = false;
  flashTimer = window.setInterval(() => {
    document.title = (on = !on) ? text : baseTitle;
  }, 1000);
  const stop = () => {
    clearInterval(flashTimer);
    document.title = baseTitle;
    document.removeEventListener('visibilitychange', stop);
  };
  document.addEventListener('visibilitychange', stop);
}
