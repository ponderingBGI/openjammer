/**
 * U12 / HA-09 — "Undo" has to say what it will take back.
 *
 * The measured failure: `HistoryEntry.label` was written by every gesture and
 * rendered nowhere, and for the graph it is the same six characters every time
 * ("Edit graph") because `graphStore` records from a diff, not from the call
 * site. One Ctrl+Z after a failed port drag removed ten cables and a whole rig
 * without ever naming it.
 */

import { describe, expect, it } from 'vitest';
import { describeHistoryEntry } from '../historyPhrase';
import type { HistoryEntry } from '../../store/historyStore';
import type { GraphNode, Connection } from '../../engine/types';

const node = (id: string, type: string): GraphNode => ({
    id,
    type: type as GraphNode['type'],
    position: { x: 0, y: 0 },
    ports: [],
    data: {},
    category: 'utility',
    childIds: [],
    parentId: null,
} as unknown as GraphNode);

const cable = (id: string, from: string, to: string): Connection => ({
    id,
    sourceNodeId: from,
    sourcePortId: 'out',
    targetNodeId: to,
    targetPortId: 'in',
    type: 'audio',
} as unknown as Connection);

const entry = (partial: Partial<HistoryEntry>): HistoryEntry => ({
    verbs: [],
    inverse: [],
    label: 'Edit graph',
    scope: 'graph',
    ...partial,
});

const names: Record<string, string> = { a: 'Keys', b: 'Instrument', s: 'Sampler' };
const lookup = (id: string) => names[id];

