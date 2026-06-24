// src/song/project.ts — persist an Arrangement inside a .openjammer project and read
// it back losslessly. The engine's serialization carries it as an OPAQUE blob
// (SerializedWorkflow.arrangement) so a saved song keeps its WHOLE timeline (FROZEN-3)
// without the engine layer depending on the song layer; this module is where the song
// layer interprets that blob — and where the timeline GUI hydrates its store from.

import type { Arrangement } from './types';

/** Bump on a breaking change to the persisted Arrangement shape. */
export const ARRANGEMENT_SCHEMA_VERSION = 1;

/** Stamp the current schema version for export (the persisted form). */
export function arrangementForExport(arr: Arrangement): Arrangement {
    return { ...arr, schemaVersion: ARRANGEMENT_SCHEMA_VERSION };
}

/**
 * Read an Arrangement back from the opaque project blob, or `undefined` when it is
 * absent / not a recognizable arrangement / from an incompatible FUTURE major
 * version. A newer-than-known version is refused rather than mis-read, so an older
 * build opening a newer song keeps the flat graph and never crashes (held-note-beats-
 * a-glitch at the load surface — the project still opens).
 */
export function readArrangement(blob: unknown): Arrangement | undefined {
    if (blob === null || typeof blob !== 'object') return undefined;
    const a = blob as Partial<Arrangement>;
    // Minimal structural validation: the fields conduct() needs to lower it.
    if (typeof a.tempoBpm !== 'number' || a.graph == null || !Array.isArray(a.tracks)) {
        return undefined;
    }
    if ((a.schemaVersion ?? 1) > ARRANGEMENT_SCHEMA_VERSION) return undefined;
    return a as Arrangement;
}
