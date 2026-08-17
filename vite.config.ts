import { defineConfig, type Plugin, type Connect } from 'vite'
import react from '@vitejs/plugin-react-swc'
import { VitePWA } from 'vite-plugin-pwa'
// wasm-bindgen libraries (e.g. loro-crdt, the collab CRDT) import their `.wasm`
// via the ESM-integration proposal, which Vite's dev server can't transform on
// its own ("ESM integration proposal for Wasm is not supported"). These two
// plugins add that support (+ the top-level-await wasm-bindgen emits), so the
// app boots in `tauri dev` / `vite dev`. They are build-safe too.
import wasm from 'vite-plugin-wasm'
import topLevelAwait from 'vite-plugin-top-level-await'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Browserslist staleness: we pin `caniuse-lite` as a direct dependency and refresh
// it with `bunx update-browserslist-db@latest` (NEVER `npx` — bun-only rule), so the
// data is always the latest PUBLISHED version. Browserslist still prints a "browsers
// data is N months old" notice purely by comparing the newest browser-release date in
// that data (currently 2025-12-04, the freshest caniuse-lite ships) against the wall
// clock — there is nothing newer to install. That notice is a false-stale warning, not
// a real problem, so we opt into browserslist's own documented suppression knob. Set
// here (vite.config.ts is evaluated before any browserslist query in the build) so it
// holds identically on Windows/PowerShell and Linux CI without an inline env prefix or
// an extra cross-env dependency. To re-check freshness, run `bunx update-browserslist-db`
// and confirm the registry has no newer caniuse-lite before assuming this is still inert.
process.env.BROWSERSLIST_IGNORE_OLD_DATA ??= '1'

// App version SSOT: inline package.json's version as `__APP_VERSION__` at build
// time. The diagnostics snapshot + IssueReporter stamp every bug report with it,
// and the AI agent's `get_diagnostics` tool reports it — one source of truth.
const pkgVersion = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
).version as string

