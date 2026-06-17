import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react-swc';
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
        },
    },
    test: {
        environment: 'jsdom',
        globals: true,
        setupFiles: ['./src/setupTests.ts'],
        include: ['src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
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
