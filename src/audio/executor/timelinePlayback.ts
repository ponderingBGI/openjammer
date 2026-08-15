import type {
    EngineFrame,
    OjGraph,
    RtCommand,
    TempoMap,
    TimedCommand,
    Timeline,
} from '@openjammer/oj-protocol';

export type TransportFrame = Extract<EngineFrame, { Transport: unknown }>['Transport'];
export type TransportFrameCallback = (frame: TransportFrame) => void;

export interface ArrangementPlayback {
    graph: OjGraph;
    tempoMap: TempoMap;
    timeline: Timeline;
}

export interface TimelineBytes {
    tempoMap: Uint8Array;
    timeline: Uint8Array;
}

const encoder = new TextEncoder();

/** The single JSON lowering used by both executor publication paths. */
export function encodeTimelineDocuments(
    tempoMap: TempoMap,
    timeline: Timeline,
): TimelineBytes {
    return {
        tempoMap: encoder.encode(JSON.stringify(tempoMap)),
        timeline: encoder.encode(JSON.stringify(timeline)),
    };
}

/** Route complete latest-value transport snapshots from a mixed frame batch. */
export function routeTransportFrames(
    frames: readonly EngineFrame[],
    callbacks: ReadonlySet<TransportFrameCallback>,
): void {
    if (callbacks.size === 0) return;
    for (const frame of frames) {
        if (!('Transport' in frame)) continue;
        for (const callback of callbacks) callback(frame.Transport);
    }
}

export function encodeTimedCommand(at: number, cmd: RtCommand): Uint8Array {
    const timed: TimedCommand = { at, cmd };
    return encoder.encode(JSON.stringify(timed));
}

export function isRollingMotion(motion: number): boolean {
    return motion === 1 || motion === 3 || motion === 4;
}
