/**
 * AI lane public surface (U20).
 *
 * The Ctrl/Cmd+K command bar's AI half imports from here. The default backend is
 * {@link PiAgentBackend} (rpc-subprocess transport via Tauri); in a browser it
 * reports `available() === false` so the UI shows the desktop-only state.
 */

export type {
    AgentBackend,
    AgentEvent,
    AgentTask,
    AgentToolCall,
    AgentToolName,
    AgentUiRequest,
    AddNodeArgs,
    RemoveNodeArgs,
    UpdateNodeDataArgs,
    AddConnectionArgs,
    RemoveConnectionArgs,
    AuthorDspNodeArgs,
} from './types';

export { PiAgentBackend } from './PiAgentBackend';
export { MockAgentBackend, demoScript, type MockAgentOptions } from './MockAgentBackend';
export { applyToolCall, TOOL_CATALOGUE } from './tools';
export type {
    AppliedToolResult,
    DspNodeRegistrar,
    ToolDescriptor,
    AgentEnvPort,
    LogEntrySummary,
    LogsReadResult,
    DiagnosticsReadResult,
    SettingsReadResult,
    SettingsUpdateResult,
} from './tools';
export {
    createGraphStoreApi,
    currentParentId,
    type GraphStoreApi,
    type NodeSnapshot,
} from './graphAdapter';
export { createEnvPort } from './envAdapter';
export { isTauri } from './tauri';
export {
    listSessions,
    loadSessionMessages,
    runCommand,
    sessionsAvailable,
    type SessionInfo,
    type DisplayMessage,
    type SessionTranscript,
} from './piSessions';

import { PiAgentBackend } from './PiAgentBackend';
import type { AgentBackend } from './types';

/**
 * The agent backend the command bar uses. A module-level singleton so the same
 * backend (and its availability check) is shared everywhere.
 */
let backend: AgentBackend = new PiAgentBackend();

/** The current default agent backend. */
export function getAgentBackend(): AgentBackend {
    return backend;
}

/** Override the default backend (tests inject a {@link MockAgentBackend}). */
export function setAgentBackend(next: AgentBackend): void {
    backend = next;
}
