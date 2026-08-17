import codspeedPlugin from '@codspeed/vitest-plugin';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    plugins: [codspeedPlugin()],
    resolve: {
        alias: {
            '@openjammer/oj-protocol': fileURLToPath(
                new URL('./packages/oj-protocol-ts/src/index.ts', import.meta.url),
            ),
        },
    },
    test: {
        environment: 'node',
        benchmark: {
            include: ['src/**/*.bench.ts'],
            time: 500,
            warmupTime: 100,
        },
    },
});
