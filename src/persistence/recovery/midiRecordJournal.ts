import type { CapturedNote } from '@openjammer/oj-protocol';
import type { Arrangement } from '../../song/types';
import type { RecordTrackBinding } from '../../song/recording';
import { captureResultToVerbs } from '../../song/recording';
import type { Verb } from '../../song/verbs';

const MIDI_RECORD_JOURNAL_KEY = 'openjammer-midi-record-journal-v1';

interface MidiRecordJournal {
    v: 1;
    takeId: number;
    startTick: number;
    endTick: number;
    bindings: RecordTrackBinding[];
    notes: CapturedNote[];
}

function write(journal: MidiRecordJournal): void {
    try { localStorage.setItem(MIDI_RECORD_JOURNAL_KEY, JSON.stringify(journal)); } catch { /* durability degrades safely */ }
}

export function beginMidiRecordJournal(startTick: number, bindings: RecordTrackBinding[]): void {
    if (!bindings.some((binding) => binding.kind === 'midi')) return;
    write({ v: 1, takeId: Date.now(), startTick, endTick: startTick, bindings, notes: [] });
}

export function appendMidiRecordJournal(note: CapturedNote): void {
    try {
        const raw = localStorage.getItem(MIDI_RECORD_JOURNAL_KEY);
        if (!raw) return;
        const journal = JSON.parse(raw) as MidiRecordJournal;
        if (journal.v !== 1 || !Array.isArray(journal.notes)) return;
        journal.notes.push(note);
        journal.endTick = Math.max(journal.endTick, note.tick);
        write(journal);
    } catch { /* a corrupt journal is ignored and left for diagnostics */ }
}

export function clearMidiRecordJournal(): void {
    try { localStorage.removeItem(MIDI_RECORD_JOURNAL_KEY); } catch { /* ignore */ }
}

export function recoverMidiRecordJournal(arrangement: Arrangement, mint: (prefix: string) => string): Verb[] {
    try {
        const raw = localStorage.getItem(MIDI_RECORD_JOURNAL_KEY);
        if (!raw) return [];
        const journal = JSON.parse(raw) as MidiRecordJournal;
        if (journal.v !== 1 || !Array.isArray(journal.notes) || !Array.isArray(journal.bindings)) return [];
        const endTick = Math.max(journal.startTick + 1, journal.endTick);
        const verbs = captureResultToVerbs({
            arrangement,
            result: { take_id: journal.takeId, segments: [], notes: journal.notes, recovered: true },
            bindings: journal.bindings,
            span: { startTick: journal.startTick, endTick },
            mint,
        });
        if (verbs.length) clearMidiRecordJournal();
        return verbs;
    } catch {
        return [];
    }
}
