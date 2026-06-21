/**
 * React boot-recovery wiring (Track B P0).
 *
 * Runs the recovery state machine once at boot, applies the outcome (restore the
 * surviving work with a calm "Recovered · Undo" pill, or surface Safe Mode after
 * repeated crashes), and owns the session-marker lifecycle:
 *   • marks the session open at boot (inside {@link runRecovery}),
 *   • forgives the crash streak once the engine is LIVE for a settle window (with
 *     an uptime backstop so a never-LIVE device-less session can't wedge it),
 *   • marks a clean exit on `pagehide`, and re-arms on a bfcache `pageshow`.
 *
 * The decision logic lives in the pure, unit-tested core; this hook is the thin
 * DOM/store glue. It NEVER blindly restores: a possibly-poison payload only loads
 * when the breaker says it is safe, and Safe Mode preserves suspects on disk.
 */

import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useGraphStore } from '../../store/graphStore';
import { logInfo, logWarn } from '../../utils/log';
import { WebMarkerStore } from './markerStore';
import { runRecovery, settle, markCleanExit, markSessionOpen, reset } from './recover';
import {
    WebPayloadSource,
    validateRecoveredGraph,
    loadQuarantined,
    newestQuarantinedId,
    clearEmergencyBackup,
} from './webPayloads';
import { useEngineHealthStore } from '../../store/engineHealthStore';

/** Forgive the streak once the engine has been LIVE this long. */
const SETTLE_AFTER_LIVE_MS = 8_000;
/** Backstop: forgive the streak after this much uptime even without a LIVE signal. */
const SETTLE_UPTIME_BACKSTOP_MS = 20_000;

export interface SafeModeState {
    bootSeq: number;
    streak: number;
    /** The newest quarantined suspect that "Recover anyway" can re-load, if any. */
    quarantinedId: string | null;
}

export interface CrashRecoveryApi {
    /** Non-null only when repeated crashes dropped us into Safe Mode. */
    safeMode: SafeModeState | null;
    /** Re-load the quarantined suspect (the explicit "Recover anyway"). */
    recoverAnyway: () => void;
    /** Clear the canvas and the breaker, start clean. */
    startFresh: () => void;
    /** Keep the current (last-good) state and leave Safe Mode. */
    dismiss: () => void;
}

const markerStore = new WebMarkerStore();
const source = new WebPayloadSource();

export function useCrashRecovery(): CrashRecoveryApi {
    const [safeMode, setSafeMode] = useState<SafeModeState | null>(null);
    const ranRef = useRef(false);

    // ---- Boot: run recovery exactly once, before the autosave effects engage. ----
    useEffect(() => {
        if (ranRef.current) return;
        ranRef.current = true;

        let outcome;
        try {
            outcome = runRecovery({ store: markerStore, source, validate: validateRecoveredGraph });
        } catch (err) {
            // Recovery must never itself crash the boot — fail open to a clean canvas.
            logWarn('recovery', 'boot recovery threw; opening clean', {
                error: err instanceof Error ? err.message : String(err),
            });
            return;
        }

        if (outcome.restored) {
            const { nodes, connections } = outcome.restored.graph;
            useGraphStore.getState().loadGraph(nodes, connections);
            clearEmergencyBackup(); // consumed — the live graph now IS the work
            logInfo('recovery', 'restored work after an unclean shutdown', {
                snapshotId: outcome.restored.snapshotId,
                mode: outcome.mode,
                quarantined: outcome.quarantined.length,
            });
            toast.success('Recovered your work', {
                description: 'OpenJammer closed unexpectedly last time. Press Ctrl/Cmd+Z to undo the restore.',
                duration: 8_000,
            });
        } else if (outcome.mode === 'safe-mode') {
            logWarn('recovery', 'entered Safe Mode after repeated crashes', {
                bootSeq: outcome.bootSeq,
                streak: outcome.streak,
            });
            const sm: SafeModeState = {
                bootSeq: outcome.bootSeq,
                streak: outcome.streak,
                quarantinedId: newestQuarantinedId(),
            };
            // Defer the full-screen takeover one tick so the canvas mounts first
            // (and so we don't set state synchronously inside the boot effect).
            queueMicrotask(() => setSafeMode(sm));
        }
    }, []);

    // ---- Settle: forgive the streak once we're known-good (LIVE + window), with
    //      an uptime backstop so a device-less session still settles. ----
    useEffect(() => {
        let settled = false;
        let liveTimer: ReturnType<typeof setTimeout> | null = null;
        const doSettle = () => {
            if (settled) return;
            settled = true;
            settle(markerStore);
        };
        const onHealth = (health: string) => {
            if (settled) return;
            if (health === 'LIVE') {
                // A sustained LIVE arms the settle timer (once — don't restart it
                // on every LIVE re-emit during steady playback).
                if (!liveTimer) liveTimer = setTimeout(doSettle, SETTLE_AFTER_LIVE_MS);
            } else if (liveTimer) {
                // Health fell back to DEAD/DEGRADED before the window elapsed: a
                // brief LIVE blip must NOT forgive a crash streak. Disarm so only
                // a *sustained* LIVE (or the uptime backstop) settles.
                clearTimeout(liveTimer);
                liveTimer = null;
            }
        };
        // React to the current and future health.
        onHealth(useEngineHealthStore.getState().health);
        const unsub = useEngineHealthStore.subscribe((s) => onHealth(s.health));
        const backstop = setTimeout(doSettle, SETTLE_UPTIME_BACKSTOP_MS);
        return () => {
            unsub();
            if (liveTimer) clearTimeout(liveTimer);
            clearTimeout(backstop);
        };
    }, []);

    // ---- Clean-exit + bfcache marker lifecycle. ----
    useEffect(() => {
        const onPageHide = () => markCleanExit(markerStore);
        const onPageShow = (e: PageTransitionEvent) => {
            if (e.persisted) markSessionOpen(markerStore); // resumed from bfcache → re-arm
        };
        window.addEventListener('pagehide', onPageHide);
        window.addEventListener('pageshow', onPageShow);
        return () => {
            window.removeEventListener('pagehide', onPageHide);
            window.removeEventListener('pageshow', onPageShow);
        };
    }, []);

    return {
        safeMode,
        recoverAnyway: () => {
            const id = safeMode?.quarantinedId ?? newestQuarantinedId();
            if (!id) {
                setSafeMode(null);
                return;
            }
            const graph = loadQuarantined(id);
            if (graph) {
                useGraphStore.getState().loadGraph(graph.nodes, graph.connections);
                logInfo('recovery', 'user recovered a quarantined snapshot from Safe Mode', { id });
            }
            setSafeMode(null);
        },
        startFresh: () => {
            useGraphStore.getState().clearGraph();
            clearEmergencyBackup();
            reset(markerStore);
            logInfo('recovery', 'user started fresh from Safe Mode');
            setSafeMode(null);
        },
        dismiss: () => setSafeMode(null),
    };
}
