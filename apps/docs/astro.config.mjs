// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

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
            sidebar: [
                { label: 'Architecture', autogenerate: { directory: 'architecture' } },
                { label: 'Reference', autogenerate: { directory: 'reference' } },
                { label: 'Contributing', autogenerate: { directory: 'contributing' } },
            ],
        }),
    ],
});
