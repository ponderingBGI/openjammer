/**
 * ContextMenu (M4 → W4-P5) render + keyboard tests.
 *
 * The right-click menu is a FILTERED PROJECTION of the SAME Action registry the
 * Ctrl+K palette reads, filtered to `surface: 'menu'`. These tests exercise that
 * projection through the real component:
 *   (a) the nested CATEGORIES render with their items (grouped by `action.path`);
 *   (b) selecting an item RUNS the action (spawning a node via the registered
 *       `run`) and CLOSES the menu;
 *   (c) the MIDI item (`node.add.midi`) triggers `onOpenMIDIBrowser` instead of
 *       running its action, when the handler is provided.
 *
 * W4-P5 adds the audited behaviours the bespoke CSS engine never had:
 *   - UI-003 — roving focus, Home/End, typeahead, Left/Right submenu
 *     disclosure, an Escape cascade and focus restore on close;
 *   - UI-004 — a submenu that would clip the viewport's right edge flips;
 *   - UI-031 — every menu animation is inert under reduced motion.
 *
 * The capability seam is mocked (desktop) so `buildMenuCtx` is deterministic;
 * `useCanvasStore.screenToCanvas` is mocked to an identity so the clicked point
 * is predictable.
 */

import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import { DESKTOP_CAPABILITIES } from '../../../engine/capabilities';
import type { Position } from '../../../engine/types';

// --- Mocks -----------------------------------------------------------------

// Deterministic capability seam: desktop row.
vi.mock('../../../audio/executor', () => ({
    getExecutor: () => ({
        getCapabilities: () => DESKTOP_CAPABILITIES,
    }),
}));

// Identity screenToCanvas so the menu's canvas point == its screen point.
vi.mock('../../../store/canvasStore', () => ({
    useCanvasStore: Object.assign(
        (selector: (s: { screenToCanvas: (p: Position) => Position }) => unknown) =>
            selector({ screenToCanvas: (p: Position) => p }),
        {
            getState: () => ({ screenToCanvas: (p: Position) => p }),
        },
    ),
}));

import { ContextMenu } from '../ContextMenu';
import {
    register,
    registerAll,
    _resetForTests,
    type Action,
} from '../../../store/commandRegistry';
import { useGraphStore } from '../../../store/graphStore';

/** A node-add-style Action offered on both surfaces, placed in `path` category. */
function makeNodeAdd(
    id: string,
    title: string,
    category: string,
    run = vi.fn(),
): Action {
    return {
        id,
        title,
        group: category,
        path: [category],
        targets: ['global', 'canvasPoint', 'selection'],
        surfaces: ['palette', 'menu'],
        run,
    };
}

const POSITION: Position = { x: 100, y: 120 };

/** Every row the ROOT panel's roving focus can land on. */
function rootRows(): HTMLElement[] {
    return Array.from(
        document.querySelectorAll<HTMLElement>('.context-menu > .oj-menu-item'),
    );
}

/** The category (submenu-disclosing) rows, in render order. */
function categoryRows(): HTMLElement[] {
    return Array.from(
        document.querySelectorAll<HTMLElement>('.context-menu > .oj-menu-item[data-category]'),
    );
}

