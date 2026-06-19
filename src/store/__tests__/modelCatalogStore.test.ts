/**
 * Model + slash-command catalog cache. Pins the two disciplines that keep
 * "instant" from ever showing a WRONG result: an opaque fingerprint that
 * discards a stale catalog when the provider config changes (but NOT when only a
 * secret key value changes), and slim model blobs that never persist base URLs.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
    catalogFingerprint,
    slimModel,
    useModelCatalogStore,
} from '../modelCatalogStore';
import type { PiModel } from '../../ai/piSessions';

describe('catalogFingerprint', () => {
    it('is stable for identical inputs', () => {
        const a = catalogFingerprint({ providerKeys: { anthropic: 'k1' }, provider: 'anthropic' });
        const b = catalogFingerprint({ providerKeys: { anthropic: 'k1' }, provider: 'anthropic' });
        expect(a).toBe(b);
    });

    it('does NOT change when only a secret key VALUE changes (no secret in the buster)', () => {
        const a = catalogFingerprint({ providerKeys: { anthropic: 'secret-one' } });
        const b = catalogFingerprint({ providerKeys: { anthropic: 'secret-two' } });
        expect(a).toBe(b);
    });

    it('changes when the SET of configured providers changes', () => {
        const a = catalogFingerprint({ providerKeys: { anthropic: 'k' } });
        const b = catalogFingerprint({ providerKeys: { anthropic: 'k', openai: 'k' } });
        expect(a).not.toBe(b);
    });

    it('changes when base URLs, custom models, or active provider change', () => {
        const base = catalogFingerprint({ providerKeys: { openai: 'k' } });
        expect(catalogFingerprint({ providerKeys: { openai: 'k' }, providerBaseUrls: { openai: 'https://x' } })).not.toBe(base);
        expect(catalogFingerprint({ providerKeys: { openai: 'k' }, providerCustomModels: { openai: ['m'] } })).not.toBe(base);
        expect(catalogFingerprint({ providerKeys: { openai: 'k' }, provider: 'openai' })).not.toBe(base);
    });

    it('treats an empty/unconfigured config as a stable key', () => {
        expect(catalogFingerprint({})).toBe(catalogFingerprint({ providerKeys: {} }));
    });
});

describe('slimModel', () => {
    it('keeps identity fields and drops everything else (no api / base URL)', () => {
        const full: PiModel = {
            provider: 'openai',
            id: 'gpt-4o',
            name: 'GPT-4o',
            reasoning: true,
            api: 'https://api.openai.com/v1',
            extra: 'nope',
        };
        expect(slimModel(full)).toEqual({ provider: 'openai', id: 'gpt-4o', name: 'GPT-4o', reasoning: true });
    });

    it('omits absent optional fields', () => {
        expect(slimModel({ provider: 'p', id: 'i' })).toEqual({ provider: 'p', id: 'i' });
    });
});

describe('useModelCatalogStore (SWR by fingerprint)', () => {
    beforeEach(() => {
        useModelCatalogStore.setState({
            models: [],
            modelsBuster: null,
            commands: [],
            commandsBuster: null,
        });
    });

    it('returns models only for the matching fingerprint, slimmed', () => {
        const store = useModelCatalogStore.getState();
        store.setModels('buster-1', [
            { provider: 'openai', id: 'gpt-4o', name: 'GPT-4o', api: 'leak', reasoning: true },
        ]);
        expect(useModelCatalogStore.getState().modelsFor('buster-1')).toEqual([
            { provider: 'openai', id: 'gpt-4o', name: 'GPT-4o', reasoning: true },
        ]);
        // A changed config (different buster) discards the stale catalog.
        expect(useModelCatalogStore.getState().modelsFor('buster-2')).toEqual([]);
    });

    it('caches and busts dynamic commands independently', () => {
        const store = useModelCatalogStore.getState();
        store.setCommands('b', [{ name: 'deploy', source: 'extension' }]);
        expect(useModelCatalogStore.getState().commandsFor('b')).toHaveLength(1);
        expect(useModelCatalogStore.getState().commandsFor('other')).toEqual([]);

        useModelCatalogStore.getState().clearCommands();
        expect(useModelCatalogStore.getState().commandsFor('b')).toEqual([]);
        // clearCommands leaves the model cache intact.
        useModelCatalogStore.getState().setModels('b', [{ provider: 'p', id: 'i' }]);
        useModelCatalogStore.getState().clearCommands();
        expect(useModelCatalogStore.getState().modelsFor('b')).toHaveLength(1);
    });
});
