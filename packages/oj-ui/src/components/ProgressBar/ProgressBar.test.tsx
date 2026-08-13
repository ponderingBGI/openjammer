import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { ProgressBar } from './ProgressBar';

describe('ProgressBar', () => {
    it('renders the base class and progressbar role without a tone modifier', () => {
        const { container } = render(<ProgressBar value={0.5} />);
        const bar = container.querySelector('.oj-progress')!;
        expect(bar.className).toBe('oj-progress');
        expect(bar.getAttribute('role')).toBe('progressbar');
    });

    it('omits a tone modifier for the default neutral tone', () => {
        const { container } = render(<ProgressBar value={0.5} />);
        expect(container.querySelector('.oj-progress')!.className).not.toContain('oj-progress--');
    });

    it('applies the tone modifier', () => {
        const { container } = render(<ProgressBar value={0.5} tone="warning" />);
        expect(container.querySelector('.oj-progress')!.className).toContain('oj-progress--warning');
    });

    it('sets aria value attributes against the default max of 1', () => {
        const { container } = render(<ProgressBar value={0.4} />);
        const bar = container.querySelector('.oj-progress')!;
        expect(bar.getAttribute('aria-valuenow')).toBe('0.4');
        expect(bar.getAttribute('aria-valuemin')).toBe('0');
        expect(bar.getAttribute('aria-valuemax')).toBe('1');
    });

    it('honors a custom max for aria-valuemax', () => {
        const { container } = render(<ProgressBar value={7} max={10} />);
        const bar = container.querySelector('.oj-progress')!;
        expect(bar.getAttribute('aria-valuenow')).toBe('7');
        expect(bar.getAttribute('aria-valuemax')).toBe('10');
    });

    it('computes the fill width as a percentage of max', () => {
        const { container } = render(<ProgressBar value={7} max={10} />);
        const fill = container.querySelector('.oj-progress__fill') as HTMLElement;
        expect(fill.style.width).toBe('70%');
    });

    it('clamps value above max to 100% and reports the clamped valuenow', () => {
        const { container } = render(<ProgressBar value={5} max={1} />);
        const bar = container.querySelector('.oj-progress')!;
        const fill = container.querySelector('.oj-progress__fill') as HTMLElement;
        expect(fill.style.width).toBe('100%');
        expect(bar.getAttribute('aria-valuenow')).toBe('1');
    });

    it('clamps a negative value to 0%', () => {
        const { container } = render(<ProgressBar value={-3} />);
        const fill = container.querySelector('.oj-progress__fill') as HTMLElement;
        expect(fill.style.width).toBe('0%');
        expect(container.querySelector('.oj-progress')!.getAttribute('aria-valuenow')).toBe('0');
    });

    it('forwards native props (aria-label, className)', () => {
        const { container } = render(
            <ProgressBar value={0.5} aria-label="loading" className="extra" />,
        );
        const bar = container.querySelector('.oj-progress')!;
        expect(bar.getAttribute('aria-label')).toBe('loading');
        expect(bar.className).toContain('extra');
    });
});
