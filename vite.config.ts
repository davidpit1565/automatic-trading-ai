import { defineConfig } from 'vite';

/** The dashboard reaches Revolut X through the local read-only signing proxy. */
const REVX_PROXY = {
  '/api/revx': {
    target: `http://localhost:${process.env['REVX_PROXY_PORT'] ?? 8788}`,
    changeOrigin: true,
  },
};

export default defineConfig({
  root: '.',
  // GitHub Pages serves from /<repo>/ — the deploy workflow sets BASE_PATH.
  base: process.env['BASE_PATH'] ?? '/',
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  server: {
    proxy: REVX_PROXY,
  },
  preview: {
    proxy: REVX_PROXY,
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
