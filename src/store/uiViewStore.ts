import { create } from 'zustand';

export type SurfaceId = 'canvas' | 'arrangement' | 'pianoroll';

interface UiViewState {
    surface: SurfaceId;
    songNodeId: string | null;
    pianoRollClipId: string | null;
    setSurface: (surface: SurfaceId, songNodeId?: string | null) => void;
    toggle: () => void;
    openPianoRoll: (clipId: string) => void;
    closePianoRoll: () => void;
}

export const useUiViewStore = create<UiViewState>((set) => ({
    surface: 'canvas',
    songNodeId: null,
    pianoRollClipId: null,
    setSurface: (surface, songNodeId) => set((state) => ({
        surface,
        songNodeId: songNodeId === undefined ? state.songNodeId : songNodeId,
    })),
    toggle: () => set((state) => ({
        surface: state.surface === 'canvas' ? 'arrangement' : 'canvas',
    })),
    openPianoRoll: (pianoRollClipId) => set({ surface: 'pianoroll', pianoRollClipId }),
    closePianoRoll: () => set({ surface: 'arrangement' }),
}));
