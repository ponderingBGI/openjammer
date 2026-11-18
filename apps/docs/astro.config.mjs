// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import starlightTypeDoc, { typeDocSidebarGroup } from 'starlight-typedoc';

// Deployed to GitHub Pages at https://<owner>.github.io/openjammer/, so the site
// is served under the `/openjammer` base. `site` + `base` make internal links,
// the sitemap, and canonical URLs resolve correctly under that prefix.
export default defineConfig({
    site: 'https://ponderingbgi.github.io',
    base: '/openjammer',
    integrations: [
        starlight({
            title: 'OpenJammer',
            description:
                'Node-driven, real-time music creation for live performance — native low latency and in the browser.',
            social: [
                {
                    icon: 'github',
                    label: 'GitHub',
                    href: 'https://github.com/ponderingBGI/openjammer',
                },
            ],
            editLink: {
                baseUrl: 'https://github.com/ponderingBGI/openjammer/edit/main/apps/docs/',
            },
            // New DNA skin: a CSS-variable remap that points Starlight's own
            // `--sl-*` scale at the OpenJammer semantic tokens (custom.css
            // imports the transcribed token sheet), plus exactly ONE bespoke
            // component slot — the splash Hero. This is the only component
            // override (hard cap): the brand ships through tokens, not forks.
            customCss: ['./src/styles/custom.css'],
            // Preload the two self-hosted faces the site actually renders.
            // `custom.css` @imports fonts.css, so the woff2 sits behind TWO
            // stylesheet parses: the browser cannot discover it until the sheet
            // and its nested @import have both landed. These links move that
            // discovery into the document (measured on the sibling download
            // page, same font setup: 19ms as `css` -> 6ms as `link`, both faces
            // in parallel). It buys a round trip, not a CLS number — see the
            // W6-FIXb report for why the FOUT attribution there was wrong.
            //
            // The second face is mono 400, NOT the 500 the download page
            // preloads: walking every text run, every docs page renders
            // `JetBrains Mono @ 400` (inline code, kbd) while only some pull 500,
            // and this head is site-wide — a preload on a page that never paints
            // the face is a wasted fetch on the critical path.
            // `crossorigin` is required even same-origin — fonts are always
            // CORS-fetched, and without it the preload is thrown away and
            // fetched a second time. It is spelled `'anonymous'` (not `true`,
            // which Astro renders as the invalid `crossorigin="true"`) so the
            // preload's CORS mode matches the font fetch by name, not by the
            // enumerated attribute's invalid-value default. Paths carry the
            // `/openjammer` base, like fonts.css's own `src:` URLs.
            head: [
                {
                    tag: 'link',
                    attrs: {
                        rel: 'preload',
                        as: 'font',
                        type: 'font/woff2',
                        crossorigin: 'anonymous',
                        href: '/openjammer/fonts/outfit-variable.woff2',
                    },
                },
                {
                    tag: 'link',
                    attrs: {
                        rel: 'preload',
                        as: 'font',
                        type: 'font/woff2',
                        crossorigin: 'anonymous',
                        href: '/openjammer/fonts/jetbrains-mono-regular.woff2',
                    },
                },
            ],
            components: {
                Hero: './src/components/Hero.astro',
            },
            // Generate an in-site API reference for the @openjammer/oj-protocol TS
            // mirror straight from its JSDoc + types (plan §6.1). The generated
            // markdown lands in src/content/docs/reference/api/ (gitignored —
            // regenerated on every build), and `typeDocSidebarGroup` adds it to
            // the sidebar below.
            plugins: [
                starlightTypeDoc({
                    entryPoints: ['../../packages/oj-protocol-ts/src/index.ts'],
                    tsconfig: '../../packages/oj-protocol-ts/tsconfig.json',
                    // Top-level `api/` (not under `reference/`) so the Reference
                    // autogenerate doesn't also recurse into it — typeDocSidebarGroup
                    // owns this group.
                    output: 'api',
                    sidebar: { label: 'Protocol API (oj-protocol-ts)' },
                }),
            ],
            // Two tracks: hand-author the player-facing Play group (a newcomer
            // never scrolls past internals to find "how do I install"); keep
            // `autogenerate` on the dev-owned Build subtrees so new builder pages
            // sync for free. `typeDocSidebarGroup` nests INSIDE Build (its files
            // still emit to `api/`); release-engineering is collapsed by default.
            sidebar: [
                {
                    label: 'Play OpenJammer',
                    items: [
                        'play/download',
                        'play/install',
                        'play/first-patch',
                        'play/audio-and-latency',
                        'play/sound-and-instruments',
                        'play/troubleshooting-with-the-ai',
                        'play/shortcuts',
                        'play/faq',
                        'play/browser-vs-native',
                        'play/troubleshooting',
                    ],
                },
                {
                    label: 'Build OpenJammer',
                    items: [
                        { label: 'Overview', slug: 'build' },
                        {
                            label: 'Architecture',
                            items: [{ autogenerate: { directory: 'build/architecture' } }],
                        },
                        {
                            label: 'Create a node',
                            items: [{ autogenerate: { directory: 'build/create-a-node' } }],
                        },
                        typeDocSidebarGroup,
                        {
                            label: 'Internals / release engineering',
                            collapsed: true,
                            items: [
                                {
                                    autogenerate: {
                                        directory: 'build/internals',
                                        collapsed: true,
                                    },
                                },
                            ],
                        },
                        'build/contributing',
                    ],
                },
                {
                    label: 'Design system',
                    items: [
                        { label: 'The 3-way sync', slug: 'design-system/three-way-sync' },
                        { label: 'Find the code', slug: 'design-system/components' },
                    ],
                },
            ],
        }),
    ],
});
