import { defineConfig } from 'vite'
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

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkgVersion),
  },
  plugins: [
    wasm(),
    topLevelAwait(),
    react(),
    VitePWA({
      registerType: 'autoUpdate',
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
