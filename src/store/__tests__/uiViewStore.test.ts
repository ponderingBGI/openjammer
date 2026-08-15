import { beforeEach, describe, expect, it } from 'vitest';
import { useUiViewStore } from '../uiViewStore';

describe('uiViewStore', () => {
    beforeEach(() => useUiViewStore.setState({ surface: 'canvas', songNodeId: null }));

    it('toggles between canvas and arrangement without losing the Song binding', () => {
        useUiViewStore.getState().setSurface('arrangement', 'song-1');
        expect(useUiViewStore.getState()).toMatchObject({ surface: 'arrangement', songNodeId: 'song-1' });
        useUiViewStore.getState().toggle();
        expect(useUiViewStore.getState()).toMatchObject({ surface: 'canvas', songNodeId: 'song-1' });
        useUiViewStore.getState().toggle();
        expect(useUiViewStore.getState().surface).toBe('arrangement');
    });
});
