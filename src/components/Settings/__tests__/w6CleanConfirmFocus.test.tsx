/**
 * W6-CLEAN #3/#4 — the Keybindings panel's focus discipline and its tone.
 *
 * Three findings from the P9 gate, all of them about where the keyboard IS:
 *
 *  • The in-panel confirm never took focus. `data-autofocus="true"` is honoured
 *    by `Modal` on OPEN, not when new content appears inside an already-open
 *    dialog, so the `role="alertdialog"` announced into nothing and Tab kept
 *    walking the panel behind it.
 *  • Activating a keycap unmounted the Button and mounted a plain `<span>` in
 *    its place, so `document.activeElement` was `<body>` for the whole capture —
 *    no focus ring, no focused control, during the one gesture that is entirely
 *    about the keyboard.
 *  • "Replace" — unbinding someone else's shortcut — wore `variant="primary"`,
 *    the most inviting colour in the system, inside a danger-toned card.
 */

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { KeybindingsPanel } from '../KeybindingsPanel';
import { useKeybindingsStore } from '../../../store/keybindingsStore';

beforeEach(() => {
    cleanup();
    useKeybindingsStore.setState({ customBindings: {} });
});

afterEach(cleanup);

function deleteRow(): HTMLElement {
    return screen.getByText('Delete Selected').closest('.keybindings-row') as HTMLElement;
}

function deleteKeycap(): HTMLElement {
    return within(deleteRow()).getByRole('button', {
        name: 'Change the shortcut for Delete Selected',
    });
}

/** Start a capture on Delete Selected, then release `combo`. */
function capture(combo: { key: string; ctrlKey?: boolean }) {
    fireEvent.keyDown(document, combo);
    fireEvent.keyUp(document, { key: combo.key });
}

describe('W6-CLEAN — the capture box holds the keyboard, not <body>', () => {
    it('moves focus onto the capture box for the whole gesture', () => {
        render(<KeybindingsPanel />);

        fireEvent.click(deleteKeycap());

        const box = within(deleteRow()).getByRole('status');
        expect(box).toHaveTextContent('Press keys...');
        expect(document.activeElement).toBe(box);
        expect(document.activeElement).not.toBe(document.body);

        // Still focused while a combo is being held.
        fireEvent.keyDown(document, { key: 'F9' });
        expect(document.activeElement).toBe(box);
    });

    it('hands focus back to the keycap it came from when the capture lands', () => {
        render(<KeybindingsPanel />);
        fireEvent.click(deleteKeycap());

        capture({ key: 'F9' });

        expect(document.activeElement).toBe(deleteKeycap());
    });

    it('hands focus back to the keycap when Escape cancels', () => {
        render(<KeybindingsPanel />);
        fireEvent.click(deleteKeycap());

        fireEvent.keyDown(document, { key: 'Escape' });

        expect(document.activeElement).toBe(deleteKeycap());
    });
});

