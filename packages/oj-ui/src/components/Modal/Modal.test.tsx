import { render, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { Modal } from './Modal';

const dialog = () => document.body.querySelector<HTMLElement>('[role="dialog"]');

describe('Modal', () => {
    it('renders nothing when closed', () => {
        render(
            <Modal open={false} onClose={() => {}} ariaLabel="x">
                <button>inner</button>
            </Modal>,
        );
        expect(dialog()).toBeNull();
    });

    it('portals a labelled modal dialog to document.body when open', () => {
        const { container } = render(
            <Modal open onClose={() => {}} ariaLabel="Settings">
                <button>inner</button>
            </Modal>,
        );
        const panel = dialog()!;
        expect(panel).not.toBeNull();
        // It is portalled out of the React container, onto the body.
        expect(container.contains(panel)).toBe(false);
        expect(panel.getAttribute('aria-modal')).toBe('true');
        expect(panel.getAttribute('aria-label')).toBe('Settings');
    });

    it('applies the size and align modifier classes (md/center by default)', () => {
        render(
            <Modal open onClose={() => {}} ariaLabel="x">
                <button>inner</button>
            </Modal>,
        );
        const panel = dialog()!;
        expect(panel.className).toContain('oj-modal--size-md');
        const scrim = panel.parentElement!;
        expect(scrim.className).toContain('oj-modal__scrim--align-center');
    });

    it('honors explicit size and align props', () => {
        render(
            <Modal open onClose={() => {}} ariaLabel="x" size="lg" align="top">
                <button>inner</button>
            </Modal>,
        );
        const panel = dialog()!;
        expect(panel.className).toContain('oj-modal--size-lg');
        expect(panel.parentElement!.className).toContain('oj-modal__scrim--align-top');
    });

    it('calls onClose on Escape', () => {
        const onClose = vi.fn();
        render(
            <Modal open onClose={onClose} ariaLabel="x">
                <button>inner</button>
            </Modal>,
        );
        fireEvent.keyDown(dialog()!.parentElement!, { key: 'Escape' });
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('calls onClose when the scrim itself is clicked', () => {
        const onClose = vi.fn();
        render(
            <Modal open onClose={onClose} ariaLabel="x">
                <button>inner</button>
            </Modal>,
        );
        const scrim = dialog()!.parentElement!;
        fireEvent.mouseDown(scrim);
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('does not close when the panel (not the scrim) is clicked', () => {
        const onClose = vi.fn();
        render(
            <Modal open onClose={onClose} ariaLabel="x">
                <button>inner</button>
            </Modal>,
        );
        fireEvent.mouseDown(dialog()!);
        expect(onClose).not.toHaveBeenCalled();
    });

    it('suppresses scrim-click close when closeOnScrim is false', () => {
        const onClose = vi.fn();
        render(
            <Modal open onClose={onClose} ariaLabel="x" closeOnScrim={false}>
                <button>inner</button>
            </Modal>,
        );
        fireEvent.mouseDown(dialog()!.parentElement!);
        expect(onClose).not.toHaveBeenCalled();
    });

    it('moves focus to the first focusable element on open', () => {
        render(
            <Modal open onClose={() => {}} ariaLabel="x">
                <button>first</button>
                <button>second</button>
            </Modal>,
        );
        const first = dialog()!.querySelector('button')!;
        expect(document.activeElement).toBe(first);
    });
});
