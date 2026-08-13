import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Banner } from './Banner';

describe('Banner', () => {
    it('renders the base + tone classes and an alert role', () => {
        const { container } = render(<Banner tone="danger" title="Latency high" />);
        const root = container.querySelector('.oj-banner')!;
        expect(root.className).toContain('oj-banner');
        expect(root.className).toContain('oj-banner--danger');
        expect(root.getAttribute('role')).toBe('alert');
    });

    it('builds on the Surface chrome (node fill, hard menu shadow)', () => {
        const { container } = render(<Banner tone="warning" title="t" />);
        const root = container.querySelector('.oj-banner')!;
        expect(root.className).toContain('oj-surface');
        expect(root.className).toContain('oj-surface--elevation-menu');
    });

    it('renders the title in the neutral body, not a state-colored heading', () => {
        const { container } = render(<Banner tone="info" title="A new interface" />);
        const title = container.querySelector('.oj-banner__title')!;
        expect(title.textContent).toBe('A new interface');
    });

    it('renders the icon (decorative) and message only when provided', () => {
        const { container } = render(
            <Banner
                tone="warning"
                icon={<span data-testid="glyph">!</span>}
                title="t"
                message="why it matters"
            />,
        );
        const icon = container.querySelector('.oj-banner__icon')!;
        expect(icon.getAttribute('aria-hidden')).toBe('true');
        expect(icon.querySelector('[data-testid="glyph"]')).not.toBeNull();
        expect(container.querySelector('.oj-banner__message')!.textContent).toBe('why it matters');
    });

    it('omits the icon, message and actions slots when not given', () => {
        const { container } = render(<Banner tone="info" title="just a title" />);
        expect(container.querySelector('.oj-banner__icon')).toBeNull();
        expect(container.querySelector('.oj-banner__message')).toBeNull();
        expect(container.querySelector('.oj-banner__actions')).toBeNull();
    });

    it('renders the actions slot when provided', () => {
        const { container } = render(
            <Banner
                tone="danger"
                title="t"
                actions={<button data-testid="fix">Fix Now</button>}
            />,
        );
        const actions = container.querySelector('.oj-banner__actions')!;
        expect(actions).not.toBeNull();
        expect(actions.querySelector('[data-testid="fix"]')).not.toBeNull();
    });

    it('merges a custom className and forwards native props', () => {
        const { container } = render(
            <Banner tone="info" title="t" className="mine" data-testid="banner" />,
        );
        const root = container.querySelector('.oj-banner')!;
        expect(root.className).toContain('mine');
        expect(root.getAttribute('data-testid')).toBe('banner');
    });
});
