import { createRoot } from 'react-dom/client';
import { bootSettled, bootStarting } from './profile';
import { getState, setState } from './store';
import { App } from './ui/App';
import { RootSafe } from './ui/Safe';
import './styles.css';
import './mobile.css';

// Test hook for scripts/e2e.mjs: dev server, or a build made with VITE_DEBUG_HOOK=1 (perf runs
// against production code; deploys don't set it).
// The game lives in the office chunk, so the hook is attached once that chunk has loaded.
if (import.meta.env.DEV || import.meta.env.VITE_DEBUG_HOOK === '1') void import('./game').then(({ game }) => Object.assign(window, { __office: { game, getState, setState } }));

// Leave a mark that this start happened; clear it once we have been up long enough to call it a
// success. A tab the browser killed for running out of memory never gets to clear it, and the
// next start comes back on lower graphics (see safeQuality in store.ts).
bootStarting();
window.setTimeout(bootSettled, 25_000);
window.addEventListener('pagehide', bootSettled); // leaving on purpose is not a crash

createRoot(document.getElementById('root')!).render(
  <RootSafe>
    <App />
  </RootSafe>,
);
