/**
 * U4 — Ctrl+S and New Project do something.
 *
 * `openjammer:new-project` was dispatched from three places and subscribed from
 * none, so Settings advertised Ctrl+S as "Save Project" and the app answered
 * with nothing at all — no dialog, no toast, no console line (UX-INV Q4, FH-1
 * F12). An event with no listener fails silently forever; these pin the direct
 * call that replaced it, and the two intents it has to keep apart.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../../audio/executor', () => ({ getExecutor: () => ({ capturePluginStates: vi.fn() }), isTauri: () => false }));

const { AppMenuBar } = await import('../AppMenuBar');
const { useGraphStore } = await import('../../../store/graphStore');
const { useArrangementStore } = await import('../../../store/arrangementStore');
const { EMERGENCY_KEY } = await import('../../../persistence/recovery/webPayloads');

/** A one-track song, enough to tell "the song went with it" from "it did not". */
const aSong = () => ({
    name: 'Untitled song', schemaVersion: 2, tempoBpm: 120, ppq: 960,
    timeSignature: [4, 4] as [number, number],
    graph: { nodes: [], connections: [] },
    tracks: [{ id: 'track-1', name: 'Track 1', ref: 'track-1', clips: [] }],
});

/**
 * The folder picker and everything under it belongs to `projectStore` (and to
 * jsdom's missing IndexedDB). What G-06 is about is what the MENU BAR does once
 * a project exists, so the store's own action is the seam.
 */
function projectCreatesCleanly() {
    useProjectStore.setState({
        createProject: vi.fn().mockResolvedValue({ name: 'Songs' }),
        saveProject: vi.fn().mockResolvedValue(undefined),
    });
}


const { requestNewProject, useNewProjectDialog } = await import('../newProjectDialog');
const { useProjectStore } = await import('../../../store/projectStore');

const ask = (intent: 'new' | 'save-current') => act(() => requestNewProject(intent));

/** The real actions, so a stub in one test cannot leak into the next. */
const realProjectActions = {
    createProject: useProjectStore.getState().createProject,
    saveProject: useProjectStore.getState().saveProject,
};

beforeEach(() => {
    useNewProjectDialog.getState().close();
    // jsdom has no File System Access API; the supported branch is the one the
    // shipping tier (Chrome/Edge) takes.
    useProjectStore.setState({ isSupported: true, name: null, handleKey: null, isLoading: false, ...realProjectActions });
    useGraphStore.getState().clearGraph();
    useArrangementStore.getState().setArrangement(null);
    localStorage.clear();
});
afterEach(cleanup);

