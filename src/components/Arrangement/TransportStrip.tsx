import { Button, ValueScrubber } from '@openjammer/oj-ui';
import { useArrangementStore } from '../../store/arrangementStore';
import { useEditingContextStore } from '../../store/editingContextStore';
import { timebase } from '../../song/time';

export function TransportStrip({ fieldWidth }: { fieldWidth: number }) {
    const arrangement = useArrangementStore((state) => state.arrangement);
    const isPlaying = useArrangementStore((state) => state.isPlaying);
    const loopEnabled = useArrangementStore((state) => state.loopEnabled);
    const undoCount = useArrangementStore((state) => state.undoStack.length);
    const redoCount = useArrangementStore((state) => state.redoStack.length);
    const pxPerTick = useEditingContextStore((state) => state.viewports.arrangement.pxPerTick);
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
                <Button title="Undo" disabled={!undoCount} onClick={() => useArrangementStore.getState().undo()}>↶</Button>
                <Button title="Redo" disabled={!redoCount} onClick={() => useArrangementStore.getState().redo()}>↷</Button>
            </div>
        </div>
    );
}
