import { describe, expect, it } from 'vitest';
import type { Arrangement } from '../types';
import { applyVerbs } from '../verbs';
import { deleteClips, duplicateClips, moveClips, nudge, splitAt, trimClip } from '../ops';
import { gridTicks, snapTick } from '../../store/editingContextStore';
import { crossedDragThreshold, dominantAxis } from '../../components/Arrangement/dragController';

const arrangement = (): Arrangement => ({
    name: 'contracts', tempoBpm: 120, ppq: 960, timeSignature: [4, 4], graph: { nodes: [], connections: [] },
    sources: { midi: { id: 'midi', kind: 'midi', name: 'midi', lengthTick: 8000, notes: [{ id: 'n', tick: 0, durTick: 120, pitch: 60 }] } },
    tracks: [
        { id: 't1', ref: 'a', clips: [{ id: 'a', sourceId: 'midi', startTick: 37, lengthTick: 960 }, { id: 'later', sourceId: 'midi', startTick: 2000, lengthTick: 400 }] },
        { id: 't2', ref: 'b', clips: [{ id: 'b', sourceId: 'midi', startTick: 400, lengthTick: 480 }] },
    ],
});

describe('BC-05 grid units', () => {
    it('maps contract units at PPQ 960', () => {
        expect(gridTicks('bar', 960, 3840, 1, true)).toBe(3840);
        expect(gridTicks('1/8', 960, 3840, 1, true)).toBe(480);
        expect(gridTicks('1/8t', 960, 3840, 1, true)).toBe(320);
        expect(gridTicks('1/16', 960, 3840, 1, true)).toBe(240);
        expect(gridTicks('1/5', 960, 3840, 1, true)).toBe(768);
    });
});

describe('BC-06 magnetic snap', () => {
    it('accepts only within 25px and Alt inversion suppresses it', () => {
        expect(snapTick(90, [100], 2, 'magnetic')).toBe(100);
        expect(snapTick(80, [100], 2, 'magnetic')).toBe(80);
        expect(snapTick(90, [100], 2, 'magnetic', true)).toBe(90);
        expect(snapTick(80, [100], 2, 'off', false, true)).toBe(100);
    });
});

describe('BC-09 Slide', () => {
    it('moves only selected clips and permits overlap', () => {
        const arr = arrangement();
        const result = applyVerbs(arr, moveClips(arr, ['a'], 1963).verbs).next;
        expect(result.tracks[0]!.clips.find((clip) => clip.id === 'later')!.startTick).toBe(2000);
    });
});

describe('BC-10 Ripple', () => {
    it('moves downstream clips in the same transaction', () => {
        const arr = arrangement();
        const result = applyVerbs(arr, moveClips(arr, ['a'], 100, { ripple: true }).verbs).next;
        expect(result.tracks[0]!.clips.find((clip) => clip.id === 'later')!.startTick).toBe(2100);
    });
});

describe('BC-12 drag threshold and axis dominance', () => {
    it('uses 4px normally and 12px x / 4px y for copies', () => {
        expect(crossedDragThreshold(3, 3, false)).toBe(false);
        expect(crossedDragThreshold(5, 2, false)).toBe(true);
        expect(crossedDragThreshold(11, 3, true)).toBe(false);
        expect(crossedDragThreshold(11, 4, true)).toBe(true);
        expect(dominantAxis(20, 2)).toBe('horizontal');
    });
});

describe('BC-17 trim clips', () => {
    it('front trim preserves the fixed end and enforces one tick', () => {
        const arr = arrangement();
        const result = applyVerbs(arr, trimClip(arr, ['a'], 'start', 2000).verbs).next;
        const clip = result.tracks[0]!.clips.find((item) => item.id === 'a')!;
        expect(clip.lengthTick).toBe(1);
        expect(clip.startTick + clip.lengthTick).toBe(997);
    });
});

describe('BC-20 split clip', () => {
    it('selects both newly minted halves', () => {
        const arr = arrangement();
        let id = 0;
        const result = splitAt(arr, ['a'], 400, () => `new-${id++}`);
        expect(result.selectedClipIds).toEqual(['new-0', 'new-1']);
        expect(applyVerbs(arr, result.verbs).next.tracks[0]!.clips.map((clip) => clip.id)).toContain('new-1');
    });
});

describe('BC-21 nudge', () => {
    it('clamps backward movement at zero', () => {
        const arr = arrangement();
        const result = applyVerbs(arr, nudge(arr, ['a'], 240, -1).verbs).next;
        expect(result.tracks[0]!.clips.find((clip) => clip.id === 'a')!.startTick).toBe(0);
    });
});

describe('BC-14 copy-drag substrate', () => {
    it('duplicates with fresh ids and leaves originals untouched', () => {
        const arr = arrangement();
        const result = duplicateClips(arr, ['a'], 240, () => 'copy');
        const next = applyVerbs(arr, result.verbs).next;
        expect(next.tracks[0]!.clips.find((clip) => clip.id === 'a')!.startTick).toBe(37);
        expect(next.tracks[0]!.clips.find((clip) => clip.id === 'copy')!.startTick).toBe(277);
    });
});

describe('BC-27 clipboard/gesture atomicity', () => {
    it('delete batch has exact inverse', () => {
        const arr = arrangement();
        const changed = applyVerbs(arr, deleteClips(arr, ['a', 'b']).verbs);
        expect(applyVerbs(changed.next, changed.inverse).next).toEqual(arr);
    });
});
