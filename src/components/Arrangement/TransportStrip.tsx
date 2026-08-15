import { Button, ValueScrubber } from '@openjammer/oj-ui';
import { useArrangementStore } from '../../store/arrangementStore';
import { useEditingContextStore } from '../../store/editingContextStore';
import { timebase } from '../../song/time';
import { useHistoryStore } from '../../store/historyStore';

export function TransportStrip({ fieldWidth }: { fieldWidth: number }) {
    const arrangement = useArrangementStore((state) => state.arrangement);
    const isPlaying = useArrangementStore((state) => state.isPlaying);
    const loopEnabled = useArrangementStore((state) => state.loopEnabled);
    const canUndo = useHistoryStore((state) => state.cursor > 0);
    const canRedo = useHistoryStore((state) => state.cursor < state.entries.length);
    const pxPerTick = useEditingContextStore((state) => state.viewports.arrangement.pxPerTick);
    const editMode = useEditingContextStore((state) => state.editMode);
    if (!arrangement) return <div className="arrangement-transport" aria-hidden="true" />;
    const tb = timebase(arrangement);
    const visibleBars = Math.max(1, fieldWidth / (pxPerTick * tb.ticksPerBar));
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
            </div>
            <div className="arrangement-transport__title">{arrangement.name}</div>
            <div className="arrangement-transport__cluster arrangement-transport__cluster--right">
                <div className="arrangement-edit-mode" role="group" aria-label="Edit mode">
                    <button type="button" aria-pressed={editMode === 'slide'} onClick={() => useEditingContextStore.getState().setEditMode('slide')}>Slide</button>
                    <button type="button" aria-pressed={editMode === 'ripple'} onClick={() => useEditingContextStore.getState().setEditMode('ripple')}>Ripple</button>
                </div>
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
        </div>
    );
}
