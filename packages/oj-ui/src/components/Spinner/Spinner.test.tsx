import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Spinner } from './Spinner';

describe('Spinner', () => {
    it('renders the base class with the status role and default size', () => {
        const { container } = render(<Spinner />);
        const el = container.querySelector('span')!;
        expect(el.className).toBe('oj-spinner');
        expect(el.getAttribute('role')).toBe('status');
        expect(el.style.width).toBe('16px');
        expect(el.style.height).toBe('16px');
    });

    it('applies a custom size to both dimensions', () => {
        const { container } = render(<Spinner size={40} />);
        const el = container.querySelector('span')!;
        expect(el.style.width).toBe('40px');
        expect(el.style.height).toBe('40px');
    });

    it('merges a custom className and preserves caller style', () => {
        const { container } = render(<Spinner className="extra" style={{ opacity: '0.5' }} />);
        const el = container.querySelector('span')!;
        expect(el.className).toContain('oj-spinner');
        expect(el.className).toContain('extra');
        expect(el.style.opacity).toBe('0.5');
    });

    it('forwards native props (aria-label override, title)', () => {
        const { container } = render(<Spinner aria-label="Loading audio" title="busy" />);
        const el = container.querySelector('span')!;
        expect(el.getAttribute('aria-label')).toBe('Loading audio');
        expect(el.getAttribute('title')).toBe('busy');
    });
});
