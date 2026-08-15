import { create } from 'zustand';

export type SurfaceId = 'canvas' | 'arrangement';

interface UiViewState {
    surface: SurfaceId;
    songNodeId: string | null;
    setSurface: (surface: SurfaceId, songNodeId?: string | null) => void;
    toggle: () => void;
}

export const useUiViewStore = create<UiViewState>((set) => ({
    surface: 'canvas',
    songNodeId: null,
    setSurface: (surface, songNodeId) => set((state) => ({
        surface,
        songNodeId: songNodeId === undefined ? state.songNodeId : songNodeId,
    })),
    toggle: () => set((state) => ({
        surface: state.surface === 'canvas' ? 'arrangement' : 'canvas',
    })),
}));
