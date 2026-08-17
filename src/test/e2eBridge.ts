import { buildDenseEdit, buildFirstLight, buildHundredTracks, buildPathological } from '../song/fixtures';
import type { Arrangement } from '../song/types';
import { useArrangementStore } from '../store/arrangementStore';
import { useHistoryStore, type EditVerb } from '../store/historyStore';
import { useGraphStore } from '../store/graphStore';
import { useEditingContextStore } from '../store/editingContextStore';
import { getAgentBackend, MockAgentBackend, setAgentBackend } from '../ai';
import type { AgentEvent, AgentTask } from '../ai';
import { useAgentSessionStore } from '../store/agentSessionStore';
import { useCollabStore } from '../store/collabStore';
import { reportPluginFault, type PluginFaultKind } from '../store/pluginFaultStore';

type FixtureName = 'denseEdit' | 'firstLight' | 'hundredTracks' | 'pathological';

interface E2EBridge {
    setFixture(name: FixtureName): void;
    snapshot(): Arrangement | null;
    verbLog(): EditVerb[];
    history(): { cursor: number; entries: number; scopes: string[] };
    selection(): unknown;
    graphSnapshot(): { nodes: unknown[]; connections: unknown[] };
    hostCollab(name: string): Promise<string>;
    joinCollab(sessionCode: string, name: string): Promise<void>;
    hostCollabWebRTC(name: string): Promise<string>;
    joinCollabWebRTC(sessionCode: string, name: string): Promise<void>;
    createCollabOffer(): Promise<string>;
    acceptCollabOffer(offer: string): Promise<string>;
    acceptCollabAnswer(answer: string): Promise<void>;
    waitForCollabReady(): Promise<void>;
    addGraphNode(label: string): string;
    pluginFault(pluginName: string, kind: PluginFaultKind, repeats?: number): void;
    setAgentScript(script: AgentEvent[] | ((task: AgentTask) => AgentEvent[])): Promise<void>;
    sendAgent(prompt: string): Promise<void>;
    agentSession(): Promise<{ messages: unknown[]; phase: string }>;
}

const clone = <T>(value: T): T => structuredClone(value);

export function installE2EBridge(): void {
    if (typeof window === 'undefined' || !navigator.webdriver) return;
    const fixtures = { denseEdit: buildDenseEdit, firstLight: buildFirstLight, hundredTracks: buildHundredTracks, pathological: buildPathological };
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
        hostCollab: (name) => useCollabStore.getState().hostSession({ name, transport: 'broadcast-channel' }),
        joinCollab: (sessionCode, name) => useCollabStore.getState().joinSession(sessionCode, { name, transport: 'broadcast-channel' }),
        // These contexts share one host, so host candidates are sufficient. Do
        // not make a deterministic CRDT journey depend on public STUN egress.
        hostCollabWebRTC: (name) => useCollabStore.getState().hostSession({
            name,
            transport: 'webrtc-manual',
            webrtcOptions: { iceServers: [] },
        }),
        joinCollabWebRTC: (sessionCode, name) => useCollabStore.getState().joinSession(sessionCode, {
            name,
            transport: 'webrtc-manual',
            webrtcOptions: { iceServers: [] },
        }),
        createCollabOffer: async () => {
            const transport = useCollabStore.getState().webrtcTransport;
            if (!transport) throw new Error('WebRTC collaboration transport is not active');
            return transport.createOffer();
        },
        acceptCollabOffer: async (offer) => {
            const transport = useCollabStore.getState().webrtcTransport;
            if (!transport) throw new Error('WebRTC collaboration transport is not active');
            return transport.acceptOffer(offer);
        },
        acceptCollabAnswer: async (answer) => {
            const transport = useCollabStore.getState().webrtcTransport;
            if (!transport) throw new Error('WebRTC collaboration transport is not active');
            await transport.acceptAnswer(answer);
        },
        waitForCollabReady: async () => {
            const transport = useCollabStore.getState().webrtcTransport;
            if (!transport) throw new Error('WebRTC collaboration transport is not active');
            await transport.waitUntilReady();
        },
        addGraphNode: (label) => useGraphStore.getState().addNode('effect', { x: 120, y: 120 }, null, { name: label }),
        pluginFault: (pluginName, kind, repeats = 1) => {
            for (let index = 0; index < repeats; index += 1) {
                reportPluginFault({ nodeId: `e2e-${pluginName}`, pluginName, kind, corr: 4242 });
            }
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
