import { create } from 'zustand';
import type { SurfaceId } from './uiViewStore';

export type GridUnit = 'none' | 'adaptive' | 'bar' | 'beat' | '1/2' | '1/3' | '1/4' | '1/5' | '1/6' | '1/7' | '1/8' | '1/10' | '1/12' | '1/14' | '1/16' | '1/20' | '1/24' | '1/28' | '1/32' | '1/8t';
export type SnapMode = 'off' | 'magnetic';
export type SnapTarget = 'grid' | 'other' | 'both';
export type EditMode = 'slide' | 'ripple' | 'lock';
export type RippleScope = 'selected' | 'all' | 'interview';
export type ZoomFocus = 'mouse' | 'playhead' | 'center';
export type NoteOverlapPolicy = 'relax' | 'reject' | 'replace' | 'truncate-existing' | 'truncate-addition' | 'extend';

export interface StepEntryState {
    trackId: string | null;
    positionTick: number;
    length: GridUnit;
    velocity: number;
    channel: number;
    octave: number;
    chordMode: boolean;
    triplet: boolean;
    dotted: boolean;
    sustain: boolean;
    pitch: number;
}

export interface ObjectSelection {
    clipIds: string[];
    noteIds: string[];
    trackIds: string[];
    sectionIds: string[];
    automationPointIds: string[];
    timeRange: TimeRangeSelection | null;
}

export interface TimeRangeSelection {
    fromTick: number;
    toTick: number;
    trackIds: string[];
}

export type SelectionSnapshot = ObjectSelection;

export interface SurfaceViewport {
    pxPerTick: number;
    leftTick: number;
    yOrigin: number;
    zoomFocus: ZoomFocus;
    tool: 'select' | 'draw';
    selection: ObjectSelection;
}

