import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

// Ladle merges this into its own Vite config. We only need the @openjammer/*
// aliases so stories + the provider resolve the workspace packages from source,
// mirroring vite.config.ts / tsconfig.app.json / vitest.config.ts.
export default defineConfig({
    resolve: {
        alias: {
            '@openjammer/oj-tokens': fileURLToPath(
                new URL('../packages/oj-tokens/src/index.ts', import.meta.url),
            ),
            '@openjammer/oj-ui': fileURLToPath(
                new URL('../packages/oj-ui/src/index.ts', import.meta.url),
            ),
            '@openjammer/oj-protocol': fileURLToPath(
                new URL('../packages/oj-protocol-ts/src/index.ts', import.meta.url),
            ),
        },
    },
})
