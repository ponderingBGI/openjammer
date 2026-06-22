/**
 * Computer-keyboard sustain (spacebar) wiring in audioStore.
 *
 * Verifies the keyboard note path shares the SAME per-note SustainController as
 * hardware CC64: while the spacebar "pedal" is down, keyboard note releases are
 * held; on spacebar-up every held voice gets exactly one engine note-off. Uses a
 * real {@link SustainController} behind a mocked router so we assert the genuine
 * hold/flush behavior, with the executor mocked to capture note-off timing.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SustainController } from '../../midi/routing/SustainController';

// ---------------------------------------------------------------------------
// Mocks — installed before importing the store under test.
// ---------------------------------------------------------------------------

interface ExecCall {
    method: 'noteOn' | 'noteOff';
    keyboardId: string;
    row: number;
    keyIndex: number;
}
const execCalls: ExecCall[] = [];
const fakeExecutor = {
    noteOn: (keyboardId: string, row: number, keyIndex: number) =>
        execCalls.push({ method: 'noteOn', keyboardId, row, keyIndex }),
    noteOff: (keyboardId: string, row: number, keyIndex: number) =>
        execCalls.push({ method: 'noteOff', keyboardId, row, keyIndex }),
    activateControlSignal: () => {},
    releaseControlSignal: () => {}
};

// One shared controller, exactly as production shares the router's instance.
const sustain = new SustainController();
const fakeRouter = {
    sustain,
    // Mirrors MIDIVoiceRouter.applySustain: down arms, up flushes via executor.
    applySustain: (nodeId: string, down: boolean) => {
        const released = sustain.setPedal(nodeId, down);
        for (const v of released) fakeExecutor.noteOff(nodeId, v.row, v.keyIndex);
    }
};

vi.mock('../../audio/executor', () => ({
    getExecutor: () => fakeExecutor
}));
vi.mock('../../audio/audioContext', () => ({
    resumeAudio: () => Promise.resolve()
}));
vi.mock('../../utils/connectionActivity', () => ({
    getConnectionsForRow: () => [],
    getConnectionsForPedal: () => []
}));
vi.mock('../../midi/routing', () => ({
    getMidiVoiceRouter: () => fakeRouter
}));

import { useAudioStore } from '../audioStore';

const offs = () =>
    execCalls.filter((c) => c.method === 'noteOff').map((c) => [c.keyboardId, c.row, c.keyIndex]);

describe('audioStore computer-keyboard sustain (spacebar)', () => {
    beforeEach(() => {
        execCalls.length = 0;
        sustain.reset();
    });

    it('releases immediately when the spacebar pedal is up', () => {
        const s = useAudioStore.getState();
        s.emitKeyboardSignal('kb', 1, 0);
        s.releaseKeyboardSignal('kb', 1, 0);
        expect(offs()).toEqual([['kb', 1, 0]]);
    });

    it('holds keyboard releases while spacebar is down, then flushes each once', () => {
        const s = useAudioStore.getState();
        s.emitControlDown('kb'); // spacebar DOWN

        for (const k of [0, 2, 4]) {
            s.emitKeyboardSignal('kb', 1, k);
            s.releaseKeyboardSignal('kb', 1, k);
        }
        expect(offs()).toEqual([]); // all held

        s.emitControlUp('kb'); // spacebar UP -> flush
        expect(offs()).toEqual([
            ['kb', 1, 0],
            ['kb', 1, 2],
            ['kb', 1, 4]
        ]);
    });

    it('a key pressed while spacebar is down then released stays held until flush', () => {
        const s = useAudioStore.getState();
        s.emitControlDown('kb');
        s.emitKeyboardSignal('kb', 1, 0);
        s.releaseKeyboardSignal('kb', 1, 0);
        expect(offs()).toEqual([]);
        s.emitControlUp('kb');
        expect(offs()).toEqual([['kb', 1, 0]]);
    });

    it('re-pressing a held key does not leak a stuck voice', () => {
        const s = useAudioStore.getState();
        s.emitControlDown('kb');
        s.emitKeyboardSignal('kb', 1, 0);
        s.releaseKeyboardSignal('kb', 1, 0); // held
        s.emitKeyboardSignal('kb', 1, 0); // re-press clears held entry
        s.emitControlUp('kb');
        expect(offs()).toEqual([]); // re-pressed voice still physically down
    });

    it('spacebar up with nothing held is a no-op', () => {
        const s = useAudioStore.getState();
        s.emitControlDown('kb');
        s.emitControlUp('kb');
        expect(offs()).toEqual([]);
    });
});
