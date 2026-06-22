/**
 * DEFECT 1 (PERSIST-1) regression: a user-dropped sample's PCM must survive a
 * reload. We persist the decoded PCM as a REAL re-resolvable asset id (via the
 * project-library save path), store that id in node.data, and on remount the
 * round-trip re-resolves the id -> decodes -> setBuffer -> the engine has PCM
 * again. Before the fix, a `file:<name>:<ts>` id was stored whose PCM was NEVER
 * persisted, so on reload the node was silent (only the cached waveform polyline
 * survived — a "fake visual").
 *
 * This pins the round-trip end-to-end at the seam: `resolvePersistedSample` ->
 * the REAL `OjcoreSamplerHandle.setBuffer` -> the bridge's `loadSample` (the
 * engine-side PCM load). The library resolve + audio decode are mocked.
 */

import { describe, it, expect } from 'vitest';
import { OjcoreSamplerHandle, type OjcoreBridge } from '../ojcoreHandles';
import {
    resolvePersistedSample,
    isResolvableSampleId,
} from '../../../components/Nodes/samplerPersistence';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Spying bridge that records every PCM lowered into the engine via loadSample. */
function mockBridge(): { bridge: OjcoreBridge; loaded: Array<{ nodeId: string; len: number; sampleRate: number; rootNote: number }> } {
    const loaded: Array<{ nodeId: string; len: number; sampleRate: number; rootNote: number }> = [];
    const bridge: OjcoreBridge = {
        nodeIndex: () => 7,
        sendCommand: () => {},
        nodeLevel: () => 0,
        loadSample: (nodeId, pcm, sampleRate, rootNote) => {
            loaded.push({ nodeId, len: pcm.length, sampleRate, rootNote });
            return Promise.resolve();
        },
        startCapture: () => {},
        stopCapture: () => Promise.resolve(null),
    };
    return { bridge, loaded };
}

/** A minimal AudioBuffer stand-in (the handle only reads these fields). */
function fakeBuffer(len: number, sampleRate: number): AudioBuffer {
    return {
        numberOfChannels: 1,
        length: len,
        sampleRate,
        getChannelData: () => new Float32Array(len).fill(0.25),
    } as unknown as AudioBuffer;
}

/** A File stand-in whose bytes decode to a known buffer. */
function fakeFile(bytes: number): File {
    return {
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(bytes)),
    } as unknown as File;
}

// ---------------------------------------------------------------------------
// isResolvableSampleId — the persist/reload contract
// ---------------------------------------------------------------------------

describe('isResolvableSampleId', () => {
    it('a real library/persisted asset id is re-resolvable', () => {
        expect(isResolvableSampleId('a3f0c0de-1234-5678-9abc-def012345678')).toBe(true);
    });

    it('a throwaway file: id is NOT re-resolvable (its PCM was never persisted)', () => {
        expect(isResolvableSampleId('file:kick.wav:1700000000000')).toBe(false);
    });

    it('null / empty is not resolvable', () => {
        expect(isResolvableSampleId(null)).toBe(false);
        expect(isResolvableSampleId(undefined)).toBe(false);
        expect(isResolvableSampleId('')).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// resolvePersistedSample — the remount round-trip into the REAL engine handle
// ---------------------------------------------------------------------------

describe('resolvePersistedSample (DEFECT 1: user-PCM survives reload)', () => {
    it('a persisted asset id round-trips to setBuffer -> engine loadSample', async () => {
        const { bridge, loaded } = mockBridge();
        const sampler = new OjcoreSamplerHandle('sampler-1', bridge);

        const sampleRate = 48000;
        const decoded = fakeBuffer(128, sampleRate);
        const getFile = (_id: string) => Promise.resolve(fakeFile(256));
        const decode = (_bytes: ArrayBuffer) => Promise.resolve(decoded);

        const result = await resolvePersistedSample(
            'persisted-asset-id', // a REAL id, NOT file:-prefixed
            sampler,
            getFile,
            decode,
        );

        expect(result.kind).toBe('loaded');
        // The decoded buffer is installed on the handle...
        expect(sampler.getBuffer()).toBe(decoded);
        // ...and lowered into the engine (the proof the node will SOUND on reload).
        expect(loaded).toEqual([
            { nodeId: 'sampler-1', len: 128, sampleRate, rootNote: 60 },
        ]);
    });

    it('a legacy file: id is unresolved and NEVER touches the engine', async () => {
        const { bridge, loaded } = mockBridge();
        const sampler = new OjcoreSamplerHandle('sampler-1', bridge);

        let getFileCalled = false;
        const getFile = (_id: string) => {
            getFileCalled = true;
            return Promise.resolve(fakeFile(256));
        };
        const decode = (_bytes: ArrayBuffer) => Promise.resolve(fakeBuffer(64, 44100));

        const result = await resolvePersistedSample(
            'file:kick.wav:1700000000000',
            sampler,
            getFile,
            decode,
        );

        // It is reported unresolved (the caller flags ERR-1, a distinct dead slot)
        expect(result.kind).toBe('unresolved');
        // ...and short-circuits before any resolve / decode / engine load.
        expect(getFileCalled).toBe(false);
        expect(sampler.getBuffer()).toBeNull();
        expect(loaded).toHaveLength(0);
    });

    it('a re-resolvable id that no longer resolves to a file is unresolved (ERR-1)', async () => {
        const { bridge, loaded } = mockBridge();
        const sampler = new OjcoreSamplerHandle('sampler-1', bridge);

        const getFile = (_id: string) => Promise.resolve(null); // moved / permission gone
        const decode = (_bytes: ArrayBuffer) => Promise.resolve(fakeBuffer(64, 44100));

        const result = await resolvePersistedSample('persisted-asset-id', sampler, getFile, decode);

        expect(result.kind).toBe('unresolved');
        expect(sampler.getBuffer()).toBeNull();
        expect(loaded).toHaveLength(0);
    });

    it('a null sampleId is empty (no engine load)', async () => {
        const { bridge, loaded } = mockBridge();
        const sampler = new OjcoreSamplerHandle('sampler-1', bridge);

        const result = await resolvePersistedSample(
            null,
            sampler,
            () => Promise.resolve(null),
            () => Promise.resolve(fakeBuffer(1, 44100)),
        );

        expect(result.kind).toBe('empty');
        expect(loaded).toHaveLength(0);
    });
});
