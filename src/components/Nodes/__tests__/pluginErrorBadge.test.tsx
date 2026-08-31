/**
 * W6-Z T2 — the degraded-plugin badge: right voice, right sheet.
 *
 * `.node-plugin-error-badge` is the ONE thing that changes on a node when a
 * hosted plugin goes missing or crashes and the engine degrades it to a labeled
 * passthrough (invariant #4a — a held note beats a glitch). It was `10px
 * var(--font-sans)`: a sans run under the app's 13px functional floor AND a size
 * that is not on the type scale at all. And it was declared in
 * `SamplerNode.css` — a faceplate sheet that does not emit it — while
 * `NodeWrapper.tsx`, which does, owns `SchematicBase.css` next door.
 *
 * Both halves are pinned here, because both are how it went wrong: a run drifts
 * off the scale most easily when it is filed under a component that never looks
 * at it.
 *
 * The badge is reachable in a test without a real crash: `pluginDegraded` reads
 * `node.data.pluginLoadError`, the same boolean the executors write through
 * `setNodePluginLoadError`. So the first test renders the REAL element from the
 * REAL flag — no stub, no fault injection — and the sheet tests hold the run.
 */

import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NodeWrapper } from '../NodeWrapper';
import { useGraphStore } from '../../../store/graphStore';
import { useHistoryStore } from '../../../store/historyStore';
import type { NodeData } from '../../../engine/types';

const SHARED_SHEET = 'src/components/Nodes/SchematicBase.css';
const FACEPLATE_SHEET = 'src/components/Nodes/SamplerNode.css';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

/** `selector { … }` pairs, comments stripped so a comment can quote a token. */
function rules(css: string): { selector: string; body: string }[] {
    const flat = css.replace(/\/\*[\s\S]*?\*\//g, '');
    return [...flat.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
        selector: m[1]!.trim().replace(/\s+/g, ' '),
        body: m[2]!,
    }));
}

const badgeRule = (css: string) =>
    rules(css).find((rule) => rule.selector === '.node-plugin-error-badge');

describe('the degraded-plugin badge renders from the engine flag', () => {
    beforeEach(() => {
        useGraphStore.setState({
            nodes: new Map(),
            connections: new Map(),
            connectionsByNode: new Map(),
            rootNodeIds: [],
            selectedNodeIds: new Set(),
            selectedConnectionIds: new Set(),
            clipboard: null,
            version: 0,
        });
        useHistoryStore.getState().clear();
    });

    it('marks a node whose plugin is missing or crashed, and only that node', () => {
        const graph = useGraphStore.getState();
        const degradedId = graph.addNode('effect', { x: 0, y: 0 });
        const healthyId = graph.addNode('effect', { x: 300, y: 0 });
        // The real flag the executors set — `pluginLoadError`, off the undo history.
        graph.updateNodeData<NodeData>(degradedId, { pluginLoadError: true }, { record: false });

        const { container } = render(<>
            <NodeWrapper node={useGraphStore.getState().nodes.get(degradedId)!} />
            <NodeWrapper node={useGraphStore.getState().nodes.get(healthyId)!} />
        </>);

        const badges = container.querySelectorAll('.node-plugin-error-badge');
        expect(badges).toHaveLength(1);
        // It says what it is to a screen reader, and it does not steal focus.
        expect(badges[0]!.getAttribute('aria-label')).toBe('Plugin missing or crashed');
        expect(badges[0]!.textContent!.trim()).toBe('!');
    });
});

describe('the badge is styled by the sheet its emitter owns', () => {
    it('lives in SchematicBase.css, the shared node chrome NodeWrapper imports', () => {
        expect(read('src/components/Nodes/NodeWrapper.tsx')).toContain("import './SchematicBase.css'");
        expect(badgeRule(read(SHARED_SHEET))).toBeDefined();
    });

    it('no longer squats in the Sampler faceplate sheet', () => {
        expect(badgeRule(read(FACEPLATE_SHEET))).toBeUndefined();
    });

    it('speaks the micro MONO voice, not a 10px sans off the scale', () => {
        const body = badgeRule(read(SHARED_SHEET))!.body;
        expect(body).toMatch(/font-family:\s*var\(--font-mono\)/);
        expect(body).toMatch(/font-size:\s*var\(--text-micro\)/);
        expect(body).toMatch(/letter-spacing:\s*var\(--tracking-micro\)/);
        expect(body).toMatch(/text-transform:\s*uppercase/);
        expect(body).not.toMatch(/var\(--font-sans\)/);
        expect(body).not.toMatch(/font-size:\s*10px/);
        // The well and the amber fill are unchanged — this was a type fix, not a
        // redesign of the one mark a player sees when a plugin dies.
        expect(body).toMatch(/width:\s*14px/);
        expect(body).toMatch(/background:\s*var\(--accent-warning\)/);
    });

    it('inks the amber fill with the theme-invariant on-accent ink', () => {
        // Measuring the new run caught what the old one hid: `--bg-primary` is
        // the INVERSE of `--text-primary`, so on a solid amber fill it was dark
        // ink in the dark theme and near-white in the light one — 2.27:1,
        // measured in Chromium, on the one mark that says a plugin just died.
        // `--text-on-accent` is defined once at `:root` and is what every other
        // solid accent fill in the app uses. 6.76 light / 8.38 dark after.
        const body = badgeRule(read(SHARED_SHEET))!.body;
        expect(body).toMatch(/color:\s*var\(--text-on-accent\)/);
        expect(body).not.toMatch(/color:\s*var\(--bg-primary\)/);
    });
});

/**
 * The same strict rule `src/components/__tests__/typeFloor.test.ts` holds the
 * panel sheets to, applied to the two node sheets this lane touched: a block
 * that sets a sub-13px size must SAY it is mono, in that block. Inheritance is
 * invisible to a reader, and "it happens to inherit mono from an ancestor" is
 * exactly how a 10px sans badge ships and survives two audits.
 */
describe.each([SHARED_SHEET, FACEPLATE_SHEET])('%s type floor', (path) => {
    const css = read(path);
    const MICRO = /font-size:\s*var\(--text-(xs|micro)\)|font-size:\s*(9\.5|1[012])px/;

    it('sets no sub-13px size without declaring the mono face beside it', () => {
        const offenders = rules(css)
            .filter((rule) => MICRO.test(rule.body))
            .filter((rule) => !/font-family:\s*var\(--font-mono\)/.test(rule.body))
            .map((rule) => rule.selector);
        expect(offenders).toEqual([]);
    });

    it('names only sizes that are on the scale', () => {
        for (const [, value] of css.matchAll(/font-size:\s*([^;]+);/g)) {
            expect(value.trim()).toMatch(
                /^var\(--text-(2xl|xl|lg|md|sm|xs|micro)\)$|^(30|22|15|14|13|11|9\.5)px$|^inherit$|^1em$/,
            );
        }
    });
});
