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
const { resolveKeyboardNotes } = await import('../../audio/ojgraph');

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
            expect(new Set(fromKeyboard.map((c) => c.sourcePortId))).toEqual(
                new Set(['row-1', 'row-2', 'row-3']),
            );
            for (const connection of fromKeyboard) {
                expect(connection.targetNodeId).toBe(installed.ids.inst);
                expect(connection.type).toBe('control');
            }
        });

        it.each(GOALS)('gives the %s rig ON-SCREEN keys that make a note', (goal) => {
            const installed = installRig(rigFor(goal, 'first'));
            const graph = useGraphStore.getState();
            const keyboardRef = goal === 'beat' ? 'pads' : 'keys';
            const keyboard = graph.nodes.get(installed.ids[keyboardRef]!)!;
            const instrumentRef = { jam: 'inst', beat: 'kit', sound: 'osc' }[goal];

            // The node a beginner is told to press is the one with keys on it.
            expect(keyboard.type).toBe('keyboard-visual');
            // It owns a mode number of its own, allocated once and persisted.
            expect((keyboard.data as { assignedKey?: number }).assignedKey).toBe(2);

            // Every row reaches the instrument as a real MIDI note — the rig is
            // playable, not a picture. (Rows sound 5/4/3, so key 0 is C5/C4/C3.)
            for (const [row, midi] of [[1, 72], [2, 60], [3, 48]] as const) {
                const notes = resolveKeyboardNotes(
                    keyboard.id, row, 0, 0.8, graph.nodes, graph.connections,
                );
                expect(notes).toHaveLength(1);
                expect(notes[0]!.targetNodeId).toBe(installed.ids[instrumentRef]);
                expect(notes[0]!.midiNote).toBe(midi);
            }
        });

        it('installs the beat rig\'s song and arms the loop', () => {
            installRig(rigFor('beat', 'some'));
            const state = useArrangementStore.getState();
            expect(state.arrangement?.sources?.[BEAT_SOURCE_ID]).toBeDefined();
            expect(state.loopEnabled).toBe(true);
        });

        // ── W6-P10 · the rig is ONE gesture, Song included ───────────────
        // Before this, `installRig` called the plain `setArrangement` AFTER the
        // gesture closed. That call clears the command-log, so the rig's own
        // single entry was wiped a line after it was made: the beat rig was the
        // one edit in the app the player could not take back, and the Song it
        // dropped on the timeline stayed there for ever. These pin the fix.
        it('takes the beat rig SONG away on the same Ctrl+Z as its nodes', () => {
            const before = useGraphStore.getState().nodes.size;
            installRig(rigFor('beat', 'some'));

            // One entry — the nodes, the cables and the Song.
            expect(useHistoryStore.getState().entries).toHaveLength(1);
            expect(useArrangementStore.getState().arrangement?.sources?.[BEAT_SOURCE_ID]).toBeDefined();

            useHistoryStore.getState().undo();
            expect(useArrangementStore.getState().arrangement).toBeNull();
            expect(useGraphStore.getState().nodes.size).toBe(before);
            expect(useGraphStore.getState().connections.size).toBe(0);

            useHistoryStore.getState().redo();
            expect(useArrangementStore.getState().arrangement?.sources?.[BEAT_SOURCE_ID]).toBeDefined();
            expect(useGraphStore.getState().nodes.size).toBeGreaterThan(before);
        });

        it('puts the song that WAS open back, rather than leaving the timeline empty', () => {
            // Opening a document clears the log (that law is unchanged), so the
            // rig's entry is the only one, and its inverse has to carry the
            // whole previous document — a `Verb` cannot cross song→song.
            useArrangementStore.getState().setArrangement(buildBeatSong());
            const previous = structuredClone(useArrangementStore.getState().arrangement);
            expect(useHistoryStore.getState().entries).toHaveLength(0);

            installRig(rigFor('beat', 'some'));
            expect(useHistoryStore.getState().entries).toHaveLength(1);

            useHistoryStore.getState().undo();
            expect(useArrangementStore.getState().arrangement).toEqual(previous);
        });

        it('does not grow the log while the player undoes and redoes it', () => {
            installRig(rigFor('beat', 'some'));
            const nodes = useGraphStore.getState().nodes.size;

            for (let cycle = 0; cycle < 3; cycle += 1) {
                useHistoryStore.getState().undo();
                useHistoryStore.getState().redo();
                // Replaying a document swap must not re-record it: one extra
                // entry per Ctrl+Z would make the log impossible to wind back.
                expect(useHistoryStore.getState().entries).toHaveLength(1);
                expect(useHistoryStore.getState().cursor).toBe(1);
            }
            expect(useGraphStore.getState().nodes.size).toBe(nodes);
            expect(useArrangementStore.getState().arrangement?.sources?.[BEAT_SOURCE_ID]).toBeDefined();
        });

        // ── W6-P10b · redo reproduces the do, undo restores the switch ───
        // The rig arms the loop, so a redo that did not would give the player a
        // different sound than the action it replays: the beat rig's identity
        // IS the looping bar, and one bar then silence reads as a lost patch.
        it('brings the loop back ARMED when the player redoes the rig', () => {
            installRig(rigFor('beat', 'some'));
            expect(useArrangementStore.getState().loopEnabled).toBe(true);

            useHistoryStore.getState().undo();
            useHistoryStore.getState().redo();
            expect(useArrangementStore.getState().arrangement?.sources?.[BEAT_SOURCE_ID]).toBeDefined();
            expect(useArrangementStore.getState().loopEnabled).toBe(true);
        });

        it('gives the player back the loop switch they had, armed or not', () => {
            for (const armedBefore of [true, false]) {
                useArrangementStore.getState().setArrangement(buildBeatSong());
                useArrangementStore.getState().setLoopEnabled(armedBefore);
                expect(useArrangementStore.getState().loopEnabled).toBe(armedBefore);

                installRig(rigFor('beat', 'some'));
                expect(useArrangementStore.getState().loopEnabled).toBe(true);

                useHistoryStore.getState().undo();
                expect(useArrangementStore.getState().loopEnabled).toBe(armedBefore);
            }
        });

        it('records no document swap for a rig that has no song at all', () => {
            installRig(rigFor('jam', 'some'));
            const [entry] = useHistoryStore.getState().entries;
            expect(entry!.verbs.some((item) => item.domain === 'document')).toBe(false);
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
