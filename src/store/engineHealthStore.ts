/**
 * Engine health store (Phase 1) — the tri-state ambient health of the audio
 * engine, surfaced WITHOUT stealing the performer's focus.
 *
 * This is deliberately a tiny, headless state container: it holds one enum and
 * a short reason string. There is NO visual dot here — the ambient health dot is
 * Wave 2 (Phase 2), which will subscribe to this store. Keeping the state and its
 * presentation separate means the fault pipe can be wired (and tested) now,
 * before any UI exists, and means there is ONE owner of "how healthy is the
 * engine" instead of a flag scattered across components.
 *
 * THE THREE STATES (and why three, not two):
 *   • IDLE     — the honest "nothing has happened yet" state. Before the first
 *                graph is pushed there is genuinely no engine activity to judge,
 *                so this must NEVER alarm. We deliberately do NOT derive health
 *                from the engine's raw `engine_running` flag, which is
 *                `self.host.is_some()` and documented-false on cold start / a
 *                device-less boot — alarming on it would cry wolf during the
 *                exact calm before a set when the player is plugging in.
 *   • DEGRADED — something went wrong but the last good sound is preserved (a
 *                rejected graph push kept the prior graph; a recoverable fault
 *                was reported). The performer can keep playing; we whisper, we
 *                never grab focus.
 *   • DEAD     — the engine cannot make sound: the native IPC bridge is absent
 *                (`getInvoke() === null` where we expected Tauri), or a graph was
 *                acknowledged yet the stream is down. This is the only state that
 *                warrants a loud-but-still-calm signal in Wave 2.
 *
 * Reaching DEAD is sticky relative to DEGRADED (a dead engine is strictly worse
 * than a degraded one), but any state can be set explicitly — the executor owns
 * the transitions and knows the truth at each call site.
 */

import { create } from 'zustand';
import type { StatusDotStatus } from '@openjammer/oj-ui';

/**
 * The tri-state engine health. Ordered loosely by severity for readability;
 * the store does not rank them — callers set the truth they observe.
 */
export type EngineHealth = 'IDLE' | 'DEGRADED' | 'DEAD';

interface EngineHealthState {
    /** Current tri-state health. Starts `IDLE` (never an alarm). */
    health: EngineHealth;
    /** A short, human-readable reason for the current state (for the Wave-2
     *  tooltip / DevLog correlation). Empty while `IDLE`. */
    reason: string;
    /**
     * Set the current health + a short reason. The single transition entry point
     * so every state change is one call (and trivially traceable). Idempotent:
     * setting the same state with the same reason is a no-op (no needless
     * re-render / subscriber churn during a fault storm).
     */
    setHealth: (health: EngineHealth, reason?: string) => void;
}

export const useEngineHealthStore = create<EngineHealthState>((set, get) => ({
    health: 'IDLE',
    reason: '',
    setHealth: (health, reason = '') => {
        const cur = get();
        if (cur.health === health && cur.reason === reason) return;
        set({ health, reason });
    },
}));

/**
 * Non-React accessor for the executor (which is a plain class, not a hook
 * consumer). Mirrors how `logStore` is reached via `useLogStore.getState()`.
 */
export function setEngineHealth(health: EngineHealth, reason?: string): void {
    useEngineHealthStore.getState().setHealth(health, reason);
}

// ============================================================================
// Derived presentation (Wave 2 / Phase 2) — PURE, testable without React.
// ============================================================================
//
// The store owns the tri-state TRUTH (Wave 1); these helpers own how that truth
// is calmly SHOWN. Kept pure + colocated so the ambient dot, the tooltip, and
// the toast policy all read ONE mapping — there is never a second place that
// decides "what colour is DEGRADED" or "is this an alarm".

/**
 * The honest round-trip latency tier shown in the dot's tooltip. Native latency is
 * DEVICE-DEPENDENT: the engine asks for a 64-frame buffer (~1.3 ms) and many devices
 * grant it even in WASAPI-shared mode — measured ~1.3 ms on a Windows test machine,
 * i.e. genuinely sub-5 ms — while some devices/drivers reject the small buffer and
 * fall back to the device period (~10 ms+). A WASAPI-exclusive / ASIO driver (not yet
 * routed) guarantees the low buffer. We never PROMISE one fixed figure we cannot keep
 * on every device; the browser tier is an honest ~15–25 ms.
 */
export function latencyTierLabel(isNative: boolean): string {
    return isNative
        ? 'native engine — low latency, device-dependent (sub-5 ms when the device grants a small buffer, ~10 ms+ if it forces a larger period)'
        : 'browser engine — an honest 15–25 ms';
}

/** The calm, ambient presentation of one health state. */
export interface HealthPresentation {
    /**
     * The oj-ui {@link StatusDotStatus} the ambient dot fills with. IDLE maps to
     * the muted `idle` token — NEVER a warn/bad colour — because "nothing has
     * happened yet" must never read as an alarm (the cold-start cry-wolf trap).
     * DEGRADED → `warn` (ochre), DEAD → `bad` (clay).
     */
    status: StatusDotStatus;
    /** The label that ALWAYS rides next to the dot (Signal-Not-Brand Rule). */
    label: string;
    /** A small glyph used as a redundant, colour-independent cue. */
    icon: string;
    /** A one-line plain explanation for the tooltip / aria description. */
    blurb: string;
    /** True only for DEAD — the one state a (still calm) toast is allowed for. */
    isAlarm: boolean;
}

/**
 * Map a tri-state {@link EngineHealth} to its calm presentation. PURE: the same
 * input always yields the same output, so the dot and the toast policy can never
 * disagree about what a state means. The `reason` (when present) is appended to
 * the blurb so the tooltip carries the executor's own words.
 */
export function presentHealth(health: EngineHealth, reason = ''): HealthPresentation {
    const detail = reason ? ` — ${reason}` : '';
    switch (health) {
        case 'DEGRADED':
            return {
                status: 'warn',
                label: 'Sound degraded',
                icon: '◐',
                blurb: `Something went wrong but your last good sound is still playing${detail}.`,
                isAlarm: false,
            };
        case 'DEAD':
            return {
                status: 'bad',
                label: 'Sound stopped',
                icon: '○',
                blurb: `The audio engine can't make sound right now${detail}.`,
                isAlarm: true,
            };
        case 'IDLE':
        default:
            return {
                status: 'idle',
                label: 'Sound ready',
                icon: '●',
                // Deliberately reassuring — IDLE is the calm before a set, not a fault.
                blurb: 'Audio engine is calm and ready — nothing to report.',
                isAlarm: false,
            };
    }
}
