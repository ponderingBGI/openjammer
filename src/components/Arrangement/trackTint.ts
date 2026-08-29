import type { ArrangementTrack } from '../../song/types';

/**
 * The paper palette a track falls back to when it has no colour of its own.
 *
 * These are semantic tokens, not literals, so a theme swap re-tints the whole
 * arrangement without touching a line of component code — the same rule the
 * rest of the surface lives by.
 *
 * Danger and muted-grey are deliberately NOT in it. On this surface red already
 * means "recording / faulted" and grey already means "muted", so a track that
 * happened to hash to either would be wearing a state it is not in.
 */
export const TRACK_TINTS = [
    'var(--accent-secondary)',
    'var(--accent-success)',
    'var(--audio-connection)',
    'var(--universal-connection)',
    'var(--accent-warning)',
] as const;

/**
 * A track's tint: its own colour if it has one, otherwise a stable pick from
 * the palette. Derived from the id so the same track keeps the same colour
 * across reloads — a performer learns "the green lane is the bass" in one set,
 * and a colour that shuffled on load would unteach it every time.
 *
 * Shared by the lane, the clip and the drag ghost so all three agree.
 */
export function trackTint(track: ArrangementTrack): string {
    if (track.color) return track.color;
    const id = track.id ?? track.ref;
    const index = [...id].reduce((sum, character) => sum + character.charCodeAt(0), 0) % TRACK_TINTS.length;
    return TRACK_TINTS[index]!;
}
