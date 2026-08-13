/** @type {import('@ladle/react').UserConfig} */
export default {
    // The component catalog lives in the oj-ui package.
    stories: 'packages/oj-ui/src/**/*.stories.{ts,tsx}',
    // Resolve the @openjammer/* workspace specifiers (raw source, no build).
    viteConfig: '.ladle/vite.config.ts',
    outDir: '.ladle/build',
}
