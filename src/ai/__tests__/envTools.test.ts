/**
 * Diagnostics & settings tools (the "help me get it working" surface).
 *
 * Two halves:
 *   • PURE: drive `get_logs` / `get_diagnostics` / `get_settings` /
 *     `update_settings` through {@link applyToolCall} with a FAKE
 *     {@link AgentEnvPort} — proving the dispatch, the summaries, the reversible
 *     undo, the env-threading through `batch_apply`, and the graceful
 *     "no env wired" degradation. Zero Zustand/DOM.
 *   • LIVE: drive {@link createEnvPort} against the real audio + log stores —
 *     proving the settings round-trip (and its undo) and the log tail filtering.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { applyToolCall, type AgentEnvPort, type DspNodeRegistrar } from '../tools';
import type { GraphStoreApi } from '../graphAdapter';
import { createEnvPort } from '../envAdapter';
import { useAudioStore } from '../../store/audioStore';
import { useGraphStore } from '../../store/graphStore';
import { useLogStore, _resetLogStoreForTests } from '../../store/logStore';
import { getSavedThemeId } from '@openjammer/oj-tokens';

// The diagnostics/settings handlers never touch the graph store; batch_apply
// only reads listNodes/listConnections for its post-state summary.
const STUB_STORE = {
    listNodes: () => [],
    listConnections: () => [],
} as unknown as GraphStoreApi;
const STUB_REGISTRAR: DspNodeRegistrar = { registerDspNode: () => () => {} };

// ---------------------------------------------------------------------------
// A controllable fake env port.
// ---------------------------------------------------------------------------

function makeFakeEnv() {
    const undo = vi.fn();
    const env: AgentEnvPort = {
        getLogs: vi.fn(() => ({
            total: 3,
            dropped: 1,
            returned: 2,
            entries: [
                { ts: 2, level: 'Error' as const, source: 'Ui' as const, scope: 'audio', message: 'boom' },
                { ts: 1, level: 'Warn' as const, source: 'Engine' as const, scope: 'engine', message: 'xrun' },
            ],
        })),
        getDiagnostics: vi.fn(() => ({
            version: '1.2.3',
            channel: 'stable' as const,
            executor: 'ojcore-native',
            crossOriginIsolated: true,
            platform: 'Win32',
            audioReady: true,
            sampleRate: 48000,
            estimatedRoundTripMs: 9.4,
            latencyClass: 'excellent',
            outputDeviceLabel: 'MOTU M4',
            usbAudioInterface: true,
        })),
        getNodeDiagnostics: vi.fn((nodeId: string) => ({
            nodeId,
            found: true,
            type: 'reverb',
            name: 'Reverb',
            dataKeys: ['mix', 'decay'],
            ports: [{ name: 'Audio In', direction: 'input' as const, type: 'audio' as const }],
            degraded: true,
            recentLogs: [
                {
                    ts: 5,
                    level: 'Warn' as const,
                    source: 'Engine' as const,
                    scope: 'engine',
                    message: `${nodeId}: degraded to passthrough`,
                },
            ],
        })),
        getSettings: vi.fn(() => ({
            sampleRate: 48000,
            latencyHint: 'interactive' as const,
            lowLatencyMode: false,
            outputDeviceId: null,
            inputDeviceId: null,
            themeId: 'cream',
            defaultVelocity: 0.8,
        })),
        updateSettings: vi.fn((patch: Record<string, unknown>) => ({
            applied: Object.keys(patch),
            settings: {
                sampleRate: 48000,
                latencyHint: 'interactive' as const,
                lowLatencyMode: Boolean(patch.lowLatencyMode),
                outputDeviceId: null,
                inputDeviceId: null,
                themeId: 'cream',
                defaultVelocity: 0.8,
            },
            undo,
        })),
    };
    return { env, undo };
}

describe('diagnostics/settings tools — pure dispatch (fake env)', () => {
    it('get_logs relays the filtered tail + ring accounting', () => {
        const { env } = makeFakeEnv();
        const res = applyToolCall(
            { name: 'get_logs', args: { levels: ['Warn', 'Error'], limit: 10 } },
            STUB_STORE,
            STUB_REGISTRAR,
            undefined,
            env,
        );
        expect(res.ok).toBe(true);
        expect(env.getLogs).toHaveBeenCalledWith({ levels: ['Warn', 'Error'], limit: 10 });
        expect(res.data).toMatchObject({ total: 3, dropped: 1, returned: 2 });
        expect(res.summary).toContain('2 of 3');
        expect(res.summary).toContain('filtered');
    });

    it('get_diagnostics summarizes running audio', () => {
        const { env } = makeFakeEnv();
        const res = applyToolCall(
            { name: 'get_diagnostics', args: {} },
            STUB_STORE,
            STUB_REGISTRAR,
            undefined,
            env,
        );
        expect(res.ok).toBe(true);
        expect(res.summary).toContain('1.2.3');
        expect(res.summary).toContain('48000 Hz');
        expect(res.summary).toContain('round-trip');
    });

    it('get_diagnostics({nodeId}) routes to the node facet and flags degraded', () => {
        const { env } = makeFakeEnv();
        const res = applyToolCall(
            { name: 'get_diagnostics', args: { nodeId: 'node-7' } },
            STUB_STORE,
            STUB_REGISTRAR,
            undefined,
            env,
        );
        expect(res.ok).toBe(true);
        expect(env.getNodeDiagnostics).toHaveBeenCalledWith('node-7');
        expect(res.summary).toContain('DEGRADED');
        expect(res.data).toMatchObject({ nodeId: 'node-7', found: true, degraded: true });
    });

    it('get_settings summarizes the current knobs', () => {
        const { env } = makeFakeEnv();
        const res = applyToolCall(
            { name: 'get_settings', args: {} },
            STUB_STORE,
            STUB_REGISTRAR,
            undefined,
            env,
        );
        expect(res.ok).toBe(true);
        expect(res.summary).toContain('48000 Hz');
        expect(res.summary).toContain('cream');
    });

    it('update_settings applies + exposes a reversible undo', () => {
        const { env, undo } = makeFakeEnv();
        const res = applyToolCall(
            { name: 'update_settings', args: { patch: { lowLatencyMode: true } } },
            STUB_STORE,
            STUB_REGISTRAR,
            undefined,
            env,
        );
        expect(res.ok).toBe(true);
        expect(res.summary).toContain('lowLatencyMode');
        res.undo();
        expect(undo).toHaveBeenCalledTimes(1);
    });

    it('update_settings with no allowlisted change is a successful no-op', () => {
        const env = makeFakeEnv().env;
        (env.updateSettings as ReturnType<typeof vi.fn>).mockReturnValueOnce({
            applied: [],
            settings: env.getSettings(),
            undo: () => {},
        });
        const res = applyToolCall(
            { name: 'update_settings', args: { patch: {} } },
            STUB_STORE,
            STUB_REGISTRAR,
            undefined,
            env,
        );
        expect(res.ok).toBe(true);
        expect(res.summary).toContain('no-op');
    });

    it('the env port threads through batch_apply', () => {
        const { env } = makeFakeEnv();
        const res = applyToolCall(
            { name: 'batch_apply', args: { calls: [{ name: 'get_settings', args: {} }] } },
            STUB_STORE,
            STUB_REGISTRAR,
            undefined,
            env,
        );
        expect(res.ok).toBe(true);
        expect(env.getSettings).toHaveBeenCalled();
    });

    it('degrades gracefully when no env port is wired', () => {
        const logs = applyToolCall({ name: 'get_logs', args: {} }, STUB_STORE, STUB_REGISTRAR);
        expect(logs.ok).toBe(true);
        expect(logs.data).toMatchObject({ total: 0, returned: 0 });

        const upd = applyToolCall(
            { name: 'update_settings', args: { patch: { sampleRate: 96000 } } },
            STUB_STORE,
            STUB_REGISTRAR,
        );
        expect(upd.ok).toBe(false);
        expect(upd.summary).toContain('not available');
    });
});

describe('createEnvPort — live against the real stores', () => {
    beforeEach(() => {
        _resetLogStoreForTests();
        // Reset the audio knobs we mutate to known defaults.
        useAudioStore.getState().setAudioConfig({
            sampleRate: 48000,
            latencyHint: 'interactive',
            lowLatencyMode: false,
        });
        useAudioStore.getState().setSelectedOutputDevice(null);
        useAudioStore.getState().setDefaultVelocity(0.8);
    });

    it('getSettings reflects the audio store', () => {
        const s = createEnvPort().getSettings();
        expect(s.sampleRate).toBe(48000);
        expect(s.lowLatencyMode).toBe(false);
        expect(s.themeId).toBe(getSavedThemeId());
    });

    it('updateSettings changes sampleRate + lowLatencyMode and undo restores them', () => {
        const env = createEnvPort();
        const { applied, settings, undo } = env.updateSettings({
            sampleRate: 96000,
            lowLatencyMode: true,
        });
        expect(applied).toEqual(expect.arrayContaining(['sampleRate', 'lowLatencyMode']));
        expect(settings.sampleRate).toBe(96000);
        expect(useAudioStore.getState().audioConfig.sampleRate).toBe(96000);
        undo();
        expect(useAudioStore.getState().audioConfig.sampleRate).toBe(48000);
        expect(useAudioStore.getState().audioConfig.lowLatencyMode).toBe(false);
    });

    it('updateSettings ignores an unknown theme id (no error, not applied)', () => {
        const { applied } = createEnvPort().updateSettings({ themeId: 'does-not-exist' });
        expect(applied).not.toContain('themeId');
    });

    it('updateSettings with an unchanged value applies nothing', () => {
        const { applied } = createEnvPort().updateSettings({ sampleRate: 48000 });
        expect(applied).toEqual([]);
    });

    it('getNodeDiagnostics: identity + ports + degraded + node-scoped logs', () => {
        const id = useGraphStore.getState().addNode('looper', { x: 0, y: 0 }, null, {});
        try {
            useLogStore.getState().append({
                level: 'Warn',
                source: 'Engine',
                scope: 'engine',
                message: `${id}: degraded to passthrough, missing dependency`,
            });
            useLogStore
                .getState()
                .append({ level: 'Info', source: 'Ui', scope: 'a', message: 'unrelated line' });
            const d = createEnvPort().getNodeDiagnostics(id);
            expect(d.found).toBe(true);
            expect(d.type).toBe('looper');
            expect(Array.isArray(d.ports)).toBe(true);
            expect(d.degraded).toBe(true);
            expect(d.recentLogs).toHaveLength(1);
            expect(d.recentLogs[0].message).toContain('degraded');
        } finally {
            useGraphStore.getState().removeNode(id);
        }
    });

    it('getNodeDiagnostics: a missing node reports found:false', () => {
        const d = createEnvPort().getNodeDiagnostics('does-not-exist');
        expect(d.found).toBe(false);
        expect(d.recentLogs).toEqual([]);
    });

    it('getLogs filters by level, returns newest-first, and respects limit', () => {
        const append = useLogStore.getState().append;
        append({ level: 'Info', source: 'Ui', scope: 'a', message: 'first info' });
        append({ level: 'Warn', source: 'Ui', scope: 'a', message: 'a warning' });
        append({ level: 'Error', source: 'Ui', scope: 'b', message: 'an error' });

        const res = createEnvPort().getLogs({ levels: ['Warn', 'Error'], limit: 10 });
        expect(res.total).toBe(3);
        expect(res.returned).toBe(2);
        // Newest first: the Error was appended last.
        expect(res.entries[0].message).toBe('an error');
        expect(res.entries[1].message).toBe('a warning');

        const limited = createEnvPort().getLogs({ limit: 1 });
        expect(limited.returned).toBe(1);
        expect(limited.entries[0].message).toBe('an error');
    });
});
