/**
 * Load-time node-TYPE migrations (W6-P11).
 *
 * The registry once carried five fixed-voice instrument types — `piano`,
 * `cello`, `electricCello`, `violin`, `saxophone` — that were byte-for-byte
 * aliases of the generic `instrument` node: the same `PrimitiveKind`
 * (`Sampler`), the same internal structure, the same predicates in
 * `portSync` / `noteRouting` / `defaultInstrument`, the same faceplate. They
 * differed only by a `defaultData.offsets` integer and by which keyword
 * `resolveVoiceFamily` happened to hit on the TYPE STRING — both of which the
 * generic node already expresses better through `data.instrumentId`
 * (`defaultInstrument.familyForNode` keys on `instrumentId` and ignores the type
 * whenever one is present). Covenant #7/#8: the aliases are gone; nothing is
 * left behind but this migration.
 *
 * A saved session must never go silent, so every seam that reads a persisted
 * document rewrites those types to `instrument` on the way in and seeds the
 * catalogue id that reproduces the SAME voice family:
 *
 *   piano         -> gm-acoustic-grand-piano  (family `piano`)
 *   cello         -> gm-cello                 (family `strings`)
 *   electricCello -> gm-cello                 (family `strings`)
 *   violin        -> gm-violin                (family `strings`)
 *   saxophone     -> gm-alto-sax              (family `reed`)
 *
 * This map lives HERE, once, and there is no second copy to drift. Do NOT trust a
 * hand-written seam list in this comment — it already rotted once (it claimed
 * "four seams" while the persisted CLIPBOARD went unmigrated). **Every caller of
 * `migrateLegacyInstrumentNode` IS the seam list; grep it.** The five known today:
 * the graph store persist `getItem` (its `nodes` AND its `clipboard`),
 * `graphStore.loadGraph` (the door for project folders and crash recovery),
 * `serialization.importWorkflow`, and `collab/graphStoreBridge.applyRemoteSnapshot`.
 *
 * `store/__tests__/legacyInstrumentSeams.test.ts` drives a legacy node through all
 * five and fails loudly if a WIRED seam regresses. Be honest about its limit: no
 * cheap test detects a NEW, sixth seam. The durable fix is architectural — make
 * `loadGraph` the single door every document walks through — and that is a
 * follow-up, not this migration.
 */

/**
 * Legacy fixed-voice node type -> the catalogue `instrumentId` that reproduces
 * its timbre on the generic `instrument` node.
 *
 * The ids are the ones in `audio/instrumentCatalog.ts`; each was chosen so
 * `voiceSynth.resolveVoiceFamily` lands on the family the old TYPE STRING used
 * to resolve to, so a migrated node sounds like it always did.
 */
export const LEGACY_INSTRUMENT_ALIASES: Readonly<Record<string, string>> = {
    piano: 'gm-acoustic-grand-piano',
    cello: 'gm-cello',
    electricCello: 'gm-cello',
    violin: 'gm-violin',
    saxophone: 'gm-alto-sax',
};

/** The one type every legacy alias becomes. */
const INSTRUMENT_TYPE = 'instrument';

/** The minimum shape a migrated node has to expose — matches both the live
 *  `GraphNode` and the on-disk `SerializedNode`. */
interface MigratableNode {
    type: string;
    data?: Record<string, unknown>;
}

/**
 * Migrate ONE loaded node off a legacy fixed-voice type.
 *
 * PURE and idempotent: a node that is not a legacy alias is returned by
 * reference (so a healthy document allocates nothing and reloads byte-identical).
 * A legacy node comes back as a copy with `type: 'instrument'` and, when it does
 * not already carry a picker selection, `data.instrumentId` seeded from
 * {@link LEGACY_INSTRUMENT_ALIASES}. Everything else — `data.offsets`,
 * `activeInputs`, the node's PERSISTED PORTS and therefore its cables — is
 * carried through untouched.
 */
export function migrateLegacyInstrumentNode<T extends MigratableNode>(node: T): T {
    const instrumentId = LEGACY_INSTRUMENT_ALIASES[node.type];
    if (instrumentId === undefined) return node;

    const data = node.data ?? {};
    const hasSelection = typeof data.instrumentId === 'string' && data.instrumentId.length > 0;

    // The spread widens `type` to `string`, which is exactly the rewrite this
    // function exists to perform; the value is a real NodeType.
    return {
        ...node,
        type: INSTRUMENT_TYPE,
        data: hasSelection ? data : { ...data, instrumentId },
    } as T;
}
