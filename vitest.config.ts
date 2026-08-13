import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
    plugins: [react()],
    resolve: {
        alias: {
            // Keep the protocol-package specifier resolvable under vitest too
            // (this config does not extend vite.config). Mirrors the vite alias.
            '@openjammer/oj-protocol': fileURLToPath(
                new URL('./packages/oj-protocol-ts/src/index.ts', import.meta.url),
            ),
            '@openjammer/oj-tokens': fileURLToPath(
                new URL('./packages/oj-tokens/src/index.ts', import.meta.url),
            ),
            '@openjammer/oj-ui': fileURLToPath(
                new URL('./packages/oj-ui/src/index.ts', import.meta.url),
            ),
            // The vite-plugin-pwa virtual module has no transform under vitest; a
            // tiny stub lets usePWA.ts load (the SW does nothing in jsdom).
            'virtual:pwa-register': fileURLToPath(
                new URL('./src/test/pwaRegisterStub.ts', import.meta.url),
            ),
        },
    },
    test: {
        environment: 'jsdom',
        globals: true,
        setupFiles: ['./src/setupTests.ts'],
        include: [
            'src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}',
            'packages/oj-ui/src/**/*.{test,spec}.{ts,tsx}',
        ],
        // NOTE: the `oj` CLI's tests under scripts/oj/__tests__ use `bun:test` +
        // `Bun.file` (they test a Bun program), so they run under `bun test`, NOT
        // vitest — see the `test:cli` script. The `test-collection` doctor check
        // asserts every test file is covered by EXACTLY ONE runner so none is dead.
        coverage: {
            provider: 'v8',
            reporter: ['text', 'json', 'html'],
            include: ['src/**/*.{ts,tsx}'],
            exclude: [
                'src/**/*.test.{ts,tsx}',
                'src/**/*.spec.{ts,tsx}',
                'src/main.tsx',
                'src/vite-env.d.ts',
            ],
        },
    },
});
