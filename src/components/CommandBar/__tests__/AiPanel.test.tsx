/**
 * AiPanel (chat redesign) — the conversation surface: composer, slash commands,
 * message rendering, the sandbox footer, and the YOLO toggle+confirm.
 *
 * The capability seam is mocked to the desktop row (agent available + host-jailed
 * → YOLO offered); the AI backend + auth are stubbed so the LIVE chat renders (not
 * the AuthChooser / DesktopOnly states). Store actions are spied so we assert the
 * panel drives them without running a real backend.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import { DESKTOP_CAPABILITIES } from '../../../engine/capabilities';

// jsdom lacks scrollIntoView, which cmdk calls when the provider chooser opens.
if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
}

const authStatusMock = vi.hoisted(() => ({
    activeProvider: 'opencode',
}));

const piSessionsMock = vi.hoisted(() => ({
    runCommand: vi.fn(async () => ({ ok: true })),
    listSlashCommands: vi.fn(async () => [] as Array<{ name: string; description?: string; source: 'extension' | 'prompt' | 'skill' }>),
    getState: vi.fn(async () => ({ ok: true, data: { model: { provider: 'opencode', id: 'zen' } } })),
    listAvailableModels: vi.fn(async () => [
        { provider: 'opencode', id: 'zen', name: 'Zen' },
        { provider: 'openai', id: 'gpt-4o', name: 'GPT-4o', reasoning: true },
    ]),
    setModel: vi.fn(async () => ({ ok: true })),
    setThinkingLevel: vi.fn(async () => ({ ok: true })),
    restartAgent: vi.fn(async () => true),
    prewarmAgent: vi.fn(async () => {}),
    listSessions: vi.fn(async () => []),
    loadSessionMessages: vi.fn(async () => ({ messages: [], incomplete: false })),
}));

vi.mock('../../../audio/executor', () => ({
    getExecutor: () => ({ getCapabilities: () => DESKTOP_CAPABILITIES }),
}));
vi.mock('../../../ai', () => ({ getAgentBackend: () => ({ id: 'stub' }) }));
vi.mock('../../../ai/piSessions', () => ({
    runCommand: piSessionsMock.runCommand,
    listSlashCommands: piSessionsMock.listSlashCommands,
    getState: piSessionsMock.getState,
    listAvailableModels: piSessionsMock.listAvailableModels,
    setModel: piSessionsMock.setModel,
    setThinkingLevel: piSessionsMock.setThinkingLevel,
    restartAgent: piSessionsMock.restartAgent,
    prewarmAgent: piSessionsMock.prewarmAgent,
    listSessions: piSessionsMock.listSessions,
    loadSessionMessages: piSessionsMock.loadSessionMessages,
}));
vi.mock('../../../ai/tauri', () => ({
    isTauri: () => true,
    getInvoke: () => (cmd: string) =>
        cmd === 'auth_status'
            ? Promise.resolve({ configured: true, activeProvider: authStatusMock.activeProvider, conflict: false })
            : Promise.resolve({}),
    listen: () => Promise.resolve(() => {}),
    openExternal: vi.fn(),
}));

import { AiPanel } from '../AiPanel';
import { useAuthStore } from '../../../auth/authStore';
import { useSandboxStore } from '../../../store/sandboxStore';
import { useAgentSessionStore, type ConversationEntry } from '../../../store/agentSessionStore';

function renderPanel(onBack = vi.fn(), props: Partial<Parameters<typeof AiPanel>[0]> = {}) {
    return { onBack, ...render(<AiPanel initialPrompt="" onBack={onBack} {...props} />) };
}

describe('AiPanel chat', () => {
    beforeEach(() => {
        cleanup();
        authStatusMock.activeProvider = 'opencode';
        useAuthStore.setState({
            activeProvider: 'opencode',
            modelId: 'zen',
            key: 'sk-opencode-test-key',
            providerKeys: { opencode: 'sk-opencode-test-key' },
            providerBaseUrls: {},
            providerCustomModels: {},
            configuredProviderIds: ['opencode'],
            configured: true,
            conflict: false,
        });
        useSandboxStore.setState({ mode: 'jailed', projectLabel: 'MyProject' });
        piSessionsMock.runCommand.mockResolvedValue({ ok: true });
        piSessionsMock.listSlashCommands.mockImplementation(() => new Promise(() => {}));
        piSessionsMock.getState.mockResolvedValue({ ok: true, data: { model: { provider: 'opencode', id: 'zen' } } });
        piSessionsMock.listAvailableModels.mockResolvedValue([
            { provider: 'opencode', id: 'zen', name: 'Zen' },
            { provider: 'openai', id: 'gpt-4o', name: 'GPT-4o', reasoning: true },
        ]);
        piSessionsMock.setModel.mockResolvedValue({ ok: true });
        piSessionsMock.setThinkingLevel.mockResolvedValue({ ok: true });
        piSessionsMock.restartAgent.mockResolvedValue(true);
        piSessionsMock.listSessions.mockResolvedValue([]);
        piSessionsMock.loadSessionMessages.mockResolvedValue({ messages: [], incomplete: false });
        useAgentSessionStore.setState({
            phase: 'idle',
            messages: [],
            error: null,
            runtimeStatus: null,
            sessionId: null,
            runBaseline: null,
            send: vi.fn(),
            newSession: vi.fn(),
        });
    });
    afterEach(() => cleanup());

    it('shows the composer and the welcome on an empty conversation', () => {
        renderPanel();
        expect(screen.getByPlaceholderText(/Ask anything/i)).toBeInTheDocument();
        expect(screen.getByText(/describe what to build/i)).toBeInTheDocument();
    });

    it('prewarms the Pi child once on entering AI mode when configured', () => {
        piSessionsMock.prewarmAgent.mockClear();
        renderPanel();
        expect(piSessionsMock.prewarmAgent).toHaveBeenCalledTimes(1);
    });

    it('offers tappable starter chips on a new chat and sends one on click', () => {
        const send = vi.fn();
        useAgentSessionStore.setState({ send });
        const { container } = renderPanel();
        const chips = container.querySelectorAll('.command-bar-ai-welcome-chip');
        expect(chips.length).toBeGreaterThan(0);
        fireEvent.click(chips[0]);
        expect(send).toHaveBeenCalledOnce();
        const sent = send.mock.calls[0][1] as { prompt: string };
        expect(typeof sent.prompt).toBe('string');
        expect(sent.prompt.length).toBeGreaterThan(0);
    });

    it('hides the starter chips once the conversation has started', () => {
        useAgentSessionStore.setState({ messages: [{ id: 'u1', role: 'user', text: 'hi' }] });
        const { container } = renderPanel();
        expect(container.querySelectorAll('.command-bar-ai-welcome-chip').length).toBe(0);
    });

    it('Ctrl+↑ opens rewind; picking a prompt truncates and pre-fills the composer', async () => {
        useAgentSessionStore.setState({
            messages: [
                { id: 'u1', role: 'user', text: 'add a keyboard' },
                { id: 'a1', role: 'assistant', markdown: 'ok', actions: [], streaming: false },
                { id: 'u2', role: 'user', text: 'add a revrb' },
                { id: 'a2', role: 'assistant', markdown: 'ok', actions: [], streaming: false },
            ],
        });
        renderPanel();
        const input = screen.getByPlaceholderText(/Ask anything/i);
        fireEvent.keyDown(input, { key: 'ArrowUp', ctrlKey: true });
        // The rewind picker lists prior prompts.
        expect(screen.getByText('add a revrb')).toBeInTheDocument();
        fireEvent.click(screen.getByText('add a keyboard'));
        await waitFor(() => {
            expect((screen.getByPlaceholderText(/Ask anything/i) as HTMLTextAreaElement).value).toBe('add a keyboard');
        });
        // Truncated to before that turn (conversation-only; canvas untouched).
        expect(useAgentSessionStore.getState().messages).toHaveLength(0);
    });

    it('renders the existing conversation from the store', () => {
        const messages: ConversationEntry[] = [
            { id: 'u1', role: 'user', text: 'add a looper' },
            { id: 'a1', role: 'assistant', markdown: 'Done!', actions: [], streaming: false },
        ];
        useAgentSessionStore.setState({ messages });
        renderPanel();
        expect(screen.getByText('add a looper')).toBeInTheDocument();
        expect(screen.getByText('Done!')).toBeInTheDocument();
    });

    it('Enter sends the composed prompt', () => {
        const send = vi.fn();
        useAgentSessionStore.setState({ send });
        renderPanel();
        const input = screen.getByPlaceholderText(/Ask anything/i);
        fireEvent.change(input, { target: { value: 'make a drone' } });
        fireEvent.keyDown(input, { key: 'Enter' });
        expect(send).toHaveBeenCalledOnce();
        expect(send.mock.calls[0][1]).toMatchObject({ prompt: 'make a drone' });
    });

    it('auto-sends the initial prompt when Tab hands it off', async () => {
        const send = vi.fn();
        useAgentSessionStore.setState({ send });
        renderPanel(vi.fn(), { initialPrompt: 'create an echo node', autoSendInitial: true });
        await waitFor(() => expect(send).toHaveBeenCalledOnce());
        expect(send.mock.calls[0][1]).toMatchObject({ prompt: 'create an echo node' });
        expect(screen.getByPlaceholderText(/Ask anything/i)).toHaveValue('');
    });

    it('Shift+Enter does NOT send (newline)', () => {
        const send = vi.fn();
        useAgentSessionStore.setState({ send });
        renderPanel();
        const input = screen.getByPlaceholderText(/Ask anything/i);
        fireEvent.change(input, { target: { value: 'line one' } });
        fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
        expect(send).not.toHaveBeenCalled();
    });

    it('the /new slash command starts a new session instead of sending', async () => {
        const send = vi.fn();
        const newSession = vi.fn();
        useAgentSessionStore.setState({ send, newSession });
        renderPanel();
        const input = screen.getByPlaceholderText(/Ask anything/i);
        fireEvent.change(input, { target: { value: '/new' } });
        fireEvent.keyDown(input, { key: 'Enter' });
        await screen.findByText(/Started a fresh Pi session/i);
        expect(newSession).toHaveBeenCalledOnce();
        expect(send).not.toHaveBeenCalled();
    });

    it('typing / opens a command menu with built-in commands', () => {
        renderPanel();
        const input = screen.getByPlaceholderText(/Ask anything/i);
        fireEvent.change(input, { target: { value: '/' } });
        const menu = within(screen.getByRole('listbox'));
        expect(menu.getByText('/new')).toBeInTheDocument();
        expect(menu.getByText('/session')).toBeInTheDocument();
    });

    it('merges dynamic Pi commands into the slash menu and forwards them as prompts', async () => {
        const send = vi.fn();
        useAgentSessionStore.setState({ send });
        piSessionsMock.listSlashCommands.mockResolvedValue([
            { name: 'deploy', description: 'Deploy the patch', source: 'prompt' as const },
        ]);
        renderPanel();
        const input = screen.getByPlaceholderText(/Ask anything/i);
        fireEvent.change(input, { target: { value: '/dep prod' } });
        expect(await screen.findByText('/deploy')).toBeInTheDocument();
        fireEvent.keyDown(input, { key: 'Enter' });
        await waitFor(() => expect(send).toHaveBeenCalledOnce());
        expect(send.mock.calls[0][1]).toMatchObject({ prompt: '/deploy prod' });
    });

    it('renders runtime status outside assistant markdown', () => {
        useAgentSessionStore.setState({ runtimeStatus: 'Starting Pi in C:/agent/workspace' });
        renderPanel();
        expect(screen.getByRole('status')).toHaveTextContent('Starting Pi');
    });

    it('/provider opens the provider chooser with the configured provider marked', async () => {
        renderPanel();
        const input = screen.getByPlaceholderText(/Ask anything/i);
        fireEvent.change(input, { target: { value: '/provider' } });
        fireEvent.keyDown(input, { key: 'Enter' });
        expect(await screen.findByText(/Configured:/i)).toBeInTheDocument();
        expect(screen.getAllByText(/opencode Zen/i).length).toBeGreaterThan(0);
        expect(screen.getByText(/Already configured/i)).toBeInTheDocument();
    });

    it('/model only shows configured providers and selecting one updates Pi', async () => {
        renderPanel();
        const input = screen.getByPlaceholderText(/Ask anything/i);
        fireEvent.change(input, { target: { value: '/model' } });
        fireEvent.keyDown(input, { key: 'Enter' });
        expect(await screen.findByText(/Choose model/i)).toBeInTheDocument();
        expect(screen.getByText(/Showing configured providers only: opencode Zen/i)).toBeInTheDocument();
        expect(screen.queryByText('GPT-4o')).not.toBeInTheDocument();
        fireEvent.click(await screen.findByText('Zen'));
        await waitFor(() => expect(piSessionsMock.setModel).toHaveBeenCalledWith(
            'opencode',
            'zen',
            expect.objectContaining({ providerKeys: { opencode: 'sk-opencode-test-key' } }),
        ));
        expect(await screen.findByText(/Model: opencode Zen \/ zen/i)).toBeInTheDocument();
    });

    it('/models can add a typed custom OpenAI-compatible model id', async () => {
        authStatusMock.activeProvider = 'openai';
        useAuthStore.setState({
            activeProvider: 'openai',
            modelId: undefined,
            key: 'sk-openrouter-test-key',
            providerKeys: { openai: 'sk-openrouter-test-key' },
            providerBaseUrls: { openai: 'https://openrouter.ai/api/v1' },
            providerCustomModels: {},
            configuredProviderIds: ['openai'],
            configured: true,
            conflict: false,
        });
        piSessionsMock.listAvailableModels.mockResolvedValue([]);
        renderPanel();
        const input = screen.getByPlaceholderText(/Ask anything/i);
        fireEvent.change(input, { target: { value: '/models anthropic/claude-sonnet-4' } });
        fireEvent.keyDown(input, { key: 'Enter' });
        expect(await screen.findByText(/Use “anthropic\/claude-sonnet-4”/i)).toBeInTheDocument();
        fireEvent.click(screen.getByText(/Use “anthropic\/claude-sonnet-4”/i));
        await waitFor(() => expect(piSessionsMock.setModel).toHaveBeenCalledWith(
            'openai',
            'anthropic/claude-sonnet-4',
            expect.objectContaining({
                providerBaseUrls: { openai: 'https://openrouter.ai/api/v1' },
                providerCustomModels: { openai: ['anthropic/claude-sonnet-4'] },
            }),
        ));
    });

    it('Shift+Tab changes the visible reasoning level immediately and the next prompt carries it', () => {
        const send = vi.fn();
        useAgentSessionStore.setState({ send });
        renderPanel();
        const input = screen.getByPlaceholderText(/Ask anything/i);
        fireEvent.keyDown(input, { key: 'Tab', shiftKey: true });
        // Single source of truth: the level shows exactly once (no transcript
        // toast, no duplicate composer-hint copy) and is its own clickable control.
        expect(screen.getAllByText(/Thinking: high/i)).toHaveLength(1);
        expect(
            screen.getByRole('button', { name: /Reasoning level: high/i }),
        ).toBeInTheDocument();
        expect(piSessionsMock.setThinkingLevel).not.toHaveBeenCalled();

        fireEvent.change(input, { target: { value: 'make a drone' } });
        fireEvent.keyDown(input, { key: 'Enter' });
        expect(send).toHaveBeenCalledOnce();
        expect(send.mock.calls[0][1]).toMatchObject({
            prompt: 'make a drone',
            thinkingLevel: 'high',
        });
    });

    it('app slash commands can open OpenJammer chrome and close the palette', () => {
        const onClose = vi.fn();
        const onHotkeys = vi.fn();
        window.addEventListener('openjammer:toggle-help', onHotkeys);
        renderPanel(vi.fn(), { onClose });
        const input = screen.getByPlaceholderText(/Ask anything/i);
        fireEvent.change(input, { target: { value: '/hotkeys' } });
        fireEvent.keyDown(input, { key: 'Enter' });
        expect(onHotkeys).toHaveBeenCalledOnce();
        expect(onClose).toHaveBeenCalledOnce();
        window.removeEventListener('openjammer:toggle-help', onHotkeys);
    });

    it('the + New button starts a new session', () => {
        const newSession = vi.fn();
        useAgentSessionStore.setState({ newSession });
        renderPanel();
        fireEvent.click(screen.getByRole('button', { name: /\+ New/i }));
        expect(newSession).toHaveBeenCalledOnce();
    });

    it('shows the sandbox footer with the project jail boundary', () => {
        renderPanel();
        expect(screen.getByText(/Sandboxed/i)).toBeInTheDocument();
        expect(screen.getByText('MyProject/')).toBeInTheDocument();
    });

    it('YOLO toggle gates behind an explicit confirm, then flips the footer', () => {
        renderPanel();
        fireEvent.click(screen.getByRole('button', { name: 'YOLO' }));
        expect(screen.getByText(/Enter YOLO mode\?/i)).toBeInTheDocument();
        expect(useSandboxStore.getState().mode).toBe('jailed');
        fireEvent.click(screen.getByRole('button', { name: /Enter YOLO/i }));
        expect(useSandboxStore.getState().mode).toBe('yolo');
        expect(screen.getByText(/YOLO Mode/i)).toBeInTheDocument();
    });
});
