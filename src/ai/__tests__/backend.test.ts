/**
 * Agent backend behaviour (U20): availability gating + the mock stream.
 *
 * Proves the BROWSER-DISABLED state — the Pi backend reports `available()`
 * false when `window.__TAURI__` is absent (a plain browser), and its `run`
 * degrades to a single terminal `error` event rather than throwing — and that
 * the mock backend faithfully replays a scripted stream.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { PiAgentBackend, classifySelfEdit } from '../PiAgentBackend';
import { MockAgentBackend, demoScript } from '../MockAgentBackend';
import type { AgentEvent } from '../types';

async function collect(it: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
    const out: AgentEvent[] = [];
    for await (const e of it) out.push(e);
    return out;
}

describe('PiAgentBackend — browser (no Tauri)', () => {
    afterEach(() => {
        delete (window as unknown as { __TAURI__?: unknown }).__TAURI__;
    });

    it('is unavailable when window.__TAURI__ is absent', () => {
        expect((window as unknown as { __TAURI__?: unknown }).__TAURI__).toBeUndefined();
        expect(new PiAgentBackend().available()).toBe(false);
    });

    it('run() yields a single terminal error event in the browser', async () => {
        const events = await collect(new PiAgentBackend().run({ prompt: 'do a thing' }));
        expect(events).toHaveLength(1);
        expect(events[0].kind).toBe('error');
        if (events[0].kind === 'error') {
            expect(events[0].message).toContain('desktop app');
        }
    });

    it('reports available when a Tauri invoke bridge is present', () => {
        (window as unknown as { __TAURI__?: unknown }).__TAURI__ = {
            core: { invoke: async () => undefined },
        };
        expect(new PiAgentBackend().available()).toBe(true);
    });
});

describe('MockAgentBackend', () => {
    it('replays a scripted array of events in order', async () => {
        const script: AgentEvent[] = [
            { kind: 'thought', text: 'thinking' },
            { kind: 'result', summary: 'done' },
        ];
        const events = await collect(new MockAgentBackend({ script }).run({ prompt: 'x' }));
        expect(events.map((e) => e.kind)).toEqual(['thought', 'result']);
    });

    it('supports a function script derived from the task', async () => {
        const backend = new MockAgentBackend({ script: (task) => demoScript(task.prompt) });
        const events = await collect(backend.run({ prompt: 'add looper' }));
        expect(events[0]).toMatchObject({ kind: 'thought' });
        expect(events.at(-1)?.kind).toBe('result');
        // The demo proposes two add_node tool calls.
        const toolCalls = events.filter((e) => e.kind === 'tool-call');
        expect(toolCalls).toHaveLength(2);
    });

    it('honours the available flag', () => {
        expect(new MockAgentBackend({ script: [], available: false }).available()).toBe(false);
        expect(new MockAgentBackend({ script: [] }).available()).toBe(true);
    });
});

describe('classifySelfEdit — Philia editing its own memory/skills', () => {
    it('recognizes an about-you write as a remembered-you self-edit', () => {
        expect(
            classifySelfEdit('write', { path: '/home/u/.openjammer/agent/.pi/agent/pi-memory/about-you.md' }),
        ).toBe('updated what it knows about you');
    });

    it('recognizes a skill markdown write under pi-memory', () => {
        expect(classifySelfEdit('edit', { path: 'pi-memory/debugging.md' })).toBe(
            'learned a skill (debugging.md)',
        );
    });

    it('recognizes a non-md pi-memory write as a memory update', () => {
        expect(classifySelfEdit('write', { path: 'pi-memory/notes.txt' })).toBe('updated its memory');
    });

    it('recognizes a bash command that touches pi-memory', () => {
        expect(classifySelfEdit('bash', { command: 'echo hi >> pi-memory/log' })).toBe(
            'updated its memory',
        );
    });

    it('recognizes a memory-package verb by name', () => {
        expect(classifySelfEdit('remember', { fact: 'likes long reverbs' })).toBe(
            'remembered something for next time',
        );
    });

    it('recognizes save_self_package as authoring a tool, with its name', () => {
        expect(classifySelfEdit('save_self_package', { name: 'tempo helper', source: '…' })).toBe(
            'saved itself a tool (tempo helper)',
        );
        expect(classifySelfEdit('save_self_package', {})).toBe('saved itself a tool');
    });

    it('returns null for a genuinely unrelated Pi tool', () => {
        expect(classifySelfEdit('write', { path: '/tmp/scratch.txt' })).toBeNull();
        expect(classifySelfEdit('web_search', { query: 'x' })).toBeNull();
    });
});
