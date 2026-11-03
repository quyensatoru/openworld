import { createRoot } from 'react-dom/client';
import { game } from './game';
import { getState, setState } from './store';
import { App } from './ui/App';
import { RootSafe } from './ui/Safe';
import './styles.css';

// Test hook for scripts/e2e.mjs (dev server only).
if (import.meta.env.DEV) Object.assign(window, { __office: { game, getState, setState } });

createRoot(document.getElementById('root')!).render(
  <RootSafe>
    <App />
  </RootSafe>,
);
