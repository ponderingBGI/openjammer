import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../audio/executor', () => ({ isTauri: () => false }));

const { Onboarding } = await import('../Onboarding');

function open(onFinish = vi.fn()) {
    render(<Onboarding onFinish={onFinish} />);
    return onFinish;
}

const options = () => screen.getAllByRole('button').filter((el) => el.className.includes('ob-opt'));

describe('Onboarding', () => {
    beforeEach(() => {
        localStorage.clear();
        document.body.className = '';
    });

    it('walks the three questions with the number keys', () => {
        const onFinish = open();
        expect(screen.getByText('Made music with a computer before?')).toBeInTheDocument();

        fireEvent.keyDown(window, { key: '3' });
        expect(screen.getByText('What do you want to make right now?')).toBeInTheDocument();

        fireEvent.keyDown(window, { key: '2' });
        expect(screen.getByText('Where do you like to work?')).toBeInTheDocument();

        fireEvent.keyDown(window, { key: '2' });
        expect(onFinish).toHaveBeenCalledWith({ exp: 'pro', goal: 'beat', theme: 'dark' });
    });

    it('never swallows a number typed into a field', () => {
        open();
        const field = document.createElement('input');
        document.body.appendChild(field);
        field.focus();

        fireEvent.keyDown(field, { key: '2' });

        // Still on question one: a "2" in a text field is a two.
        expect(screen.getByText('Made music with a computer before?')).toBeInTheDocument();
        field.remove();
    });

    it('ignores number keys carrying a modifier', () => {
        open();
        fireEvent.keyDown(window, { key: '2', ctrlKey: true });
        expect(screen.getByText('Made music with a computer before?')).toBeInTheDocument();
    });

    describe('skip', () => {
        it('finishes with defaults from the very first question', () => {
            const onFinish = open();
            fireEvent.click(screen.getByRole('button', { name: /skip, take me in/i }));
            expect(onFinish).toHaveBeenCalledWith({ exp: 'some', goal: 'jam', theme: 'light' });
        });

        it('KEEPS the answers already given', () => {
            const onFinish = open();
            fireEvent.click(options()[0]!); // "First time"
            fireEvent.click(options()[1]!); // "Build a beat"
            fireEvent.click(screen.getByRole('button', { name: /skip, take me in/i }));
            expect(onFinish).toHaveBeenCalledWith({ exp: 'first', goal: 'beat', theme: 'light' });
        });

        it('does the same on Escape', () => {
            const onFinish = open();
            fireEvent.click(options()[2]!); // "Years of it"
            fireEvent.keyDown(window, { key: 'Escape' });
            expect(onFinish).toHaveBeenCalledWith({ exp: 'pro', goal: 'jam', theme: 'light' });
        });
    });

    it('lets Back change an answer without losing the others', () => {
        const onFinish = open();
        fireEvent.click(options()[0]!); // first time
        fireEvent.click(screen.getByRole('button', { name: /back/i }));
        fireEvent.click(options()[2]!); // years of it
        fireEvent.click(screen.getByRole('button', { name: /skip, take me in/i }));
        expect(onFinish).toHaveBeenCalledWith({ exp: 'pro', goal: 'jam', theme: 'light' });
    });

    it('is a labelled modal dialog and takes focus', () => {
        open();
        const dialog = screen.getByRole('dialog');
        expect(dialog.getAttribute('aria-modal')).toBe('true');
        expect(dialog).toHaveAccessibleName('Made music with a computer before?');
        expect(document.activeElement).toBe(options()[0]);
    });

    it('traps Tab inside the card, both directions', () => {
        open();
        const focusables = [...document.querySelectorAll<HTMLElement>('.ob-card button')];
        const first = focusables[0]!;
        const last = focusables[focusables.length - 1]!;

        last.focus();
        fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Tab' });
        expect(document.activeElement).toBe(first);

        fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Tab', shiftKey: true });
        expect(document.activeElement).toBe(last);
    });

    it('marks the studio behind as a peek while it is open, and lets it go after', () => {
        const { unmount } = render(<Onboarding onFinish={vi.fn()} />);
        expect(document.body.classList.contains('oj-onboarding-open')).toBe(true);
        unmount();
        expect(document.body.classList.contains('oj-onboarding-open')).toBe(false);
    });

    it('counts the steps honestly', () => {
        open();
        expect(screen.getByText('01 / 03')).toBeInTheDocument();
        fireEvent.keyDown(window, { key: '1' });
        expect(screen.getByText('02 / 03')).toBeInTheDocument();
        fireEvent.keyDown(window, { key: '1' });
        expect(screen.getByText('03 / 03')).toBeInTheDocument();
    });
});
