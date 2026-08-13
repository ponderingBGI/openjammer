/**
 * Live binding of the timeline tool port to the arrangement store — the song-layer
 * mirror of {@link import('./graphAdapter').createGraphStoreApi}. {@link
 * applyToolCall} stays pure (it takes an {@link ArrangementToolPort}); this is where
 * `describe_arrangement` / `edit_timeline` reach the real Zustand store, so the agent
 * authors the ONE Arrangement through the SAME reversible verbs + command-log a human
 * GUI drag uses (one Ctrl+Z for both).
 *
 * Ids for ADDED entities are minted here (the agent omits them), so an inverse can
 * name what it created — the same `mintId` the GUI uses, kept collision-free.
 */

import { useArrangementStore } from '../store/arrangementStore';
import { describeArrangement } from '../song/describe';
import type { Verb } from '../song/verbs';
import type { ArrangementToolPort } from './tools';

/** Fill any missing stable id on a verb's ADDED entity (and nested notes), so the
 *  reversible inverse can address exactly what this edit created. */
function withMintedIds(verb: Verb, mint: (prefix: string) => string): Verb {
    switch (verb.kind) {
        case 'addTrack':
            return verb.track.id ? verb : { ...verb, track: { ...verb.track, id: mint('track') } };
        case 'addClip': {
            const id = verb.clip.id ?? mint('clip');
            const notes = verb.clip.notes.map((n) => (n.id ? n : { ...n, id: mint('note') }));
            return { ...verb, clip: { ...verb.clip, id, notes } };
        }
        case 'addNote':
            return verb.note.id ? verb : { ...verb, note: { ...verb.note, id: mint('note') } };
        case 'addSection':
            return verb.section.id ? verb : { ...verb, section: { ...verb.section, id: mint('section') } };
        case 'addAutomationLane':
            return verb.lane.id ? verb : { ...verb, lane: { ...verb.lane, id: mint('lane') } };
        default:
            return verb;
    }
}

/** Create the live timeline port for {@link applyToolCall}. Reads the store fresh on
 *  every call (mutation discipline — never close over a stale snapshot). */
export function createArrangementPort(): ArrangementToolPort {
    return {
        describe() {
            const arr = useArrangementStore.getState().arrangement;
            return arr ? { text: describeArrangement(arr) } : null;
        },
        apply(verbs) {
            const s = useArrangementStore.getState();
            if (!s.arrangement) {
                return { ok: false, summary: 'No song is open on the timeline to edit.', undo: () => {} };
            }
            const minted = verbs.map((v) => withMintedIds(v, s.mintId));
            try {
                // One store.apply = one command-log entry = one Ctrl+Z (atomic: a bad
                // verb throws inside applyVerbs BEFORE any state commits, so the edit is
                // all-or-nothing).
                s.apply(minted);
            } catch (err) {
                return {
                    ok: false,
                    summary: `edit_timeline failed: ${err instanceof Error ? err.message : String(err)}`,
                    undo: () => {},
                };
            }
            return {
                ok: true,
                summary: `Applied ${minted.length} timeline edit(s).`,
                undo: () => useArrangementStore.getState().undo(),
            };
        },
    };
}
