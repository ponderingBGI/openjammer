/**
 * Built-in instrument voices (the playable-out-of-the-box layer).
 *
 * Melodic instrument nodes (Keys, Piano, Cello, Sax, …) lower to the engine's
 * `builtin.sampler` (see `src/engine/manifest.ts`), which is **silent until PCM
 * is bound**. The repo ships no sample assets, so without help a freshly-wired
 * `MiniLab → Keys → Speaker` patch produces no sound — the note routes correctly
 * but lands on an empty sampler.
 *
 * To make instruments playable immediately we SYNTHESIZE a distinct voice per
 * instrument (see {@link import('./voiceSynth')}) and the executors lower it into
 * each instrument node. A node that carries an `instrumentId` (the picker) gets
 * that instrument's family voice — a piano sounds like a piano, a sax like a sax —
 * and a bare category node gets a sensible default. A user who later binds a real
 * sample / SoundFont / plugin simply replaces the synthesized voice.
 *
 * This module is the thin executor-facing seam over the voice engine: the set of
 * node types that receive a built-in voice, plus the per-node resolver.
 */

import { INSTRUMENT_DEFINITIONS } from './instrumentCatalog';
import {
    getFamilyVoice,
    getInstrumentVoice,
    isKarplusFamily,
    resolveVoiceFamily,
    type SynthVoice,
    type VoiceFamily,
} from './voiceSynth';

/**
 * Instrument node types that receive a built-in voice when they have no
 * user-bound sample. The category aliases plus the generic `instrument` picker
 * (which resolves its voice from the selected `instrumentId`).
 */
export const DEFAULT_VOICE_INSTRUMENTS: ReadonlySet<string> = new Set([
    'keys',
    'piano',
    'cello',
    'electricCello',
    'violin',
    'saxophone',
    'strings',
    'winds',
    'instrument',
]);

/** A decoded mono voice ready to lower into the engine sampler. */
export type DefaultVoice = SynthVoice;

/** Catalogue lookup so a picker `instrumentId` resolves to its name + category. */
const CATALOG_BY_ID = new Map(INSTRUMENT_DEFINITIONS.map((d) => [d.id, d]));

/** The resolved {@link VoiceFamily} for an instrument node (picker id or type). */
function familyForNode(nodeType: string, data: Record<string, unknown> | undefined): VoiceFamily {
    const instrumentId = typeof data?.instrumentId === 'string' ? data.instrumentId : undefined;
    if (instrumentId) {
        const def = CATALOG_BY_ID.get(instrumentId);
        return resolveVoiceFamily(instrumentId, def?.name, def?.category);
    }
    return resolveVoiceFamily(nodeType);
}

/**
 * Whether an instrument node should be lowered to the engine's real Karplus
 * primitive (a plucked string / bass) instead of the additive sampler. Used by
 * BOTH the emit (to pick `KarplusString`) and the executors (to skip binding a
 * sample — Karplus is note-triggered and needs no PCM), so the two never disagree.
 */
export function instrumentUsesKarplus(
    nodeType: string,
    data: Record<string, unknown> | undefined,
): boolean {
    if (!DEFAULT_VOICE_INSTRUMENTS.has(nodeType)) return false;
    return isKarplusFamily(familyForNode(nodeType, data));
}

/**
 * The default voice (the warm `keys` family) — the back-compatible single-voice
 * accessor used where no specific instrument is in play.
 */
export function getDefaultInstrumentVoice(): DefaultVoice {
    return getFamilyVoice('keys');
}

/** The resolved voice for one instrument node + a stable cache KEY (its family). */
export interface NodeVoice {
    /** The synthesized PCM voice to bind into the engine sampler. */
    voice: DefaultVoice;
    /**
     * A stable key identifying WHICH voice this is (the resolved family). The
     * executors compare it against the last-bound key so a voice is only re-sent
     * when the instrument selection actually changes.
     */
    key: string;
}

/**
 * Resolve the built-in voice for an instrument node from its `type` and its
 * `data.instrumentId` (the picker selection). A node-type maps to a category
 * voice; an `instrumentId` refines it to the specific instrument's family.
 */
export function getVoiceForInstrumentNode(
    nodeType: string,
    data: Record<string, unknown> | undefined,
): NodeVoice {
    const instrumentId = typeof data?.instrumentId === 'string' ? data.instrumentId : undefined;
    if (instrumentId) {
        const def = CATALOG_BY_ID.get(instrumentId);
        const family = resolveVoiceFamily(instrumentId, def?.name, def?.category);
        return { voice: getInstrumentVoice(instrumentId, def?.name, def?.category), key: family };
    }
    // No picker selection: resolve a voice from the node TYPE itself (e.g. the
    // `cello` / `saxophone` category nodes), falling back to the warm default.
    const family = resolveVoiceFamily(nodeType);
    return { voice: getFamilyVoice(family), key: family };
}
