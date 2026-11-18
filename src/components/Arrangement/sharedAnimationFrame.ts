type FrameWriter = (now: number) => void;

const writers = new Set<FrameWriter>();
let frame: number | null = null;

function paint(now: number): void {
    for (const writer of [...writers]) writer(now);
    frame = writers.size ? requestAnimationFrame(paint) : null;
}

/** One surface clock for playhead, recording feedback, meters, and level beads. */
export function registerTimelineFrameWriter(writer: FrameWriter): () => void {
    writers.add(writer);
    writer(globalThis.performance?.now() ?? Date.now());
    if (frame === null) frame = requestAnimationFrame(paint);
    return () => {
        writers.delete(writer);
        if (writers.size === 0 && frame !== null) {
            cancelAnimationFrame(frame);
            frame = null;
        }
    };
}

export function timelineFrameWriterCountForTests(): number { return writers.size; }
