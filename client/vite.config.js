import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const target = process.env.GATEWAY || 'http://127.0.0.1:3000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // The dev server proxies to the Node gateway so the browser talks to a single
    // origin. That keeps the WebSocket URL derivation in the client trivial.
    proxy: {
      '/api': { target, changeOrigin: true },
      '/ws': { target, ws: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});