describe('describeHistoryEntry', () => {
    it('names an added card in both grammars', () => {
        const phrase = describeHistoryEntry(
            entry({ verbs: [{ domain: 'graph', verb: { kind: 'addNode', node: node('s', 'sampler') } }] }),
            lookup,
        );
        expect(phrase.done).toBe('Added Sampler');
        // The imperative is what reads correctly after "Undo".
        expect(`Undo ${phrase.name}`).toBe('Undo Add Sampler');
    });

    /*
     * Adding one card is often several `addNode` verbs — a Looper arrives with its
     * own internals. "Added 3 nodes" is true and useless.
     */
    it('names the CARD, not the insides it arrived with', () => {
        const inner = { ...node('i1', 'gain'), parentId: 's' } as GraphNode;
        const phrase = describeHistoryEntry(
            entry({
                verbs: [
                    { domain: 'graph', verb: { kind: 'addNode', node: node('s', 'sampler') } },
                    { domain: 'graph', verb: { kind: 'addNode', node: inner } },
                ],
            }),
            lookup,
        );
        expect(phrase.done).toBe('Added Sampler');
    });

    it('names a wired cable by both ends', () => {
        const phrase = describeHistoryEntry(
            entry({ verbs: [{ domain: 'graph', verb: { kind: 'addConnection', connection: cable('c1', 'a', 'b') } }] }),
            lookup,
        );
        expect(phrase.done).toBe('Connected Keys to Instrument');
    });

    it('can still name a card that has just been deleted, from the entry’s inverse', () => {
        const phrase = describeHistoryEntry(
            entry({
                verbs: [{ domain: 'graph', verb: { kind: 'removeNode', nodeId: 'gone' } }],
                inverse: [{ domain: 'graph', verb: { kind: 'addNode', node: node('gone', 'looper') } }],
            }),
            () => undefined,
        );
        // The store no longer holds it, so the words come off the verb itself.
        expect(phrase.name).toBe('Delete Looper');
    });

    it('prefers a real label over anything it could assemble', () => {
        const phrase = describeHistoryEntry(
            entry({
                label: 'Install beat rig',
                verbs: [
                    { domain: 'graph', verb: { kind: 'addNode', node: node('a', 'keyboard') } },
                    { domain: 'graph', verb: { kind: 'addNode', node: node('b', 'instrument') } },
                ],
            }),
            lookup,
        );
        expect(`Undo ${phrase.name}`).toBe('Undo Install beat rig');
    });

    it('counts what it cannot name individually', () => {
        const phrase = describeHistoryEntry(
            entry({
                verbs: [
                    { domain: 'graph', verb: { kind: 'removeConnection', connectionId: 'c1' } },
                    { domain: 'graph', verb: { kind: 'removeConnection', connectionId: 'c2' } },
                ],
            }),
            lookup,
        );
        expect(phrase.done).toBe('Disconnected 2 cables');
    });

    /*
     * 1C-03 — "Added 1 nodes."
     *
     * A Sampler's add records its internal `addConnection` verbs in the SAME
     * entry, and the headline branch required `wires.length === 0`, so every
     * pre-wired card fell through to the counter and was announced by an
     * ungrammatical count instead of its name. That is HA-09's exact defect
     * surviving inside the feature built to close it.
     */
    it('names a card that arrives PRE-WIRED, and says that it did', () => {
        const inner = { ...node('i1', 'gain'), parentId: 's' } as GraphNode;
        const phrase = describeHistoryEntry(
            entry({
                verbs: [
                    { domain: 'graph', verb: { kind: 'addNode', node: node('s', 'sampler') } },
                    { domain: 'graph', verb: { kind: 'addNode', node: inner } },
                    { domain: 'graph', verb: { kind: 'addConnection', connection: cable('c1', 'i1', 's') } },
                ],
            }),
            lookup,
        );
        expect(phrase.done).toBe('Added Sampler, wired');
        expect(`Undo ${phrase.name}`).toBe('Undo Add Sampler');
    });

    it('never writes a count of one', () => {
        const phrase = describeHistoryEntry(
            entry({ verbs: [{ domain: 'graph', verb: { kind: 'removeNode', nodeId: 'a' } }, { domain: 'graph', verb: { kind: 'removeNode', nodeId: 'b' } }] }),
            lookup,
        );
        expect(phrase.done).toBe('Deleted 2 nodes');
        // ...and the singular is a word, not a bare number.
        const one = describeHistoryEntry(
            entry({
                verbs: [
                    { domain: 'graph', verb: { kind: 'addNode', node: node('s', 'sampler') } },
                    { domain: 'graph', verb: { kind: 'addNode', node: { ...node('i1', 'gain'), parentId: 's' } as GraphNode } },
                ],
            }),
            lookup,
        );
        expect(one.done).not.toMatch(/\b1 nodes?\b/);
        expect(one.done).toBe('Added Sampler');
    });

    /*
     * A rig install is the biggest single thing a first-run player ever does and
     * it was titled "Undo Add 4 cards". `buildRig` now opens the history frame
     * with the rig's own name; this pins the grammar on both faces.
     */
    /*
     * RG-03 — Duplicate wore Paste's name, because `duplicateSelected` delegates
     * to `pasteClipboard` and inherited its history frame. It has its own now, and
     * the two faces of the phrase differ on purpose: the button names the COMMAND,
     * the announcement names WHAT HAPPENED.
     */
    it('names the command for Undo and the card for the announcement', () => {
        const phrase = describeHistoryEntry(
            entry({
                label: 'Duplicate nodes',
                verbs: [
                    { domain: 'graph', verb: { kind: 'addNode', node: node('s', 'sampler') } },
                    { domain: 'graph', verb: { kind: 'addNode', node: { ...node('i1', 'gain'), parentId: 's' } as GraphNode } },
                ],
            }),
            lookup,
        );
        expect(phrase.done).toBe('Duplicated Sampler');
        expect(`Undo ${phrase.name}`).toBe('Undo Duplicate nodes');
    });

    it('falls back to the label when the gesture made more than one card', () => {
        const phrase = describeHistoryEntry(
            entry({
                label: 'Duplicate nodes',
                verbs: [
                    { domain: 'graph', verb: { kind: 'addNode', node: node('s', 'sampler') } },
                    { domain: 'graph', verb: { kind: 'addNode', node: node('b', 'looper') } },
                ],
            }),
            lookup,
        );
        expect(phrase.done).toBe('Duplicated nodes');
        expect(phrase.name).toBe('Duplicate nodes');
    });

    it('phrases a rig install by name, in both grammars', () => {
        const phrase = describeHistoryEntry(
            entry({
                label: 'Install Beat rig',
                verbs: [
                    { domain: 'graph', verb: { kind: 'addNode', node: node('a', 'keyboard') } },
                    { domain: 'graph', verb: { kind: 'addNode', node: node('b', 'instrument') } },
                ],
            }),
            lookup,
        );
        expect(phrase.done).toBe('Installed Beat rig');
        expect(`Undo ${phrase.name}`).toBe('Undo Install Beat rig');
    });

    /*
     * The UX-1B gate saw the topbar render "Undo compound". `arrangementStore`
     * records `verbs.length === 1 ? verbs[0].kind : 'Edit timeline'`, so a single
     * wrapped timeline gesture is labelled with the bare machine word. A compound
     * entry must phrase as its label or its FIRST verb — never as "compound".
     */
    it('never says the word "compound"', () => {
        const phrase = describeHistoryEntry(
            entry({
                label: 'compound',
                scope: 'arrangement',
                verbs: [{
                    domain: 'arrangement',
                    verb: { kind: 'compound', verbs: [{ kind: 'moveClip' }, { kind: 'addClip' }] },
                } as never],
            }),
            lookup,
        );
        expect(phrase.name).toBe('Move clip');
        expect(phrase.done).toBe('Moved clip');
        expect(`${phrase.name} ${phrase.done}`).not.toMatch(/compound/i);
    });

    it('turns a leaked verb kind back into English', () => {
        const phrase = describeHistoryEntry(
            entry({ label: 'addClip', scope: 'arrangement', verbs: [{ domain: 'arrangement', verb: { kind: 'addClip' } } as never] }),
            lookup,
        );
        expect(phrase.name).toBe('Add clip');
        expect(phrase.done).toBe('Added clip');
    });

    it('falls back honestly rather than inventing a sentence', () => {
        const phrase = describeHistoryEntry(entry({}), lookup);
        expect(phrase.name).toBe('Edit graph');
    });
});
