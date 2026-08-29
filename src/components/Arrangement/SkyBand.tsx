import { Button, Chip, Kbd, ValueScrubber } from '@openjammer/oj-ui';
import { useArrangementStore } from '../../store/arrangementStore';
import { useEditingContextStore } from '../../store/editingContextStore';
import { timebase } from '../../song/time';
import { useTrackLaneViewStore } from '../../store/trackLaneViewStore';
import { usePluginFaultCards } from '../../store/pluginFaultStore';

/**
 * THE SKY BAND — 56px of surface chrome above the ruler.
 *
 * Three zones, and the middle one is empty on purpose: the ONE floating
 * transport pill sits there. Reserving this band is how a ruled surface keeps
 * the pill from ever covering a bar, so the pill's position rule can stay
 * identical on the canvas, the arrangement and the piano roll.
 *
 * Left is WHERE YOU ARE: the song's name and the `Tab` keycap that takes you
 * back to the canvas. Right is WHAT THIS SURFACE CAN DO — and only what is
 * genuinely arrangement-scoped.
 *
 * **Undo / redo are deliberately absent.** They are document-scoped, they are
 * already in the topbar 46px above this line, and `Ctrl+Z` reaches them from
 * anywhere. A second copy of a control is exactly what "extend, don't fork"
 * forbids, and two more buttons cost attention on a stage.
 *
 * Grid, magnet, the tool strip and follow-playhead live in the ruler's 200×64
 * corner instead (spec 2.3) — they belong beside the ruled field they act on,
 * not up here with the song's identity.
 *
 * Errors are CHIPS in this cluster, never a modal and never a banner that
 * shoves the ruler down: a failed take must not move the bar you were reading.
 */
export function SkyBand({ fieldWidth }: { fieldWidth: number; onOpenSettings?: () => void }) {
    const arrangement = useArrangementStore((state) => state.arrangement);
    const punchEnabled = useArrangementStore((state) => state.punchEnabled);
    const isPlaying = useArrangementStore((state) => state.isPlaying);
    const isRecording = useArrangementStore((state) => state.isRecording);
    const recordError = useArrangementStore((state) => state.recordError);
    const transportError = useArrangementStore((state) => state.transportError);
    const pxPerTick = useEditingContextStore((state) => state.viewports.arrangement.pxPerTick);
    const editMode = useEditingContextStore((state) => state.editMode);
    const mixerOpen = useTrackLaneViewStore((state) => state.mixerOpen);
    const faults = usePluginFaultCards();
    if (!arrangement) return <div className="arrangement-sky" aria-hidden="true" />;
    const tb = timebase(arrangement);
    const visibleBars = Math.max(1, fieldWidth / (pxPerTick * tb.ticksPerBar));
    const punch = arrangement.locations?.find((location) => location.kind === 'punch' && location.endTick !== undefined);
    return (
        <div className="arrangement-sky" aria-label="Arrangement tools">
            <div className="arrangement-sky__identity">
                <span className="arrangement-sky__name" title={arrangement.name}>{arrangement.name}</span>
                <span className="arrangement-sky__hint"><Kbd>Tab</Kbd>canvas</span>
            </div>
            <div className="arrangement-sky__gap" aria-hidden="true" />
            <div className="arrangement-sky__utility">
                {faults.length > 0 && <Chip className="arrangement-sky__alert" tone="warning" role="status">{faults.length} plugin benched</Chip>}
                {transportError && <Chip className="arrangement-sky__alert" tone="warning" role="status">{transportError}</Chip>}
                {recordError && <Chip className="arrangement-sky__alert" tone="danger" role="status">{recordError}</Chip>}
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
            <div className="arrangement-record-live" aria-live="assertive" aria-atomic="true">{isRecording ? 'Recording started' : 'Recording stopped'}{recordError ? `. ${recordError}` : ''}</div>
        </div>
    );
}
