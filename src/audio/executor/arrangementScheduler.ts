// src/audio/executor/arrangementScheduler.ts — the PURE timing brain of timeline
// preview. The executor's preview loop calls these each timer tick; keeping them pure
// (no clock, no engine) makes the look-ahead policy unit-testable in isolation.
//
// The model is the standard Web Audio "tale of two clocks" look-ahead scheduler: a
// coarse JS timer wakes every ~25 ms and dispatches every command whose offset has
// entered a short horizon, sending them to the engine immediately. Browser-tier
// timing is honestly ~15–25 ms — the bit-identical guarantee belongs to the OFFLINE
// bounce (conduct → render), not this live preview; the playhead stays the visual
// source of truth (AudioContext.currentTime). A partial stop releases EXACTLY the
// notes still sounding, so a held note never strands on the engine.

import type { RtCommand } from '@openjammer/oj-protocol';

/**
 * One scheduled timeline command at a wall-clock OFFSET (seconds) from play start.
 * Structurally mirrors the song layer's `ScheduleEvent` and the engine's `SchedEvent`
 * — defined HERE in the audio layer so the executor seam never imports the song
 * layer (the same justification by which `ScheduleEvent` mirrors the Rust shape). A
 * `ScheduleEvent[]` from `conduct()` is assignable to `ScheduledCommand[]`.
 */
export type ScheduledCommand =
    | { at: number; cmd: 'noteOn'; node: number; note: number; vel: number }
    | { at: number; cmd: 'noteOff'; node: number; note: number }
    | { at: number; cmd: 'setParam'; node: number; param: number; value: number };

/** Lower one scheduled command to the engine `RtCommand` it dispatches as. */
export function toRtCommand(ev: ScheduledCommand): RtCommand {
    switch (ev.cmd) {
        case 'noteOn':
            return { NoteOn: { node: ev.node, note: ev.note, vel: ev.vel } };
        case 'noteOff':
            return { NoteOff: { node: ev.node, note: ev.note } };
        case 'setParam':
            return { SetParam: { node: ev.node, param: ev.param, value: ev.value } };
    }
}

/**
 * Pure look-ahead dispatch: given the SORTED schedule and a cursor, return every
 * command whose offset `at` is `<= untilSec` (the look-ahead horizon) plus the
 * advanced cursor. The caller ticks this with `untilSec = elapsed + lookAhead` and
 * sends the returned commands at once. Linear in the number dispatched this tick.
 */
export function commandsUpTo(
    events: readonly ScheduledCommand[],
    cursor: number,
    untilSec: number,
): { commands: RtCommand[]; cursor: number } {
    const commands: RtCommand[] = [];
    let i = cursor;
    while (i < events.length && events[i]!.at <= untilSec) {
        commands.push(toRtCommand(events[i]!));
        i++;
    }
    return { commands, cursor: i };
}

/**
 * The NoteOff commands that release exactly the notes left SOUNDING after dispatching
 * `[0, cursor)` — every dispatched noteOn whose matching noteOff is still ahead of the
 * cursor. A stop sends these so no voice strands on the engine (a held note beats a
 * glitch: silence cleanly, never leave a stuck note ringing).
 */
export function heldNoteOffs(events: readonly ScheduledCommand[], cursor: number): RtCommand[] {
    const held = new Map<string, { node: number; note: number }>();
    const end = Math.min(cursor, events.length);
    for (let i = 0; i < end; i++) {
        const e = events[i]!;
        if (e.cmd === 'noteOn') held.set(`${e.node}:${e.note}`, { node: e.node, note: e.note });
        else if (e.cmd === 'noteOff') held.delete(`${e.node}:${e.note}`);
    }
    return [...held.values()].map((h) => ({ NoteOff: { node: h.node, note: h.note } }));
}
