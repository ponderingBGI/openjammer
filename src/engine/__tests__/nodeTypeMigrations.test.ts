/**
 * W6-P11 · The one alias->instrumentId map, and the pure migration over it.
 *
 * Every one of these fails on the pre-P11 code for the same reason: there was no
 * migration at all — the five fixed-voice types were still registered, so a saved
 * `piano` stayed a `piano` forever and nothing ever seeded an `instrumentId`.
 */

import { describe, it, expect } from 'vitest';
import {
    LEGACY_INSTRUMENT_ALIASES,
    migrateLegacyInstrumentNode,
} from '../nodeTypeMigrations';
import { INSTRUMENT_DEFINITIONS } from '../../audio/instrumentCatalog';
import { resolveVoiceFamily } from '../../audio/voiceSynth';
import { KNOWN_PLUGIN_IDS } from '../types';
import { nodeDefinitions } from '../registry';

describe('LEGACY_INSTRUMENT_ALIASES', () => {
    it('covers exactly the five deleted fixed-voice types', () => {
        expect(Object.keys(LEGACY_INSTRUMENT_ALIASES).sort()).toEqual(
            ['cello', 'electricCello', 'piano', 'saxophone', 'violin'].sort(),
        );
    });

    it('names only types that are GONE from the registry (else the map is dead weight)', () => {
        for (const legacy of Object.keys(LEGACY_INSTRUMENT_ALIASES)) {
            expect(KNOWN_PLUGIN_IDS as readonly string[]).not.toContain(legacy);
            expect(nodeDefinitions).not.toHaveProperty(legacy);
        }
        // …and the type they all become is still real.
        expect(nodeDefinitions).toHaveProperty('instrument');
    });

    it('points at real catalogue instruments', () => {
        const ids = new Set(INSTRUMENT_DEFINITIONS.map((d) => d.id));
        for (const instrumentId of Object.values(LEGACY_INSTRUMENT_ALIASES)) {
            expect(ids.has(instrumentId), instrumentId).toBe(true);
        }
    });

    it('preserves the VOICE FAMILY the old node type used to resolve to', () => {
        // This is the whole point of the mapping: a migrated node must not change
        // timbre family. `resolveVoiceFamily` used to be fed the TYPE STRING; it is
        // now fed the seeded instrumentId + its catalogue name/category.
        const byId = new Map(INSTRUMENT_DEFINITIONS.map((d) => [d.id, d]));
        for (const [legacyType, instrumentId] of Object.entries(LEGACY_INSTRUMENT_ALIASES)) {
            const def = byId.get(instrumentId)!;
            expect(
                resolveVoiceFamily(instrumentId, def.name, def.category),
                `${legacyType} -> ${instrumentId}`,
            ).toBe(resolveVoiceFamily(legacyType));
        }
    });
});

describe('migrateLegacyInstrumentNode', () => {
    it('rewrites the type and seeds the instrumentId', () => {
        const migrated = migrateLegacyInstrumentNode({
            type: 'piano',
            data: { offsets: { 'input-1': 0 }, activeInputs: ['input-1'] },
        });
        expect(migrated.type).toBe('instrument');
        expect(migrated.data).toMatchObject({ instrumentId: 'gm-acoustic-grand-piano' });
    });

    it('carries data.offsets (the only thing the old defs actually differed by) through untouched', () => {
        const offsets = { 'input-1': -12, 'input-2': 7 };
        const migrated = migrateLegacyInstrumentNode({ type: 'cello', data: { offsets } });
        expect(migrated.data!.offsets).toEqual(offsets);
        expect(migrated.data).toMatchObject({ instrumentId: 'gm-cello' });
    });

    it('never overwrites a picker selection the player already made', () => {
        const migrated = migrateLegacyInstrumentNode({
            type: 'violin',
            data: { instrumentId: 'gm-flute' },
        });
        expect(migrated.type).toBe('instrument');
        expect(migrated.data).toMatchObject({ instrumentId: 'gm-flute' });
    });

    it('tolerates a node with no data at all', () => {
        const migrated = migrateLegacyInstrumentNode<{ type: string; data?: Record<string, unknown> }>({ type: 'saxophone' });
        expect(migrated.type).toBe('instrument');
        expect(migrated.data).toEqual({ instrumentId: 'gm-alto-sax' });
    });

    it('is idempotent and leaves every other node BY REFERENCE (a healthy doc allocates nothing)', () => {
        const once = migrateLegacyInstrumentNode({ type: 'piano', data: {} });
        const twice = migrateLegacyInstrumentNode(once);
        expect(twice).toBe(once);

        const keys = { type: 'keys', data: { offsets: {} } };
        expect(migrateLegacyInstrumentNode(keys)).toBe(keys);
        const speaker = { type: 'speaker', data: {} };
        expect(migrateLegacyInstrumentNode(speaker)).toBe(speaker);
    });

    it('does not mutate its input', () => {
        const node = { type: 'piano', data: { offsets: { 'input-1': 3 } } };
        migrateLegacyInstrumentNode(node);
        expect(node.type).toBe('piano');
        expect(node.data).not.toHaveProperty('instrumentId');
    });
});
