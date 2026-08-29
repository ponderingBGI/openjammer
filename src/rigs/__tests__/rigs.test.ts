import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/executor', () => ({
    getExecutor: () => ({
        pauseContinuousSources: vi.fn(),
        resumeContinuousSources: vi.fn(),
        setArrangementLoop: vi.fn(),
        setArrangementPunch: vi.fn(),
        setArrangementClick: vi.fn(),
        setArrangementCountIn: vi.fn(),
        subscribeSignalLevels: () => () => {},
        getTimelineBackend: () => 'wasm',
    }),
    isTauri: () => false,
}));

const { useGraphStore } = await import('../../store/graphStore');
const { useArrangementStore } = await import('../../store/arrangementStore');
const { useHistoryStore } = await import('../../store/historyStore');
const { installRig, rigFor } = await import('../index');
const { getNodeDefinition } = await import('../../engine/registry');
const { BEAT_ROWS, BEAT_SOURCE_ID, BEAT_STEPS, BEAT_STEP_TICKS, buildBeatSong } = await import('../beatSong');

const GOALS = ['jam', 'beat', 'sound'] as const;
const PERSONAS = ['first', 'some', 'pro'] as const;

function reset() {
    useGraphStore.setState({
        nodes: new Map(),
        connections: new Map(),
        connectionsByNode: new Map(),
        rootNodeIds: [],
        selectedNodeIds: new Set(),
        selectedConnectionIds: new Set(),
    });
    useArrangementStore.getState().setArrangement(null);
    useHistoryStore.setState({ entries: [], cursor: 0 });
}

