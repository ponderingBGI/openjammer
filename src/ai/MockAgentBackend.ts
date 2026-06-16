/**
 * MockAgentBackend (U20) — a fake agent that replays a scripted event stream.
 *
 * Pi is NOT installed in this sandbox and there is no provider key, so the whole
 * integration is built to compile + type-check + unit-test with Pi MOCKED. This
 * backend proves the tool-call -> graphStore-verb path and the Approve/Reject
 * transaction without any subprocess, network, or model.
 *
 * It is also handy in real use as a deterministic demo: pass a fixed `script`
 * and it yields those events with optional delays, exactly like a streaming
 * model would.
 */

import type { AgentBackend, AgentEvent, AgentTask } from './types';

/** Options controlling the mock's behaviour. */
export interface MockAgentOptions {
    /**
     * The exact sequence of events to yield. If a function, it is called with
     * the task so a test can produce events derived from the prompt. MUST end
     * with a terminal `result` or `error` event.
     */
    script: AgentEvent[] | ((task: AgentTask) => AgentEvent[]);
    /** Whether this backend reports itself available. Default true. */
    available?: boolean;
    /** Optional per-event delay (ms) to simulate streaming. Default 0 (sync). */
    delayMs?: number;
}

/** Sleep helper used only when a streaming delay is requested. */
function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export class MockAgentBackend implements AgentBackend {
    readonly id = 'mock';
    private readonly opts: MockAgentOptions;

    constructor(opts: MockAgentOptions) {
        this.opts = opts;
    }

    available(): boolean {
        return this.opts.available ?? true;
    }

    async *run(task: AgentTask): AsyncIterable<AgentEvent> {
        const events =
            typeof this.opts.script === 'function' ? this.opts.script(task) : this.opts.script;
        for (const event of events) {
            if (this.opts.delayMs) await sleep(this.opts.delayMs);
            yield event;
        }
    }
}

/**
 * A tiny canned plan used by the browser fallback's "what AI would do" preview
 * and by tests as a representative happy path: a thought, two tool calls, and a
 * result. The tool calls use the real registry node types so they apply cleanly.
 */
export function demoScript(prompt: string): AgentEvent[] {
    return [
        { kind: 'thought', text: `Planning how to: ${prompt}` },
        {
            kind: 'tool-call',
            id: 'demo-1',
            call: { name: 'add_node', args: { type: 'looper' } },
        },
        {
            kind: 'tool-call',
            id: 'demo-2',
            call: { name: 'add_node', args: { type: 'speaker' } },
        },
        { kind: 'result', summary: 'Proposed adding a looper feeding a speaker.' },
    ];
}
