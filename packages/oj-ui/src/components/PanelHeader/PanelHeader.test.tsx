import { render } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { PanelHeader } from './PanelHeader';

describe('PanelHeader', () => {
    it('renders the base class and the title text', () => {
        const { container } = render(<PanelHeader title="Settings" />);
        const root = container.querySelector('.oj-panel-header')!;
        expect(root).toBeTruthy();
        const title = container.querySelector('.oj-panel-header__title')!;
        expect(title.textContent).toBe('Settings');
    });

    it('omits the heading block when no title, subtitle, or badge is given', () => {
        const { container } = render(<PanelHeader onClose={() => {}} />);
        expect(container.querySelector('.oj-panel-header__heading')).toBeNull();
    });

    it('renders the subtitle when given', () => {
        const { container } = render(<PanelHeader title="A" subtitle="more" />);
        const sub = container.querySelector('.oj-panel-header__subtitle')!;
        expect(sub.textContent).toBe('more');
    });

    it('shows the back button only when onBack is given and fires it', () => {
        const onBack = vi.fn();
        const { container } = render(<PanelHeader title="A" onBack={onBack} backLabel="Go back" />);
        const back = container.querySelector('.oj-panel-header__back') as HTMLButtonElement;
        expect(back).toBeTruthy();
        expect(back.textContent).toContain('Go back');
        back.click();
        expect(onBack).toHaveBeenCalledTimes(1);
    });

    it('hides the back button by default', () => {
        const { container } = render(<PanelHeader title="A" />);
        expect(container.querySelector('.oj-panel-header__back')).toBeNull();
    });

    it('shows the close button only when onClose is given and fires it', () => {
        const onClose = vi.fn();
        const { container } = render(<PanelHeader title="A" onClose={onClose} />);
        const close = container.querySelector('.oj-panel-header__close') as HTMLButtonElement;
        expect(close).toBeTruthy();
        close.click();
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('renders the badge node next to the title', () => {
        const { container } = render(
            <PanelHeader title="A" badge={<span data-testid="b">live</span>} />,
        );
        const badge = container.querySelector('.oj-panel-header__badge')!;
        expect(badge.querySelector('[data-testid="b"]')!.textContent).toBe('live');
    });

    it('renders the actions slot before close', () => {
        const { container } = render(
            <PanelHeader title="A" actions={<button>Do</button>} onClose={() => {}} />,
        );
        const actions = container.querySelector('.oj-panel-header__actions')!;
        expect(actions.textContent).toBe('Do');
    });

    it('renders extra children below the row', () => {
        const { container } = render(
            <PanelHeader title="A">
                <input placeholder="search" />
            </PanelHeader>,
        );
        const extra = container.querySelector('.oj-panel-header__extra')!;
        expect(extra.querySelector('input')).toBeTruthy();
    });

    it('merges a custom className and forwards native props', () => {
        const { container } = render(<PanelHeader title="A" className="mine" data-x="1" />);
        const root = container.querySelector('.oj-panel-header')!;
        expect(root.className).toContain('oj-panel-header');
        expect(root.className).toContain('mine');
        expect(root.getAttribute('data-x')).toBe('1');
    });
});
