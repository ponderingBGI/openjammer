// scripts/oj/design.ts — the design-system bridge CLI.
//
//   oj design map      regenerate component-map.json (the one source that links every
//                      component across code / Ladle / Figma / Claude Design)
//   oj design status   print which legs of the 3-way sync are live (a one-glance health check)
//
// component-map.json is the $0 substitute for Code Connect: it joins, by component name,
// the Figma node-id (from `figma connect parse`), the Ladle story id (from the Ladle build
// meta), the code path + GitHub URL, and the Claude Design project. The docs "Find the code"
// index (apps/docs) and the in-house Figma description-stamp plugin both read it, so there is
// exactly one place the cross-surface mapping lives. Regenerated, never hand-edited.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';

const ROOT = join(import.meta.dir, '..', '..');
const FIGMA_FILE_KEY = 'ayHEMsJL1BPhvTYWi1CFJs';
const FIGMA_FILE_SLUG = 'OpenJammer-oj-ui-Library';
const LADLE_META = join(ROOT, '.ladle', 'build', 'meta.json');
const DS_CONFIG = join(ROOT, '.design-sync', 'config.json');
const MAP_PATH = join(ROOT, 'component-map.json');

const kebab = (s: string): string =>
  s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/_/g, '-').toLowerCase();

interface ComponentEntry {
  name: string;
  codePath: string;
  githubUrl: string;
  ladleStoryId: string | null;
  figmaNodeId: string;
  figmaUrl: string;
}
interface ComponentMap {
  $generated: string;
  figmaFileKey: string;
  claudeDesignProject: string | null;
  repo: string;
  branch: string;
  coverage: { components: number; withStory: number; withFigma: number };
  components: ComponentEntry[];
}

/** owner/repo from the origin remote, falling back to the known slug. */
function repoSlug(): string {
  try {
    const url = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: ROOT })
      .toString()
      .trim();
    const m = url.match(/github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/);
    if (m) return m[1];
  } catch {
    /* not a git checkout or no remote — fall through */
  }
  return 'ponderingBGI/openjammer';
}

/** Run `figma connect parse` and return [{ component, figmaNode, codeConnectFile }]. */
function parseCodeConnect(): Array<{ component: string; figmaNode: string; file: string }> {
  let raw: string;
  try {
    raw = execFileSync('bunx', ['figma', 'connect', 'parse'], {
      cwd: ROOT,
      maxBuffer: 64 * 1024 * 1024,
    }).toString();
  } catch (e) {
    throw new Error(
      `\`figma connect parse\` failed — is @figma/code-connect installed?\n${(e as Error).message}`,
    );
  }
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start < 0 || end < 0) throw new Error('figma connect parse produced no JSON array');
  const docs = JSON.parse(raw.slice(start, end + 1)) as Array<Record<string, unknown>>;
  return docs.map((d) => ({
    component: String(d.component),
    figmaNode: String(d.figmaNode),
    file: String(d._codeConnectFilePath ?? ''),
  }));
}

/** Build { kebab-component-name -> first story id } from the Ladle build meta, plus a
 *  dir-based fallback map { component-dir -> first story id }. */
function ladleStories(): { byName: Map<string, string>; byDir: Map<string, string> } {
  const byName = new Map<string, string>();
  const byDir = new Map<string, string>();
  if (!existsSync(LADLE_META)) return { byName, byDir };
  const meta = JSON.parse(readFileSync(LADLE_META, 'utf8')) as {
    stories: Record<string, { filePath?: string }>;
  };
  // Sort ids for deterministic "first story" selection.
  for (const id of Object.keys(meta.stories).sort()) {
    const parts = id.split('--'); // <namespace>--<component>--<variant>
    if (parts.length >= 2) {
      const mid = parts[1];
      if (!byName.has(mid)) byName.set(mid, id);
    }
    const fp = meta.stories[id].filePath;
    if (fp) {
      const dir = basename(dirname(fp)); // component dir, e.g. "Banner"
      if (!byDir.has(dir)) byDir.set(dir, id);
    }
  }
  return { byName, byDir };
}

function claudeProject(): string | null {
  if (!existsSync(DS_CONFIG)) return null;
  try {
    const cfg = JSON.parse(readFileSync(DS_CONFIG, 'utf8')) as { projectId?: string };
    return cfg.projectId ? `https://claude.ai/design/p/${cfg.projectId}` : null;
  } catch {
    return null;
  }
}

