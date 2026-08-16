import { describe, expect, it } from 'vitest';
import type { CaptureResult } from '@openjammer/oj-protocol';
import type { Arrangement } from '../types';
import { captureResultToVerbs, pairCapturedNotes, punchRecordState, wasmTapToCapturedNote } from '../recording';

const arrangement = (): Arrangement => ({
    name: 'Record test', tempoBpm: 120, sampleRate: 48_000,
    graph: { nodes: [{ ref: 'keys', type: 'instrument' }, { ref: 'mic', type: 'microphone', data: { deviceId: 'line-in' } }] },
    tracks: [
        { id: 'midi-track', ref: 'keys', clips: [] },
        { id: 'audio-track', ref: 'mic', clips: [{ id: 'old', sourceId: 'src:audio:old', startTick: 100, lengthTick: 900, layerIndex: 2 }] },
    ],
    sources: { 'src:audio:old': { id: 'src:audio:old', kind: 'audio', name: 'old', assetId: 'old', frames: 100, sampleRate: 48_000, channels: 1 } },
});

const mint = () => { let n = 0; return (prefix: string) => `${prefix}-${++n}`; };

describe('Wave 7b capture mapping', () => {
    it('maps native segment/note ticks exactly into one atomic verb batch', () => {
        const result: CaptureResult = {
            take_id: 7, recovered: false,
            segments: [{ node: 9, asset: 0xabcd, start_sample: 1200, frames: 2400, start_tick: 240, length_ticks: 480, loop_index: 0, xruns: 0 }],
            notes: [
                { node: 4, note: 60, velocity: 101, on: true, tick: 300 },
                { node: 4, note: 60, velocity: 0, on: false, tick: 777 },
            ],
        };
        const verbs = captureResultToVerbs({
            arrangement: arrangement(), result, span: { startTick: 240, endTick: 960 }, mint: mint(),
            bindings: [
                { trackId: 'midi-track', ref: 'keys', node: 4, kind: 'midi', inputLabel: 'MIDI' },
                { trackId: 'audio-track', ref: 'mic', node: 9, kind: 'audio', inputLabel: 'line-in' },
            ],
        });
        const midiSource = verbs.find((verb) => verb.kind === 'addSource' && verb.source.kind === 'midi');
        expect(midiSource && midiSource.kind === 'addSource' && midiSource.source.kind === 'midi' ? midiSource.source.notes[0] : null)
            .toMatchObject({ tick: 60, durTick: 477, pitch: 60, vel: 101 });
        const clips = verbs.filter((verb) => verb.kind === 'addClip');
        expect(clips.map((verb) => verb.kind === 'addClip' ? [verb.clip.startTick, verb.clip.lengthTick] : null)).toEqual([[240, 720], [240, 480]]);
    });

    it('turns loop segments into ascending, topmost take layers', () => {
        const result: CaptureResult = { take_id: 8, recovered: false, notes: [], segments: [
            { node: 9, asset: 1, start_sample: 0, frames: 100, start_tick: 100, length_ticks: 400, loop_index: 0, xruns: 0 },
            { node: 9, asset: 2, start_sample: 100, frames: 100, start_tick: 100, length_ticks: 400, loop_index: 1, xruns: 0 },
        ] };
        const verbs = captureResultToVerbs({ arrangement: arrangement(), result, span: { startTick: 100, endTick: 500 }, mint: mint(), bindings: [{ trackId: 'audio-track', ref: 'mic', node: 9, kind: 'audio', inputLabel: 'line-in' }] });
        expect(verbs.filter((verb) => verb.kind === 'addClip').map((verb) => verb.kind === 'addClip' ? verb.clip.layerIndex : null)).toEqual([3, 4]);
    });

    it('uses truncate-existing semantics for repeated captured note-ons', () => {
        const notes = pairCapturedNotes([
            { node: 1, note: 64, velocity: 80, on: true, tick: 10 },
            { node: 1, note: 64, velocity: 90, on: true, tick: 20 },
            { node: 1, note: 64, velocity: 0, on: false, tick: 30 },
        ], { startTick: 0, endTick: 40 }, mint());
        expect(notes.map(({ tick, durTick, vel }) => ({ tick, durTick, vel }))).toEqual([{ tick: 10, durTick: 10, vel: 80 }, { tick: 20, durTick: 10, vel: 90 }]);
    });
});

describe('Wave 7b wasm and punch state', () => {
    it('records the routed wasm tap at the honest block-quantized tick', () => {
        expect(wasmTapToCapturedNote({ node: 3, note: 72, velocity: 99, on: true, atMs: 12.5 }, 480.49)).toEqual({ node: 3, note: 72, velocity: 99, on: true, tick: 480 });
    });

    it('dims armed record outside an enabled punch range', () => {
        const range = { startTick: 100, endTick: 200 };
        expect(punchRecordState(false, range, 50)).toBe('off');
        expect(punchRecordState(true, range, 150)).toBe('inside');
        expect(punchRecordState(true, range, 250)).toBe('outside');
    });
});

