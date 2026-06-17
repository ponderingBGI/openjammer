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
                'Node-driven, real-time music creation for live performance — native (<5 ms) and in the browser.',
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
            sidebar: [
                { label: 'Guides', autogenerate: { directory: 'guides' } },
                { label: 'Architecture', autogenerate: { directory: 'architecture' } },
                { label: 'Reference', autogenerate: { directory: 'reference' } },
                typeDocSidebarGroup,
                { label: 'Contributing', autogenerate: { directory: 'contributing' } },
            ],
        }),
    ],
});
