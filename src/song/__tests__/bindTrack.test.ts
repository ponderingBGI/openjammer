/**
 * U6 — a fresh track is unbound, and choosing an instrument binds it.
 *
 * A track's `ref` names the node in the song's own graph that voices it. A track
 * drawn by hand carried the literal string `'track-1'` over an empty graph, so
 * `conduct` put it in `skipped` and the song was silent by construction — and
 * the "Choose instrument ⌄" chip dispatched a `trackId` every listener dropped,
 * so nothing in the app could ever fix it (UX-INV Q2 cause 2, FH-1 F11).
 *
 * What is pinned here: the binding is ONE reversible edit, its inverse restores
 * the exact previous patch, and after it the track resolves — the same predicate
 * `conduct` uses.
 */

import { describe, it, expect } from 'vitest';
import { bindTrackVerbs, trackIsBound, unboundTracks } from '../bindTrack';
import { applyVerbs } from '../verbs';
import type { Arrangement } from '../types';

function freshSong(): Arrangement {
    return {
        name: 'Untitled song',
        tempoBpm: 120,
        ppq: 960,
        timeSignature: [4, 4],
        graph: { nodes: [], connections: [] },
        tracks: [{ id: 'track-1', name: 'Track 1', ref: 'track-1', clips: [] }],
    };
}

describe('an unbound track', () => {
    it('is what a freshly drawn track IS', () => {
        const song = freshSong();
        expect(trackIsBound(song, song.tracks[0]!)).toBe(false);
        expect(unboundTracks(song)).toEqual([{ name: 'Track 1', ref: 'track-1' }]);
    });

    it('stops being one the moment it is bound', () => {
        const song = freshSong();
        const { next } = applyVerbs(song, bindTrackVerbs(song, 'track-1', { type: 'instrument' }));
        expect(trackIsBound(next, next.tracks[0]!)).toBe(true);
        expect(unboundTracks(next)).toEqual([]);
    });
});

describe('bindTrackVerbs', () => {
    it('writes the voice into the SONG graph and points the track at it', () => {
        const song = freshSong();
        const { next } = applyVerbs(song, bindTrackVerbs(song, 'track-1', { type: 'instrument', data: { instrumentId: 'karplus-nylon' } }));

        const voice = next.graph.nodes.find((node) => node.ref === next.tracks[0]!.ref);
        expect(voice?.type).toBe('instrument');
        expect(voice?.data).toEqual({ instrumentId: 'karplus-nylon' });
    });

    /*
     * A voice wired to nothing is a track that still makes no sound — the same
     * disappointment one step later.
     */
    it('gives the song a master out when it has none, and wires the voice to it', () => {
        const song = freshSong();
        const { next } = applyVerbs(song, bindTrackVerbs(song, 'track-1', { type: 'instrument' }));

        const speaker = next.graph.nodes.find((node) => node.type === 'speaker');
        expect(speaker).toBeDefined();
        expect(next.graph.connections).toContainEqual({ from: next.tracks[0]!.ref, to: speaker!.ref });
    });

    it('reuses the existing master rather than building a second island', () => {
        const song = freshSong();
        const first = applyVerbs(song, bindTrackVerbs(song, 'track-1', { type: 'instrument' })).next;
        const twoTracks: Arrangement = { ...first, tracks: [...first.tracks, { id: 'track-2', name: 'Track 2', ref: 'track-2', clips: [] }] };

        const { next } = applyVerbs(twoTracks, bindTrackVerbs(twoTracks, 'track-2', { type: 'sampler' }));

        expect(next.graph.nodes.filter((node) => node.type === 'speaker')).toHaveLength(1);
    });

    it('takes the old voice away when a track swaps instrument', () => {
        const song = freshSong();
        const bound = applyVerbs(song, bindTrackVerbs(song, 'track-1', { type: 'instrument' })).next;
        const { next } = applyVerbs(bound, bindTrackVerbs(bound, 'track-1', { type: 'sampler' }));

        expect(next.graph.nodes.filter((node) => node.type === 'instrument')).toHaveLength(0);
        expect(next.graph.nodes.filter((node) => node.type === 'sampler')).toHaveLength(1);
        // …and its dangling wire with it.
        expect(next.graph.connections?.every((wire) => wire.from === next.tracks[0]!.ref)).toBe(true);
    });

    /*
     * The whole reason it is verbs and not a mutation: choosing the wrong
     * instrument costs exactly one Ctrl+Z, and it puts the patch back byte for
     * byte.
     */
    it('is exactly reversible', () => {
        const song = freshSong();
        const verbs = bindTrackVerbs(song, 'track-1', { type: 'instrument' });
        const { next, inverse } = applyVerbs(song, verbs);
        expect(next).not.toEqual(song);

        const back = applyVerbs(next, inverse).next;
        expect(back).toEqual(song);
    });

    it('refuses a track that is not there rather than throwing into a live gesture', () => {
        expect(bindTrackVerbs(freshSong(), 'nope', { type: 'instrument' })).toEqual([]);
    });
});

describe('the setTrackRef verb on its own', () => {
    it('inverts to the ref the track had before', () => {
        const song = freshSong();
        const { next, inverse } = applyVerbs(song, [{ kind: 'setTrackRef', trackId: 'track-1', ref: 'voice' }]);
        expect(next.tracks[0]!.ref).toBe('voice');
        expect(inverse).toEqual([{ kind: 'setTrackRef', trackId: 'track-1', ref: 'track-1' }]);
    });

    it('refuses an empty ref — a binding to nothing is the bug, not the fix', () => {
        expect(() => applyVerbs(freshSong(), [{ kind: 'setTrackRef', trackId: 'track-1', ref: '' }])).toThrow();
    });
});
