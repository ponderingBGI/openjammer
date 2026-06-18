/**
 * G2 — AI-collab frame guard (M3).
 *
 * An AI run applies many graphStore verbs live (the user sees the graph build),
 * but peers should not see a half-built patch one verb at a time. Without a
 * guard, EACH streamed AI verb would diff into the CRDT and broadcast separately.
 *
 * The fix is an AI FRAME: while the frame is open the store->CRDT subscriber is
 * suppressed (the AI delta accumulates locally, peers see nothing). At the turn
 * boundary `commitAiFrame()` pushes the accumulated net delta as ONE commit. If a
 * run is abandoned after manually reverting to the pre-run graph, `discardAiFrame()`
 * emits nothing and just re-syncs the high-water mark.
 *
 * This module is a tiny MODULE-LEVEL REGISTRY of the active bridge's frame
 * controls so the AI session store (which has no handle to the live bridge) can
 * drive the frame via free functions. It is null-safe: with no collab session
 * active every function is a no-op, so single-user behaviour is unchanged.
 */

/** The frame controls a {@link GraphStoreBridge} exposes to the AI lane. */
export interface AiCollabFrameTarget {
    /** Open the frame: suppress store->CRDT diffing; accumulate the AI delta. */
    beginAiFrame(): void;
    /** Close + commit: push the accumulated net delta as one CRDT commit. */
    commitAiFrame(): void;
    /** Close + discard: emit nothing (store already reverted to == CRDT). */
    discardAiFrame(): void;
}

/** The currently-registered bridge, or null when no session is active. */
let active: AiCollabFrameTarget | null = null;

/** Register the active session's bridge as the AI-frame target. */
export function registerAiCollabBridge(target: AiCollabFrameTarget): void {
    active = target;
}

/** Unregister `target` — but ONLY if it is still the active one (avoid clobber). */
export function unregisterAiCollabBridge(target: AiCollabFrameTarget): void {
    if (active === target) active = null;
}

/** Open the AI frame on the active bridge. No-op when no session is active. */
export function beginAiFrame(): void {
    active?.beginAiFrame();
}

/** Commit the AI frame on the active bridge. No-op when no session is active. */
export function commitAiFrame(): void {
    active?.commitAiFrame();
}

/** Discard the AI frame on the active bridge. No-op when no session is active. */
export function discardAiFrame(): void {
    active?.discardAiFrame();
}
