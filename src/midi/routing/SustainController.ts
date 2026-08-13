/**
 * SustainController — per-note sustain (damper / CC64) for the control plane.
 *
 * The OpenJammer engine is a pure note model: `NoteOn`/`NoteOff` with no hold or
 * CC64 concept (see docs/BOUNDARY.md). Sustain is therefore *entirely* a
 * control-side decision: when the pedal is down, a note-OFF must not reach the
 * engine — the voice is "held" until the pedal lifts, at which point every held
 * voice is released exactly once. This class is the single, reusable home for
 * that decision so the hardware-MIDI path (CC64 in {@link MIDIVoiceRouter}) and
 * the computer-keyboard path (spacebar in audioStore) share one mechanism
 * instead of forking parallel hold logic.
 *
 * It is *pure runtime control state*: nothing here persists or touches undo
 * history — a held set and a pedal flag are momentary performance state.
 *
 * Musical contract ("a held note beats a glitch"):
 *  - Pedal DOWN, then note pressed + released -> voice is held (sounds on).
 *  - Pedal UP -> every held voice is released exactly once, then the set clears.
 *  - Note released while pedal UP -> released immediately (normal behavior).
 *  - Re-pressing a held note -> the stale held entry is dropped (no double-off),
 *    so the fresh press owns the voice and never leaks a stuck note.
 *  - Pedal UP with nothing held -> a no-op.
 *  - State is keyed per input node, so two nodes sustain independently.
 */

/** A voice released by the sustain controller. */
export interface ReleasedVoice {
    row: number;
    keyIndex: number;
}

/** Stable key for a voice within a single input node. */
function voiceKey(row: number, keyIndex: number): string {
    return `${row}:${keyIndex}`;
}

export class SustainController {
    /** Pedal-down state, keyed by input node id. Absent/false = pedal up. */
    private readonly pedalDown = new Map<string, boolean>();
    /** Held voices per node id: voiceKey -> {row,keyIndex}. */
    private readonly held = new Map<string, Map<string, ReleasedVoice>>();

    /** Is the pedal currently down for this input node? */
    isPedalDown(nodeId: string): boolean {
        return this.pedalDown.get(nodeId) === true;
    }

    /**
     * Note pressed. Clears any stale held entry for the same voice so a re-press
     * of a sustained note retriggers cleanly instead of leaking a stuck voice on
     * the next pedal-up. Call this on every note-ON.
     */
    onNoteOn(nodeId: string, row: number, keyIndex: number): void {
        const nodeHeld = this.held.get(nodeId);
        if (nodeHeld) nodeHeld.delete(voiceKey(row, keyIndex));
    }

    /**
     * Decide whether a note-OFF should be suppressed (held). Returns `true` when
     * the pedal is down for this node — the caller must NOT release the voice and
     * the voice is recorded for the eventual flush. Returns `false` when the
     * caller should release immediately (pedal up).
     */
    onNoteOff(nodeId: string, row: number, keyIndex: number): boolean {
        if (!this.isPedalDown(nodeId)) return false;
        let nodeHeld = this.held.get(nodeId);
        if (!nodeHeld) {
            nodeHeld = new Map();
            this.held.set(nodeId, nodeHeld);
        }
        nodeHeld.set(voiceKey(row, keyIndex), { row, keyIndex });
        return true;
    }

    /**
     * Set the pedal state for an input node. On the falling edge (down -> up)
     * the held voices are returned so the caller can release each exactly once;
     * the controller clears them. Any other transition returns an empty array.
     */
    setPedal(nodeId: string, down: boolean): ReleasedVoice[] {
        const wasDown = this.isPedalDown(nodeId);
        this.pedalDown.set(nodeId, down);
        if (wasDown && !down) {
            return this.flush(nodeId);
        }
        return [];
    }

    /**
     * Release and clear every held voice for a node, returning them so the caller
     * can emit one note-OFF each. A no-op (empty array) when nothing is held.
     */
    flush(nodeId: string): ReleasedVoice[] {
        const nodeHeld = this.held.get(nodeId);
        if (!nodeHeld || nodeHeld.size === 0) return [];
        const voices = [...nodeHeld.values()];
        nodeHeld.clear();
        return voices;
    }

    /** Drop all sustain state (e.g. on teardown). */
    reset(): void {
        this.pedalDown.clear();
        this.held.clear();
    }
}
