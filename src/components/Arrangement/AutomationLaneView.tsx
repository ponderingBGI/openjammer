import { useMemo, useRef, useState, type PointerEvent } from 'react';
import { SegmentedControl, Select } from '@openjammer/oj-ui';
import { addressableTrackParams, descriptorForLane, evaluateAutomation } from '../../song/automation';
import { moveAutomationPoints, setAutomationRange } from '../../song/ops';
import type { Arrangement, ArrangementTrack, AutomationLane, AutomationPoint } from '../../song/types';
import { useArrangementStore } from '../../store/arrangementStore';

export const AUTOMATION_LANE_HEIGHT = 96;
const LANE_HEIGHT = AUTOMATION_LANE_HEIGHT;

export function AutomationLaneView({ arrangement, track, lane, pxPerTick }: { arrangement: Arrangement; track: ArrangementTrack; lane: AutomationLane; pxPerTick: number }) {
    const descriptor = descriptorForLane(arrangement, lane);
    const params = useMemo(() => addressableTrackParams(arrangement, track), [arrangement, track]);
    const paramGroups = useMemo(() => [...new Set(params.map((param) => param.label.group))], [params]);
    const playheadTick = useArrangementStore((state) => state.playheadTick);
    const fieldRef = useRef<HTMLDivElement>(null);
    const drag = useRef<{ arrangement: Arrangement; startX: number; startY: number; point: AutomationPoint; push: boolean; scale: number } | null>(null);
    const rangeDrag = useRef<{ arrangement: Arrangement; startY: number; points: AutomationPoint[]; from: number; to: number } | null>(null);
    const [range, setRange] = useState<{ from: number; to: number } | null>(null);
    if (!descriptor || !lane.id) return null;
    const span = descriptor.max - descriptor.min || 1;
    const yFor = (value: number) => 8 + (1 - (value - descriptor.min) / span) * (LANE_HEIGHT - 16);
    const tickAt = (event: Pick<PointerEvent, 'clientX'>) => {
        const rect = fieldRef.current!.getBoundingClientRect();
        return Math.max(0, Math.round((event.clientX - rect.left) / pxPerTick));
    };
    const valueAt = (clientY: number) => {
        const rect = fieldRef.current!.getBoundingClientRect();
        return descriptor.min + (1 - Math.max(0, Math.min(1, (clientY - rect.top - 8) / (LANE_HEIGHT - 16)))) * span;
    };
    const path = lane.points.length ? [...lane.points].sort((a, b) => a.tick - b.tick).map((point, index) => {
        const x = point.tick * pxPerTick;
        const y = yFor(point.value);
        if (index === 0) return `M ${x} ${y}`;
        return lane.interp === 'Linear' ? `L ${x} ${y}` : `H ${x} V ${y}`;
    }).join(' ') : '';
    const live = evaluateAutomation(lane.points, playheadTick, lane.interp) ?? descriptor.default;
    return (
        <>
            <div className="arrangement-automation__header">
                <Select aria-label={`Parameter for ${track.name ?? track.ref} automation`} value={`${lane.ref}:${lane.param}`} onChange={(event) => {
                    const selected = params.find((param) => `${param.ref}:${param.id}` === event.target.value);
                    if (selected) useArrangementStore.getState().apply({ kind: 'setAutomationLaneTarget', laneId: lane.id!, ref: selected.ref, param: selected.id });
                }}>
                    {paramGroups.map((group) => <optgroup key={group} label={group}>{params.filter((param) => param.label.group === group).map((param) => <option key={`${param.ref}:${param.id}`} value={`${param.ref}:${param.id}`}>{param.label.name}</option>)}</optgroup>)}
                </Select>
                <span className="arrangement-automation__value">{live.toFixed(descriptor.unit === 'dB' ? 1 : 2)}{descriptor.unit === 'dB' ? ' dB' : ''}</span>
                <SegmentedControl className="arrangement-automation__state" aria-label={`${descriptor.label.name} automation state`} value={lane.state ?? 'Play'} options={[{ value: 'Off', label: 'Off' }, { value: 'Play', label: 'Play' }]} onChange={(state) => useArrangementStore.getState().apply({ kind: 'setAutomationLaneState', laneId: lane.id!, state })} />
                <SegmentedControl className="arrangement-automation__interp" aria-label={`${descriptor.label.name} interpolation`} value={lane.interp ?? 'Discrete'} options={[{ value: 'Discrete', label: 'Step' }, { value: 'Linear', label: 'Linear' }]} onChange={(interp) => useArrangementStore.getState().apply({ kind: 'setAutomationLaneInterp', laneId: lane.id!, interp })} />
            </div>
            <div
                ref={fieldRef}
                className="arrangement-automation__field"
                onDoubleClick={(event) => {
                    if ((event.target as HTMLElement).closest('.arrangement-automation__point')) return;
                    useArrangementStore.getState().apply({ kind: 'setAutomationPoint', laneId: lane.id!, point: { tick: tickAt(event), value: valueAt(event.clientY) } });
                }}
                onPointerDown={(event) => {
                    if (!event.shiftKey || event.button !== 0 || (event.target as HTMLElement).closest('.arrangement-automation__point')) return;
                    const tick = tickAt(event);
                    setRange({ from: tick, to: tick });
                    event.currentTarget.setPointerCapture(event.pointerId);
                }}
                onPointerMove={(event) => {
                    if (event.currentTarget.hasPointerCapture(event.pointerId) && range && !rangeDrag.current) setRange({ from: range.from, to: tickAt(event) });
                }}
            >
                <span className="arrangement-automation__default" aria-hidden="true" style={{ top: yFor(descriptor.default) }} />
                <svg className="arrangement-automation__curve" aria-hidden="true"><path d={path} /></svg>
                {lane.points.map((point) => <button
                    key={point.tick}
                    type="button"
                    className="arrangement-automation__point"
                    aria-label={`${descriptor.label.name} at tick ${point.tick}: ${point.value}`}
                    style={{ left: point.tick * pxPerTick, top: yFor(point.value) }}
                    onKeyDown={(event) => {
                        if (event.key === 'Delete' || event.key === 'Backspace') {
                            event.preventDefault();
                            useArrangementStore.getState().apply({ kind: 'removeAutomationPoint', laneId: lane.id!, tick: point.tick });
                        }
                    }}
                    onPointerDown={(event) => {
                        event.stopPropagation();
                        event.currentTarget.setPointerCapture(event.pointerId);
                        const primary = event.ctrlKey || event.metaKey;
                        drag.current = { arrangement, startX: event.clientX, startY: event.clientY, point, push: primary && event.shiftKey, scale: primary ? event.shiftKey ? 0.01 : 0.1 : 1 };
                        useArrangementStore.getState().beginGesture('Move automation point');
                    }}
                    onPointerMove={(event) => {
                        const start = drag.current;
                        if (!start) return;
                        const result = moveAutomationPoints(start.arrangement, lane.id!, [start.point.tick], Math.round((event.clientX - start.startX) / pxPerTick * start.scale), (start.startY - event.clientY) / (LANE_HEIGHT - 16) * span * start.scale, start.push);
                        useArrangementStore.getState().previewGesture(result.verbs);
                    }}
                    onPointerUp={() => { drag.current = null; useArrangementStore.getState().commitGesture(); }}
                    onPointerCancel={() => { drag.current = null; useArrangementStore.getState().abortGesture(); }}
                />)}
                {range && <button
                    type="button"
                    className="arrangement-automation__range"
                    aria-label={`Automation range ${Math.min(range.from, range.to)} to ${Math.max(range.from, range.to)}`}
                    style={{ left: Math.min(range.from, range.to) * pxPerTick, width: Math.max(2, Math.abs(range.to - range.from) * pxPerTick) }}
                    onPointerDown={(event) => {
                        event.stopPropagation();
                        const from = Math.min(range.from, range.to);
                        const to = Math.max(range.from, range.to);
                        rangeDrag.current = { arrangement, startY: event.clientY, points: lane.points.filter((point) => point.tick >= from && point.tick <= to), from, to };
                        event.currentTarget.setPointerCapture(event.pointerId);
                        useArrangementStore.getState().beginGesture('Adjust automation range');
                    }}
                    onPointerMove={(event) => {
                        const start = rangeDrag.current;
                        if (!start) return;
                        const delta = (start.startY - event.clientY) / (LANE_HEIGHT - 16) * span;
                        const points = start.points.map((point) => ({ ...point, value: point.value + delta }));
                        useArrangementStore.getState().previewGesture(setAutomationRange(start.arrangement, lane.id!, start.from, start.to, points).verbs);
                    }}
                    onPointerUp={() => { rangeDrag.current = null; useArrangementStore.getState().commitGesture(); }}
                    onPointerCancel={() => { rangeDrag.current = null; useArrangementStore.getState().abortGesture(); }}
                />}
            </div>
        </>
    );
}
