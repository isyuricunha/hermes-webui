/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // SECURITY (review F2): default loopback. The Vite dev server proxies
    // /api to the unauthenticated WebUI control surface; opt into a broader
    // bind explicitly with VITE_DEV_HOST=1 (private network, at your own risk).
    host: process.env.VITE_DEV_HOST === '1' ? true : '127.0.0.1',
    port: 5173,
    proxy: {
      // Dev only: in production the Fastify server serves the built assets.
      '/api': {
        target: 'http://127.0.0.1:8789',
        changeOrigin: false,
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
  },
});
