/**
 * W6-P10 · Registry reachability invariant.
 *
 * `menuCategories` is the ONE list both add-a-node surfaces read: the canvas
 * right-click menu (`ContextMenu.tsx`, which orders and icons the same six
 * buckets) and the Ctrl+K palette (`useCommandSources.buildNodeActions`, which
 * mints one `node.add.<type>` Action per item). The in-app agent reads it too
 * (`ai/graphAdapter.ts`). A registered node type that appears in NO bucket is
 * therefore shipped DSP that no user, and no agent, can ever place — which is
 * exactly what happened to `pan` and `width` (W5-P6-REVIEW F5).
 *
 * This test is the guard that would have caught them. It is deliberately
 * TOTAL: every registered type must be accounted for, either by a menu bucket
 * or by an explicit, reasoned entry in {@link INTERNAL_ONLY} below. Adding a
 * type to the registry without doing one or the other fails here.
 *
 * NOT node types, and so not expected here: `audio-in` / `audio-out` /
 * `bundle-in` / `pedal` / `row-N` are PORT ids (the MASTER-PLAN's "40 node
 * types" miscounted two of them as types; the union has 36).
 */

import { describe, it, expect } from 'vitest';
import { menuCategories, nodeDefinitions } from '../registry';
import { KNOWN_PLUGIN_IDS, type NodeCategory, type NodeType } from '../types';

/**
 * Every registered type that is deliberately NOT offered on an add-a-node
 * surface, with the reason it is unreachable by design. If a type here ever
 * becomes user-placeable, move it into a `menuCategories` bucket — do not add a
 * second list.
 */
const INTERNAL_ONLY: Record<string, string> = {
    // ── Interior mirrors ────────────────────────────────────────────────────
    // The "-visual" types are the INSIDE face of a container the player already
    // placed. They are synthesised when the container is entered; placing one at
    // the top level would be a faceplate with nothing behind it.
    'instrument-visual': 'interior mirror of an instrument container; synthesised on enter',
    'midi-visual': 'interior mirror of a MIDI device container; synthesised on enter',
    'minilab3-visual': 'interior mirror of the MiniLab 3 container; synthesised on enter',
    'sampler-visual': 'interior mirror of the Sampler container; synthesised on enter',

    // ── Parts a container builds, never a node the player drops ──────────────
    'canvas-input': 'level boundary: the interior handle for a parent input port',
    'canvas-output': 'level boundary: the interior handle for a parent output port',
    'input-panel': 'published-port panel a container creates for itself',
    'output-panel': 'published-port panel a container creates for itself',

    // ── Hardware identity, added by the device browser ───────────────────────
    'minilab-3': 'a MIDI device preset — reached by picking the hardware in the MIDI browser, not by name',

    // ── Programmatic / legacy identities kept so old documents still load ────
    // `instrument` is the generic voice-by-id node the RIGS build directly
    // (`src/rigs/presets.ts`); the menu offers the three family aliases
    // (Strings / Keys / Winds) instead so there is one obvious "add an
    // instrument" row rather than two. Not the agent: its add-a-node vocabulary
    // is this same `menuCategories` list, so it cannot place `instrument` either.
    instrument: 'generic voice-by-instrumentId; placed by the rigs, fronted in the menu by strings|keys|winds',
    // `keyboard-key` has no producer at all: a keyboard container's interior is
    // ONE `keyboard-visual` carrying 31 per-key ports (`nodeInternals
    // .createKeyboardInternals`), not 31 nodes. Nothing in the app has ever
    // minted one — a stronger covenant-#8 case than the five voices below,
    // which at least deserialize from old saves.
    'keyboard-key': 'dead type — nothing produces one: the keyboard container mints a single keyboard-visual with 31 per-key PORTS; deletion candidate (covenant #8)',
    // The five fixed-voice types predate the family aliases. They stay
    // registered ONLY so a workflow saved before the alias migration still
    // deserializes. Covenant #8 says a type nobody can reach and nothing
    // produces should be deleted — flagged for the owner (COVERAGE.md).
    piano: 'legacy fixed voice — load-only, superseded by keys; deletion candidate (covenant #8)',
    cello: 'legacy fixed voice — load-only, superseded by strings; deletion candidate (covenant #8)',
    electricCello: 'legacy fixed voice — load-only, superseded by strings; deletion candidate (covenant #8)',
    violin: 'legacy fixed voice — load-only, superseded by strings; deletion candidate (covenant #8)',
    saxophone: 'legacy fixed voice — load-only, superseded by winds; deletion candidate (covenant #8)',
};

