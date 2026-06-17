import { defineConfig, devices } from '@playwright/test';

// PWA smoke / E2E (plan §4.2). Builds the production PWA and serves it through
// `vite preview`, which emits the COOP/COEP headers the engine's
// SharedArrayBuffer path needs — so the suite asserts `crossOriginIsolated ===
// true` against the REAL built bundle, not just the dev server.
const PORT = 4173;

export default defineConfig({
    testDir: './e2e',
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    workers: process.env.CI ? 1 : undefined,
    reporter: process.env.CI ? 'line' : 'list',
    use: {
        baseURL: `http://localhost:${PORT}`,
        trace: 'on-first-retry',
    },
    projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
    webServer: {
        command: `bun run build && bun run preview --port ${PORT} --strictPort`,
        url: `http://localhost:${PORT}`,
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
    },
});
