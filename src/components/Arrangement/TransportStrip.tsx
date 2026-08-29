import { Button, ValueScrubber } from '@openjammer/oj-ui';
import { useArrangementStore } from '../../store/arrangementStore';
import { useEditingContextStore } from '../../store/editingContextStore';
import { timebase } from '../../song/time';
import { useTrackLaneViewStore } from '../../store/trackLaneViewStore';

/**
 * The ruled surfaces' UTILITY row.
 *
 * Everything about TIME left this strip in Wave 4: play/stop, return-to-start,
 * record, loop, the click and its count-in, the bar.beat readout and the tempo
 * now live in the ONE floating {@link TransportPill}, which is identical on the
 * canvas, the arrangement and the piano roll. Undo/redo moved to the topbar (they
 * are document-scoped, not time-scoped), and the latency warning became a chip in
 * the topbar's status cluster instead of a banner colliding with this row.
 *
 * What is left is genuinely arrangement-only: the song's name, the edit mode, the
 * mixer and export doors, the timeline's zoom, and punch — which is a RANGE on
 * the ruler rather than a transport state, and belongs beside the thing it marks.
 * The lane rebuilding the arrangement owns where these finally sit (the sky
 * band's utility cluster); this keeps every capability reachable until then.
 */
export function TransportStrip({ fieldWidth }: { fieldWidth: number; onOpenSettings?: () => void }) {
    const arrangement = useArrangementStore((state) => state.arrangement);
    const punchEnabled = useArrangementStore((state) => state.punchEnabled);
    const isPlaying = useArrangementStore((state) => state.isPlaying);
    const isRecording = useArrangementStore((state) => state.isRecording);
    const recordError = useArrangementStore((state) => state.recordError);
    const transportError = useArrangementStore((state) => state.transportError);
    const pxPerTick = useEditingContextStore((state) => state.viewports.arrangement.pxPerTick);
    const editMode = useEditingContextStore((state) => state.editMode);
    const mixerOpen = useTrackLaneViewStore((state) => state.mixerOpen);
    if (!arrangement) return <div className="arrangement-transport" aria-hidden="true" />;
    const tb = timebase(arrangement);
    const visibleBars = Math.max(1, fieldWidth / (pxPerTick * tb.ticksPerBar));
    const punch = arrangement.locations?.find((location) => location.kind === 'punch' && location.endTick !== undefined);
    return (
        <div className="arrangement-transport" aria-label="Arrangement tools">
            <div className="arrangement-transport__title">{arrangement.name}</div>
            <div className="arrangement-transport__cluster arrangement-transport__cluster--right">
                <div className="arrangement-edit-mode" role="group" aria-label="Edit mode">
                    <button type="button" aria-pressed={editMode === 'slide'} onClick={() => useEditingContextStore.getState().setEditMode('slide')}>Slide</button>
                    <button type="button" aria-pressed={editMode === 'ripple'} onClick={() => useEditingContextStore.getState().setEditMode('ripple')}>Ripple</button>
                </div>
                <Button aria-pressed={punchEnabled} title={punch ? `${punchEnabled ? 'Disable' : 'Enable'} punch range` : 'Punch range is not set'} onClick={() => useArrangementStore.getState().setPunchEnabled(!punchEnabled)}>P</Button>
                <Button aria-pressed={mixerOpen} title={mixerOpen ? 'Close mixer' : 'Open mixer'} onClick={() => useTrackLaneViewStore.getState().toggleMixer()}>Mix</Button>
                <Button title="Export song" disabled={isPlaying} onClick={() => window.dispatchEvent(new CustomEvent('openjammer:export-song'))}>Export</Button>
                <ValueScrubber
                    className="arrangement-zoom-scrubber"
                    value={visibleBars}
                    display={`${Math.round(visibleBars)} bars`}
                    aria-label="Timeline width in bars"
                    onCommit={(bars) => {
                        const next = Math.max(1, bars);
                        useEditingContextStore.getState().setViewport('arrangement', {
                            pxPerTick: fieldWidth / (next * tb.ticksPerBar),
                        });
                    }}
                />
            </div>
            {recordError && <div className="arrangement-record-error" role="status">{recordError}</div>}
            {transportError && <div className="arrangement-record-error" role="status">{transportError}</div>}
            <div className="arrangement-record-live" aria-live="assertive" aria-atomic="true">{isRecording ? 'Recording started' : 'Recording stopped'}{recordError ? `. ${recordError}` : ''}</div>
        </div>
    );
}
