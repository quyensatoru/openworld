import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { cloudflare } from '@cloudflare/vite-plugin';

// One id per build, baked into both the client and the worker: the server tells clients its id in
// `welcome`, so tabs opened before a deploy can offer a reload.
const BUILD_ID = process.env.BUILD_ID ?? new Date().toISOString().slice(0, 16);

export default defineConfig({
  // OFFICE_STATE=<dir>: a dev server with its own local D1 / Durable Object data — tests on a second
  // server must never share state with the office someone is using on 5173
  plugins: [react(), cloudflare(process.env.OFFICE_STATE ? { persistState: { path: process.env.OFFICE_STATE } } : {})],
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  server: { host: true, port: 5173 },
  build: { chunkSizeWarningLimit: 2500 },
});
