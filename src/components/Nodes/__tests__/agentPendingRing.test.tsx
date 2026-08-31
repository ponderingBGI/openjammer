/**
 * W6-CAP D3 — `.is-agent-pending` was dead on half the node components.
 *
 * DESIGN.md §5 calls the breathing violet ring "the only thing that borrows the
 * universal violet outside a port": it is how a player sees which cards an agent
 * just minted, before they trust them. `NodeShell` renders it, but only when the
 * component that owns the shell passes `agentPending` — and every node that
 * renders its OWN `NodeShell` instead of going through `NodeWrapper`'s generic
 * card simply omitted the prop.
 *
 * Verified live by W6-CAP: with the agent session at `phase: 'running'`, a `pan`
 * node (via NodeWrapper) got `.oj-node.is-agent-pending`; an `add` node rendered
 * `oj-node schematic-node math-node add` with no such class. An agent that mints
 * a Speaker, a Math node or a Song showed the player nothing.
 *
 * This mounts every node type in this lane's ownership through the real
 * `NodeWrapper` dispatch, drives the real `agentSessionStore` into the real
 * agent-run state, and asserts the ring is on the card. Each `it.each` row fails
 * on the pre-fix component.
 */

import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useGraphStore } from '../../../store/graphStore';
import { useHistoryStore } from '../../../store/historyStore';
import {
    useAgentSessionStore,
    _resetAgentSessionForTests,
} from '../../../store/agentSessionStore';
import type { NodeType } from '../../../engine/types';
import { NodeWrapper } from '../NodeWrapper';

function resetGraph() {
    useGraphStore.setState({
        nodes: new Map(),
        connections: new Map(),
        connectionsByNode: new Map(),
        rootNodeIds: [],
        selectedNodeIds: new Set(),
        selectedConnectionIds: new Set(),
        clipboard: null,
        version: 0,
    });
    useHistoryStore.getState().clear();
    _resetAgentSessionForTests();
}

/** The real agent-run state: a run is in flight and this node is not in its baseline. */
function startAgentRun() {
    useAgentSessionStore.setState({ phase: 'running', runBaseline: new Set<string>() });
}

function renderNode(type: NodeType) {
    const id = useGraphStore.getState().addNode(type, { x: 0, y: 0 });
    const node = useGraphStore.getState().nodes.get(id)!;
    return render(<NodeWrapper node={node} />);
}

beforeEach(resetGraph);
afterEach(cleanup);

/**
 * Every node type whose component owns its own `NodeShell`.
 *
 * W6-FIX wired the first ten; W6-P7D closes the list with the four P7
 * faceplates (`looper`, `sampler`, `sampler-visual`, `library`), which were the
 * documented follow-up F11. Every node that renders its own shell is now here —
 * if a new faceplate opts out of `NodeWrapper`'s generic card, it belongs in
 * this list too, or an agent that mints it shows the player nothing.
 */
const OWNED: readonly NodeType[] = [
    'add',
    'subtract',
    'speaker',
    'microphone',
    'container',
    'song',
    'canvas-input',
    'canvas-output',
    'input-panel',
    'output-panel',
    'looper',
    'sampler',
    'sampler-visual',
    'library',
] as const;

describe('the agent-pending ring reaches every node this lane owns', () => {
    it.each(OWNED)('%s wears .is-agent-pending while the agent is running', (type) => {
        startAgentRun();
        const { container } = renderNode(type);
        const card = container.querySelector('.oj-node');
        expect(card).not.toBeNull();
        expect(card!.className).toContain('is-agent-pending');
    });

    it.each(OWNED)('%s drops the ring once the run is over', (type) => {
        const { container } = renderNode(type);
        expect(container.querySelector('.oj-node')!.className).not.toContain('is-agent-pending');
    });

    it('a node the run did not create never wears the ring', () => {
        // The baseline is what the agent found on the canvas — a card already
        // there is not pending, even mid-run. Otherwise the ring would light the
        // whole patch and mean nothing.
        const id = useGraphStore.getState().addNode('add', { x: 0, y: 0 });
        useAgentSessionStore.setState({ phase: 'running', runBaseline: new Set([id]) });
        const node = useGraphStore.getState().nodes.get(id)!;
        const { container } = render(<NodeWrapper node={node} />);
        expect(container.querySelector('.oj-node')!.className).not.toContain('is-agent-pending');
    });
});