describe('preset rigs', () => {
    beforeEach(reset);

    describe('specs', () => {
        it.each(GOALS.flatMap((goal) => PERSONAS.map((persona) => [goal, persona] as const)))(
            'the %s rig at the %s density names only real node types and unique refs',
            (goal, persona) => {
                const spec = rigFor(goal, persona);
                const refs = spec.nodes.map((node) => node.ref);
                expect(new Set(refs).size).toBe(refs.length);
                for (const node of spec.nodes) {
                    // getNodeDefinition falls back to an inert Unknown for a bad
                    // type, so assert the type ROUND-TRIPS rather than just resolves.
                    expect(getNodeDefinition(node.type).type).toBe(node.type);
                }
            },
        );

        it.each(GOALS.flatMap((goal) => PERSONAS.map((persona) => [goal, persona] as const)))(
            'every wire in the %s rig at the %s density points at refs it declares',
            (goal, persona) => {
                const spec = rigFor(goal, persona);
                const refs = new Set(spec.nodes.map((node) => node.ref));
                for (const wire of spec.wires) {
                    expect(refs.has(wire.from.split(':')[0]!)).toBe(true);
                    expect(refs.has(wire.to.split(':')[0]!)).toBe(true);
                }
            },
        );

        it('never starts a beginner on a distortion pedal', () => {
            const effects = GOALS.flatMap((goal) =>
                PERSONAS.flatMap((persona) =>
                    rigFor(goal, persona).nodes.filter((node) => node.type === 'effect'),
                ),
            );
            expect(effects.length).toBeGreaterThan(0);
            for (const effect of effects) {
                expect(effect.data?.effectType).not.toBe('distortion');
            }
        });

        it('gives a beginner fewer stages than a pro, and only the beat rig a song', () => {
            expect(rigFor('sound', 'first').nodes.length).toBeLessThan(rigFor('sound', 'pro').nodes.length);
            expect(rigFor('beat', 'some').song).toBe('beat-loop');
            expect(rigFor('jam', 'some').song).toBeUndefined();
            expect(rigFor('sound', 'some').song).toBeUndefined();
        });
    });

    describe('installation', () => {
        it.each(GOALS)('builds the %s rig fully wired, through the graph verbs', (goal) => {
            const installed = installRig(rigFor(goal, 'some'));

            expect(installed.unwired).toEqual([]);
            const graph = useGraphStore.getState();
            // Every declared node exists, plus whatever internals a node owns
            // (a keyboard brings its own visual + panels).
            for (const ref of Object.keys(installed.ids)) {
                expect(graph.nodes.get(installed.ids[ref]!)).toBeDefined();
            }
            // The signal actually reaches a speaker.
            expect(graph.getNodesByType('speaker')).toHaveLength(1);
        });

        it('lands as exactly ONE history entry that Ctrl+Z removes', () => {
            const before = useGraphStore.getState().nodes.size;
            installRig(rigFor('jam', 'some'));

            expect(useHistoryStore.getState().entries).toHaveLength(1);
            expect(useGraphStore.getState().nodes.size).toBeGreaterThan(before);

            useGraphStore.getState().undo();
            expect(useGraphStore.getState().nodes.size).toBe(before);
            expect(useGraphStore.getState().connections.size).toBe(0);
        });

        it('wires the keyboard by the port NAME the player reads off the canvas', () => {
            const installed = installRig(rigFor('jam', 'some'));
            const graph = useGraphStore.getState();
            const keyboard = graph.nodes.get(installed.ids.keys!)!;
            const rows = keyboard.ports.filter((port) => /^Row \d$/.test(port.name));
            expect(rows.length).toBeGreaterThanOrEqual(3);

            const fromKeyboard = [...graph.connections.values()].filter((c) => c.sourceNodeId === keyboard.id);
            expect(fromKeyboard.length).toBe(3);
            for (const connection of fromKeyboard) {
                expect(connection.targetNodeId).toBe(installed.ids.inst);
                expect(connection.type).toBe('control');
            }

            // The instrument's panel expanded into one named bundle per row —
            // exactly what dragging the three cables by hand produces.
            const instrument = graph.nodes.get(installed.ids.inst!)!;
            const bundles = instrument.ports.filter((port) => /^Keyboard Row \d/.test(port.name));
            expect(bundles).toHaveLength(3);
        });

        it('installs the beat rig\'s song and arms the loop', () => {
            installRig(rigFor('beat', 'some'));
            const state = useArrangementStore.getState();
            expect(state.arrangement?.sources?.[BEAT_SOURCE_ID]).toBeDefined();
            expect(state.loopEnabled).toBe(true);
        });

        it('leaves the other rigs without a song rather than faking a loop', () => {
            installRig(rigFor('jam', 'some'));
            expect(useArrangementStore.getState().arrangement).toBeNull();
        });
    });

    describe('the beat song', () => {
        it('is one real looping bar of MIDI on the shared timeline', () => {
            const song = buildBeatSong();
            const source = song.sources?.[BEAT_SOURCE_ID];
            expect(source?.kind).toBe('midi');
            expect(song.tracks).toHaveLength(1);
            expect(song.tracks[0]!.clips).toHaveLength(1);
            expect(song.tracks[0]!.clips[0]!.lengthTick).toBe(BEAT_STEPS * BEAT_STEP_TICKS);
            expect(song.locations?.some((location) => location.kind === 'loop')).toBe(true);
        });

        it('puts every note on a step of the grid the shell renders', () => {
            const song = buildBeatSong();
            const source = song.sources?.[BEAT_SOURCE_ID];
            if (source?.kind !== 'midi') throw new Error('the groove must be a MIDI source');
            const pitches = new Set(BEAT_ROWS.map((row) => row.pitch));
            for (const note of source.notes) {
                expect(pitches.has(note.pitch)).toBe(true);
                expect(note.tick % BEAT_STEP_TICKS).toBe(0);
                expect(note.tick / BEAT_STEP_TICKS).toBeLessThan(BEAT_STEPS);
            }
            expect(source.notes.length).toBeGreaterThan(0);
        });

        it('routes its own graph into a speaker so the loop is audible headless', () => {
            const song = buildBeatSong();
            expect(song.graph.nodes.some((node) => node.type === 'speaker')).toBe(true);
            expect(song.graph.connections?.length).toBeGreaterThan(0);
        });
    });
});
