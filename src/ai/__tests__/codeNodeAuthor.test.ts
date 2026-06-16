/**
 * Code-node authoring bridge (M6) — sync source fallback + async wasm upgrade.
 *
 * Proves `authorCodeNode`:
 *   - registers the source-fallback plugin SYNCHRONOUSLY (undo immediate),
 *   - upgrades to the compiled `ai.wasm.<hash>` node with the REAL params when the
 *     native `author_wasm_node` resolves,
 *   - keeps the fallback on a diagnostic (no faust / compile error / validation),
 *   - is fully REVERSIBLE: dispose tears down whatever is currently registered,
 *     including a dispose that races the async upgrade.
 *
 * All deps are injected, so this needs no Tauri / Zustand / DOM.
 */

import { describe, it, expect, vi } from 'vitest';
import {
    authorCodeNode,
    type AuthoredNodeResult,
    type CodeNodeAuthorDeps,
} from '../codeNodeAuthor';
import type { ParamDecl } from '../../engine/manifest';

/** A registry spy: records every register call + the live registration set. */
function makeRegistrySpy() {
    const live = new Map<string, { name: string; params: ParamDecl[] }>();
    const calls: { id: string; params: ParamDecl[] }[] = [];
    const register: CodeNodeAuthorDeps['register'] = (id, name, _source, params) => {
        live.set(id, { name, params });
        calls.push({ id, params });
        return {
            unregister: () => {
                live.delete(id);
            },
        };
    };
    return { live, calls, register };
}

const baseDeps = (
    overrides: Partial<CodeNodeAuthorDeps>,
): CodeNodeAuthorDeps => ({
    register: () => ({ unregister: () => {} }),
    sourcePluginId: (source) => `ai.dsp.${source.length}`,
    wasmPluginId: (hash) => `ai.wasm.${hash}`,
    invokeAuthor: null,
    parseManifestParams: () => [],
    ...overrides,
});

describe('authorCodeNode', () => {
    it('registers the source-fallback synchronously when no native invoke', () => {
        const spy = makeRegistrySpy();
        const reg = authorCodeNode(
            { name: 'Echo', source: 'process = _;' },
            baseDeps({ register: spy.register, invokeAuthor: null }),
        );
        const fallbackId = reg.pluginId;
        expect(fallbackId.startsWith('ai.dsp.')).toBe(true);
        expect(spy.live.has(fallbackId)).toBe(true);
        // Browser path: no params yet (source stored only).
        expect(spy.live.get(fallbackId)?.params).toEqual([]);

        reg.dispose();
        expect(spy.live.has(fallbackId)).toBe(false);
        // dispose is idempotent.
        expect(() => reg.dispose()).not.toThrow();
    });

    it('upgrades to the compiled ai.wasm node with the real params on native success', async () => {
        const spy = makeRegistrySpy();
        const params: ParamDecl[] = [{ id: 0, name: 'rate', min: 0.1, max: 20, default: 4 }];
        const result: AuthoredNodeResult = {
            manifestId: 'ai.wasm.deadbeef',
            manifestJson: JSON.stringify({ params }),
            wasmHash: 'deadbeef',
            nIn: 1,
            nOut: 1,
        };
        const invokeAuthor = vi.fn(async () => result);

        const reg = authorCodeNode(
            { name: 'Tremolo', source: 'process = _;' },
            baseDeps({
                register: spy.register,
                invokeAuthor,
                parseManifestParams: (json) => JSON.parse(json).params,
            }),
        );
        const fallbackId = reg.pluginId;
        // Synchronously: the source fallback is live.
        expect(spy.live.has(fallbackId)).toBe(true);

        // Let the async upgrade resolve.
        await vi.waitFor(() => expect(spy.live.has('ai.wasm.deadbeef')).toBe(true));
        // The fallback was dropped; identity follows the compiled artifact.
        expect(spy.live.has(fallbackId)).toBe(false);
        // The compiled node carries the REAL params.
        expect(spy.live.get('ai.wasm.deadbeef')?.params).toEqual(params);

        // Reverting tears down the compiled registration.
        reg.dispose();
        expect(spy.live.has('ai.wasm.deadbeef')).toBe(false);
    });

    it('keeps the source fallback when the native author returns a diagnostic', async () => {
        const spy = makeRegistrySpy();
        const invokeAuthor = vi.fn(async (): Promise<AuthoredNodeResult> => ({
            manifestId: '',
            manifestJson: '',
            wasmHash: '',
            nIn: 0,
            nOut: 0,
            diagnostic: 'faust not installed',
        }));

        const reg = authorCodeNode(
            { name: 'X', source: 'process = _;' },
            baseDeps({ register: spy.register, invokeAuthor }),
        );
        await Promise.resolve();
        await Promise.resolve();
        // No upgrade: only the source fallback remains.
        expect(spy.live.has(reg.pluginId)).toBe(true);
        expect([...spy.live.keys()]).toEqual([reg.pluginId]);
    });

    it('does not leak a registration when disposed before the upgrade resolves', async () => {
        const spy = makeRegistrySpy();
        const result: AuthoredNodeResult = {
            manifestId: 'ai.wasm.cafe',
            manifestJson: JSON.stringify({ params: [] }),
            wasmHash: 'cafe',
            nIn: 1,
            nOut: 1,
        };
        let resolveInvoke: (r: AuthoredNodeResult) => void = () => {};
        const invokeAuthor = vi.fn(
            () => new Promise<AuthoredNodeResult>((r) => (resolveInvoke = r)),
        );

        const reg = authorCodeNode(
            { name: 'Racey', source: 'process = _;' },
            baseDeps({
                register: spy.register,
                invokeAuthor,
                parseManifestParams: () => [],
            }),
        );
        // Dispose BEFORE the native author resolves.
        reg.dispose();
        expect(spy.live.size).toBe(0);

        // Now the upgrade resolves — it must not leak a live registration.
        resolveInvoke(result);
        await vi.waitFor(() => expect(invokeAuthor).toHaveBeenCalled());
        await Promise.resolve();
        await Promise.resolve();
        expect(spy.live.size).toBe(0);
    });
});
