import { create } from 'zustand';
import type { SurfaceId } from './uiViewStore';

export type GridUnit = 'none' | 'adaptive' | 'bar' | '1/2' | '1/4' | '1/8' | '1/16' | '1/8t';
export type SnapMode = 'off' | 'grid';
export type ZoomFocus = 'mouse' | 'playhead' | 'center';

export interface SurfaceViewport {
    pxPerTick: number;
    leftTick: number;
    yOrigin: number;
    zoomFocus: ZoomFocus;
    tool: 'select' | 'draw';
    selection: { clipIds: string[]; noteIds: string[] };
}

const DEFAULT_PX_PER_TICK = 38.75 / (960 * 4);
const makeViewport = (): SurfaceViewport => ({
    pxPerTick: DEFAULT_PX_PER_TICK,
    leftTick: 0,
    yOrigin: 0,
    zoomFocus: 'mouse',
    tool: 'select',
    selection: { clipIds: [], noteIds: [] },
});

export function zoomAroundPointer(
    viewport: Pick<SurfaceViewport, 'pxPerTick' | 'leftTick'>,
    pointerPx: number,
    factor: number,
    ticksPerBar: number,
): Pick<SurfaceViewport, 'pxPerTick' | 'leftTick'> {
    const min = 4 / ticksPerBar;
    const max = 4000 / ticksPerBar;
    const pxPerTick = Math.max(min, Math.min(max, viewport.pxPerTick * factor));
    const anchorTick = viewport.leftTick + pointerPx / viewport.pxPerTick;
    return { pxPerTick, leftTick: Math.max(0, anchorTick - pointerPx / pxPerTick) };
}

interface EditingContextState {
    snapMode: SnapMode;
    gridUnit: GridUnit;
    gridBeforeInternal: GridUnit;
    editPoint: 'mouse' | 'playhead';
    drawLength: GridUnit;
    drawVelocity: number;
    drawChannel: number;
    quantizeGrid: GridUnit;
    nudgeAmount: GridUnit;
    timeDomain: 'beats' | 'samples';
    clipboard: unknown[];
    dragActive: boolean;
    moveAutomationWithClips: boolean;
    viewports: Record<SurfaceId, SurfaceViewport>;
    setGridUnit: (gridUnit: GridUnit) => void;
    toggleSnap: () => void;
    setViewport: (surface: SurfaceId, patch: Partial<SurfaceViewport>) => void;
    zoomAt: (surface: SurfaceId, pointerPx: number, factor: number, ticksPerBar: number) => void;
}

export const useEditingContextStore = create<EditingContextState>((set) => ({
    snapMode: 'grid',
    gridUnit: 'adaptive',
    gridBeforeInternal: 'adaptive',
    editPoint: 'mouse',
    drawLength: '1/16',
    drawVelocity: 96,
    drawChannel: 1,
    quantizeGrid: '1/16',
    nudgeAmount: '1/16',
    timeDomain: 'beats',
    clipboard: [],
    dragActive: false,
    moveAutomationWithClips: true,
    viewports: { canvas: makeViewport(), arrangement: makeViewport() },
    setGridUnit: (gridUnit) => set({ gridUnit }),
    toggleSnap: () => set((state) => ({ snapMode: state.snapMode === 'grid' ? 'off' : 'grid' })),
    setViewport: (surface, patch) => set((state) => ({
        viewports: { ...state.viewports, [surface]: { ...state.viewports[surface], ...patch } },
    })),
    zoomAt: (surface, pointerPx, factor, ticksPerBar) => set((state) => ({
        viewports: {
            ...state.viewports,
            [surface]: {
                ...state.viewports[surface],
                ...zoomAroundPointer(state.viewports[surface], pointerPx, factor, ticksPerBar),
            },
        },
    })),
}));
