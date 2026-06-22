/**
 * Sampler persistence round-trip (PERSIST-1, DEFECT 1 fix).
 *
 * A user-dropped / file-picked sample is persisted by routing its decoded PCM
 * through the SAME project-library save path that library and looper samples use
 * (`saveAudioToLibrary`), and storing the resulting REAL asset id in
 * `node.data.sampleId` — never the decoded bytes (so undo-history snapshots and
 * project size stay bounded). The throwaway `file:<name>:<ts>` id is only kept as
 * a live-only fallback when no project library exists.
 *
 * This module owns the single decision that turns a persisted `sampleId` back
 * into engine PCM on remount, so the rule lives ONCE and is unit-testable without
 * a DOM: a re-resolvable id (anything not `file:`-prefixed) is decoded and lowered
 * into the engine via `SamplerHandle.setBuffer`; a legacy `file:` id is reported
 * unresolvable because its PCM was never persisted.
 */

import type { SamplerHandle } from '../../audio/executor/capabilities';

/** A persisted sampleId is re-resolvable iff it is a REAL asset id (library item
 *  / a sample we wrote via saveAudioToLibrary) — i.e. NOT a throwaway `file:` id
 *  whose PCM was never stored. */
export function isResolvableSampleId(sampleId: string | null | undefined): boolean {
    return !!sampleId && !sampleId.startsWith('file:');
}

/** Result of trying to re-install a persisted sample's PCM into the engine. */
export type SampleResolution =
    /** PCM was decoded and lowered into the engine sampler this mount. */
    | { kind: 'loaded'; buffer: AudioBuffer }
    /** A re-resolvable id that no longer resolves to a file (moved/deleted/
     *  permission revoked), OR a legacy un-persisted `file:` id. Engine is silent
     *  → the caller flags ERR-1. */
    | { kind: 'unresolved' }
    /** Nothing to do (no id). */
    | { kind: 'empty' };

/**
 * Re-resolve a persisted `sampleId` to engine PCM and install it on `sampler`.
 *
 * This is the fix for the silent-on-reload bug: as long as the persisted id is a
 * real, re-resolvable asset, its PCM is decoded and pushed back into the engine
 * via `setBuffer` (which lowers mono PCM through the bridge's `loadSample`), so the
 * node SOUNDS again instead of being a silent waveform polyline.
 *
 * @param getFile resolves an asset id to its `File` (the library `getItemFile`),
 *                or null if it can no longer be resolved.
 * @param decode  decodes raw bytes to an AudioBuffer (the AudioContext decoder).
 */
export async function resolvePersistedSample(
    sampleId: string | null | undefined,
    sampler: Pick<SamplerHandle, 'setBuffer'>,
    getFile: (id: string) => Promise<File | null>,
    decode: (bytes: ArrayBuffer) => Promise<AudioBuffer>,
): Promise<SampleResolution> {
    if (!sampleId) return { kind: 'empty' };
    if (!isResolvableSampleId(sampleId)) {
        // Legacy throwaway id — its PCM was never persisted, so it cannot be
        // restored. The engine has no sample → unresolved (ERR-1 at the caller).
        return { kind: 'unresolved' };
    }

    const file = await getFile(sampleId);
    if (!file) return { kind: 'unresolved' };

    const bytes = await file.arrayBuffer();
    const buffer = await decode(bytes);
    sampler.setBuffer(buffer);
    return { kind: 'loaded', buffer };
}
