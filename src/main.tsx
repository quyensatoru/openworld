import { createRoot } from 'react-dom/client';
import { game } from './game';
import { getState, setState } from './store';
import { App } from './ui/App';
import { RootSafe } from './ui/Safe';
import './styles.css';
import './mobile.css';

// Test hook for scripts/e2e.mjs: dev server, or a build made with VITE_DEBUG_HOOK=1 (perf runs
// against production code; deploys don't set it).
if (import.meta.env.DEV || import.meta.env.VITE_DEBUG_HOOK === '1') Object.assign(window, { __office: { game, getState, setState } });

createRoot(document.getElementById('root')!).render(
  <RootSafe>
    <App />
  </RootSafe>,
);