/** Menu bucket name -> the `NodeCategory` its members must all declare. */
const BUCKET_CATEGORY: Record<string, NodeCategory> = {
    Input: 'input',
    Instruments: 'instruments',
    Routing: 'routing',
    Effects: 'effects',
    Utility: 'utility',
    Output: 'output',
};

const menuItems = menuCategories.flatMap((category) => category.items);

/**
 * The registered types, taken from the registry itself.
 *
 * `nodeDefinitions` is `Record<NodeType, NodeDefinition>`, so its key set is the
 * whole union by construction — the type system will not let a member go
 * missing. `KNOWN_PLUGIN_IDS` is a hand-maintained array whose
 * `satisfies readonly NodeType[]` only proves its members are IN the union,
 * never that they cover it; iterating it would let a new type added to the union
 * and the registry but forgotten in the array slip past this guard entirely.
 */
const registeredTypes = Object.keys(nodeDefinitions) as NodeType[];

describe('menuCategories — every shipped node type is reachable or deliberately internal', () => {
    it('lists each type in exactly one category', () => {
        const seen = new Map<NodeType, number>();
        for (const type of menuItems) seen.set(type, (seen.get(type) ?? 0) + 1);
        const duplicated = [...seen].filter(([, count]) => count > 1).map(([type]) => type);
        expect(duplicated).toEqual([]);
    });

    it('offers only registered types', () => {
        const unregistered = menuItems.filter((type) => !(type in nodeDefinitions));
        expect(unregistered).toEqual([]);
    });

    it('accounts for every registered type — reachable, or documented as internal', () => {
        const reachable = new Set<string>(menuItems);
        const orphans = registeredTypes.filter(
            (type) => !reachable.has(type) && !(type in INTERNAL_ONLY),
        );
        // A failure here means a registered, sounding node type can be placed by
        // nobody. Put it in a `menuCategories` bucket, or document WHY it is
        // internal in INTERNAL_ONLY above.
        expect(orphans).toEqual([]);
    });

    it('keeps KNOWN_PLUGIN_IDS equal to the registry, so the hand list cannot drift', () => {
        // The guard above is total because it walks the registry. This one keeps
        // the runtime id list — what the registry validates deserialized strings
        // against — from silently falling behind that same set.
        expect([...KNOWN_PLUGIN_IDS].sort()).toEqual([...registeredTypes].sort());
    });

    it('keeps INTERNAL_ONLY honest: no stale ids, no type both internal and offered', () => {
        const known = new Set<string>(registeredTypes);
        expect(Object.keys(INTERNAL_ONLY).filter((type) => !known.has(type))).toEqual([]);
        expect(Object.keys(INTERNAL_ONLY).filter((type) => menuItems.includes(type as NodeType))).toEqual([]);
        expect(Object.values(INTERNAL_ONLY).every((reason) => reason.length > 20)).toBe(true);
    });

    it('puts each type in the bucket its own `category` names', () => {
        // The right-click menu groups by the bucket name; the palette groups by
        // `def.category`. When they disagree, one node lands in two different
        // places on the two surfaces.
        const mismatched = menuCategories.flatMap((bucket) =>
            bucket.items
                .filter((type) => nodeDefinitions[type]?.category !== BUCKET_CATEGORY[bucket.name])
                .map((type) => `${type} (${nodeDefinitions[type]?.category}) in ${bucket.name}`),
        );
        expect(mismatched).toEqual([]);
    });

    it('offers the two stereo stages — the F5 regression', () => {
        // `pan` and `width` are real engine effects that the sound-design and
        // pro rigs already install; before W6-P10 no user could place either.
        const effects = menuCategories.find((category) => category.name === 'Effects');
        expect(effects?.items).toContain('pan');
        expect(effects?.items).toContain('width');
    });
});
