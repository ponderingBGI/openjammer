import { getExecutor } from '../../audio/executor';
import { conduct } from '../../song/conduct';
import { quantizeNotes } from '../../song/ops';
import { timebase } from '../../song/time';
import { useArrangementStore } from '../../store/arrangementStore';
import { gridTicks, useEditingContextStore } from '../../store/editingContextStore';

export function applyPianoRollQuantize(noteIds: readonly string[]): void {
    const store = useArrangementStore.getState();
    const arrangement = store.arrangement;
    if (!arrangement || !noteIds.length) return;
    const editing = useEditingContextStore.getState();
    const tb = timebase(arrangement);
    const startGrid = gridTicks(editing.quantizeGrid, tb.ticksPerBeat, tb.ticksPerBar, editing.viewports.pianoroll.pxPerTick, true);
    if (!startGrid) return;
    const result = quantizeNotes(arrangement, noteIds, {
        startGrid,
        snapStart: editing.quantizeSnapStart,
        snapEnd: editing.quantizeSnapEnd,
        strength: editing.quantizeStrength,
        swing: editing.quantizeSwing,
        threshold: editing.quantizeThreshold,
        position: store.playheadTick,
    });
    if (result.verbs.length) store.apply(result.verbs);
}

let auditionPitch: number | null = null;
let auditionNode: number | null = null;

export function auditionPianoRollNote(trackRef: string, pitch: number, velocity: number, phase: 'on' | 'off'): void {
    const store = useArrangementStore.getState();
    const arrangement = store.arrangement;
    if (!arrangement || store.isPlaying) return;
    const executor = getExecutor();
    if (phase === 'off') {
        executor.auditionNote(auditionNode ?? trackRef, auditionPitch ?? pitch, velocity, false);
        auditionPitch = null;
        auditionNode = null;
        executor.stopArrangementPreview();
        return;
    }
    const preview = conduct(arrangement, executor.getTimelineBackend(), { lenient: true });
    executor.updateArrangementPreview({ graph: preview.graph, tempoMap: preview.tempoMap, timeline: preview.timeline });
    auditionPitch = pitch;
    auditionNode = preview.trackIndex[trackRef] ?? null;
    // Web worklet publication is synchronous; native graph publication is async,
    // so let its command queue observe the graph before the direct live note.
    window.setTimeout(() => {
        if (auditionPitch === pitch && !useArrangementStore.getState().isPlaying) {
            executor.auditionNote(auditionNode ?? trackRef, pitch, Math.min(48, velocity), true);
        }
    }, executor.getTimelineBackend() === 'native' ? 24 : 0);
}
