import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;

export default defineConfig({
    testDir: './e2e/perf',
    fullyParallel: false,
    workers: 1,
    retries: 0,
    timeout: 180_000,
    reporter: process.env.CI ? 'line' : 'list',
    outputDir: 'test-results/perf',
    projects: [{ name: 'chromium-perf', use: { ...devices['Desktop Chrome'] } }],
    use: {
        baseURL: `http://localhost:${PORT}`,
        trace: 'off', // J8 owns CDP tracing so its frame markers stay phase-scoped.
    },
    webServer: {
        command: `bun run build && bun run preview --port ${PORT} --strictPort`,
        url: `http://localhost:${PORT}`,
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
    },
});
