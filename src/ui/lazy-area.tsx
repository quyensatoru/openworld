// The floors with their own games (cinema, werewolf, mole, prop hunt, wedding) ship their UI as
// separate chunks: nobody downloads them until they walk in (or a game they are part of needs them).
import { Suspense, lazy, useState, type ComponentType, type ReactNode } from 'react';

/** One named export of a lazily loaded module, as a component. Every part of a module shares its chunk. */
export function part<M>(load: () => Promise<M>, name: keyof M): ComponentType {
  return lazy(() => load().then((m) => ({ default: m[name] as ComponentType })));
}

/**
 * Renders its parts once `want` has been true, and keeps them from then on (each part already hides
 * itself when it has nothing to show). `label` → a small "loading…" pill while the chunk arrives;
 * without it the parts just appear when ready.
 */
export function Area({ want, label, children }: { want: boolean; label?: string; children: ReactNode }) {
  const [on, setOn] = useState(false);
  if (want && !on) setOn(true);
  if (!on && !want) return null;
  return (
    <Suspense
      fallback={
        label ? (
          <div className="area-loading" role="status">
            <span className="spinner" /> Đang tải {label}…
          </div>
        ) : null
      }
    >
      {children}
    </Suspense>
  );
}
