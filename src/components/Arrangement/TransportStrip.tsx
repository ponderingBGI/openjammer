import { Button, ValueScrubber } from '@openjammer/oj-ui';
import { useArrangementStore } from '../../store/arrangementStore';
import { useEditingContextStore } from '../../store/editingContextStore';
import { timebase } from '../../song/time';
import { useHistoryStore } from '../../store/historyStore';
import { useTrackLaneViewStore } from '../../store/trackLaneViewStore';
import { LatencyWarningBanner } from '../LatencyWarningBanner';
import { punchRecordState } from '../../song/recording';

export function TransportStrip({ fieldWidth, onOpenSettings }: { fieldWidth: number; onOpenSettings?: () => void }) {
    const arrangement = useArrangementStore((state) => state.arrangement);
    const isPlaying = useArrangementStore((state) => state.isPlaying);
    const loopEnabled = useArrangementStore((state) => state.loopEnabled);
    const punchEnabled = useArrangementStore((state) => state.punchEnabled);
    const clickEnabled = useArrangementStore((state) => state.clickEnabled);
    const countInBars = useArrangementStore((state) => state.countInBars);
    const isRecording = useArrangementStore((state) => state.isRecording);
    const armedCount = useArrangementStore((state) => state.armedTrackIds.length);
    const recordError = useArrangementStore((state) => state.recordError);
    const playheadTick = useArrangementStore((state) => state.playheadTick);
    const canUndo = useHistoryStore((state) => state.cursor > 0);
    const canRedo = useHistoryStore((state) => state.cursor < state.entries.length);
    const pxPerTick = useEditingContextStore((state) => state.viewports.arrangement.pxPerTick);
    const editMode = useEditingContextStore((state) => state.editMode);
    const mixerOpen = useTrackLaneViewStore((state) => state.mixerOpen);
    if (!arrangement) return <div className="arrangement-transport" aria-hidden="true" />;
    const tb = timebase(arrangement);
    const visibleBars = Math.max(1, fieldWidth / (pxPerTick * tb.ticksPerBar));
    const punch = arrangement.locations?.find((location) => location.kind === 'punch' && location.endTick !== undefined);
    const insidePunch = punchRecordState(punchEnabled, punch, playheadTick) !== 'outside';
    return (
        <div className="arrangement-transport" aria-label="Arrangement transport">
            <div className="arrangement-transport__cluster">
                <Button className="arrangement-transport__play" title={isPlaying ? 'Stop' : 'Play'} onClick={() => {
                    const store = useArrangementStore.getState();
                    if (store.isPlaying) store.stop(); else store.play();
                }}>{isPlaying ? '■' : '▶'}</Button>
                <Button title="Return to start" onClick={() => useArrangementStore.getState().seek(0)}>↤</Button>
                <Button
                    aria-pressed={loopEnabled}
                    title={loopEnabled ? 'Disable loop' : 'Enable loop'}
                    onClick={() => useArrangementStore.getState().setLoopEnabled(!loopEnabled)}
                >↻</Button>
                <Button aria-pressed={punchEnabled} title={punch ? `${punchEnabled ? 'Disable' : 'Enable'} punch range` : 'Punch range is not set'} onClick={() => useArrangementStore.getState().setPunchEnabled(!punchEnabled)}>P</Button>
                <Button className={`arrangement-record${isRecording ? ' is-recording' : ''}${armedCount > 0 && !insidePunch ? ' is-outside-punch' : ''}`} aria-pressed={isRecording} title={isRecording ? 'Stop recording' : 'Record'} onClick={() => void useArrangementStore.getState().record()}><span aria-hidden="true" className="arrangement-record__dot" />{isRecording && <span className="arrangement-record__label">REC</span>}</Button>
                <Button aria-pressed={clickEnabled} title={`${clickEnabled ? 'Disable' : 'Enable'} click`} onClick={() => useArrangementStore.getState().setClick(!clickEnabled)}>♩</Button>
                <Button aria-pressed={countInBars > 0} title="Count-in: off, 1 bar, or 2 bars" onClick={() => useArrangementStore.getState().setCountIn(countInBars === 0 ? 1 : countInBars === 1 ? 2 : 0)}>C{countInBars || ''}</Button>
            </div>
            <div className="arrangement-transport__title">{arrangement.name}</div>
            <div className="arrangement-transport__cluster arrangement-transport__cluster--right">
                <div className="arrangement-transport__latency"><LatencyWarningBanner onOpenSettings={onOpenSettings} /></div>
                <div className="arrangement-edit-mode" role="group" aria-label="Edit mode">
                    <button type="button" aria-pressed={editMode === 'slide'} onClick={() => useEditingContextStore.getState().setEditMode('slide')}>Slide</button>
                    <button type="button" aria-pressed={editMode === 'ripple'} onClick={() => useEditingContextStore.getState().setEditMode('ripple')}>Ripple</button>
                </div>
                <Button aria-pressed={mixerOpen} title={mixerOpen ? 'Close mixer' : 'Open mixer'} onClick={() => useTrackLaneViewStore.getState().toggleMixer()}>Mix</Button>
                <Button title="Export song" disabled={isPlaying} onClick={() => window.dispatchEvent(new CustomEvent('openjammer:export-song'))}>Export</Button>
                <ValueScrubber
                    value={arrangement.tempoBpm}
                    display={`${arrangement.tempoBpm} BPM`}
                    aria-label="Tempo"
                    onCommit={(tempoBpm) => useArrangementStore.getState().apply({ kind: 'setTempo', tempoBpm })}
                />
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
                <Button title="Undo" disabled={!canUndo} onClick={() => useHistoryStore.getState().undo()}>↶</Button>
                <Button title="Redo" disabled={!canRedo} onClick={() => useHistoryStore.getState().redo()}>↷</Button>
            </div>
            {recordError && <div className="arrangement-record-error" role="status">{recordError}</div>}
            <div className="arrangement-record-live" aria-live="assertive" aria-atomic="true">{isRecording ? 'Recording started' : 'Recording stopped'}{recordError ? `. ${recordError}` : ''}</div>
        </div>
    );
}
