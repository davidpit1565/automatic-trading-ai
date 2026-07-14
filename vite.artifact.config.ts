/**
 * Single-file build: inlines all JS/CSS into one index.html so the
 * dashboard can be shared as a self-contained page (e.g. opened on a
 * phone). Functionally identical to the normal build; without the local
 * proxy it runs in clearly-labelled demo mode.
 *
 *   npm run build:single  ->  dist-single/index.html
 */

import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  root: '.',
  plugins: [viteSingleFile()],
  build: {
    outDir: 'dist-single',
    sourcemap: false,
  },
});
