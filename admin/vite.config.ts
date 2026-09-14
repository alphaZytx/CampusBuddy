import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@campusbuddy/shared': path.join(root, 'packages/shared/src/index.ts'),
      '@': path.join(root, 'admin/src'),
    },
  },
  server: {
    port: 5174,
    // The API is proxied so the browser sees one origin in development, which keeps
    // cookies, CORS and the WebSocket upgrade straightforward.
    proxy: {
      '/api': { target: 'http://127.0.0.1:4000', changeOrigin: true },
      '/ws': { target: 'ws://127.0.0.1:4000', ws: true },
    },
  },
  build: { outDir: 'dist', sourcemap: true },
});