// Serve the static /download page for BOTH `/download` and `/download/` in the
// dev + preview servers. Vite's SPA fallback otherwise serves the app shell for
// the extensionless `/download` (no trailing slash) — so the browser shows the
// welcome screen instead of the download page ("looks like a refresh"; only the
// trailing-slash form resolves to the directory index). We rewrite to the exact
// index.html path (NOT a redirect), so the browser URL is unchanged and Vite's
// static serve handles it with no directory-index ambiguity. Production (Vercel)
// is covered by the equivalent rewrite in vercel.json.
function serveDownloadPage(): Plugin {
  const rewrite: Connect.NextHandleFunction = (req, _res, next) => {
    const url = req.url || ''
    const q = url.indexOf('?')
    const path = q === -1 ? url : url.slice(0, q)
    if (path === '/download' || path === '/download/') {
      req.url = '/download/index.html' + (q === -1 ? '' : url.slice(q))
    }
    next()
  }
  return {
    name: 'oj-serve-download-page',
    configureServer(server) {
      server.middlewares.use(rewrite)
    },
    configurePreviewServer(server) {
      server.middlewares.use(rewrite)
    },
  }
}

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkgVersion),
  },
  plugins: [
    serveDownloadPage(),
    wasm(),
    topLevelAwait(),
    react(),
    VitePWA({
      // PROMPT, not autoUpdate: a new service worker must NEVER silently reload
      // the page (and yank the AudioContext) mid-performance. The app surfaces a
      // non-blocking prompt and applies the update on idle (see PwaUpdatePrompt).
      registerType: 'prompt',
      // Keep the fetch handler self-contained. A split Workbox runtime can leave
      // a cold, fully-offline browser unable to start the worker that owns the
      // precache, stranding even assets that are present in CacheStorage.
      includeAssets: ['favicon.ico', 'robots.txt', 'apple-touch-icon.png'],
      manifest: {
        name: 'OpenJammer',
        short_name: 'OpenJammer',
        description: 'Node-based music generation tool for live performances',
        theme_color: '#0a0a0f',
        background_color: '#0a0a0f',
        display: 'standalone',
        orientation: 'landscape',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png'
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable'
          }
        ]
      },
      workbox: {
        inlineWorkboxRuntime: true,
        // The application entry imports the CRDT and audio-engine wasm modules.
        // Caching only JS/CSS leaves the offline shell stranded before React can
        // mount, even though the navigation itself is served successfully.
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2,wasm}'],
        // Allow larger files (audio samples can be big)
        maximumFileSizeToCacheInBytes: 50 * 1024 * 1024, // 50MB
        // The static /download page is NOT the SPA. Without this, the SW's
        // NavigationRoute serves the cached app shell (index.html) for the
        // /download navigation — so the welcome screen re-renders instead of the
        // download page ("looks like a refresh"). Excluding it lets the request
        // hit the network/host, which serves public/download/index.html.
        navigateFallbackDenylist: [/^\/download/],
        runtimeCaching: [
          // Audio files - CacheFirst with long expiration
          {
            urlPattern: /\.(?:mp3|wav|ogg|m4a|flac|webm)$/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'audio-samples-cache',
              expiration: {
                maxEntries: 200,
                maxAgeSeconds: 60 * 60 * 24 * 30 // 30 days
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          },
          // Google Fonts stylesheets
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-cache',
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365 // 1 year
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          },
          // Google Fonts files
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'gstatic-fonts-cache',
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365 // 1 year
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          },
          // Instrument samples from CDN
          {
            urlPattern: /^https:\/\/.*\.(?:githubusercontent|unpkg|jsdelivr|cloudfront)\..*\.(?:mp3|wav|ogg)$/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'instrument-samples-cache',
              expiration: {
                maxEntries: 500,
                maxAgeSeconds: 60 * 60 * 24 * 30 // 30 days
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          }
        ]
      }
    })
  ],
  resolve: {
    alias: {
      // Loro's default browser entry performs a synchronous XHR for its wasm.
      // Browsers cannot reliably satisfy that cold request from a service worker
      // while offline, so use Loro's official self-contained base64 entry. The
      // CRDT remains byte-identical; only its loading transport changes.
      'loro-crdt': fileURLToPath(new URL('./node_modules/loro-crdt/base64/index.js', import.meta.url)),
      '@': '/src',
      // The shared TS protocol package (the wire/event SSOT). Aliased so both the
      // bare workspace specifier and app code resolve to the single source file
      // without a build step. Mirrors the tsconfig `paths` + vitest alias.
      '@openjammer/oj-protocol': '/packages/oj-protocol-ts/src/index.ts',
      // The design-token SSOT (themes + engine). Same alias-only pattern as the
      // protocol package — generated CSS is imported by relative path in main.tsx.
      '@openjammer/oj-tokens': '/packages/oj-tokens/src/index.ts',
      // The presentational component library (theme-agnostic primitives).
      '@openjammer/oj-ui': '/packages/oj-ui/src/index.ts',
      events: 'rollup-plugin-node-polyfills/polyfills/events'
    }
  },
  build: {
    // Default 500 kB is too tight for an app that bundles a CRDT + markdown +
    // tree-view stack; 900 kB is the honest ceiling AFTER the split below. We do
    // NOT raise it to paper over a fat entry — the manualChunks split keeps the
    // entry under it (see below).
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        // HARD-WON LESSON: hand-splitting React/scheduler/the app's own modules
        // into vendor chunks caused production-only circular ESM init crashes
        // (white screen before React mounted). So this split is deliberately
        // NARROW: it only peels off a few LEAF third-party libraries that have
        // no import edge back into app code or React internals — the CRDT
        // (loro-crdt, ~MB of wasm-bindgen glue), the markdown renderer stack
        // (react-markdown/remark/micromark/unified — large but isolated, only
        // pulled in by the command bar), and the tree-view + beat-detector
        // leaves. React, react-dom, zustand, cmdk and ALL src/ stay in the
        // entry chunk untouched, so the load-order that React's mount depends on
        // is byte-for-byte what Rollup already proved safe. Anything that is not
        // one of these explicit leaves falls through to Rollup's default
        // chunking — no broad `node_modules` catch-all that could re-trip the
        // circular-init crash.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          // Normalize Windows + pnpm-style paths to a forward-slash form so the
          // package-name match below is platform-independent.
          const path = id.replace(/\\/g, '/')
          // react-dom is the single largest dependency (~520 kB of source). It
          // and its runtime peers (react, scheduler, the react-reconciler) form
          // a self-contained vendor island with NO import edge back into app
          // code, so peeling them into one `react-vendor` chunk is safe — unlike
          // the earlier broken attempt that grouped app modules WITH React and
          // tripped a circular-init order bug. The e2e smoke (clicks "Play here",
          // asserts the worklet posts `ready` and React actually mounted) is the
          // guard that this load order stays correct.
          if (
            /\/node_modules\/(react|react-dom|scheduler|react-reconciler|use-sync-external-store)\//.test(
              path,
            )
          )
            return 'react-vendor'
          if (path.includes('/node_modules/loro-crdt/')) return 'loro-crdt'
          if (
            /\/node_modules\/(react-markdown|remark-[^/]+|remark|rehype-[^/]+|micromark[^/]*|mdast-[^/]+|hast-[^/]+|unist-[^/]+|unified|vfile[^/]*|property-information|space-separated-tokens|comma-separated-tokens|decode-named-character-reference|character-entities[^/]*|trim-lines|trough|bail|is-plain-obj|ccount|markdown-table|zwitch|longest-streak|html-url-attributes|estree-util-[^/]+|devlop|html-void-elements|web-namespaces)\//.test(
              path,
            )
          )
            return 'markdown'
          // The file-tree view (react-arborist + its react-dnd/redux runtime)
          // and the toast layer (sonner) are large, self-contained leaves used
          // only by a few panels — split so they don't weigh the entry.
          if (
            /\/node_modules\/(react-arborist|react-dnd|react-dnd-html5-backend|dnd-core|@react-dnd\/[^/]+|redux|@redux\/[^/]+)\//.test(
              path,
            )
          )
            return 'tree-view'
          if (path.includes('/node_modules/sonner/')) return 'sonner'
          // idb-keyval is a tiny, dependency-free persistence leaf. Keeping it
          // separate prevents the project store's IndexedDB adapter from tipping
          // the initial app chunk over the enforced budget.
          if (path.includes('/node_modules/idb-keyval/')) return 'idb-keyval'
          return undefined
        },
      },
    },
  },
  // Worker configuration for AudioWorklet modules
  worker: {
    format: 'es'
  },
  // Cross-Origin Isolation (U17) — required for SharedArrayBuffer, which the
  // ojcore-wasm AudioWorklet uses for the zero-latency UI<->engine command ring.
  // These headers make `crossOriginIsolated === true` so SAB is available.
  //
  // PRODUCTION HOSTING MUST SERVE THESE TOO. Any host serving the built `dist/`
  // (Vercel/Netlify/nginx/etc.) has to emit the same two response headers on the
  // app's HTML/JS, or the wasm executor silently falls back to the (functional,
  // higher-latency) postMessage control path and SharedArrayBuffer is undefined:
  //     Cross-Origin-Opener-Policy: same-origin
  //     Cross-Origin-Embedder-Policy: require-corp
  // (e.g. Vercel: vercel.json `headers`; nginx: `add_header`; Netlify: _headers.)
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp'
    },
    // Tauri dev: keep Vite's file watcher OUT of the Rust build output. During
    // `tauri dev`, cargo locks `target/**/*.dll` while linking, and chokidar
    // throws `EBUSY: resource busy or locked` watching it — which crashes the
    // dev server and aborts the whole `beforeDevCommand`. Ignoring the Rust dirs
    // (and the worktree's `.claude/`) makes `tauri dev` reliable on this layout.
    // NOTE: do NOT ignore '.claude' here — this worktree itself lives under a
    // '.claude/worktrees/…' path, so that glob would match the WHOLE project and
    // silently disable HMR for all of src/. Only the Rust build output needs
    // ignoring (the EBUSY culprit is target/**/*.dll while cargo links).
    watch: {
      ignored: ['**/target/**', '**/src-tauri/target/**']
    }
  },
  preview: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp'
    }
  }
})
