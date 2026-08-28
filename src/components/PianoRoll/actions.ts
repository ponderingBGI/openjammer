import { getExecutor } from '../../audio/executor';
import { conduct } from '../../song/conduct';
import { quantizeNotes } from '../../song/ops';
import { timebase } from '../../song/time';
import { useArrangementStore } from '../../store/arrangementStore';
import { gridTicks, useEditingContextStore } from '../../store/editingContextStore';

export function applyPianoRollQuantize(noteIds: readonly string[], surface: 'arrangement' | 'pianoroll' = 'pianoroll'): void {
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
    if (result.verbs.length) store.apply(result.verbs, { surface });
}

export type PianoRollAuditionToken = number;

interface AuditionVoice {
    readonly token: PianoRollAuditionToken;
    readonly trackRef: string;
    readonly targetNode: string | number;
    readonly pitch: number;
    timer: number | null;
    sounding: boolean;
}

let nextAuditionToken = 1;
const auditionVoices = new Map<PianoRollAuditionToken, AuditionVoice>();

function releaseAuditionVoice(voice: AuditionVoice, velocity: number): void {
    if (!auditionVoices.delete(voice.token)) return;
    if (voice.timer !== null) window.clearTimeout(voice.timer);
    if (voice.sounding) getExecutor().auditionNote(voice.targetNode, voice.pitch, velocity, false);
    if (auditionVoices.size === 0 && !useArrangementStore.getState().isPlaying) getExecutor().stopArrangementPreview();
}

/** Release one exact audition voice, including a pending native publication delay. */
export function releasePianoRollAudition(token: PianoRollAuditionToken, velocity = 0): void {
    const voice = auditionVoices.get(token);
    if (voice) releaseAuditionVoice(voice, velocity);
}

/** Terminal cleanup for a piano-roll close or unmount. Does not own transport. */
export function cancelPianoRollAuditions(): void {
    for (const voice of [...auditionVoices.values()]) releaseAuditionVoice(voice, 0);
}

export function auditionPianoRollNote(
    trackRef: string,
    pitch: number,
    velocity: number,
    phase: 'on' | 'off',
    token?: PianoRollAuditionToken,
): PianoRollAuditionToken | null {
    const store = useArrangementStore.getState();
    if (phase === 'off') {
        const voice = token === undefined
            ? [...auditionVoices.values()].find((candidate) => candidate.trackRef === trackRef && candidate.pitch === pitch)
            : auditionVoices.get(token);
        if (voice) releaseAuditionVoice(voice, velocity);
        return null;
    }

    const arrangement = store.arrangement;
    if (!arrangement || store.isPlaying) return null;
    const executor = getExecutor();
    const preview = conduct(arrangement, executor.getTimelineBackend(), { lenient: true });
    executor.updateArrangementPreview({ graph: preview.graph, tempoMap: preview.tempoMap, timeline: preview.timeline });
    const voiceToken = nextAuditionToken++;
    const voice: AuditionVoice = {
        token: voiceToken,
        trackRef,
        targetNode: preview.trackIndex[trackRef] ?? trackRef,
        pitch,
        timer: null,
        sounding: false,
    };
    auditionVoices.set(voiceToken, voice);
    // Web worklet publication is synchronous; native graph publication is async,
    // so let its command queue observe the graph before the direct live note.
    voice.timer = window.setTimeout(() => {
        voice.timer = null;
        if (!auditionVoices.has(voiceToken)) return;
        if (useArrangementStore.getState().isPlaying) {
            auditionVoices.delete(voiceToken);
            return;
        }
        voice.sounding = true;
        executor.auditionNote(voice.targetNode, pitch, Math.min(48, velocity), true);
    }, executor.getTimelineBackend() === 'native' ? 24 : 0);
    return voiceToken;
}
