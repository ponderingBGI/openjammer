/**
 * Live {@link AgentEnvPort} — binds the agent's diagnostics/settings tools to the
 * real Zustand stores (the "help me get it working" surface).
 *
 * This is the trust boundary for the READ-the-world + WRITE-the-knobs tools, the
 * mirror of {@link import('./graphAdapter').createGraphStoreApi} for the graph:
 *   • `get_logs` tails the SAME {@link useLogStore} ring the DevLog panel shows,
 *   • `get_diagnostics` reads the allowlisted environment snapshot plus the live
 *     audio facts (running?, sample rate, round-trip latency, output device), and
 *   • `get_settings` / `update_settings` read and write ONLY a safe allowlist of
 *     user-facing settings — through the EXACT store verbs the Settings panel
 *     uses (`setAudioConfig`, `setSelectedOutputDevice`, …), and every write is
 *     reversible (it returns an `undo` that restores the prior values).
 *
 * So the agent can never reach past what a user clicking the Settings panel can
 * do, and "let me try 48 kHz / select your USB interface / switch to the
 * interactive latency hint" is as undoable as any graph edit.
 */

import type { Severity } from '@openjammer/oj-protocol';
import {
    useLogStore,
    filterEntries,
    type LogEntry,
    type LogView,
} from '../store/logStore';
import { useAudioStore } from '../store/audioStore';
import { useGraphStore } from '../store/graphStore';
import { resolveNodeDefinition } from '../engine/registry';
import { gatherDiagnostics } from '../utils/diagnostics';
import { redactText, redactValue } from '../utils/redact';
import { applyTheme, getSavedThemeId, getThemeById, saveThemeId } from '@openjammer/oj-tokens';
import type {
    AgentEnvPort,
    DiagnosticsReadResult,
    LogEntrySummary,
    LogsReadResult,
    NodeDiagnosticsResult,
    SettingsReadResult,
    SettingsUpdateResult,
} from './tools';
import { SIGNAL_SILENCE_FLOOR, toPortSummary } from './types';
import type { GetLogsArgs, GetSignalArgs, SettingsPatch, SignalProbeResult } from './types';

/** Max node-scoped log lines the get_diagnostics node facet returns. */
const NODE_LOG_LIMIT = 25;

/**
 * Whether a log entry references `nodeId` in its message or any field value — how
 * the node facet finds the evidence (degraded messages, asset/plugin events, and —
 * once the fault id-map lands — faults) for ONE node.
 */
function entryMentionsNode(e: LogEntry, nodeId: string): boolean {
    if (e.message.includes(nodeId)) return true;
    const f = e.fields;
    if (f && typeof f === 'object') {
        for (const v of Object.values(f)) {
            if (v === nodeId || (typeof v === 'string' && v.includes(nodeId))) return true;
        }
    }
    return false;
}

/** Default number of log entries returned by `get_logs` when no `limit` is given. */
const DEFAULT_LOG_LIMIT = 50;
/** Hard cap so the relay back to the model stays bounded regardless of `limit`. */
const MAX_LOG_LIMIT = 500;

/** Compact a stored {@link LogEntry} to the agent-facing {@link LogEntrySummary}. */
function toSummary(e: LogEntry): LogEntrySummary {
    return {
        ts: e.ts,
        level: e.level,
        source: e.source,
        scope: e.scope,
        message: redactText(e.message),
        ...(e.fields !== undefined ? { fields: redactValue(e.fields) as Record<string, unknown> } : {}),
        ...(e.corr !== undefined ? { corr: e.corr } : {}),
    };
}

/** Build the {@link LogView} the pure {@link filterEntries} selector consumes. */
function toView(args: GetLogsArgs): LogView {
    return {
        levels: args.levels && args.levels.length > 0 ? new Set<Severity>(args.levels) : null,
        scope: args.scope ?? null,
        search: args.search ?? '',
        corr: null,
    };
}

/**
 * Create the live diagnostics/settings port for {@link import('./tools').applyToolCall}.
 * Reads from / writes to the live Zustand stores; safe to call once per apply.
 */
