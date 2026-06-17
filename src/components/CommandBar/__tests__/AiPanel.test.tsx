/**
 * AiPanel (Phase 5/6) — the AI surface chrome: permission footer, YOLO
 * toggle+confirm, keyboard help, and the Approve/Reject hotkeys.
 *
 * The capability seam is mocked to the desktop row (agent available + host-jailed
 * → YOLO offered), the AI backend + auth are stubbed so the LIVE agent surface
 * renders (not the AuthChooser / DesktopOnly states).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { DESKTOP_CAPABILITIES } from '../../../engine/capabilities';

vi.mock('../../../audio/executor', () => ({
    getExecutor: () => ({ getCapabilities: () => DESKTOP_CAPABILITIES }),
}));
vi.mock('../../../ai', () => ({ getAgentBackend: () => ({ name: 'stub' }) }));
vi.mock('../../../ai/tauri', () => ({
    getInvoke: () => (cmd: string) =>
        cmd === 'auth_status'
            ? Promise.resolve({ configured: true, activeProvider: 'opencode', conflict: false })
            : Promise.resolve({}),
    openExternal: vi.fn(),
}));

import { AiPanel } from '../AiPanel';
import { useAuthStore } from '../../../auth/authStore';
import { useSandboxStore } from '../../../store/sandboxStore';
import { useAgentSessionStore, type TranscriptEntry } from '../../../store/agentSessionStore';

function renderPanel(onClose = vi.fn(), onBack = vi.fn()) {
    return { onClose, onBack, ...render(<AiPanel initialPrompt="" onBack={onBack} onClose={onClose} />) };
}

describe('AiPanel chrome (Phase 5/6)', () => {
    beforeEach(() => {
        cleanup();
        useAuthStore.setState({ configured: true, conflict: false });
        useSandboxStore.setState({ mode: 'jailed', projectLabel: 'MyProject' });
        useAgentSessionStore.setState({ phase: 'idle', transcript: [], error: null, prompt: '' });
    });
    afterEach(() => cleanup());

    it('shows the sandbox footer with the project jail boundary', () => {
        renderPanel();
        expect(screen.getByText(/Sandboxed/i)).toBeInTheDocument();
        expect(screen.getByText('MyProject/')).toBeInTheDocument();
    });

    it('YOLO toggle gates behind an explicit confirm, then flips the footer', () => {
        renderPanel();
        // Jailed: a "YOLO" toggle is offered (desktop can host-jail).
        fireEvent.click(screen.getByRole('button', { name: 'YOLO' }));
        // It does NOT enter YOLO directly — a confirm appears.
        expect(screen.getByText(/Enter YOLO mode\?/i)).toBeInTheDocument();
        expect(useSandboxStore.getState().mode).toBe('jailed');
        // Confirming enters YOLO; the footer now reports the danger state by label.
        fireEvent.click(screen.getByRole('button', { name: /Enter YOLO/i }));
        expect(useSandboxStore.getState().mode).toBe('yolo');
        expect(screen.getByText(/YOLO Mode/i)).toBeInTheDocument();
    });

    it('the "?" affordance toggles the keyboard-shortcut help', () => {
        renderPanel();
        expect(screen.queryByText('Shortcuts')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: /keyboard shortcuts/i }));
        expect(screen.getByText('Shortcuts')).toBeInTheDocument();
        expect(screen.getByText(/Approve the changes/i)).toBeInTheDocument();
    });

    it('Approve hotkey (mod+Shift+Enter) approves and closes when awaiting approval', () => {
        const entry: TranscriptEntry = {
            id: 'e1',
            event: { kind: 'result', summary: 'Built a reverb chain.' },
        };
        useAgentSessionStore.setState({ phase: 'awaiting-approval', transcript: [entry] });
        const { onClose } = renderPanel();

        fireEvent.keyDown(window, { key: 'Enter', ctrlKey: true, shiftKey: true });

        expect(onClose).toHaveBeenCalledOnce();
        expect(useAgentSessionStore.getState().phase).toBe('idle');
    });

    it('Reject hotkey (Esc) reverts when awaiting approval', () => {
        const entry: TranscriptEntry = {
            id: 'e1',
            event: { kind: 'result', summary: 'Built a reverb chain.' },
        };
        useAgentSessionStore.setState({ phase: 'awaiting-approval', transcript: [entry] });
        renderPanel();

        fireEvent.keyDown(window, { key: 'Escape' });

        expect(useAgentSessionStore.getState().phase).toBe('idle');
    });
});
