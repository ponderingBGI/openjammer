import { create } from 'zustand';
import type { SurfaceId } from './uiViewStore';

export type GridUnit = 'none' | 'adaptive' | 'bar' | 'beat' | '1/2' | '1/3' | '1/4' | '1/5' | '1/6' | '1/7' | '1/8' | '1/10' | '1/12' | '1/14' | '1/16' | '1/20' | '1/24' | '1/28' | '1/32' | '1/8t';
export type SnapMode = 'off' | 'magnetic';
export type SnapTarget = 'grid' | 'other' | 'both';
export type EditMode = 'slide' | 'ripple' | 'lock';
export type RippleScope = 'selected' | 'all' | 'interview';
export type ZoomFocus = 'mouse' | 'playhead' | 'center';

export interface ObjectSelection {
    clipIds: string[];
    noteIds: string[];
    trackIds: string[];
    sectionIds: string[];
    automationPointIds: string[];
}

export interface SurfaceViewport {
    pxPerTick: number;
    leftTick: number;
    yOrigin: number;
    zoomFocus: ZoomFocus;
    tool: 'select' | 'draw';
    selection: ObjectSelection;
}

const DEFAULT_PX_PER_TICK = 38.75 / (960 * 4);
const emptySelection = (): ObjectSelection => ({ clipIds: [], noteIds: [], trackIds: [], sectionIds: [], automationPointIds: [] });
const makeViewport = (): SurfaceViewport => ({
    pxPerTick: DEFAULT_PX_PER_TICK,
    leftTick: 0,
    yOrigin: 0,
    zoomFocus: 'mouse',
    tool: 'select',
    selection: emptySelection(),
});

export function zoomAroundPointer(viewport: Pick<SurfaceViewport, 'pxPerTick' | 'leftTick'>, pointerPx: number, factor: number, ticksPerBar: number): Pick<SurfaceViewport, 'pxPerTick' | 'leftTick'> {
    const min = 4 / ticksPerBar;
    const max = 4000 / ticksPerBar;
    const pxPerTick = Math.max(min, Math.min(max, viewport.pxPerTick * factor));
    const anchorTick = viewport.leftTick + pointerPx / viewport.pxPerTick;
    return { pxPerTick, leftTick: Math.max(0, anchorTick - pointerPx / pxPerTick) };
}

const divisions: Partial<Record<GridUnit, number>> = {
    '1/2': 2, '1/3': 3, '1/4': 4, '1/5': 5, '1/6': 6, '1/7': 7, '1/8': 8,
    '1/8t': 12, '1/10': 10, '1/12': 12, '1/14': 14, '1/16': 16, '1/20': 20,
    '1/24': 24, '1/28': 28, '1/32': 32,
};

export function gridTicks(unit: GridUnit, ticksPerBeat: number, ticksPerBar: number, pxPerTick = Infinity, unscaled = false): number | null {
    if (unit === 'none') return null;
    if (unit === 'bar') return ticksPerBar;
    if (unit === 'beat') return ticksPerBeat;
    if (unit === 'adaptive') {
        const candidates = [32, 28, 24, 20, 16, 14, 12, 10, 8, 7, 6, 5, 4, 3, 2];
        const div = candidates.find((value) => ticksPerBeat * 4 / value * pxPerTick >= 25) ?? 2;
        return ticksPerBeat * 4 / div;
    }
    let ticks = ticksPerBeat * 4 / divisions[unit]!;
    if (!unscaled) while (ticks * pxPerTick < 25 && ticks < ticksPerBar) ticks *= 2;
    return ticks;
}

export function snapTick(rawTick: number, candidates: readonly number[], pxPerTick: number, mode: SnapMode, invert = false, ensure = false): number {
    if (!candidates.length) return rawTick;
    const enabled = ensure || (mode === 'magnetic') !== invert;
    if (!enabled) return rawTick;
    const nearest = candidates.reduce((best, value) => Math.abs(value - rawTick) < Math.abs(best - rawTick) ? value : best);
    return ensure || Math.abs(nearest - rawTick) * pxPerTick <= 25 ? nearest : rawTick;
}

interface EditingContextState {
    snapMode: SnapMode;
    snapTarget: SnapTarget;
    gridUnit: GridUnit;
    gridBeforeInternal: GridUnit;
    editPoint: 'mouse' | 'playhead' | 'marker';
    editMode: EditMode;
    rippleScope: RippleScope;
    drawLength: GridUnit;
    drawVelocity: number;
    drawChannel: number;
    quantizeGrid: GridUnit;
    nudgeAmount: GridUnit;
    timeDomain: 'beats' | 'samples';
    clipboard: unknown[];
    dragActive: boolean;
    followPlayhead: boolean;
    followEdits: boolean;
    moveAutomationWithClips: boolean;
    viewports: Record<SurfaceId, SurfaceViewport>;
    setGridUnit: (gridUnit: GridUnit) => void;
    toggleSnap: () => void;
    setSnapTarget: (target: SnapTarget) => void;
    setEditMode: (mode: EditMode) => void;
    setDragActive: (active: boolean) => void;
    setSelection: (surface: SurfaceId, selection: Partial<ObjectSelection>) => void;
    clearSelection: (surface: SurfaceId) => void;
    setViewport: (surface: SurfaceId, patch: Partial<SurfaceViewport>) => void;
    zoomAt: (surface: SurfaceId, pointerPx: number, factor: number, ticksPerBar: number) => void;
}

export const useEditingContextStore = create<EditingContextState>((set) => ({
    snapMode: 'magnetic',
    snapTarget: 'grid',
    gridUnit: 'adaptive',
    gridBeforeInternal: 'adaptive',
    editPoint: 'playhead',
    editMode: 'slide',
    rippleScope: 'selected',
    drawLength: '1/16',
    drawVelocity: 96,
    drawChannel: 1,
    quantizeGrid: '1/16',
    nudgeAmount: '1/16',
    timeDomain: 'beats',
    clipboard: [],
    dragActive: false,
    followPlayhead: false,
    followEdits: false,
    moveAutomationWithClips: true,
    viewports: { canvas: makeViewport(), arrangement: makeViewport() },
    setGridUnit: (gridUnit) => set({ gridUnit }),
    toggleSnap: () => set((state) => ({ snapMode: state.snapMode === 'magnetic' ? 'off' : 'magnetic' })),
    setSnapTarget: (snapTarget) => set({ snapTarget }),
    setEditMode: (editMode) => set({ editMode }),
    setDragActive: (dragActive) => set({ dragActive }),
    setSelection: (surface, patch) => set((state) => ({ viewports: { ...state.viewports, [surface]: { ...state.viewports[surface], selection: { ...state.viewports[surface].selection, ...patch } } } })),
    clearSelection: (surface) => set((state) => ({ viewports: { ...state.viewports, [surface]: { ...state.viewports[surface], selection: emptySelection() } } })),
    setViewport: (surface, patch) => set((state) => ({ viewports: { ...state.viewports, [surface]: { ...state.viewports[surface], ...patch } } })),
    zoomAt: (surface, pointerPx, factor, ticksPerBar) => set((state) => ({ viewports: { ...state.viewports, [surface]: { ...state.viewports[surface], ...zoomAroundPointer(state.viewports[surface], pointerPx, factor, ticksPerBar) } } })),
}));
