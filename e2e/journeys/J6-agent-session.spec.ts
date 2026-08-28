import { expect, test, type Page } from '@playwright/test';
import type { AgentEvent } from '../../src/ai';
import type { Arrangement } from '../../src/song/types';
import { loadFixture, snapshot } from './support';

interface AgentBridge {
    setAgentScript(script: AgentEvent[]): void;
    sendAgent(prompt: string): Promise<void>;
    agentSession(): { messages: Array<{ role: string; text?: string; markdown?: string; actions?: unknown[] }>; phase: string };
    history(): { cursor: number; entries: number; scopes: string[] };
}

const callBridge = <T>(page: Page, method: string, arg?: unknown) => page.evaluate(
    ({ method, arg }) => {
        const api = (window as unknown as { __openjammerE2E: Record<string, (...args: unknown[]) => unknown> }).__openjammerE2E;
        return api[method]!(...(arg === undefined ? [] : [arg])) as T;
    },
    { method, arg },
);

test('@journey J6 Agent Session — agent and human share one undo history', async ({ page }) => {
    test.setTimeout(120_000);
    await loadFixture(page, 'firstLight');

    const build: AgentEvent[] = [
        { kind: 'thought', text: 'I will build an eight-bar agent track, then tighten and mix it.' },
        { kind: 'tool-call', id: 'build-track', call: { name: 'edit_timeline', args: { verbs: [
            { kind: 'addSource', source: { id: 'agent-source', kind: 'midi', name: 'Agent eight bars', lengthTick: 30_720, notes: [] } },
            { kind: 'addTrack', index: 99, track: { id: 'agent-track', ref: 'agent-track', name: 'Agent 8 bars', clips: [{ id: 'agent-clip', sourceId: 'agent-source', startTick: 0, lengthTick: 30_720 }] } },
        ] } } },
        { kind: 'tool-call', id: 'notes-and-mix', call: { name: 'edit_timeline', args: { ops: [
            { op: 'drawNote', clipId: 'agent-clip', note: { id: 'agent-note-1', tick: 35, durTick: 480, pitch: 60, vel: 96 } },
            { op: 'drawNote', clipId: 'agent-clip', note: { id: 'agent-note-2', tick: 995, durTick: 480, pitch: 64, vel: 94 } },
            { op: 'drawNote', clipId: 'agent-clip', note: { id: 'agent-note-3', tick: 1955, durTick: 960, pitch: 67, vel: 92 } },
            { op: 'quantizeNotes', targets: ['agent-note-1', 'agent-note-2', 'agent-note-3'], grid: 240, strength: 100 },
            { op: 'setTrackGain', trackId: 'agent-track', gainDb: -4.5 },
        ] } } },
        { kind: 'session', sessionId: 'journey-j6' },
        { kind: 'result', summary: 'Built and mixed eight bars.' },
    ];
    await callBridge<void>(page, 'setAgentScript', build);
    await callBridge<void>(page, 'sendAgent', 'Build me eight bars with notes, quantize them, and set the gain.');

    let document = await snapshot(page) as Arrangement;
    expect(document.tracks.find((track) => track.id === 'agent-track')?.gainDb).toBe(-4.5);
    expect(document.sources?.['agent-source']?.kind === 'midi' && document.sources['agent-source'].notes.map((note) => note.tick)).toEqual([0, 960, 1920]);

    // Human undo uses the same surface keybinding and reverses the two streamed
    // agent edits in exact interleaved-history order.
    await page.locator('[data-surface-root="arrangement"]').click({ position: { x: 8, y: 8 } });
    await page.keyboard.press('Control+z');
    await page.keyboard.press('Control+z');
    document = await snapshot(page) as Arrangement;
    expect(document.tracks.some((track) => track.id === 'agent-track')).toBe(false);
    expect(document.sources?.['agent-source']).toBeUndefined();

    const describe: AgentEvent[] = [
        { kind: 'tool-call', id: 'describe-after-undo', call: { name: 'describe_arrangement', args: {} } },
        { kind: 'thought', text: 'The Agent 8 bars track is gone after your two undos; the original song remains.' },
        { kind: 'result', summary: 'Described the live, undone arrangement.' },
    ];
    await callBridge<void>(page, 'setAgentScript', describe);
    await callBridge<void>(page, 'sendAgent', 'Describe what is there after my undos.');
    const session = await callBridge<AgentBridge['agentSession'] extends (...args: never[]) => infer T ? T : never>(page, 'agentSession');
    expect(session.messages.some((message) => message.role === 'assistant' && message.markdown?.includes('gone after your two undos'))).toBe(true);

    const continued: AgentEvent[] = [
        { kind: 'tool-call', id: 'continue', call: { name: 'edit_timeline', args: { verbs: [
            { kind: 'setTempo', tempoBpm: 92 },
            { kind: 'setTrackGain', trackId: 'first-light-lead', gainDb: -6 },
        ] } } },
        { kind: 'thought', text: 'Continued from the live post-undo song.' },
        { kind: 'result', summary: 'Adjusted the surviving arrangement.' },
    ];
    await callBridge<void>(page, 'setAgentScript', continued);
    await callBridge<void>(page, 'sendAgent', 'Continue from that state.');
    document = await snapshot(page) as Arrangement;
    expect(document.tempoBpm).toBe(92);

    const history = await callBridge<{ cursor: number; entries: number; scopes: string[] }>(page, 'history');
    expect(history.cursor).toBe(1);
    expect(history.entries).toBe(1); // continuing after undo truncates the redo branch
    expect(history.scopes).toEqual(['arrangement']);
});
