import { expect, type CDPSession, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export const PERF_BUDGETS = {
    coldOpenMs: {
        limit: 3_000,
        unit: 'ms',
        rationale: 'Doctrine J8 interaction target; roughly 2× the expected macro-runner baseline leaves cold-start headroom without hiding a doubled regression.',
    },
    scrollP95Ms: {
        limit: 16.7,
        unit: 'ms',
        rationale: 'One 60 Hz refresh interval: the full-page virtualization sweep should normally present every frame.',
    },
    zoomP95Ms: {
        limit: 33,
        unit: 'ms',
        rationale: 'Pointer-centred zoom may spend two 60 Hz frames rebuilding ruler/grid geometry, but not more.',
    },
    dragMaxMs: {
        limit: 50,
        unit: 'ms',
        rationale: 'A preview hitch longer than three 60 Hz frames is directly perceptible while holding a clip.',
    },
    playheadDroppedFrames: {
        limit: 0,
        unit: 'frames',
        rationale: 'A five-second rolling playhead is continuous work; any missed presentation marker is a useful Ring 3 finding.',
    },
} as const;

interface TraceEvent {
    name?: string;
    ph?: string;
    pid?: number;
    tid?: number;
    ts?: number;
}

export interface FrameStats {
    marker: string;
    frameCount: number;
    intervalCount: number;
    p50Ms: number;
    p95Ms: number;
    maxMs: number;
    droppedFrames: number;
    explicitDroppedFrameMarkers: number;
}

const TRACE_CATEGORIES = [
    'benchmark',
    'cc',
    'devtools.timeline',
    'disabled-by-default-devtools.timeline.frame',
    'toplevel',
    'viz',
].join(',');

const PRESENTATION_MARKERS = ['DrawFrame', 'BeginFrame', 'RequestMainThreadFrame'] as const;
const DROPPED_MARKERS = new Set(['DroppedFrame', 'FrameDropped', 'MissedFrame']);

const round = (value: number): number => Number(value.toFixed(3));

function percentile(sorted: readonly number[], fraction: number): number {
    if (!sorted.length) return 0;
    return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)]!;
}

function frameStream(events: readonly TraceEvent[]): { marker: string; timestamps: number[] } {
    for (const marker of PRESENTATION_MARKERS) {
        const byThread = new Map<string, number[]>();
        for (const event of events) {
            if (event.name !== marker || typeof event.ts !== 'number') continue;
            const key = `${event.pid ?? 0}:${event.tid ?? 0}`;
            const stream = byThread.get(key) ?? [];
            stream.push(event.ts);
            byThread.set(key, stream);
        }
        const best = [...byThread.values()].sort((a, b) => b.length - a.length)[0];
        if (best && best.length > 1) return { marker, timestamps: [...new Set(best)].sort((a, b) => a - b) };
    }
    return { marker: 'none', timestamps: [] };
}

export function computeFrameStats(events: readonly TraceEvent[]): FrameStats {
    const { marker, timestamps } = frameStream(events);
    const intervals = timestamps.slice(1).map((timestamp, index) => (timestamp - timestamps[index]!) / 1_000).filter((value) => value > 0);
    const sorted = [...intervals].sort((a, b) => a - b);
    const inferredDrops = intervals.reduce((total, interval) => total + Math.max(0, Math.round(interval / (1_000 / 60)) - 1), 0);
    const explicitDrops = events.filter((event) => event.name && DROPPED_MARKERS.has(event.name)).length;
    return {
        marker,
        frameCount: timestamps.length,
        intervalCount: intervals.length,
        p50Ms: round(percentile(sorted, 0.5)),
        p95Ms: round(percentile(sorted, 0.95)),
        maxMs: round(sorted.at(-1) ?? 0),
        droppedFrames: Math.max(inferredDrops, explicitDrops),
        explicitDroppedFrameMarkers: explicitDrops,
    };
}

async function readProtocolStream(session: CDPSession, handle: string): Promise<string> {
    let result = '';
    for (;;) {
        const chunk = await session.send('IO.read', { handle }) as { data: string; base64Encoded?: boolean; eof?: boolean };
        result += chunk.base64Encoded ? Buffer.from(chunk.data, 'base64').toString('utf8') : chunk.data;
        if (chunk.eof) break;
    }
    await session.send('IO.close', { handle });
    return result;
}

export async function traceFrames<T>(page: Page, tracePath: string, action: () => Promise<T>): Promise<{ result: T; stats: FrameStats }> {
    const session = await page.context().newCDPSession(page);
    await session.send('Tracing.start', {
        transferMode: 'ReturnAsStream',
        traceConfig: { recordMode: 'recordContinuously', includedCategories: TRACE_CATEGORIES.split(',') },
    });
    let result!: T;
    let actionError: unknown;
    try {
        result = await action();
    } catch (error) {
        actionError = error;
    }
    const complete = new Promise<string>((resolve) => session.once('Tracing.tracingComplete', (event) => resolve((event as { stream: string }).stream)));
    await session.send('Tracing.end');
    const raw = await readProtocolStream(session, await complete);
    await session.detach();
    await mkdir(dirname(tracePath), { recursive: true });
    await writeFile(tracePath, raw);
    if (actionError) throw actionError;
    const parsed = JSON.parse(raw) as { traceEvents?: TraceEvent[] } | TraceEvent[];
    const events = Array.isArray(parsed) ? parsed : parsed.traceEvents ?? [];
    return { result, stats: computeFrameStats(events) };
}

export function expectAtMost(actual: number, budget: keyof typeof PERF_BUDGETS, details: string): void {
    const target = PERF_BUDGETS[budget];
    expect(
        actual,
        `${budget} exceeded: ${actual}${target.unit} > ${target.limit}${target.unit}. ${details}\nBudget rationale: ${target.rationale}`,
    ).toBeLessThanOrEqual(target.limit);
}
