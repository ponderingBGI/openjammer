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

const piSessionsMock = vi.hoisted(() => ({
    runCommand: vi.fn(async () => ({ ok: true })),
    listSlashCommands: vi.fn(async () => [] as Array<{ name: string; description?: string; source: 'extension' | 'prompt' | 'skill' }>),
    restartAgent: vi.fn(async () => true),
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
    restartAgent: piSessionsMock.restartAgent,
    listSessions: piSessionsMock.listSessions,
    loadSessionMessages: piSessionsMock.loadSessionMessages,
}));
vi.mock('../../../ai/tauri', () => ({
    isTauri: () => true,
    getInvoke: () => (cmd: string) =>
        cmd === 'auth_status'
            ? Promise.resolve({ configured: true, activeProvider: 'opencode', conflict: false })
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
        useAuthStore.setState({ configured: true, conflict: false });
        useSandboxStore.setState({ mode: 'jailed', projectLabel: 'MyProject' });
        piSessionsMock.runCommand.mockResolvedValue({ ok: true });
        piSessionsMock.listSlashCommands.mockImplementation(() => new Promise(() => {}));
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
