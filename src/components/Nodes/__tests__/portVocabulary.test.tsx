/**
 * W6-SHIP item 4 (+ fix round F1/F2) — the same two ports are named the same way
 * on every card, and the card reads the same word after a reload.
 *
 * Measured in the live DOM across five faceplates side by side, the audio input
 * read `Audio In` on Speaker and Effect, `Input` on Sampler and `IN` on
 * Instrument; the audio output read `Audio Out` on Effect but `AUDIO` on Sampler,
 * Instrument and InstrumentVisual. All three uppercase, so it was never a casing
 * break — it was a VOCABULARY break, and all three were visible at once on the
 * beat rig's default canvas.
 *
 * **The first version of this gate agreed the vocabulary was unified while the
 * screen said otherwise**, and that is the more useful lesson. It walked
 * `nodeDefinitions[type].defaultPorts`, so it saw the registry and nothing else —
 * but a card's ports come from four places:
 *
 *  1. `registry.ts` — a plain node's declared ports;
 *  2. `nodeInternals.ts` + `portSync.ts` — a CONTAINER's ports, DERIVED from its
 *     internal children (this is where the Sampler's `Input` / `Audio` came from);
 *  3. `dynamicRegistry.ts` — hosted VST3/AU/CLAP and AI-authored nodes;
 *  4. `graphStore.migrateNodePorts` — what a SAVED project comes back as.
 *
 * So this file no longer reads the definition table. It ADDS every user-facing
 * node type through the real `useGraphStore.addNode` — which runs the internals
 * builder and the port sync — and asserts on the ports the card actually carries,
 * plus the labels the real component actually renders. And it asserts (4)
 * directly, because "the same card reads `AUDIO IN` when added and `IN` after a
 * reload" is a specific, worse failure than either name on its own.
 */

import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { menuCategories, nodeDefinitions } from '../../../engine/registry';
import { makeHostedPluginDefinition } from '../../../engine/dynamicRegistry';
import { migrateNodePorts, useGraphStore } from '../../../store/graphStore';
import { useHistoryStore } from '../../../store/historyStore';
import type { GraphNode, NodeType, PortDefinition } from '../../../engine/types';

vi.mock('../../../audio/executor', async () => {
    const actual = await vi.importActual<typeof import('../../../audio/executor')>('../../../audio/executor');
    return {
        ...actual,
        getExecutor: () => ({
            getLooper: () => null,
            getRecorder: () => null,
            getSamplerAdapter: () => null,
            waitForSamplerAdapter: async () => null,
            subscribeSignalLevels: () => () => {},
            setSpeakerDevice: vi.fn(),
            setSpeakerVolume: vi.fn(),
        }),
    };
});

const { NodeWrapper } = await import('../NodeWrapper');

/** The words this vocabulary retired, as PORT LABELS. */
const RETIRED = ['Audio In', 'Audio Out', 'AUDIO IN', 'AUDIO OUT', 'AUDIO', 'INPUT', 'OUTPUT', 'Input', 'Output', 'Audio'];

/** The one pair a generic signal port may be called, in either casing. */
const ALLOWED = new Set(['In', 'Out', 'IN', 'OUT']);

/** The ids that ARE the generic pair. Composite panel ids end in `:audio-out`. */
const isGenericPort = (port: PortDefinition) =>
    ['audio-in', 'audio-out', 'in', 'out'].includes(port.id.split(':').pop() ?? '');

function resetGraph(): void {
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
}

beforeEach(resetGraph);
afterEach(cleanup);

/** Every node type the palette and the right-click menu actually offer. */
const USER_FACING: NodeType[] = [...new Set(menuCategories.flatMap((category) => category.items))]
    .filter((type) => nodeDefinitions[type]);

describe('a node ADDED through the real store carries the unified vocabulary', () => {
    it.each(USER_FACING)('%s', (type) => {
        const id = useGraphStore.getState().addNode(type, { x: 0, y: 0 });
        // Every node the add produced, not just the root: a container's internal
        // children and its derived parent ports are exactly what the first gate
        // could not see.
        for (const node of useGraphStore.getState().nodes.values()) {
            for (const port of node.ports) {
                if (!isGenericPort(port)) continue;
                expect(ALLOWED.has(port.name), `${node.type}.${port.id} = "${port.name}"`).toBe(true);
            }
        }
        expect(useGraphStore.getState().nodes.get(id)).toBeTruthy();
    });
});

describe('the labels the card RENDERS', () => {
    it.each(USER_FACING)('%s renders no retired port label', (type) => {
        const id = useGraphStore.getState().addNode(type, { x: 0, y: 0 });
        const node = useGraphStore.getState().nodes.get(id)!;
        const { container } = render(<NodeWrapper node={node} />);
        const labels = [...container.querySelectorAll('.oj-port-row__label')]
            .map((element) => element.textContent?.trim() ?? '')
            .filter(Boolean);
        // A retired spelling must not appear as a WHOLE label. (`Pitch Bend` and
        // `Sample` are real names and are untouched; only an exact match is a break.)
        const offenders = labels.filter((label) => RETIRED.includes(label));
        expect(offenders, `${type} rendered ${JSON.stringify(labels)}`).toEqual([]);
    });
});

