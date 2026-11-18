/**
 * W6-CLEAN #2/#3 — the menu bar asks in the UI, and the question takes focus.
 *
 * `AppMenuBar` used to answer "clear this canvas?" and "no project in that
 * folder — make one?" with a native `confirm()`. Native dialogs block the main
 * thread, cannot be styled or Escaped like the rest of the app, and rip the
 * keyboard away from an instrument that may be sounding. Both are now the same
 * in-UI grammar Settings uses: a danger/info `Callout` carrying
 * `role="alertdialog"`, two real Buttons, the safe one first — and FOCUSED,
 * because an alertdialog nobody is focused on announces into nothing.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useGraphStore } from '../../../store/graphStore';

vi.mock('../../../audio/executor', () => ({
    getExecutor: () => ({ capturePluginStates: vi.fn() }),
    isTauri: () => false,
}));

const { AppMenuBar } = await import('../AppMenuBar');

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
}

beforeEach(resetGraph);
afterEach(() => {
    cleanup();
    resetGraph();
});

/** Open File → New Canvas. */
function chooseNewCanvas() {
    fireEvent.click(screen.getByRole('button', { name: /^File/ }));
    fireEvent.click(screen.getByText('New Canvas'));
}

describe('W6-CLEAN — the menu bar never raises a native dialog', () => {
    it('asks in the UI before clearing a canvas that has nodes on it', () => {
        const nativeConfirm = vi.fn(() => true);
        vi.stubGlobal('confirm', nativeConfirm);
        useGraphStore.getState().addNode('speaker', { x: 0, y: 0 });
        const placed = useGraphStore.getState().nodes.size;
        expect(placed).toBeGreaterThan(0);

        render(<AppMenuBar />);
        chooseNewCanvas();

        expect(nativeConfirm).not.toHaveBeenCalled();
        const dialog = screen.getByRole('alertdialog');
        expect(dialog).toHaveTextContent('Clear this canvas?');
        // The canvas is untouched until the question is answered.
        expect(useGraphStore.getState().nodes.size).toBe(placed);

        vi.unstubAllGlobals();
    });

    it('clears on confirm and keeps the patch on cancel', () => {
        useGraphStore.getState().addNode('speaker', { x: 0, y: 0 });
        const placed = useGraphStore.getState().nodes.size;
        render(<AppMenuBar />);

        chooseNewCanvas();
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(screen.queryByRole('alertdialog')).toBeNull();
        expect(useGraphStore.getState().nodes.size).toBe(placed);

        chooseNewCanvas();
        fireEvent.click(screen.getByRole('button', { name: 'Clear canvas' }));
        expect(screen.queryByRole('alertdialog')).toBeNull();
        expect(useGraphStore.getState().nodes.size).toBe(0);
    });

    it('does not ask at all when there is nothing to lose', () => {
        render(<AppMenuBar />);
        chooseNewCanvas();

        expect(screen.queryByRole('alertdialog')).toBeNull();
    });

    it('gives the destructive word the danger variant, never the inviting accent fill', () => {
        useGraphStore.getState().addNode('speaker', { x: 0, y: 0 });
        render(<AppMenuBar />);
        chooseNewCanvas();

        const destructive = screen.getByRole('button', { name: 'Clear canvas' });
        expect(destructive).toHaveClass('oj-btn--danger');
        expect(destructive).not.toHaveClass('oj-btn--primary');
    });
});

describe('W6-CLEAN #3 — the alertdialog takes focus and gives it back', () => {
    it('lands focus on the safe action and restores it to the menu trigger on close', () => {
        useGraphStore.getState().addNode('speaker', { x: 0, y: 0 });
        render(<AppMenuBar />);

        chooseNewCanvas();
        // Not <body>: the question owns the keyboard while it is up.
        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }));

        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(document.activeElement).toBe(screen.getByRole('button', { name: /^File/ }));
    });

    it('Escape dismisses it the way every other surface is dismissed', () => {
        useGraphStore.getState().addNode('speaker', { x: 0, y: 0 });
        const placed = useGraphStore.getState().nodes.size;
        render(<AppMenuBar />);
        chooseNewCanvas();

        fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape' });

        expect(screen.queryByRole('alertdialog')).toBeNull();
        expect(useGraphStore.getState().nodes.size).toBe(placed);
    });
});

/** Every `.ts`/`.tsx` file under a directory, recursively. */
function sourceFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
        else if (/\.tsx?$/.test(entry)) out.push(full);
    }
    return out;
}

describe('W6-CLEAN — UI-021 is closed for the topbar', () => {
    // `AppMenuBar` lives beside the Topbar it renders into; `Toolbar/` holds the
    // menu primitives it is built from. Neither may reach for a native dialog.
    const roots = ['src/components/Toolbar', 'src/components/Shell'];

    it.each(roots)('has no native confirm()/alert()/prompt() in %s', (root) => {
        const offenders: string[] = [];
        for (const file of sourceFiles(resolve(process.cwd(), root))) {
            if (file.includes('__tests__')) continue;
            const source = readFileSync(file, 'utf8')
                // Prose about the ban is not the ban being broken.
                .replace(/\/\*[\s\S]*?\*\//g, '')
                .replace(/\/\/.*$/gm, '');
            if (/(?<![.\w])(confirm|alert|prompt)\s*\(/.test(source)) offenders.push(file);
        }
        expect(offenders).toEqual([]);
    });
});