export function createEnvPort(): AgentEnvPort {
    return {
        getLogs(args: GetLogsArgs): LogsReadResult {
            const state = useLogStore.getState();
            const filtered = filterEntries(state.entries, toView(args));
            const limit = Math.min(Math.max(1, args.limit ?? DEFAULT_LOG_LIMIT), MAX_LOG_LIMIT);
            // `entries` is oldest→newest; take the tail then reverse to newest-first.
            const tail = filtered.slice(-limit).reverse().map(toSummary);
            return {
                total: state.entries.length,
                dropped: state.droppedCount,
                returned: tail.length,
                entries: tail,
            };
        },

        getDiagnostics(): DiagnosticsReadResult {
            const env = gatherDiagnostics();
            const a = useAudioStore.getState();
            return {
                version: env.version,
                channel: env.channel,
                executor: env.executor,
                crossOriginIsolated: env.crossOriginIsolated,
                platform: env.platform,
                audioReady: a.isAudioContextReady,
                sampleRate: a.isAudioContextReady ? a.audioMetrics.sampleRate : null,
                estimatedRoundTripMs: a.isAudioContextReady
                    ? a.audioMetrics.estimatedRoundTrip
                    : null,
                latencyClass: a.isAudioContextReady ? a.audioMetrics.classification : null,
                outputDeviceLabel: a.deviceInfo.deviceLabel || null,
                usbAudioInterface: a.deviceInfo.isUSBAudioInterface,
            };
        },

        getNodeDiagnostics(nodeId: string): NodeDiagnosticsResult {
            const node = useGraphStore.getState().getNode(nodeId);
            const mentioned = useLogStore
                .getState()
                .entries.filter((e) => entryMentionsNode(e, nodeId));
            const recentLogs = mentioned.slice(-NODE_LOG_LIMIT).reverse().map(toSummary);
            // Degraded flag: the structured `fields.degraded` the executor stamps on a
            // degraded-stub entry is the SSOT; the message regex stays only as a
            // fallback for any other degraded-ish wording.
            const degraded = mentioned.some(
                (e) =>
                    (e.fields as { degraded?: unknown } | undefined)?.degraded === true ||
                    /degrad|passthrough/i.test(e.message),
            );
            if (!node) {
                return { nodeId, found: false, degraded, recentLogs };
            }
            return {
                nodeId,
                found: true,
                type: node.pluginId ?? node.type,
                name: resolveNodeDefinition({ type: node.type, pluginId: node.pluginId }).name,
                pluginId: node.pluginId,
                dataKeys: Object.keys((node.data ?? {}) as Record<string, unknown>),
                ports: (node.ports ?? []).map(toPortSummary),
                degraded,
                recentLogs,
            };
        },

        async getSignal(args: GetSignalArgs): Promise<SignalProbeResult> {
            // Probe the live engine peak off the audio thread (the executor owns the
            // transient meter subscription). Lazy import so the heavy audio/executor
            // module graph only loads on a real probe, not at AI-module load (keeps
            // the AI layer light + tests fast). Clamp to 0–1 defensively; `null` means
            // no live reading is available (unmetered node, or audio stopped).
            const { getExecutor } = await import('../audio/executor');
            const raw = await getExecutor().probeSignal(args.nodeId);
            const peak = raw === null ? null : Math.max(0, Math.min(1, raw));
            return {
                nodeId: args.nodeId,
                peak,
                hasSignal: peak !== null && peak > SIGNAL_SILENCE_FLOOR,
            };
        },

        getSettings(): SettingsReadResult {
            const a = useAudioStore.getState();
            return {
                sampleRate: a.audioConfig.sampleRate,
                latencyHint: a.audioConfig.latencyHint,
                lowLatencyMode: a.audioConfig.lowLatencyMode,
                outputDeviceId: a.selectedOutputDevice,
                inputDeviceId: a.selectedInputDevice,
                themeId: getSavedThemeId(),
                defaultVelocity: a.defaultVelocity,
            };
        },

        updateSettings(patch: SettingsPatch): SettingsUpdateResult {
            const a = useAudioStore.getState();
            const before = this.getSettings();
            const applied: string[] = [];
            const undos: Array<() => void> = [];

            // Each branch applies ONLY when the key is present AND the value differs,
            // through the same store verb the Settings panel uses, capturing an undo.
            const audioConfigPatch: Partial<typeof a.audioConfig> = {};
            const audioConfigUndo: Partial<typeof a.audioConfig> = {};

            if (patch.sampleRate !== undefined && patch.sampleRate !== before.sampleRate) {
                audioConfigPatch.sampleRate = patch.sampleRate;
                audioConfigUndo.sampleRate = before.sampleRate;
                applied.push('sampleRate');
            }
            if (patch.latencyHint !== undefined && patch.latencyHint !== before.latencyHint) {
                audioConfigPatch.latencyHint = patch.latencyHint;
                audioConfigUndo.latencyHint = before.latencyHint;
                applied.push('latencyHint');
            }
            if (
                patch.lowLatencyMode !== undefined &&
                patch.lowLatencyMode !== before.lowLatencyMode
            ) {
                audioConfigPatch.lowLatencyMode = patch.lowLatencyMode;
                audioConfigUndo.lowLatencyMode = before.lowLatencyMode;
                applied.push('lowLatencyMode');
            }
            if (Object.keys(audioConfigPatch).length > 0) {
                a.setAudioConfig(audioConfigPatch);
                undos.push(() => a.setAudioConfig(audioConfigUndo));
            }

            if (
                patch.outputDeviceId !== undefined &&
                patch.outputDeviceId !== before.outputDeviceId
            ) {
                a.setSelectedOutputDevice(patch.outputDeviceId);
                undos.push(() => a.setSelectedOutputDevice(before.outputDeviceId));
                applied.push('outputDeviceId');
            }
            if (patch.inputDeviceId !== undefined && patch.inputDeviceId !== before.inputDeviceId) {
                a.setSelectedInputDevice(patch.inputDeviceId);
                undos.push(() => a.setSelectedInputDevice(before.inputDeviceId));
                applied.push('inputDeviceId');
            }
            if (
                patch.defaultVelocity !== undefined &&
                patch.defaultVelocity !== before.defaultVelocity
            ) {
                a.setDefaultVelocity(patch.defaultVelocity);
                undos.push(() => a.setDefaultVelocity(before.defaultVelocity));
                applied.push('defaultVelocity');
            }

            // Theme: only a KNOWN theme id is honoured (an unknown id is ignored,
            // never an error), applied via the same applyTheme + saveThemeId the
            // Settings panel uses so the change persists.
            if (patch.themeId !== undefined && patch.themeId !== before.themeId) {
                const theme = getThemeById(patch.themeId);
                if (theme) {
                    applyTheme(theme);
                    saveThemeId(theme.id);
                    const prevTheme = getThemeById(before.themeId);
                    undos.push(() => {
                        if (prevTheme) {
                            applyTheme(prevTheme);
                            saveThemeId(prevTheme.id);
                        }
                    });
                    applied.push('themeId');
                }
            }

            const undo = (): void => {
                // Restore in reverse so composite changes unwind cleanly.
                for (let i = undos.length - 1; i >= 0; i--) undos[i]();
            };

            return { applied, settings: this.getSettings(), undo };
        },
    };
}