describe('the New Project dialog', () => {
    it('is not there until something asks for it', () => {
        render(<AppMenuBar />);
        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('opens on a direct call — the thing the dead event never did', () => {
        render(<AppMenuBar />);
        ask('new');
        expect(screen.getByRole('dialog', { name: 'New project' })).toBeInTheDocument();
    });

    /*
     * Ctrl+S means SAVE. Wiring it to the same handler as File ▸ New Project…
     * would have made Ctrl+S clear the canvas (the trap UX-INV flagged), so the
     * two intents say different things and do different things.
     */
    it('says what Ctrl+S means, and where the work is being kept meanwhile', () => {
        render(<AppMenuBar />);
        ask('save-current');

        const dialog = screen.getByRole('dialog', { name: 'Save this song to a folder' });
        expect(dialog.textContent).toMatch(/only kept in this browser/i);
        expect(dialog.textContent).toMatch(/folder/i);
    });

    it('takes Escape, like every other question in this app', () => {
        render(<AppMenuBar />);
        ask('new');
        act(() => { fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' }); });
        expect(useNewProjectDialog.getState().intent).toBeNull();
    });

    it('is honest when this browser cannot open a folder at all', () => {
        useProjectStore.setState({ isSupported: false });
        render(<AppMenuBar />);
        ask('new');

        expect(screen.getByRole('dialog').textContent).toMatch(/cannot open a folder/i);
        expect(screen.queryByRole('button', { name: /choose a folder/i })).toBeNull();
        useProjectStore.setState({ isSupported: true });
    });
});

/*
 * G-07. `useConfirmFocus` restores to whatever had focus when the dialog
 * mounted, and the menu bar's fallback is the File trigger — the right answer
 * only when the File menu opened it. Ctrl+S, the palette and Safe Mode all reach
 * this dialog without touching the menu bar, and a keyboard-only player was
 * dropped on `<body>` mid-set.
 */
describe('the dialog gives the keyboard back', () => {
    it('returns focus to whatever asked for it', () => {
        render(<AppMenuBar />);
        const opener = document.createElement('button');
        opener.textContent = 'somewhere else entirely';
        document.body.append(opener);
        opener.focus();

        ask('new');
        expect(document.activeElement).not.toBe(opener);

        act(() => { fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' }); });

        expect(document.activeElement).toBe(opener);
        opener.remove();
    });

    it('falls back to the File trigger when the opener is gone', () => {
        render(<AppMenuBar />);
        const opener = document.createElement('button');
        document.body.append(opener);
        opener.focus();
        ask('new');
        opener.remove();

        act(() => { fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' }); });

        expect((document.activeElement as HTMLElement | null)?.textContent).toBe('File');
    });
});

/*
 * G-06. A new project is a new DOCUMENT, and the document is two halves.
 * Clearing only the canvas left the previous song loaded: it followed the player
 * into the brand-new folder, was written there by the next Ctrl+S, and came back
 * on every clean boot now that a clean boot restores the song.
 */
describe('New Project starts BOTH halves over', () => {
    const chooseFolder = async () => {
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /choose a folder/i }));
        });
        await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    };

    it('clears the song and its backup with the canvas', async () => {
        useGraphStore.getState().addNode('speaker', { x: 0, y: 0 });
        useArrangementStore.getState().setArrangement(aSong());
        localStorage.setItem(EMERGENCY_KEY, '{"nodes":[],"edges":[],"timestamp":1}');
        projectCreatesCleanly();

        render(<AppMenuBar />);
        ask('new');
        await chooseFolder();

        expect(useGraphStore.getState().nodes.size).toBe(0);
        expect(useArrangementStore.getState().arrangement).toBeNull();
        expect(localStorage.getItem(EMERGENCY_KEY)).toBeNull();
    });

    it('but Ctrl+S-without-a-project keeps both', async () => {
        useGraphStore.getState().addNode('speaker', { x: 0, y: 0 });
        useArrangementStore.getState().setArrangement(aSong());
        projectCreatesCleanly();

        render(<AppMenuBar />);
        ask('save-current');
        await chooseFolder();

        expect(useGraphStore.getState().nodes.size).toBeGreaterThan(0);
        expect(useArrangementStore.getState().arrangement).not.toBeNull();
    });
});

describe('Save is discoverable before it is usable', () => {
    it('is in the File menu with no project open', () => {
        render(<AppMenuBar />);
        act(() => { fireEvent.click(screen.getByRole('button', { name: 'File' })); });
        expect(screen.getByText('Save Project')).toBeInTheDocument();
    });
});

/*
 * HA-15. The rule the codebase writes down in `confirmFocus.ts` — a question is
 * asked IN the app, never with a native dialog that blocks the main thread and
 * takes the keyboard off a sounding instrument — applied to the one store that
 * was still breaking it.
 */
describe('the project store asks nothing natively', () => {
    it('has no prompt() or confirm() left in it', () => {
        const source = readFileSync(resolve(process.cwd(), 'src/store/projectStore.ts'), 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/\/\/.*$/gm, '');
        expect(/(?<![.\w])(confirm|alert|prompt)\s*\(/.test(source)).toBe(false);
    });

    it('never silently overwrites a song when nobody can be asked', async () => {
        // No `confirmOverwrite` supplied ⇒ fail closed, not overwrite.
        const state = useProjectStore.getState();
        const picker = vi.fn().mockResolvedValue({
            name: 'Songs',
            getFileHandle: vi.fn().mockResolvedValue({}),
        });
        vi.stubGlobal('showDirectoryPicker', picker);
        useProjectStore.setState({ isLoading: false });

        await expect(state.createProject({ name: 'Mine' })).rejects.toThrow(/already contains a project/);
        vi.unstubAllGlobals();
    });
});