const DEFAULT_PX_PER_TICK = 38.75 / (960 * 4);
export const emptySelection = (): ObjectSelection => ({ clipIds: [], noteIds: [], trackIds: [], sectionIds: [], automationPointIds: [], timeRange: null });
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
    quantizeStrength: number;
    quantizeSwing: number;
    quantizeThreshold: number;
    quantizeSnapStart: boolean;
    quantizeSnapEnd: boolean;
    overlapPolicy: NoteOverlapPolicy;
    scrollVelocityEditing: boolean;
    selectLastDrawnNoteOnly: boolean;
    stepEntry: StepEntryState;
    nudgeAmount: GridUnit;
    timeDomain: 'beats' | 'samples';
    /** Clipboard contents live in clipboardStore; this field remains only as a migration seam. */
    clipboard: never[];
    enteredTrackId: string | null;
    enteredClipId: string | null;
    lastPointerTick: number | null;
    selectionHistory: SelectionSnapshot[];
    selectionHistoryIndex: number;
    selectionOpDepth: number;
    selectionOpBefore: SelectionSnapshot | null;
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
    beginSelectionOp: (surface: SurfaceId) => void;
    commitSelectionOp: (surface: SurfaceId) => void;
    beginSelectionOpHistory: (surface?: SurfaceId) => void;
    undoSelection: (surface: SurfaceId) => void;
    redoSelection: (surface: SurfaceId) => void;
    setViewport: (surface: SurfaceId, patch: Partial<SurfaceViewport>) => void;
    zoomAt: (surface: SurfaceId, pointerPx: number, factor: number, ticksPerBar: number) => void;
    setQuantize: (patch: Partial<Pick<EditingContextState, 'quantizeGrid' | 'quantizeStrength' | 'quantizeSwing' | 'quantizeThreshold' | 'quantizeSnapStart' | 'quantizeSnapEnd'>>) => void;
    setStepEntry: (patch: Partial<StepEntryState>) => void;
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
    quantizeStrength: 100,
    quantizeSwing: 0,
    quantizeThreshold: 0,
    quantizeSnapStart: true,
    quantizeSnapEnd: false,
    overlapPolicy: 'truncate-existing',
    scrollVelocityEditing: true,
    selectLastDrawnNoteOnly: true,
    stepEntry: { trackId: null, positionTick: 0, length: '1/16', velocity: 96, channel: 1, octave: 4, chordMode: false, triplet: false, dotted: false, sustain: false, pitch: 60 },
    nudgeAmount: '1/16',
    timeDomain: 'beats',
    clipboard: [],
    enteredTrackId: null,
    enteredClipId: null,
    lastPointerTick: null,
    selectionHistory: [emptySelection()],
    selectionHistoryIndex: 0,
    selectionOpDepth: 0,
    selectionOpBefore: null,
    dragActive: false,
    followPlayhead: false,
    followEdits: false,
    moveAutomationWithClips: true,
    viewports: { canvas: makeViewport(), arrangement: makeViewport(), pianoroll: makeViewport() },
    setGridUnit: (gridUnit) => set({ gridUnit }),
    toggleSnap: () => set((state) => ({ snapMode: state.snapMode === 'magnetic' ? 'off' : 'magnetic' })),
    setSnapTarget: (snapTarget) => set({ snapTarget }),
    setEditMode: (editMode) => set({ editMode }),
    setDragActive: (dragActive) => set({ dragActive }),
    setSelection: (surface, patch) => set((state) => {
        const current = state.viewports[surface].selection;
        const hasObjects = Boolean((patch.clipIds?.length ?? 0) || (patch.noteIds?.length ?? 0) || (patch.automationPointIds?.length ?? 0));
        const selection = { ...current, ...patch };
        if (patch.timeRange) {
            selection.clipIds = [];
            selection.noteIds = [];
            selection.automationPointIds = [];
            selection.sectionIds = [];
        } else if (hasObjects) selection.timeRange = null;
        return { viewports: { ...state.viewports, [surface]: { ...state.viewports[surface], selection } } };
    }),
    clearSelection: (surface) => set((state) => ({ viewports: { ...state.viewports, [surface]: { ...state.viewports[surface], selection: emptySelection() } } })),
    beginSelectionOp: (surface) => set((state) => ({
        selectionOpDepth: state.selectionOpDepth + 1,
        selectionOpBefore: state.selectionOpDepth === 0 ? structuredClone(state.viewports[surface].selection) : state.selectionOpBefore,
    })),
    commitSelectionOp: (surface) => set((state) => {
        if (state.selectionOpDepth === 0) return {};
        if (state.selectionOpDepth > 1) return { selectionOpDepth: state.selectionOpDepth - 1 };
        const current = structuredClone(state.viewports[surface].selection);
        const top = state.selectionHistory[state.selectionHistoryIndex];
        if (top && JSON.stringify(top) === JSON.stringify(current)) return { selectionOpDepth: 0, selectionOpBefore: null };
        const kept = state.selectionHistory.slice(state.selectionHistoryIndex);
        return { selectionOpDepth: 0, selectionOpBefore: null, selectionHistory: [current, ...kept].slice(0, 100), selectionHistoryIndex: 0 };
    }),
    beginSelectionOpHistory: (surface = 'arrangement') => set((state) => ({
        selectionHistory: [structuredClone(state.viewports[surface].selection)],
        selectionHistoryIndex: 0,
        selectionOpDepth: 0,
        selectionOpBefore: null,
    })),
    undoSelection: (surface) => set((state) => {
        const index = Math.min(state.selectionHistory.length - 1, state.selectionHistoryIndex + 1);
        const selection = state.selectionHistory[index];
        return selection ? { selectionHistoryIndex: index, viewports: { ...state.viewports, [surface]: { ...state.viewports[surface], selection: structuredClone(selection) } } } : {};
    }),
    redoSelection: (surface) => set((state) => {
        const index = Math.max(0, state.selectionHistoryIndex - 1);
        const selection = state.selectionHistory[index];
        return selection ? { selectionHistoryIndex: index, viewports: { ...state.viewports, [surface]: { ...state.viewports[surface], selection: structuredClone(selection) } } } : {};
    }),
    setViewport: (surface, patch) => set((state) => ({ viewports: { ...state.viewports, [surface]: { ...state.viewports[surface], ...patch } } })),
    zoomAt: (surface, pointerPx, factor, ticksPerBar) => set((state) => ({ viewports: { ...state.viewports, [surface]: { ...state.viewports[surface], ...zoomAroundPointer(state.viewports[surface], pointerPx, factor, ticksPerBar) } } })),
    setQuantize: (patch) => set(patch),
    setStepEntry: (patch) => set((state) => ({ stepEntry: { ...state.stepEntry, ...patch } })),
}));