describe('W6-CLEAN — the confirms take focus and give it back', () => {
    it('reset-all lands focus on the SAFE action, not the destructive one', () => {
        useKeybindingsStore.getState().setBinding('edit.delete', { key: 'x' });
        render(<KeybindingsPanel />);

        fireEvent.click(screen.getByRole('button', { name: 'Reset All to Defaults' }));

        const dialog = screen.getByRole('alertdialog');
        const keep = within(dialog).getByRole('button', { name: 'Keep mine' });
        expect(document.activeElement).toBe(keep);
        expect(document.activeElement).not.toBe(
            within(dialog).getByRole('button', { name: 'Reset all' }),
        );
    });

    it('reset-all restores focus to the trigger when the answer is "keep mine"', () => {
        useKeybindingsStore.getState().setBinding('edit.delete', { key: 'x' });
        render(<KeybindingsPanel />);

        const trigger = screen.getByRole('button', { name: 'Reset All to Defaults' });
        fireEvent.click(trigger);
        fireEvent.click(screen.getByRole('button', { name: 'Keep mine' }));

        expect(document.activeElement).toBe(trigger);
    });

    it('keeps focus inside the panel when "reset all" disables its own trigger', () => {
        useKeybindingsStore.getState().setBinding('edit.delete', { key: 'x' });
        render(<KeybindingsPanel />);

        fireEvent.click(screen.getByRole('button', { name: 'Reset All to Defaults' }));
        fireEvent.click(screen.getByRole('button', { name: 'Reset all' }));

        // Nothing is customised any more, so the trigger is disabled — focus goes
        // to the panel's first control rather than falling out to <body>.
        expect(screen.getByRole('button', { name: 'Reset All to Defaults' })).toBeDisabled();
        expect(document.activeElement).toBe(
            screen.getByRole('searchbox', { name: 'Search shortcuts' }),
        );
        expect(document.activeElement).not.toBe(document.body);
    });

    it('the conflict dialog takes focus on Cancel and returns it to the row', () => {
        render(<KeybindingsPanel />);
        fireEvent.click(deleteKeycap());

        // Ctrl+Z already belongs to Undo.
        capture({ key: 'z', ctrlKey: true });

        const dialog = screen.getByRole('alertdialog', { name: 'Shortcut conflict' });
        const cancel = within(dialog).getByRole('button', { name: 'Cancel' });
        expect(document.activeElement).toBe(cancel);

        fireEvent.click(cancel);
        expect(document.activeElement).toBe(deleteKeycap());
    });

    it('the conflict dialog returns focus to the row after Replace, too', () => {
        render(<KeybindingsPanel />);
        fireEvent.click(deleteKeycap());
        capture({ key: 'z', ctrlKey: true });

        fireEvent.click(screen.getByRole('button', { name: 'Replace' }));

        expect(document.activeElement).toBe(deleteKeycap());
        expect(document.activeElement).not.toBe(document.body);
    });
});

describe('W6-CLEAN — one grammar for the consequential choice', () => {
    it('paints "Replace" with the danger tint, not the inviting accent fill', () => {
        render(<KeybindingsPanel />);
        fireEvent.click(deleteKeycap());
        capture({ key: 'z', ctrlKey: true });

        const replace = screen.getByRole('button', { name: 'Replace' });
        expect(replace).toHaveClass('oj-btn--danger');
        expect(replace).not.toHaveClass('oj-btn--primary');
    });
});


/*
 * HA-23 / U14 — the two Keybindings confirms take Escape themselves.
 *
 * Neither had a handler, so Escape fell through to the Settings modal
 * underneath: answering "no" to "Reset every shortcut?" — or backing out of a
 * conflict — closed ALL of Settings. Four other inline confirms in the app
 * already did this right (`AppMenuBar`); these copy that shape.
 */
describe('HA-23 — Escape cancels the confirm, not the panel behind it', () => {
    /** Fire Escape at `element` and report whether it escaped to the document. */
    function escapeFrom(element: HTMLElement): boolean {
        let reached = false;
        const listener = () => { reached = true; };
        document.addEventListener('keydown', listener);
        fireEvent.keyDown(element, { key: 'Escape' });
        document.removeEventListener('keydown', listener);
        return reached;
    }

    it('closes the reset-all confirm and stops', () => {
        useKeybindingsStore.setState({ customBindings: { 'arrangement.play': { key: 'F8' } } });
        render(<KeybindingsPanel />);
        fireEvent.click(screen.getByRole('button', { name: 'Reset All to Defaults' }));

        const dialog = screen.getByRole('alertdialog', { name: 'Reset every shortcut' });
        expect(escapeFrom(dialog)).toBe(false);

        expect(screen.queryByRole('alertdialog', { name: 'Reset every shortcut' })).toBeNull();
        // Declining changed nothing about the bindings themselves.
        expect(useKeybindingsStore.getState().customBindings['arrangement.play']).toEqual({ key: 'F8' });
        // And the panel it was asked inside is still open.
        expect(screen.getByRole('button', { name: 'Reset All to Defaults' })).toBeInTheDocument();
    });

    it('closes the shortcut-conflict confirm and stops', () => {
        render(<KeybindingsPanel />);
        fireEvent.click(deleteKeycap());
        capture({ key: 'z', ctrlKey: true });

        const dialog = screen.getByRole('alertdialog', { name: 'Shortcut conflict' });
        expect(escapeFrom(dialog)).toBe(false);

        expect(screen.queryByRole('alertdialog', { name: 'Shortcut conflict' })).toBeNull();
        expect(useKeybindingsStore.getState().customBindings['arrangement.delete']).toBeUndefined();
    });
});
