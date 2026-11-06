/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

/**
 * Strict CSP, injected into the built index.html only (the dev server needs inline scripts for
 * React refresh). DAPI evonodes (whichever the quorum service lists), the quorum service and Radar are
 * other hosts, so `connect-src` allows any https origin and nothing over plain http; everything else is
 * same-origin. `wasm-unsafe-eval` is
 * what evo-sdk's WASM needs; no `unsafe-eval`, no inline scripts or styles.
 */
export const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  // evo-sdk's WASM is a separate asset, so no blob: worker is needed
  "worker-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self' https:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ');

function cspPlugin(): Plugin {
  return {
    name: 'cairn-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace('<!--CSP-->', `<meta http-equiv="Content-Security-Policy" content="${CSP}" />`);
    },
  };
}

/**
 * evo-sdk's published bundle (`dist/evo-sdk.module.js`) inlines wasm-sdk's WASM as base64 of gzip: a 12 MB JS string that the
 * CDN cannot compress further, is parsed as JS, base64-decoded and gunzipped before it compiles. Its unbundled entry
 * (`dist/sdk.js`) imports `@dashevo/wasm-sdk/compressed`; pointing that at wasm-sdk's own `raw` entry makes the WASM a separate
 * `.wasm` asset (its `new URL('wasm_sdk_bg.wasm', import.meta.url)`), served as application/wasm, compressed by the CDN and
 * compiled while it streams. Same exports, same `init()`.
 */
const EVO_SDK_ALIASES = [
  { find: /^@dashevo\/evo-sdk$/, replacement: fileURLToPath(new URL('sdk.js', import.meta.resolve('@dashevo/evo-sdk'))) },
  { find: /^@dashevo\/wasm-sdk\/compressed$/, replacement: '@dashevo/wasm-sdk/raw' },
];

export default defineConfig({
  // CAIRN_BASE is the URL prefix when served from a sub-path (GitHub Pages before the custom domain).
  base: process.env.CAIRN_BASE ?? '/',
  plugins: [react(), cspPlugin()],
  // not under Vitest (Node): raw init() would fetch the WASM from a file:// URL; no unit test initialises the SDK
  resolve: { alias: process.env.VITEST ? [] : EVO_SDK_ALIASES },
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    // evo-sdk's JS is ~630 KB (its ~26 MB WASM is a separate asset); it is lazy-loaded after first paint.
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      onwarn(w, warn) {
        // @scure/base has a harmless misplaced /* @__PURE__ */ comment.
        if (w.code === 'INVALID_ANNOTATION' && w.id?.includes('@scure/base')) return;
        warn(w);
      },
    },
  },
  // not pre-bundled: esbuild would drop wasm-sdk's `new URL(..., import.meta.url)` WASM reference
  optimizeDeps: { exclude: ['@dashevo/evo-sdk', '@dashevo/wasm-sdk'] },
  preview: { port: Number(process.env.CAIRN_E2E_PORT ?? 4417), strictPort: true },
  server: { port: 5417 },
  test: {
    // component tests (*.test.tsx) pick a DOM per file: `// @vitest-environment happy-dom`
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    environment: 'node',
  },
});
