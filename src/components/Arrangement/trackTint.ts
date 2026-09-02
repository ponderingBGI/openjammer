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

/**
 * `<input type="color">`'s spec default, and the only literal colour this module
 * is allowed to name. It is reached ONLY when there is no DOM to resolve a token
 * against (a test renderer, a canvas-less environment) — never as a brand colour.
 * The blue this branch's `5b412f5` retired used to sit here instead, so clicking a
 * lane that had no colour of its own opened the OS picker on a hue the app had
 * publicly retired, while the lane itself wore orange.
 */
export const UNSET_SWATCH_HEX = '#000000';

/** `#rrggbb` written by hand, the one shape `<input type="color">` accepts. */
const EXPLICIT_HEX = /^#[0-9a-f]{6}$/i;

/**
 * The track's effective tint as a `#rrggbb` literal, for the ONE control that
 * cannot take a token: the native colour picker.
 *
 * Everything else on this surface paints from `--track-tint` and is correct by
 * construction. The native input is different — the OS dialog opens on whatever
 * hex we hand it, so a hard-coded fallback there is a lie about what the lane is
 * currently wearing. So we resolve the real thing: read the COMPUTED
 * `--track-tint` off the lane (already token-substituted by the engine, whatever
 * theme is live), paint one pixel with it, and read the sRGB bytes back. That is
 * the only route — `oklch()` survives both `getComputedStyle().color` and
 * `canvas.fillStyle` serialization untouched in Chromium, so nothing shorter
 * actually produces a hex.
 *
 * An unresolvable value leaves the pixel at {@link UNSET_SWATCH_HEX}, because an
 * invalid `fillStyle` assignment is ignored and the black we primed with stands.
 */
export function trackTintHex(track: ArrangementTrack, lane: Element | null): string {
    if (track.color && EXPLICIT_HEX.test(track.color)) return track.color;
    if (!lane || typeof document === 'undefined') return UNSET_SWATCH_HEX;
    const raw = getComputedStyle(lane).getPropertyValue('--track-tint').trim();
    if (EXPLICIT_HEX.test(raw)) return raw.toLowerCase();
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return UNSET_SWATCH_HEX;
    context.fillStyle = UNSET_SWATCH_HEX;
    context.fillStyle = raw;
    context.fillRect(0, 0, 1, 1);
    const [red, green, blue] = context.getImageData(0, 0, 1, 1).data;
    return `#${[red, green, blue].map((channel) => (channel ?? 0).toString(16).padStart(2, '0')).join('')}`;
}
