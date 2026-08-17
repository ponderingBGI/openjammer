import { buildDenseEdit, buildFirstLight, buildPathological } from '../song/fixtures';
import type { Arrangement } from '../song/types';
import { useArrangementStore } from '../store/arrangementStore';
import { useHistoryStore, type EditVerb } from '../store/historyStore';
import { useGraphStore } from '../store/graphStore';
import { useEditingContextStore } from '../store/editingContextStore';
import { getAgentBackend, MockAgentBackend, setAgentBackend } from '../ai';
import type { AgentEvent, AgentTask } from '../ai';
import { useAgentSessionStore } from '../store/agentSessionStore';

type FixtureName = 'denseEdit' | 'firstLight' | 'pathological';

interface E2EBridge {
    setFixture(name: FixtureName): void;
    snapshot(): Arrangement | null;
    verbLog(): EditVerb[];
    history(): { cursor: number; entries: number; scopes: string[] };
    selection(): unknown;
    graphSnapshot(): { nodes: unknown[]; connections: unknown[] };
    setAgentScript(script: AgentEvent[] | ((task: AgentTask) => AgentEvent[])): Promise<void>;
    sendAgent(prompt: string): Promise<void>;
    agentSession(): Promise<{ messages: unknown[]; phase: string }>;
}

const clone = <T>(value: T): T => structuredClone(value);

export function installE2EBridge(): void {
    if (typeof window === 'undefined' || !navigator.webdriver) return;
    const fixtures = { denseEdit: buildDenseEdit, firstLight: buildFirstLight, pathological: buildPathological };
    const bridge: E2EBridge = {
        setFixture(name) {
            useArrangementStore.getState().setArrangement(fixtures[name]());
        },
        snapshot: () => clone(useArrangementStore.getState().arrangement),
        verbLog: () => {
            const history = useHistoryStore.getState();
            return clone(history.entries.slice(0, history.cursor).flatMap((entry) => entry.verbs));
        },
        history: () => {
            const history = useHistoryStore.getState();
            return { cursor: history.cursor, entries: history.entries.length, scopes: history.entries.map((entry) => entry.scope) };
        },
        selection: () => clone(useEditingContextStore.getState().viewports.arrangement.selection),
        graphSnapshot: () => {
            const graph = useGraphStore.getState();
            return clone({ nodes: [...graph.nodes.values()], connections: [...graph.connections.values()] });
        },
        setAgentScript: async (script) => setAgentBackend(new MockAgentBackend({ script })),
        sendAgent: async (prompt) => useAgentSessionStore.getState().send(getAgentBackend(), { prompt }),
        agentSession: async () => {
            const session = useAgentSessionStore.getState();
            return clone({ messages: session.messages, phase: session.phase });
        },
    };
    (window as unknown as { __openjammerE2E: E2EBridge }).__openjammerE2E = bridge;
}
