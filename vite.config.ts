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
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
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
      '@': '/src',
      // The shared TS protocol package (the wire/event SSOT). Aliased so both the
      // bare workspace specifier and app code resolve to the single source file
      // without a build step. Mirrors the tsconfig `paths` + vitest alias.
      '@openjammer/oj-protocol': '/packages/oj-protocol-ts/src/index.ts',
      events: 'rollup-plugin-node-polyfills/polyfills/events'
    }
  },
  // Let Rollup/Vite choose chunk boundaries. Hand-written vendor chunks caused
  // production-only circular ESM initialization crashes (white screen before
  // React mounted), so startup correctness beats cache-shape micro-optimization.
  build: {
    chunkSizeWarningLimit: 900,
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
