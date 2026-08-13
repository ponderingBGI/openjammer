import { defineConfig, devices } from '@playwright/test';

// PWA smoke / E2E (plan §4.2). Builds the production PWA and serves it through
// `vite preview`, which emits the COOP/COEP headers the engine's
// SharedArrayBuffer path needs — so the suite asserts `crossOriginIsolated ===
// true` against the REAL built bundle, not just the dev server.
const PORT = 4173;

// Which browser engines to drive. The dead-worklet bug was browser-independent
// (a bundling defect, not a Chromium quirk), so the resurrection is best proven
// on Firefox + WebKit too. But `bun run test:e2e` (= `playwright test`) launches
// EVERY configured project, and a project whose browser binary isn't installed
// fails at `browserType.launch` ("Executable doesn't exist") — turning the gate
// RED. CI's Playwright step currently installs only chromium, so we gate the
// extra engines behind an opt-in flag: default is chromium-only (always
// installed), and `OJ_E2E_ALL_BROWSERS=1` (set once CI installs all three, and
// locally where they're present) adds firefox + webkit. This keeps the merge
// gate green by construction while still allowing the full cross-browser proof.
const ALL_BROWSERS = process.env.OJ_E2E_ALL_BROWSERS === '1';

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
    // Drive the configured engines. Chromium always runs (it's the one CI
    // installs); firefox + webkit run when OJ_E2E_ALL_BROWSERS=1 — they have the
    // strictest AudioWorklet / cross-origin-isolation behaviour and catch
    // regressions Chromium hides, so the resurrection should be proven there too
    // wherever those binaries are installed (see ALL_BROWSERS above).
    projects: [
        { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
        ...(ALL_BROWSERS
            ? [
                  { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
                  { name: 'webkit', use: { ...devices['Desktop Safari'] } },
              ]
            : []),
    ],
    webServer: {
        command: `bun run build && bun run preview --port ${PORT} --strictPort`,
        url: `http://localhost:${PORT}`,
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
    },
});
