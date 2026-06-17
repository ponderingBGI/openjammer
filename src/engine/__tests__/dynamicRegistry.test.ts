/**
 * Dynamic Plugin Registry (M5).
 *
 * Proves the OPEN identity space: register/get/has/unregister/list/subscribe and
 * the STABLE content hash that derives a dynamic id from a node's kernel. The
 * registry is the leaf the engine `registry.resolveNodeDefinition` reads from, so
 * its determinism is what makes identity survive sessions + reloads.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { NodeDefinition } from '../types';
import {
    registerDynamicPlugin,
    unregisterDynamicPlugin,
    getDynamicPlugin,
    hasDynamicPlugin,
    listDynamicPlugins,
    subscribe,
    shortHash,
    dspPluginIdFor,
    makeDspNodeDefinition,
    _resetDynamicRegistryForTests,
} from '../dynamicRegistry';

function fakeDef(name: string): NodeDefinition {
    return {
        type: 'effect',
        category: 'effects',
        name,
        description: `${name} (dynamic)`,
        defaultPorts: [],
        defaultData: {},
        canEnter: false,
    };
}

describe('dynamicRegistry', () => {
    beforeEach(() => {
        _resetDynamicRegistryForTests();
    });

    it('registers, gets, and reports has() for an open id', () => {
        expect(hasDynamicPlugin('ai.dsp.abc')).toBe(false);
        expect(getDynamicPlugin('ai.dsp.abc')).toBeUndefined();

        registerDynamicPlugin('ai.dsp.abc', fakeDef('Tape Echo'));

        expect(hasDynamicPlugin('ai.dsp.abc')).toBe(true);
        expect(getDynamicPlugin('ai.dsp.abc')?.name).toBe('Tape Echo');
    });

    it('returns an unregister that removes the entry', () => {
        const unregister = registerDynamicPlugin('ai.dsp.abc', fakeDef('Echo'));
        expect(hasDynamicPlugin('ai.dsp.abc')).toBe(true);

        unregister();
        expect(hasDynamicPlugin('ai.dsp.abc')).toBe(false);
    });

    it('unregisterDynamicPlugin removes by id (no-op if absent)', () => {
        registerDynamicPlugin('ai.dsp.x', fakeDef('X'));
        unregisterDynamicPlugin('ai.dsp.x');
        expect(hasDynamicPlugin('ai.dsp.x')).toBe(false);
        // No-op for an unknown id — must not throw.
        expect(() => unregisterDynamicPlugin('ai.dsp.unknown')).not.toThrow();
    });

    it('re-registering the same id replaces the prior def (idempotent)', () => {
        registerDynamicPlugin('ai.dsp.abc', fakeDef('Old'));
        registerDynamicPlugin('ai.dsp.abc', fakeDef('New'));
        expect(getDynamicPlugin('ai.dsp.abc')?.name).toBe('New');
        expect(listDynamicPlugins()).toHaveLength(1);
    });

    it('lists all registered plugins in registration order', () => {
        registerDynamicPlugin('ai.dsp.1', fakeDef('One'));
        registerDynamicPlugin('ai.dsp.2', fakeDef('Two'));
        const list = listDynamicPlugins();
        expect(list.map((e) => e.id)).toEqual(['ai.dsp.1', 'ai.dsp.2']);
        expect(list.map((e) => e.def.name)).toEqual(['One', 'Two']);
    });

    it('notifies subscribers on register and unregister; unsubscribe stops it', () => {
        let count = 0;
        const unsub = subscribe(() => {
            count += 1;
        });

        registerDynamicPlugin('ai.dsp.a', fakeDef('A')); // +1
        unregisterDynamicPlugin('ai.dsp.a'); // +1
        expect(count).toBe(2);

        unsub();
        registerDynamicPlugin('ai.dsp.b', fakeDef('B')); // no notification
        expect(count).toBe(2);
    });

    describe('shortHash determinism', () => {
        it('is stable for the same input across calls', () => {
            const src = 'process = _ : *(0.5);';
            expect(shortHash(src)).toBe(shortHash(src));
        });

        it('produces different hashes for different inputs', () => {
            expect(shortHash('process = _;')).not.toBe(shortHash('process = _ : *(2);'));
        });

        it('returns short lowercase hex', () => {
            const h = shortHash('anything');
            expect(h).toMatch(/^[0-9a-f]{1,8}$/);
        });

        it('dspPluginIdFor yields the SAME id for the SAME source', () => {
            const src = 'process = _ : fi.lowpass(1, 800);';
            expect(dspPluginIdFor(src)).toBe(dspPluginIdFor(src));
            expect(dspPluginIdFor(src)).toMatch(/^ai\.dsp\.[0-9a-f]{1,8}$/);
        });
    });

    it('makeDspNodeDefinition is effect-shaped and an opaque leaf', () => {
        const def = makeDspNodeDefinition({ name: 'Crusher', faustSource: 'process = _;' });
        expect(def.type).toBe('effect');
        expect(def.category).toBe('effects');
        expect(def.name).toBe('Crusher');
        expect(def.canEnter).toBe(false);
        // Carries the effect audio in/out port pair so it renders like an effect.
        expect(def.defaultPorts.map((p) => p.id)).toEqual(['audio-in', 'audio-out']);
    });
});