describe('a card reads the same word after a reload as it did when added', () => {
    /**
     * Put `node` through the REAL load seam — `migrateNodePorts`, the exact
     * function `persist`'s `getItem` runs on every rehydrate. It is called
     * directly rather than through `persist.rehydrate()` because the middleware
     * does not restore under jsdom, and a test that re-implemented the rename
     * would only ever agree with itself.
     */
    const migrated = (node: GraphNode): GraphNode => migrateNodePorts(structuredClone(node));

    it('renames every retired spelling the loader can still meet', () => {
        // The exact shape `nodeInternals` used to produce, and the reason the
        // migration had to become direction-aware: `Audio` means `Out` on an
        // output and `In` on the receiving side of an output-panel.
        const saved: GraphNode = {
            id: 'saved-1',
            type: 'effect',
            category: 'effects',
            position: { x: 0, y: 0 },
            data: {},
            ports: [
                { id: 'audio-in', name: 'Audio In', type: 'audio', direction: 'input' },
                { id: 'audio-out', name: 'Audio Out', type: 'audio', direction: 'output' },
            ],
            parentId: null,
            childIds: [],
        };
        const after = migrated(saved);
        expect(after.ports.map((port) => port.name)).toEqual(['In', 'Out']);
    });

    it('reads `Audio` by DIRECTION, not by name alone', () => {
        const saved: GraphNode = {
            id: 'saved-2',
            type: 'output-panel',
            category: 'routing',
            position: { x: 0, y: 0 },
            data: {},
            ports: [
                // The real `nodeInternals` shape: id says audio-out, direction is input.
                { id: 'audio-out', name: 'Audio', type: 'audio', direction: 'input' },
            ],
            parentId: null,
            childIds: [],
        };
        expect(migrated(saved).ports[0]!.name).toBe('In');
    });

    it('leaves a port the PLAYER named alone', () => {
        // "Output" on a hand-named panel port is their word. The rename is keyed
        // on the generic ids precisely so this system never overwrites a person.
        const saved: GraphNode = {
            id: 'saved-3',
            type: 'output-panel',
            category: 'routing',
            position: { x: 0, y: 0 },
            data: {},
            ports: [{ id: 'custom-port-1', name: 'Output', type: 'audio', direction: 'input' }],
            parentId: null,
            childIds: [],
        };
        expect(migrated(saved).ports[0]!.name).toBe('Output');
    });
});

describe('hosted and AI-authored nodes speak it too', () => {
    it('a hosted VST3/AU/CLAP definition names In / Out', () => {
        const definition = makeHostedPluginDefinition({
            name: 'Some Compressor',
            format: 'vst3',
            uid: 'uid-1',
            path: '/plugins/some.vst3',
            ports: { audio_in: 2, audio_out: 2 },
            param_count: 0,
        } as never);
        expect(definition.defaultPorts.map((port) => port.name)).toEqual(['In', 'Out']);
    });

    it('the dynamic effect port pair really does mirror the static one', () => {
        // `EFFECT_DYNAMIC_PORTS`' own comment claims it "mirrors the static
        // `effect` definition's `defaultPorts`". After the rename it no longer
        // did, and nothing noticed — a comment asserting a relationship that
        // nothing checks is how the two drifted in the first place.
        const source = readFileSync(join(process.cwd(), 'src/engine/dynamicRegistry.ts'), 'utf8');
        const staticNames = nodeDefinitions.effect.defaultPorts.map((port) => port.name).sort();
        const dynamicNames = [...source.matchAll(/id: '(?:audio-in|audio-out)', name: '([^']+)'/g)]
            .map((match) => match[1]!);
        expect(new Set(dynamicNames)).toEqual(new Set(staticNames));
    });
});

describe('no source still authors a retired port name', () => {
    /** Every `.ts`/`.tsx` under the four modules that MINT port names. */
    const SOURCES = [
        'src/engine/registry.ts',
        'src/engine/dynamicRegistry.ts',
        'src/engine/nodeStandards.ts',
        'src/utils/nodeInternals.ts',
        'src/utils/portSync.ts',
    ];

    it.each(SOURCES)('%s', (path) => {
        const source = readFileSync(join(process.cwd(), path), 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/\/\/[^\n]*/g, '');
        for (const word of ['Audio In', 'Audio Out']) {
            expect(source, `${path} still authors "${word}"`).not.toContain(`name: '${word}'`);
        }
        // The bare `'Audio'` and the `|| 'Input'` / `|| 'Output'` fallbacks are the
        // two shapes that fed the Sampler its old labels.
        expect(source).not.toContain("name: 'Audio'");
        expect(source).not.toMatch(/\|\|\s*'(Input|Output)'/);
    });

    it('every faceplate that hard-codes a socket label uses the pair', () => {
        // `InstrumentNode` and `InstrumentVisualNode` passed 'AUDIO' straight into
        // their socket helper, bypassing the registry — which is why unifying the
        // registry alone would not have closed this.
        const root = join(process.cwd(), 'src/components/Nodes');
        const offenders: string[] = [];
        for (const name of readdirSync(root).filter((file) => file.endsWith('.tsx'))) {
            const source = readFileSync(join(root, name), 'utf8');
            for (const word of RETIRED) {
                const asLabel = new RegExp(`(?:label=|socket\\([^,]+,\\s*|portRow\\([^,]+,\\s*)['"\`]${word}['"\`]`);
                if (asLabel.test(source)) offenders.push(`${name}: "${word}"`);
            }
        }
        expect(offenders).toEqual([]);
    });

    it('keeps the accessible name descriptive — terse is for the eye only', () => {
        // The 9.5px label is `OUT`; a screen reader still hears "Audio output".
        const instrument = readFileSync(join(process.cwd(), 'src/components/Nodes/InstrumentNode.tsx'), 'utf8');
        expect(instrument).toContain("socket(outputPort, 'OUT', 'Audio output')");
    });
});
