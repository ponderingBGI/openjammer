import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { ArrangementTrack } from '../../../song/types';
import { useTrackLaneViewStore } from '../../../store/trackLaneViewStore';
import { TrackLane } from '../TrackLane';

afterEach(() => {
    cleanup();
    useTrackLaneViewStore.getState().resetPitchRanges();
});

const baseTrack: ArrangementTrack = {
    id: 'track-stable',
    ref: 'keys',
    name: 'Keys',
    clips: [{
        id: 'clip-1',
        startTick: 0,
        notes: [{ id: 'note-60', tick: 0, durTick: 120, pitch: 60 }],
    }],
};

const props = {
    pxPerTick: 0.1,
    gutterPx: 100,
    laneHeight: 100,
    fieldWidth: 500,
};

describe('TrackLane stable pitch mapping', () => {
    it('keeps mapping for notes inside the remembered range and grows only outside it', () => {
        const { container, rerender } = render(<TrackLane track={baseTrack} {...props} />);
        const originalTop = (container.querySelector('[title="C4"]') as HTMLElement).style.top;

        const withInsideNote: ArrangementTrack = {
            ...baseTrack,
            clips: [{
                ...baseTrack.clips[0]!,
                notes: [
                    ...baseTrack.clips[0]!.notes,
                    { id: 'note-62', tick: 120, durTick: 120, pitch: 62 },
                ],
            }],
        };
        rerender(<TrackLane track={withInsideNote} {...props} />);
        expect((container.querySelector('[title="C4"]') as HTMLElement).style.top).toBe(originalTop);
        expect(useTrackLaneViewStore.getState().pitchRanges['track-stable']).toEqual({ lo: 54, hi: 66 });

        const withOutsideNote: ArrangementTrack = {
            ...baseTrack,
            clips: [{
                ...baseTrack.clips[0]!,
                notes: [
                    ...baseTrack.clips[0]!.notes,
                    { id: 'note-80', tick: 120, durTick: 120, pitch: 80 },
                ],
            }],
        };
        rerender(<TrackLane track={withOutsideNote} {...props} />);
        expect(useTrackLaneViewStore.getState().pitchRanges['track-stable']).toEqual({ lo: 54, hi: 81 });
        expect((container.querySelector('[title="C4"]') as HTMLElement).style.top).not.toBe(originalTop);
    });
});
