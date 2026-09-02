import { describe, expect, it } from 'vitest';
import { clippedNoteGeometry, INLINE_MIN_HALF_BEAT_PX, inlineOpeningPxPerTick, MIN_RESIZE_EDGE_WIDTH_PX, pitchRowHeight, resizeEdge, shouldAutoDetectDrums, surfaceOpeningPxPerTick, velocityOpacity } from '../geometry';
import { buildPaperSketch } from '../../../song/songs/paperSketch';

describe('piano-roll geometry', () => {
    it('BC-32 exposes resize zones from 10px up and caps them at 8px', () => {
        // HA-18: ten pixels is where the edges START working. The floor used to
        // be EXCLUSIVE (`width <= 10 -> null`), so a note exactly ten pixels wide
        // — the width one `Ctrl+wheel` notch produced from the inline roll's old
        // opening zoom — was still un-trimmable, with a cursor that never changed
        // to say so.
        expect(resizeEdge(1, MIN_RESIZE_EDGE_WIDTH_PX)).toBe('start');
        expect(resizeEdge(9, MIN_RESIZE_EDGE_WIDTH_PX)).toBe('end');
        expect(resizeEdge(1, MIN_RESIZE_EDGE_WIDTH_PX - 1)).toBeNull();
        expect(resizeEdge(7, 30)).toBe('start');
        expect(resizeEdge(9, 30)).toBeNull();
        expect(resizeEdge(23, 30)).toBe('end');
    });

    it("HA-18 — the inline roll's opening zoom makes a half-beat note grabbable", () => {
        // The lane roll inherited the Song's axis, where a half beat is 4.8px:
        // under the resize floor, so the first clip a player ever opened could be
        // moved and never trimmed. The opening zoom is defined by the note width
        // it has to produce, not by a magic number.
        for (const ppq of [96, 480, 960, 1920]) {
            const pxPerTick = inlineOpeningPxPerTick(ppq);
            const halfBeatPx = (ppq / 2) * pxPerTick;
            expect(halfBeatPx).toBeCloseTo(INLINE_MIN_HALF_BEAT_PX, 6);
            expect(halfBeatPx).toBeGreaterThanOrEqual(MIN_RESIZE_EDGE_WIDTH_PX);
            expect(resizeEdge(1, halfBeatPx)).toBe('start');
        }
        // And it is a FLOOR, not a target: the Song's own default axis (a half
        // beat at 4.8px) is well under it, which is the bug it exists to close.
        const songDefault = 38.75 / (960 * 4);
        expect(480 * songDefault).toBeLessThan(INLINE_MIN_HALF_BEAT_PX);
        expect(inlineOpeningPxPerTick(960)).toBeGreaterThan(songDefault);
    });

    it('F4 — the full roll opens FITTED, with the same floor', () => {
        const ppq = 960;
        const floor = inlineOpeningPxPerTick(ppq);
        const song = 38.75 / (960 * 4);

        // A four-bar clip in a 1 000px field: the clip fills the field.
        const fourBars = 4 * 4 * ppq;
        expect(surfaceOpeningPxPerTick(1000, fourBars, ppq, song)).toBeCloseTo(1000 / fourBars, 9);

        // A sixty-bar clip would fit at 0.0043px/tick — a hairline comb — so the
        // 24px-per-half-beat floor wins instead, and every note stays trimmable.
        const sixtyBars = 60 * 4 * ppq;
        expect(surfaceOpeningPxPerTick(1000, sixtyBars, ppq, song)).toBe(floor);
        expect((ppq / 2) * surfaceOpeningPxPerTick(1000, sixtyBars, ppq, song)).toBeCloseTo(INLINE_MIN_HALF_BEAT_PX, 6);

        // Never below the Song's own axis: a player already zoomed past the
        // floor keeps their scale.
        expect(surfaceOpeningPxPerTick(1000, sixtyBars, ppq, 5)).toBe(5);

        // And the symptom it exists to close: the shipped starter's axis put
        // every note under the resize floor on the surface `E` opens.
        expect((ppq / 2) * song).toBeLessThan(MIN_RESIZE_EDGE_WIDTH_PX);
        expect((ppq / 2) * surfaceOpeningPxPerTick(1000, sixtyBars, ppq, song)).toBeGreaterThanOrEqual(MIN_RESIZE_EDGE_WIDTH_PX);

        // A clip with no length cannot be fitted; the floor still applies.
        expect(surfaceOpeningPxPerTick(1000, 0, ppq, song)).toBe(floor);
    });

    it('maps velocity to opacity without changing note geometry', () => {
        // W4-TBb: the floor rose 0.45 -> 0.68. At 0.45 the softest note composited
        // to 1.65:1 against a white-key row, so the primary object of this editor
        // failed WCAG 1.4.11 at every velocity below maximum. The composited floor
        // itself is gated in `Arrangement/__tests__/contrast.test.ts`; this pins
        // the shape of the ramp: monotonic, clamped, and exactly 1 at 127.
        expect(velocityOpacity(0)).toBeCloseTo(0.68);
        expect(velocityOpacity(127)).toBe(1);
        expect(velocityOpacity(64)).toBeGreaterThan(velocityOpacity(32));
        expect(velocityOpacity(-40)).toBeCloseTo(0.68);
        expect(velocityOpacity(400)).toBe(1);
    });

    it('clips source notes to the visible clip window', () => {
        expect(clippedNoteGeometry({ tick: 80, durTick: 40, pitch: 60 }, 1000, 100, 200, 0.5)).toEqual({ left: 500, width: 10 });
        expect(clippedNoteGeometry({ tick: 310, durTick: 20, pitch: 60 }, 1000, 100, 200, 0.5)).toBeNull();
    });

    it('auto-detects a compact GM drum pitch set only', () => {
        expect(shouldAutoDetectDrums([{ tick: 0, durTick: 1, pitch: 36 }, { tick: 10, durTick: 1, pitch: 42 }])).toBe(true);
        expect(shouldAutoDetectDrums([{ tick: 0, durTick: 1, pitch: 20 }])).toBe(false);
        expect(shouldAutoDetectDrums([])).toBe(false);
    });
});

