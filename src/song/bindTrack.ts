// src/song/bindTrack.ts — "this track plays THAT", as one reversible edit.
//
// A track's `ref` names a node in the song's OWN graph (`arr.graph`, the half
// `conduct` lowers). A track drawn by hand got the literal string `'track-1'`
// over an empty graph, so `conduct` could never resolve it and the song was
// silent by construction; the "Choose instrument ⌄" chip on the lane header
// dispatched an event whose `trackId` every listener dropped, so there was no
// gesture anywhere that fixed it (UX-INV Q2 cause 2, FH-1 F11).
//
// This is that gesture, as verbs: add the voice, wire it to a master out, point
// the track at it, and take away whatever it used to point at if nothing else
// wants it. Applied as ONE array it is one history entry, so a wrong instrument
// costs exactly one Ctrl+Z.

import type { SpecNode } from './spec';
import type { Arrangement } from './types';
import type { Verb } from './verbs';

/** The node type a chosen instrument lowers to, plus whatever data it carries. */
export interface TrackVoice {
    /** A registry node type (`instrument`, `sampler`, `keys`, …). */
    type: string;
    data?: Record<string, unknown>;
}

/** A ref nothing in the graph is using yet. */
function freeRef(arr: Arrangement, base: string): string {
    if (!arr.graph.nodes.some((node) => node.ref === base)) return base;
    for (let n = 2; ; n++) {
        const candidate = `${base}-${n}`;
        if (!arr.graph.nodes.some((node) => node.ref === candidate)) return candidate;
    }
}

/**
 * The verbs that bind `trackId` to a fresh `voice`. Empty when the track is
 * gone — a caller's stale id must never throw into a live gesture.
 *
 * The song graph gets a Speaker if it has none: a voice wired to nothing is a
 * track that still makes no sound, which is the same disappointment one step
 * later. An existing Speaker is reused, so choosing three instruments builds one
 * mix rather than three islands.
 */
export function bindTrackVerbs(arr: Arrangement, trackId: string, voice: TrackVoice): Verb[] {
    const track = arr.tracks.find((item) => (item.id ?? item.ref) === trackId);
    if (!track) return [];

    const verbs: Verb[] = [];
    let sink = arr.graph.nodes.find((node) => node.type === 'speaker')?.ref;
    if (sink === undefined) {
        sink = freeRef(arr, 'out');
        verbs.push({ kind: 'addGraphNode', node: { ref: sink, type: 'speaker' } });
    }

    const ref = freeRef(arr, `${trackId}-voice`);
    const node: SpecNode = { ref, type: voice.type, ...(voice.data ? { data: voice.data } : {}) };
    verbs.push({ kind: 'addGraphNode', node, connections: [{ from: ref, to: sink }] });
    verbs.push({ kind: 'setTrackRef', trackId: track.id ?? track.ref, ref });

    // The voice it used to have, if it had one and it is now nobody's. Swapping
    // an instrument should not leave the old one hanging off the master.
    const previous = arr.graph.nodes.find((item) => item.ref === track.ref);
    const sharedWithAnotherTrack = arr.tracks.some(
        (item) => (item.id ?? item.ref) !== trackId && item.ref === track.ref,
    );
    if (previous && !sharedWithAnotherTrack && previous.type !== 'speaker') {
        verbs.push({ kind: 'removeGraphNode', ref: previous.ref });
    }
    return verbs;
}

/**
 * Is this track pointing at a node that will actually sound? The chip, the
 * transport's error message and the lane header all ask the same question of the
 * same field, so they can never disagree about which tracks are unbound.
 */
export function trackIsBound(arr: Arrangement, track: { ref: string }): boolean {
    return arr.graph.nodes.some((node) => node.ref === track.ref);
}

/** Every track in the song that has no voice yet, in song order. */
export function unboundTracks(arr: Arrangement): { name: string; ref: string }[] {
    return arr.tracks
        .filter((track) => !trackIsBound(arr, track))
        .map((track) => ({ name: track.name ?? track.ref, ref: track.ref }));
}