function buildMap(): ComponentMap {
  const repo = repoSlug();
  const branch = 'canari';
  const { byName, byDir } = ladleStories();
  const connects = parseCodeConnect();

  const components: ComponentEntry[] = connects
    .map(({ component, figmaNode, file }) => {
      // node-id: prefer the ?node-id= query; normalize hyphen/colon forms.
      const nodeMatch = figmaNode.match(/node-id=([0-9]+[:-][0-9]+)/);
      const nodeId = nodeMatch ? nodeMatch[1].replace('-', ':') : '';
      const nodeUrlId = nodeId.replace(':', '-');
      const figmaUrl = `https://www.figma.com/design/${FIGMA_FILE_KEY}/${FIGMA_FILE_SLUG}?node-id=${nodeUrlId}`;
      // code path: the .figma.tsx sits beside its source file (same basename).
      const codePath = file
        ? file.replace(`${ROOT}/`, '').replace(/\.figma\.tsx$/, '.tsx')
        : '';
      const dir = codePath ? basename(dirname(codePath)) : '';
      const story = byName.get(kebab(component)) ?? byDir.get(dir) ?? null;
      return {
        name: component,
        codePath,
        githubUrl: codePath ? `https://github.com/${repo}/blob/${branch}/${codePath}` : '',
        ladleStoryId: story,
        figmaNodeId: nodeId,
        figmaUrl,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    $generated: 'by `bun run gen:component-map` (scripts/oj/design.ts) — do not edit by hand',
    figmaFileKey: FIGMA_FILE_KEY,
    claudeDesignProject: claudeProject(),
    repo,
    branch,
    coverage: {
      components: components.length,
      withStory: components.filter((c) => c.ladleStoryId).length,
      withFigma: components.filter((c) => c.figmaNodeId).length,
    },
    components,
  };
}

function cmdMap(json: boolean): number {
  const map = buildMap();
  writeFileSync(MAP_PATH, JSON.stringify(map, null, 2) + '\n', 'utf8');
  if (json) {
    process.stdout.write(JSON.stringify(map.coverage) + '\n');
  } else {
    const { components, withStory } = map.coverage;
    process.stdout.write(
      `component-map.json: ${components} components, ${components} Figma-mapped, ${withStory} with a Ladle story` +
        ` (${components - withStory} storyless)\n`,
    );
  }
  return 0;
}

function ok(b: boolean): string {
  return b ? '✓' : '✗';
}

function cmdStatus(json: boolean): number {
  const legs: Record<string, { ok: boolean; detail: string }> = {};

  // Token build: regenerate, then check the tree is clean for the generated artifacts.
  let tokensClean = false;
  try {
    execFileSync('bun', ['run', 'tokens'], { cwd: ROOT, stdio: 'ignore' });
    const diff = execFileSync(
      'git',
      [
        'diff',
        '--quiet',
        '--',
        'packages/oj-tokens/dist/variables.css',
        'packages/oj-tokens/src/generated/themes.ts',
        'packages/oj-ui/oj-tokens.css',
      ],
      { cwd: ROOT },
    );
    tokensClean = true; // --quiet exits 0 (no diff)
    void diff;
  } catch {
    tokensClean = false; // non-zero exit = drift (or build failure)
  }
  legs.tokens = {
    ok: tokensClean,
    detail: tokensClean ? 'artifacts match the DTCG' : 'DRIFT — run `bun run tokens` and commit',
  };

  // design-sync configured? (the anchor _ds_sync.json lives in the remote claude.ai/design
  // project, not the repo — the committed marker is .design-sync/config.json with a projectId.)
  const dsCfg = join(ROOT, '.design-sync', 'config.json');
  let dsOk = false;
  let dsDetail = 'not configured — run /design-sync';
  if (existsSync(dsCfg)) {
    try {
      const cfg = JSON.parse(readFileSync(dsCfg, 'utf8')) as { projectId?: string; pkg?: string };
      dsOk = !!(cfg.projectId && cfg.pkg);
      dsDetail = dsOk
        ? `synced → project ${String(cfg.projectId).slice(0, 8)}… (re-run /design-sync after changes)`
        : 'config incomplete — re-run /design-sync';
    } catch {
      dsDetail = '.design-sync/config.json unreadable';
    }
  }
  legs.designSync = { ok: dsOk, detail: dsDetail };

  // component-map present + coverage
  let coverage = '';
  let mapOk = false;
  if (existsSync(MAP_PATH)) {
    const m = JSON.parse(readFileSync(MAP_PATH, 'utf8')) as ComponentMap;
    coverage = `${m.coverage.components} components, ${m.coverage.withStory} with stories`;
    mapOk = true;
  } else {
    coverage = 'missing — run `bun run gen:component-map`';
  }
  legs.componentMap = { ok: mapOk, detail: coverage };

  // Code Connect publish leg (Org/Enterprise) — dormant until the secret + a plan exist.
  const hasToken = !!process.env.FIGMA_ACCESS_TOKEN;
  legs.codeConnect = {
    ok: true, // dormant-but-ready is the correct free-tier state
    detail: hasToken
      ? 'FIGMA_ACCESS_TOKEN set — publish active (needs Org/Enterprise + a published library)'
      : 'dormant (free/Pro): mappings validate on PR; set FIGMA_ACCESS_TOKEN at Org/Enterprise to publish',
  };

  if (json) {
    process.stdout.write(JSON.stringify(legs) + '\n');
    return Object.values(legs).every((l) => l.ok) ? 0 : 1;
  }

  process.stdout.write('design-system sync — leg status\n');
  for (const [name, leg] of Object.entries(legs)) {
    process.stdout.write(`  ${ok(leg.ok)} ${name.padEnd(14)} ${leg.detail}\n`);
  }
  process.stdout.write(
    '\nFigma plan/seat: check in Figma (Education=Professional today: Dev Mode + 10 modes +\n' +
      '  library publish; only Code Connect needs Org/Enterprise). Education is a personal grant —\n' +
      '  re-verify yearly or budget a ~$12/mo Pro Dev seat. Set the file to "anyone with link → can view".\n',
  );
  return Object.values(legs).every((l) => l.ok) ? 0 : 1;
}

export async function design(args: string[], jsonFlag = false): Promise<number> {
  const json = jsonFlag || args.includes('--json');
  const sub = args.find((a) => !a.startsWith('-'));
  switch (sub) {
    case 'map':
      return cmdMap(json);
    case 'status':
      return cmdStatus(json);
    default:
      process.stderr.write('usage: oj design <map|status> [--json]\n');
      return 2;
  }
}
