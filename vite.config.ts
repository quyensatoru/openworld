import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { cloudflare } from '@cloudflare/vite-plugin';

// One id per build, baked into both the client and the worker: the server tells clients its id in
// `welcome`, so tabs opened before a deploy can offer a reload.
const BUILD_ID = process.env.BUILD_ID ?? new Date().toISOString().slice(0, 16);

export default defineConfig({
  plugins: [react(), cloudflare()],
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  server: { host: true, port: 5173 },
  build: { chunkSizeWarningLimit: 2500 },
});
