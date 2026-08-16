import { SchedEventKind, type RtCommand, type SchedEvent, type TimedCommand } from '@openjammer/oj-protocol';
import type { Arrangement } from '../../song/types';
import { assembleExportArgs } from './exportSpec';
import type { BounceSpec, ExportProgress, ExportStats } from './types';
import { downloadWav, encodeWav24 } from './wavEncoder';

// Generated wasm-bindgen glue intentionally has no declaration file.
// @ts-expect-error generated module
import initWasm, * as wasm from '../../audio/wasm/pkg/ojcore_wasm.js';

const BLOCK = 128;
const encoder = new TextEncoder();

interface WasmExports { memory: WebAssembly.Memory }

function commandFor(event: SchedEvent): RtCommand {
    switch (event.kind) {
        case SchedEventKind.SET_PARAM:
            return { SetParam: { node: event.node, param: event.a | (event.b << 8), value: event.value } };
        case SchedEventKind.NOTE_OFF:
            return { NoteOff: { node: event.node, note: event.a } };
        case SchedEventKind.NOTE_ON:
        case SchedEventKind.SAMPLER_START:
            return { NoteOn: { node: event.node, note: event.a || 60, vel: event.b || 127 } };
    }
}

function pushFrame(exports: WasmExports, payload: Uint8Array): boolean {
    const base = wasm.cmd_ring_ptr() as number;
    const dataOffset = wasm.ring_data_offset() as number;
    const capacity = (wasm.cmd_ring_len() as number) - dataOffset;
    const view = new DataView(exports.memory.buffer);
    const writeOffset = wasm.ring_write_offset() as number;
    const readOffset = wasm.ring_read_offset() as number;
    const write = view.getUint32(base + writeOffset, true);
    const read = view.getUint32(base + readOffset, true);
    const frameLength = payload.length + 4;
    if (frameLength > capacity - ((write - read) >>> 0)) return false;
    const mask = capacity - 1;
    const dataBase = base + dataOffset;
    for (let index = 0; index < 4; index++) view.setUint8(dataBase + ((write + index) & mask), (payload.length >>> (index * 8)) & 0xff);
    for (let index = 0; index < payload.length; index++) view.setUint8(dataBase + ((write + 4 + index) & mask), payload[index]);
    view.setUint32(base + writeOffset, (write + frameLength) >>> 0, true);
    return true;
}

function pushJson(exports: WasmExports, value: RtCommand | TimedCommand): void {
    if (!pushFrame(exports, encoder.encode(JSON.stringify(value)))) throw new Error('Browser engine command queue filled during export.');
}

export async function exportBrowser(
    arrangement: Arrangement,
    spec: BounceSpec,
    filename: string,
    onProgress: (progress: ExportProgress) => void,
): Promise<ExportStats> {
    if (spec.format !== 'wav' || spec.bitDepth !== '24') throw new Error('Browser export currently writes 24-bit WAV only.');
    if (Object.values(arrangement.sources ?? {}).some((source) => source.kind === 'audio')) {
        throw new Error('Browser export cannot read arrangement audio clips yet. Use the desktop app for this song; MIDI and in-engine instruments export here.');
    }
    const args = assembleExportArgs(arrangement, spec, filename, 'wasm');
    const exports = await initWasm() as WasmExports;
    wasm.init(spec.sampleRate, BLOCK);
    if (!wasm.load_graph(encoder.encode(JSON.stringify(args.graph)))) throw new Error('The browser engine could not compile this song for export.');
    pushJson(exports, 'TransportPlay');

    const fixedFrames = spec.tail.mode === 'fixed' ? Math.round(spec.tail.seconds * spec.sampleRate) : 0;
    const baseFrames = args.timeline.end;
    const autoCap = spec.sampleRate * 30;
    const targetMax = baseFrames + (spec.tail.mode === 'auto' ? autoCap : fixedFrames);
    const totalBlocks = Math.ceil(targetMax / BLOCK);
    const quietNeeded = Math.ceil(spec.sampleRate * 0.25);
    const quietThreshold = 10 ** (-84 / 20);
    let quietFrames = 0;
    let eventIndex = 0;
    let rendered = 0;
    let peak = 0;
    let clipped = 0;
    const chunks: Float32Array[] = [];

    while (rendered < targetMax) {
        const frames = Math.min(BLOCK, targetMax - rendered);
        while (eventIndex < args.timeline.events.length && args.timeline.events[eventIndex]!.at < rendered + frames) {
            const event = args.timeline.events[eventIndex++]!;
            pushJson(exports, { at: event.at, cmd: commandFor(event) });
        }
        wasm.process(frames);
        const ptr = wasm.output_ptr() as number;
        const channels = wasm.output_channels() as number;
        const planar = new Float32Array(exports.memory.buffer, ptr, channels * BLOCK);
        const block = new Float32Array(frames * 2);
        let blockPeak = 0;
        for (let frame = 0; frame < frames; frame++) {
            for (let channel = 0; channel < 2; channel++) {
                const value = planar[Math.min(channel, channels - 1) * BLOCK + frame] ?? 0;
                block[frame * 2 + channel] = value;
                const absolute = Math.abs(value);
                peak = Math.max(peak, absolute);
                blockPeak = Math.max(blockPeak, absolute);
                if (absolute >= 0.999) clipped++;
            }
        }
        chunks.push(block);
        rendered += frames;
        if (spec.tail.mode === 'auto' && rendered >= baseFrames) {
            quietFrames = blockPeak < quietThreshold ? quietFrames + frames : 0;
            if (quietFrames >= quietNeeded) break;
        }
        if (chunks.length % 32 === 0 || rendered >= targetMax) {
            onProgress({ outPath: filename, blocksRendered: Math.ceil(rendered / BLOCK), totalBlocksEstimate: totalBlocks });
            await new Promise<void>((resolve) => setTimeout(resolve, 0));
        }
    }

    const interleaved = new Float32Array(rendered * 2);
    let at = 0;
    for (const chunk of chunks) { interleaved.set(chunk, at); at += chunk.length; }
    const bytes = encodeWav24(interleaved, spec.sampleRate, 2);
    downloadWav(bytes, `${filename}.wav`);
    return {
        path: `${filename}.wav`,
        maxSamplePeakDbfs: peak > 0 ? 20 * Math.log10(peak) : Number.NEGATIVE_INFINITY,
        clippedSampleCount: clipped,
        frames: rendered,
        sampleRate: spec.sampleRate,
        channels: 2,
    };
}
