import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Arrangement } from '../../../song/types';
import type { BounceSpec } from '../types';

const engine = vi.hoisted(() => ({
    memory: new WebAssembly.Memory({ initial: 1 }),
    sounding: false,
    downloaded: new Uint8Array() as Uint8Array<ArrayBufferLike>,
}));

vi.mock('../../../audio/wasm/pkg/ojcore_wasm.js', () => {
    const ringBase = 0;
    const writeOffset = 0;
    const readOffset = 4;
    const dataOffset = 8;
    const capacity = 4096;
    const output = 8192;
    const encoderBlock = 128;
    return {
        default: vi.fn(async () => ({ memory: engine.memory })),
        init: vi.fn(() => {
            engine.sounding = false;
            new Uint8Array(engine.memory.buffer).fill(0);
        }),
        load_graph: vi.fn(() => true),
        cmd_ring_ptr: () => ringBase,
        cmd_ring_len: () => dataOffset + capacity,
        ring_data_offset: () => dataOffset,
        ring_write_offset: () => writeOffset,
        ring_read_offset: () => readOffset,
        output_ptr: () => output,
        output_channels: () => 2,
        process: vi.fn(() => {
            const view = new DataView(engine.memory.buffer);
            let read = view.getUint32(ringBase + readOffset, true);
            const write = view.getUint32(ringBase + writeOffset, true);
            const dataBase = ringBase + dataOffset;
            const mask = capacity - 1;
            while (read !== write) {
                let length = 0;
                for (let index = 0; index < 4; index++) length |= view.getUint8(dataBase + ((read + index) & mask)) << (index * 8);
                const payload = new Uint8Array(length);
                for (let index = 0; index < length; index++) payload[index] = view.getUint8(dataBase + ((read + 4 + index) & mask));
                const command = JSON.parse(new TextDecoder().decode(payload)) as unknown;
                // Match the committed browser engine: ordinary RtCommands are
                // consumed here; a {at, cmd} TimedCommand envelope is not.
                if (command && typeof command === 'object' && 'NoteOn' in command) engine.sounding = true;
                if (command && typeof command === 'object' && 'NoteOff' in command) engine.sounding = false;
                read = (read + 4 + length) >>> 0;
            }
            view.setUint32(ringBase + readOffset, read, true);
            const planar = new Float32Array(engine.memory.buffer, output, encoderBlock * 2);
            planar.fill(engine.sounding ? 0.25 : 0);
        }),
    };
});

vi.mock('../wavEncoder', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../wavEncoder')>();
    return {
        ...actual,
        downloadWav: vi.fn((bytes: Uint8Array) => { engine.downloaded = bytes; }),
    };
});

import { exportBrowser } from '../browserExport';

const arrangement: Arrangement = {
    name: 'offline unit',
    tempoBpm: 120,
    ppq: 960,
    graph: {
        nodes: [{ ref: 'keys', type: 'keys' }, { ref: 'speaker', type: 'speaker' }],
        connections: [{ from: 'keys', to: 'speaker' }],
    },
    sources: {
        notes: { id: 'notes', kind: 'midi', name: 'notes', lengthTick: 960, notes: [{ tick: 0, durTick: 480, pitch: 60, vel: 100 }] },
    },
    tracks: [{ ref: 'keys', clips: [{ sourceId: 'notes', startTick: 0, lengthTick: 960 }] }],
};

const spec: BounceSpec = {
    sampleRate: 48_000,
    bitDepth: '24',
    format: 'wav',
    tail: { mode: 'fixed', seconds: 0 },
};

describe('browser offline export', () => {
    beforeEach(() => { engine.downloaded = new Uint8Array(); });

    it('dispatches scheduled events as render-loop RtCommands and produces audible PCM', async () => {
        const stats = await exportBrowser(arrangement, spec, 'offline-unit', () => {});
        expect(stats.maxSamplePeakDbfs).toBeGreaterThan(-48);
        expect(engine.downloaded.byteLength).toBeGreaterThan(44);
        expect(engine.downloaded.subarray(44).some((byte) => byte !== 0)).toBe(true);
    });
});
