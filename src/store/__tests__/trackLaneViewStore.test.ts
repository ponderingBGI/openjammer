import { beforeEach, describe, expect, it } from 'vitest';
import { useTrackLaneViewStore } from '../trackLaneViewStore';

describe('trackLaneViewStore inline piano roll height', () => {
    beforeEach(() => useTrackLaneViewStore.setState(useTrackLaneViewStore.getInitialState(), true));

    it('restores the separately remembered lane height when the piano roll closes', () => {
        const store = useTrackLaneViewStore.getState();
        store.setLaneHeight('track-1', 136);
        store.togglePianoRoll('track-1', 'clip-1');

        expect(useTrackLaneViewStore.getState()).toMatchObject({
            laneHeights: { 'track-1': 220 },
            previousLaneHeights: { 'track-1': 136 },
        });

        useTrackLaneViewStore.getState().closePianoRoll('track-1');
        expect(useTrackLaneViewStore.getState().laneHeights['track-1']).toBe(136);
        expect(useTrackLaneViewStore.getState().previousLaneHeights['track-1']).toBeUndefined();
    });

    it('does not replace the remembered height when switching the expanded clip', () => {
        const store = useTrackLaneViewStore.getState();
        store.setLaneHeight('track-1', 104);
        store.togglePianoRoll('track-1', 'clip-1');
        useTrackLaneViewStore.getState().togglePianoRoll('track-1', 'clip-2');
        useTrackLaneViewStore.getState().togglePianoRoll('track-1', 'clip-2');

        expect(useTrackLaneViewStore.getState().laneHeights['track-1']).toBe(104);
    });
});