/**
 * W6-SHIP item 5 — the first clip a new player opens is not a drum grid.
 *
 * The old rule was `pitches.size <= 16 && every pitch in [35, 81]`, which is most
 * tonal music. The SHIPPED starter matched it: "Nylon Chords" is a four-note
 * karplus arpeggio in A minor, and it opened as duration-less 10px diamonds beside
 * a key gutter reading `D5 · C#5 · … · Low bongo · Ride · Cowbell`. Both halves of
 * that are visible damage — the labels are wrong, and collapsing every note to a
 * diamond throws away the difference between a 480-tick note and a 60-tick one.
 *
 * So the predicate now needs a kit SIGNAL. The three tests below are the three
 * signals, and the first one is the regression: the real shipped starter, built by
 * the real builder, not a fixture that approximates it.
 */
describe('drum-mode detection needs a kit signal', () => {
    /** The starter's chord clip, straight out of the shipping song builder. */
    function starterChordNotes() {
        const arrangement = buildPaperSketch();
        const track = arrangement.tracks.find((item) => item.ref === 'chords')!;
        const source = arrangement.sources![track.clips[0]!.sourceId]!;
        return source.kind === 'midi' ? source.notes : [];
    }

    it('opens the shipped starter melodic', () => {
        const notes = starterChordNotes();
        expect(notes.length, 'the starter really does have a chord part').toBeGreaterThan(0);
        // It is exactly the shape the old rule fell for: few distinct pitches,
        // all of them inside the 35-81 window.
        const pitches = new Set(notes.map((note) => note.pitch));
        expect(pitches.size).toBeLessThanOrEqual(16);
        expect([...pitches].every((pitch) => pitch >= 35 && pitch <= 81)).toBe(true);
        // And it is melodic, because the notes are HELD.
        expect(shouldAutoDetectDrums(notes, { trackName: 'Nylon Chords', ppq: 960 })).toBe(false);
    });

    it('opens a real drum clip as drums, on shape alone', () => {
        // A two-bar kick/snare/hat groove: every pitch named in the GM map, every
        // note a hit rather than a held pitch.
        const groove = [36, 42, 38, 42, 36, 42, 38, 42].map((pitch, index) => ({
            tick: index * 240, durTick: 60, pitch, vel: 100,
        }));
        expect(shouldAutoDetectDrums(groove, { ppq: 960 })).toBe(true);
    });

    it('takes the instrument at its word when it is a kit', () => {
        // The one unambiguous statement in the system beats every heuristic, even
        // for material whose SHAPE says melodic (held notes, an unmapped pitch).
        const held = [{ tick: 0, durTick: 1920, pitch: 74, vel: 90 }];
        expect(shouldAutoDetectDrums(held, {})).toBe(false);
        expect(shouldAutoDetectDrums(held, { instrumentIsPercussion: true })).toBe(true);
        expect(shouldAutoDetectDrums(held, { trackName: 'Drums' })).toBe(true);
        expect(shouldAutoDetectDrums(held, { instrumentId: 'gm-standard-kit' })).toBe(true);
    });

    it('one held note is enough to disqualify a kit-shaped clip', () => {
        // Things you hold are pitches. The tie goes to melodic on purpose: opening
        // a kit melodic costs one click of the Drums toggle, opening a song as
        // drums misnames every row and discards every duration on screen.
        const hits = [36, 38, 42].map((pitch, index) => ({ tick: index * 240, durTick: 60, pitch }));
        expect(shouldAutoDetectDrums(hits, { ppq: 960 })).toBe(true);
        expect(shouldAutoDetectDrums([...hits, { tick: 720, durTick: 960, pitch: 36 }], { ppq: 960 })).toBe(false);
    });

    it('rejects a pitch the GM map does not name, not merely one outside a window', () => {
        // 58 (Vibraslap) sits inside the old 35-81 window and is NOT in the map
        // the key gutter reads from — which is exactly how the starter ended up
        // with `A#3` sitting between `Ride` and `Crash` in a drum-mode gutter.
        const withUnmapped = [
            { tick: 0, durTick: 60, pitch: 36 },
            { tick: 240, durTick: 60, pitch: 58 },
        ];
        expect(shouldAutoDetectDrums(withUnmapped, { ppq: 960 })).toBe(false);
    });

    it('keeps pitched rows in the 6px to 22px hit-testable contract range', () => {
        // Spec 2.7: clamp(6, fit, 22). The ceiling rose from 16 in W4-TB so a
        // narrow pitch range fills the surface instead of floating above a third
        // of it; the 6px floor (D18) is unchanged — it is the pointer contract.
        expect(pitchRowHeight(40, { lo: 0, hi: 127 }, false)).toBe(6);
        expect(pitchRowHeight(600, { lo: 60, hi: 71 }, false)).toBe(22);
        expect(pitchRowHeight(20, { lo: 35, hi: 81 }, true)).toBe(18);
    });
});
