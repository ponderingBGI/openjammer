import { describe, expect, it } from 'vitest';
import {
    commandsUpTo,
    cursorAtOrAfter,
    heldNoteOffs,
    toRtCommand,
    type ScheduledCommand,
} from '../arrangementScheduler';

const sched: ScheduledCommand[] = [
    { at: 0, cmd: 'setParam', node: 5, param: 1, value: 900 },
    { at: 0, cmd: 'noteOn', node: 1, note: 60, vel: 100 },
    { at: 0.5, cmd: 'noteOff', node: 1, note: 60 },
    { at: 0.5, cmd: 'noteOn', node: 1, note: 64, vel: 90 },
    { at: 1.0, cmd: 'noteOff', node: 1, note: 64 },
];

describe('arrangementScheduler', () => {
    it('lowers each command to its RtCommand', () => {
        expect(toRtCommand({ at: 0, cmd: 'noteOn', node: 1, note: 60, vel: 100 })).toEqual({
            NoteOn: { node: 1, note: 60, vel: 100 },
        });
        expect(toRtCommand({ at: 0, cmd: 'noteOff', node: 1, note: 60 })).toEqual({ NoteOff: { node: 1, note: 60 } });
        expect(toRtCommand({ at: 0, cmd: 'setParam', node: 5, param: 1, value: 900 })).toEqual({
            SetParam: { node: 5, param: 1, value: 900 },
        });
    });

    it('dispatches only commands within the look-ahead horizon, advancing the cursor', () => {
        const t0 = commandsUpTo(sched, 0, 0.1); // horizon covers the two at=0 events
        expect(t0.commands).toEqual([
            { SetParam: { node: 5, param: 1, value: 900 } },
            { NoteOn: { node: 1, note: 60, vel: 100 } },
        ]);
        expect(t0.cursor).toBe(2);

        const t1 = commandsUpTo(sched, t0.cursor, 0.6); // covers the 0.5 pair
        expect(t1.commands).toEqual([
            { NoteOff: { node: 1, note: 60 } },
            { NoteOn: { node: 1, note: 64, vel: 90 } },
        ]);
        expect(t1.cursor).toBe(4);
    });

    it('covers every command exactly once across successive ticks', () => {
        let cursor = 0;
        const all: unknown[] = [];
        for (const until of [0.1, 0.3, 0.6, 0.9, 1.2]) {
            const r = commandsUpTo(sched, cursor, until);
            all.push(...r.commands);
            cursor = r.cursor;
        }
        expect(all).toHaveLength(sched.length);
        expect(cursor).toBe(sched.length);
    });

    it('heldNoteOffs releases exactly the notes still sounding at the cursor', () => {
        // After dispatching the first 2 (setParam + noteOn 60), note 60 is sounding.
        expect(heldNoteOffs(sched, 0, 2)).toEqual([{ NoteOff: { node: 1, note: 60 } }]);
        // After 4 (…noteOff 60, noteOn 64), only 64 is sounding.
        expect(heldNoteOffs(sched, 0, 4)).toEqual([{ NoteOff: { node: 1, note: 64 } }]);
        // After all 5, nothing is held.
        expect(heldNoteOffs(sched, 0, 5)).toEqual([]);
        // Before anything dispatched, nothing is held.
        expect(heldNoteOffs(sched, 0, 0)).toEqual([]);
    });

    it('a mid-song start does not spuriously release notes that were never sent', () => {
        // Start at the 0.5 noteOn (index 3): only events [3, to) count.
        expect(heldNoteOffs(sched, 3, 4)).toEqual([{ NoteOff: { node: 1, note: 64 } }]);
        // The earlier note 60 (index 1) is NOT released — it was never dispatched.
    });

    it('cursorAtOrAfter finds the first event at/after a start time', () => {
        expect(cursorAtOrAfter(sched, 0)).toBe(0);
        expect(cursorAtOrAfter(sched, 0.5)).toBe(2); // first event with at >= 0.5
        expect(cursorAtOrAfter(sched, 2)).toBe(5); // past the end
    });
});
