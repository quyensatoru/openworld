declare const __BUILD_ID__: string | undefined;
/** Build id baked in by vite.config.ts (same for client and worker of one build). */
export const BUILD_ID: string = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev';
