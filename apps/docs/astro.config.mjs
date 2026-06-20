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
            // Living-Sketchbook skin: CSS-variable token remap (warm paper, ink
            // line, Caveat voice, hard offset shadows) plus exactly ONE bespoke
            // component slot — the splash Hero. This is the only component
            // override (hard cap): the brand ships through tokens, not forks.
            customCss: ['./src/styles/custom.css'],
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
                        { label: 'Architecture', autogenerate: { directory: 'build/architecture' } },
                        { label: 'Create a node', autogenerate: { directory: 'build/create-a-node' } },
                        typeDocSidebarGroup,
                        {
                            label: 'Internals / release engineering',
                            collapsed: true,
                            autogenerate: { directory: 'build/internals' },
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
