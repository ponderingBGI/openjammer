// OpenJammer oj-ui — "stamp code links" Figma plugin.
//
// The free-tier substitute for Code Connect. Code Connect (real code snippets in Dev Mode)
// needs a Figma Organization/Enterprise plan; on Professional/Education it is unavailable.
// This plugin instead writes, onto every component master, the one thing a designer or AI
// needs WITHOUT Dev Mode: the import line + deep links to the source, the live component on
// Claude Design, and the Ladle story id — all visible in the Assets panel and the component's
// documentation link.
//
// It is driven entirely by component-map.json (bundled at build time, the same single source the
// docs "Find the code" index uses), so there is no second mapping to maintain. Re-run it after
// regenerating the map (`bun run gen:component-map`) to re-stamp. Figma exposes no API to publish
// a library or run a plugin headlessly, so this is a manual, idempotent maintainer action.
//
// Build: `bun run build` in this package → dist/code.js (component-map.json inlined).
// Run:   Figma desktop → Plugins → Development → Import manifest → run on the oj-ui library file.

import map from '../../../component-map.json';

interface Entry {
  name: string;
  codePath: string;
  githubUrl: string;
  ladleStoryId: string | null;
  figmaNodeId: string;
  figmaUrl: string;
}
interface Map {
  claudeDesignProject: string | null;
  components: Entry[];
}

const PKG = '@openjammer/oj-ui';

function describe(c: Entry, claude: string | null): string {
  const links: string[] = [];
  if (c.githubUrl) links.push(`[Source](${c.githubUrl})`);
  if (claude) links.push(`[Live · Claude Design](${claude})`);
  const parts = [`\`import { ${c.name} } from '${PKG}'\``];
  if (links.length) parts.push(links.join(' · '));
  if (c.ladleStoryId) parts.push(`Ladle story: \`${c.ladleStoryId}\``);
  return parts.join('\n\n');
}

async function main(): Promise<void> {
  // dynamic-page access: load every page before resolving node ids across the file.
  await figma.loadAllPagesAsync();
  const m = map as unknown as Map;

  let stamped = 0;
  const missing: string[] = [];

  for (const c of m.components) {
    if (!c.figmaNodeId) continue;
    let node: BaseNode | null = null;
    try {
      node = await figma.getNodeByIdAsync(c.figmaNodeId);
    } catch {
      node = null;
    }
    if (!node || (node.type !== 'COMPONENT' && node.type !== 'COMPONENT_SET')) {
      missing.push(c.name);
      continue;
    }
    const target = node as ComponentNode | ComponentSetNode;
    target.description = describe(c, m.claudeDesignProject);
    // documentationLinks takes a single URL — the source is the most universally useful.
    if (c.githubUrl) target.documentationLinks = [{ uri: c.githubUrl }];
    stamped++;
  }

  const tail = missing.length
    ? ` · ${missing.length} not found (${missing.slice(0, 4).join(', ')}${missing.length > 4 ? '…' : ''})`
    : '';
  figma.closePlugin(`oj-ui: stamped ${stamped} component${stamped === 1 ? '' : 's'}${tail}`);
}

main().catch((e) => figma.closePlugin(`oj-ui stamp failed: ${(e as Error).message}`));
