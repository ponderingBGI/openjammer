/**
 * useEngineHealthToast (Phase 2) — the ONLY place the engine-health store is
 * allowed to raise a toast, and it does so as quietly as the Live Performance
 * Rule demands.
 *
 * Policy (deliberately strict, so a fault storm never becomes a toast storm):
 *   • A toast fires ONLY on a transition INTO DEAD — the one state where the
 *     performer truly cannot make sound. DEGRADED stays ambient (the dot only);
 *     a held note beats a glitch, so a recoverable degrade never grabs focus.
 *   • It is DEDUPED + RATE-LIMITED: re-entering DEAD while already dead, or a
 *     burst of DEAD-causing faults, yields at most ONE toast per cooldown
 *     window. The drain already coalesces faults; this is the second guard so
 *     even a mis-wired firehose cannot storm the surface.
 *   • Recovery (DEAD → IDLE/DEGRADED) is silent — we never celebrate, we just
 *     dismiss. The dot already shows the new calm state.
 *
 * It renders nothing; it is a behavioural subscriber mounted once near the
 * Toaster. The toast itself is calm: a single line, no action that steals focus,
 * pointing the performer at the local diagnostics they can choose to open.
 */

import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { useEngineHealthStore, type EngineHealth } from '../../store/engineHealthStore';

/** Minimum gap between two engine-dead toasts (ms). One calm signal, not a storm. */
const DEAD_TOAST_COOLDOWN_MS = 30_000;

/** A stable id so sonner de-dupes repeat dead signals into one toast slot. */
const DEAD_TOAST_ID = 'engine-health-dead';

export function useEngineHealthToast(): void {
    // Track the previous health so we fire on the TRANSITION into DEAD, not on
    // every store emission while already dead.
    const prevRef = useRef<EngineHealth>(useEngineHealthStore.getState().health);
    const lastToastAtRef = useRef<number>(0);

    useEffect(() => {
        const unsubscribe = useEngineHealthStore.subscribe((state) => {
            const prev = prevRef.current;
            const next = state.health;
            if (next === prev) return;
            prevRef.current = next;

            // Only a fresh entry into DEAD is allowed to surface a toast. Leaving
            // DEAD (recovered to IDLE/DEGRADED) is silent — but we DISMISS the stale
            // dead toast so a "Sound stopped" line can't linger after sound is back
            // (the dot already shows the new calm state; we never celebrate recovery).
            if (next !== 'DEAD') {
                toast.dismiss(DEAD_TOAST_ID);
                return;
            }

            const now = Date.now();
            if (now - lastToastAtRef.current < DEAD_TOAST_COOLDOWN_MS) return;
            lastToastAtRef.current = now;

            const detail = state.reason ? ` (${state.reason})` : '';
            toast.error('Sound stopped', {
                id: DEAD_TOAST_ID,
                description:
                    `The audio engine can't make sound right now${detail}. ` +
                    'Your work is safe — open “Report a problem” for local diagnostics.',
                duration: 8000,
            });
        });
        return unsubscribe;
    }, []);
}
