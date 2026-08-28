import { describe, expect, it, vi } from 'vitest';
import { conduct } from '../conduct';
import { normalizeArrangement } from '../normalize';
import { applyVerbs } from '../verbs';
import { FIRST_LIGHT_BAR, buildFirstLight } from '../songs/firstLight';

describe('First Light', () => {
    it('authors the complete document through the public Verb batch', () => {
        const publicApply = vi.fn(applyVerbs);
        const arrangement = buildFirstLight(publicApply);
        expect(publicApply).toHaveBeenCalledOnce();
        expect(publicApply.mock.calls[0]![0].tracks).toEqual([]);
        expect(publicApply.mock.calls[0]![1].map((verb) => verb.kind)).toEqual(expect.arrayContaining([
            'setTempo', 'addSource', 'addTrack', 'addClip', 'setTrackGain', 'setTrackPan', 'addAutomationLane', 'addLocation',
        ]));
        expect(arrangement.tracks.map((track) => track.name)).toEqual(['Drums', 'Bass', 'Keys', 'Lead', 'Pad']);
    });

    it('normalizes idempotently', () => {
        const arrangement = buildFirstLight();
        expect(normalizeArrangement(arrangement)).toEqual(arrangement);
        expect(normalizeArrangement(normalizeArrangement(arrangement))).toEqual(arrangement);
    });

    it('conducts notes for all five tracks and playable automation', () => {
        const arrangement = buildFirstLight();
        const result = conduct(arrangement);
        expect(Object.keys(result.trackIndex).sort()).toEqual(['bass', 'drums', 'keys', 'lead', 'pad']);
        for (const node of Object.values(result.trackIndex)) {
            expect(result.events.some((event) => event.cmd === 'noteOn' && event.node === node)).toBe(true);
        }
        expect(result.events.filter((event) => event.cmd === 'setParam').length).toBeGreaterThan(20);
        expect(result.timeline.loop_range).toBeNull();
        expect(result.seconds).toBeGreaterThan(68);
    });

    it('carries the four section chips and the bar-17 peak marker', () => {
        const locations = buildFirstLight().locations ?? [];
        expect(locations.filter((item) => item.kind === 'section').map((item) => item.name)).toEqual(['Intro', 'Groove', 'Lift', 'Outro']);
        expect(locations.find((item) => item.name === 'peak')).toMatchObject({ kind: 'mark', startTick: 16 * FIRST_LIGHT_BAR });
        expect(locations.some((item) => item.kind === 'loop')).toBe(false);
    });
});
