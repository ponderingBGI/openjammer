import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
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
    }
  },
  preview: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp'
    }
  }
})