describe('ContextMenu (M4)', () => {
    beforeEach(() => {
        cleanup();
        _resetForTests();
        // No selection (menu ctx → no single node target).
        useGraphStore.setState({ selectedNodeIds: new Set() });
    });

    afterEach(() => {
        cleanup();
    });

    it('renders the nested categories with their items (projection of the registry)', () => {
        registerAll([
            makeNodeAdd('node.add.looper', 'Add Looper', 'Routing'),
            makeNodeAdd('node.add.keys', 'Add Keys', 'Instruments'),
        ]);

        render(<ContextMenu position={POSITION} onClose={() => {}} />);

        // Both categories present...
        expect(screen.getByText('Instruments')).toBeInTheDocument();
        expect(screen.getByText('Routing')).toBeInTheDocument();
        // ...with their items.
        expect(screen.getByText('Add Keys')).toBeInTheDocument();
        expect(screen.getByText('Add Looper')).toBeInTheDocument();
    });

    it('does NOT show palette-only actions (the curated SUBSET)', () => {
        registerAll([
            makeNodeAdd('node.add.looper', 'Add Looper', 'Routing'),
            // App action: palette-only, must be absent from the menu.
            {
                id: 'app.settings',
                title: 'Open Settings',
                group: 'App',
                targets: ['global'],
                surfaces: ['palette'],
                run: vi.fn(),
            },
        ]);

        render(<ContextMenu position={POSITION} onClose={() => {}} />);

        expect(screen.getByText('Add Looper')).toBeInTheDocument();
        expect(screen.queryByText('Open Settings')).toBeNull();
    });

    it('runs the action and closes when an item is selected', () => {
        const run = vi.fn();
        const onClose = vi.fn();
        register(makeNodeAdd('node.add.looper', 'Add Looper', 'Routing', run));

        render(<ContextMenu position={POSITION} onClose={onClose} />);
        fireEvent.click(screen.getByText('Add Looper'));

        // The action ran, with a ctx carrying the clicked canvas point.
        expect(run).toHaveBeenCalledOnce();
        const ctx = run.mock.calls[0][0];
        expect(ctx.point).toEqual(POSITION);
        expect(ctx.targetKinds).toContain('canvasPoint');

        // The menu closes (rAF-deferred).
        return new Promise<void>((resolve) => {
            requestAnimationFrame(() => {
                expect(onClose).toHaveBeenCalled();
                resolve();
            });
        });
    });

    it('appends unknown groups (e.g. AI DSP) after the known categories', () => {
        registerAll([
            makeNodeAdd('node.add.looper', 'Add Looper', 'Routing'),
            makeNodeAdd('ai.dsp.reverb', 'Add Reverb', 'AI DSP'),
        ]);

        render(<ContextMenu position={POSITION} onClose={() => {}} />);

        const categories = categoryRows().map((row) => row.dataset.category);

        // 'AI DSP' (unknown) comes after 'Routing' (known).
        expect(categories.indexOf('AI DSP')).toBeGreaterThan(
            categories.indexOf('Routing'),
        );
    });

    it('opens the MIDI browser instead of running the action for the MIDI item', () => {
        const midiRun = vi.fn();
        const onOpenMIDIBrowser = vi.fn();
        const onClose = vi.fn();
        register(makeNodeAdd('node.add.midi', 'Add Midi', 'Input', midiRun));

        render(
            <ContextMenu
                position={POSITION}
                onClose={onClose}
                onOpenMIDIBrowser={onOpenMIDIBrowser}
            />,
        );

        fireEvent.click(screen.getByText('Add Midi'));

        // The browser opened; the add action did NOT run; the menu closed.
        expect(onOpenMIDIBrowser).toHaveBeenCalledOnce();
        expect(midiRun).not.toHaveBeenCalled();
        expect(onClose).toHaveBeenCalled();
    });

    it('keeps keyboard a11y: Escape closes the menu', () => {
        const onClose = vi.fn();
        register(makeNodeAdd('node.add.looper', 'Add Looper', 'Routing'));

        render(<ContextMenu position={POSITION} onClose={onClose} />);
        fireEvent.keyDown(document, { key: 'Escape' });

        expect(onClose).toHaveBeenCalled();
    });

    it('exposes role=menu and role=menuitem for screen readers', () => {
        register(makeNodeAdd('node.add.looper', 'Add Looper', 'Routing'));

        render(<ContextMenu position={POSITION} onClose={() => {}} />);

        const menu = screen.getByRole('menu', { name: 'Canvas menu' });
        expect(menu).toBeInTheDocument();
        // The item is a menuitem, inside the category's own labelled submenu.
        expect(screen.getByText('Add Looper').closest('[role="menuitem"]')).not.toBeNull();
        expect(screen.getByRole('menu', { name: 'Routing' })).toBeInTheDocument();
        expect(within(menu).getByText('Cancel')).toBeInTheDocument();
    });

    // ── UX-1C: HA-21 (no emoji) and HA-26 (the verbs, and a node menu) ────

    /**
     * The six category emoji were the only ones in the instrument, and their own
     * comment admitted they were kept to stay "byte-faithful" to the pre-redesign
     * UI. PRODUCT.md lists "a toy" as an explicit anti-reference.
     */
    it('HA-21: the category rows carry no emoji at all', () => {
        registerAll([
            makeNodeAdd('node.add.keys', 'Add Keys', 'Instruments'),
            makeNodeAdd('node.add.looper', 'Add Looper', 'Routing'),
        ]);

        const { container } = render(<ContextMenu position={POSITION} onClose={() => {}} />);

        expect(container.querySelector('.oj-menu-item__icon')).toBeNull();
        expect(container.textContent ?? '').not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2328}]/u);
    });

    /**
     * HA-26 — delete, copy, paste, duplicate and select-all had NO pointer route
     * anywhere in the application. They are now rows, and they run the canvas's
     * own verb functions, which is what the keymap runs too.
     */
    it('HA-26: the canvas menu runs the SAME edit verbs the keymap runs', () => {
        register(makeNodeAdd('node.add.looper', 'Add Looper', 'Routing'));
        const verbs = {
            copy: vi.fn(),
            paste: vi.fn(),
            duplicate: vi.fn(),
            selectAll: vi.fn(),
            remove: vi.fn(),
            disconnectNode: vi.fn(),
            hasSelection: true,
        };

        render(<ContextMenu position={POSITION} onClose={() => {}} verbs={verbs} />);

        for (const [label, spy] of [
            ['Copy', verbs.copy],
            ['Paste', verbs.paste],
            ['Select all', verbs.selectAll],
            ['Delete', verbs.remove],
        ] as const) {
            fireEvent.click(screen.getByText(label).closest('[role="menuitem"]')!);
            expect(spy, `${label} runs its verb`).toHaveBeenCalledTimes(1);
        }
    });

    it('HA-26: verbs that need a selection are disabled when there is none', () => {
        register(makeNodeAdd('node.add.looper', 'Add Looper', 'Routing'));
        const verbs = {
            copy: vi.fn(), paste: vi.fn(), duplicate: vi.fn(), selectAll: vi.fn(),
            remove: vi.fn(), disconnectNode: vi.fn(), hasSelection: false,
        };

        render(<ContextMenu position={POSITION} onClose={() => {}} verbs={verbs} />);

        expect(screen.getByText('Copy').closest('[role="menuitem"]'))
            .toHaveAttribute('aria-disabled', 'true');
        // Paste and Select all do not need one — pasting into an empty canvas and
        // selecting everything are exactly what you do when nothing is selected.
        expect(screen.getByText('Paste').closest('[role="menuitem"]'))
            .not.toHaveAttribute('aria-disabled', 'true');
    });

    it('HA-26: right-clicking a card opens that card’s menu, add categories included', () => {
        register(makeNodeAdd('node.add.looper', 'Add Looper', 'Routing'));
        const verbs = {
            copy: vi.fn(), paste: vi.fn(), duplicate: vi.fn(), selectAll: vi.fn(),
            remove: vi.fn(), disconnectNode: vi.fn(), hasSelection: true,
        };

        render(
            <ContextMenu
                position={POSITION}
                onClose={() => {}}
                verbs={verbs}
                target={{ id: 'node-1', title: 'Looper' }}
            />,
        );

        const menu = screen.getByRole('menu', { name: 'Looper menu' });
        expect(within(menu).getByText('Disconnect all cables')).toBeInTheDocument();
        // Still an ADD menu: a right-click is how a first-run player adds a node.
        expect(within(menu).getByText('Routing')).toBeInTheDocument();

        fireEvent.click(screen.getByText('Disconnect all cables').closest('[role="menuitem"]')!);
        expect(verbs.disconnectNode).toHaveBeenCalledWith('node-1');
    });

    // ── W4-P5: UI-003 keyboard operability ────────────────────────────────

    it('opens with the first row focused and moves focus with arrows/Home/End', () => {
        registerAll([
            makeNodeAdd('node.add.keys', 'Add Keys', 'Instruments'),
            makeNodeAdd('node.add.looper', 'Add Looper', 'Routing'),
        ]);

        render(<ContextMenu position={POSITION} onClose={() => {}} />);

        const rows = rootRows();
        expect(document.activeElement).toBe(rows[0]);

        fireEvent.keyDown(rows[0], { key: 'ArrowDown' });
        expect(document.activeElement).toBe(rows[1]);

        fireEvent.keyDown(rows[1], { key: 'End' });
        expect(document.activeElement).toBe(rows[rows.length - 1]);

        fireEvent.keyDown(document.activeElement!, { key: 'Home' });
        expect(document.activeElement).toBe(rows[0]);
    });

    it('discloses a submenu with ArrowRight and closes it with ArrowLeft (UI-003)', async () => {
        register(makeNodeAdd('node.add.looper', 'Add Looper', 'Routing'));

        render(<ContextMenu position={POSITION} onClose={() => {}} />);
        const routing = categoryRows()[0];
        routing.focus();

        expect(routing).toHaveAttribute('data-open', 'false');
        fireEvent.keyDown(routing, { key: 'ArrowRight' });
        await waitFor(() =>
            expect(categoryRows()[0]).toHaveAttribute('data-open', 'true'),
        );
        // Focus lands on the submenu's first item.
        await waitFor(() =>
            expect(document.activeElement?.textContent).toContain('Add Looper'),
        );

        fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' });
        expect(categoryRows()[0]).toHaveAttribute('data-open', 'false');
        expect(document.activeElement).toBe(categoryRows()[0]);
    });

    it('Escape CASCADES: the submenu closes first, then the menu', async () => {
        const onClose = vi.fn();
        register(makeNodeAdd('node.add.looper', 'Add Looper', 'Routing'));

        render(<ContextMenu position={POSITION} onClose={onClose} />);
        fireEvent.click(categoryRows()[0]);
        await waitFor(() =>
            expect(categoryRows()[0]).toHaveAttribute('data-open', 'true'),
        );

        fireEvent.keyDown(document, { key: 'Escape' });
        expect(categoryRows()[0]).toHaveAttribute('data-open', 'false');
        expect(onClose).not.toHaveBeenCalled();

        fireEvent.keyDown(document, { key: 'Escape' });
        expect(onClose).toHaveBeenCalled();
    });

    it('typeahead jumps to the row whose label starts with what was typed', () => {
        registerAll([
            makeNodeAdd('node.add.keys', 'Add Keys', 'Instruments'),
            makeNodeAdd('node.add.looper', 'Add Looper', 'Routing'),
        ]);

        render(<ContextMenu position={POSITION} onClose={() => {}} />);
        const rows = categoryRows();
        rows[0].focus();

        fireEvent.keyDown(rows[0], { key: 'r' });
        expect((document.activeElement as HTMLElement).dataset.category).toBe('Routing');
    });

    it('scopes typeahead to the open submenu that owns focus', async () => {
        registerAll([
            makeNodeAdd('node.add.keyboard', 'Add Keyboard', 'Input'),
            makeNodeAdd('node.add.oscillator', 'Add Oscillator', 'Input'),
            makeNodeAdd('node.add.speaker', 'Add Speaker', 'Output'),
        ]);

        render(<ContextMenu position={POSITION} onClose={() => {}} />);
        const input = categoryRows().find((row) => row.dataset.category === 'Input')!;
        fireEvent.keyDown(input, { key: 'ArrowRight' });

        // Element identity, not text: the "Input" row's textContent contains its
        // whole submenu, so a text assertion would pass with focus still outside.
        await waitFor(() =>
            expect(document.activeElement).toBe(
                screen.getByText('Add Keyboard').closest('[role="menuitem"]'),
            ),
        );
        fireEvent.keyDown(document.activeElement!, { key: 'o' });

        expect(document.activeElement).toBe(
            screen.getByText('Add Oscillator').closest('[role="menuitem"]'),
        );
        expect(document.activeElement).not.toBe(
            categoryRows().find((row) => row.dataset.category === 'Output'),
        );
    });

    it('types ahead by the node name inside a submenu, not by the "Add" verb', async () => {
        // Every submenu row is phrased "Add <node>", so matching the literal
        // label would make typeahead useless exactly where the review said it
        // was most wanted: "s" for Speaker inside Output.
        registerAll([
            // Recorder first, so focus opens on it and the jump to Speaker is
            // a real move rather than a row matching itself.
            makeNodeAdd('node.add.recorder', 'Add Recorder', 'Output'),
            makeNodeAdd('node.add.speaker', 'Add Speaker', 'Output'),
        ]);

        render(<ContextMenu position={POSITION} onClose={() => {}} />);
        const output = categoryRows().find((row) => row.dataset.category === 'Output')!;
        fireEvent.keyDown(output, { key: 'ArrowRight' });

        // Assert on the ELEMENT, not its text: a category row's textContent
        // contains its whole submenu, so a text check would pass while focus
        // was still sitting on "Output".
        await waitFor(() =>
            expect(document.activeElement).toBe(
                screen.getByText('Add Recorder').closest('[role="menuitem"]'),
            ),
        );

        fireEvent.keyDown(document.activeElement!, { key: 's' });
        expect(document.activeElement).toBe(
            screen.getByText('Add Speaker').closest('[role="menuitem"]'),
        );
    });

    it('restores focus to the element that had it before the menu opened', () => {
        register(makeNodeAdd('node.add.looper', 'Add Looper', 'Routing'));

        const trigger = document.createElement('button');
        document.body.appendChild(trigger);
        trigger.focus();

        const view = render(<ContextMenu position={POSITION} onClose={() => {}} />);
        expect(document.activeElement).not.toBe(trigger);

        view.unmount();
        expect(document.activeElement).toBe(trigger);
        trigger.remove();
    });

    // ── W4-P5: UI-004 flip/clamp ──────────────────────────────────────────

    it('flips a submenu to the left when it would clip the right edge (UI-004)', async () => {
        register(makeNodeAdd('node.add.looper', 'Add Looper', 'Routing'));

        // jsdom reports zero-size rects; stand in a geometry where the submenu's
        // default (right-hand) placement overflows the viewport.
        const rect = (left: number, width: number): DOMRect =>
            ({
                left,
                width,
                right: left + width,
                top: 0,
                bottom: 100,
                height: 100,
                x: left,
                y: 0,
                toJSON: () => ({}),
            }) as DOMRect;
        const spy = vi
            .spyOn(Element.prototype, 'getBoundingClientRect')
            .mockImplementation(function (this: Element) {
                if (this.classList.contains('oj-menu-item__submenu')) {
                    return (this as HTMLElement).style.right === '100%'
                        ? rect(600, 200)
                        : rect(window.innerWidth - 40, 200);
                }
                return rect(0, 200);
            });

        render(<ContextMenu position={POSITION} onClose={() => {}} />);
        fireEvent.click(categoryRows()[0]);

        await waitFor(() => {
            const sub = document.querySelector<HTMLElement>('.oj-menu-item__submenu');
            expect(sub).toHaveAttribute('data-flipped', 'true');
            expect(sub!.style.right).toBe('100%');
        });
        spy.mockRestore();
    });

    // ── W4-P5: UI-031 reduced motion ──────────────────────────────────────

    it('holds every menu animation still under prefers-reduced-motion (UI-031)', () => {
        const css = readFileSync('src/components/Canvas/ContextMenu.css', 'utf8');
        const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
        expect(reduced).not.toBe('');
        expect(reduced).toContain('animation: none');
    });
});
