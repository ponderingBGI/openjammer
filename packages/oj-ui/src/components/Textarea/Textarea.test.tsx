import { render } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { Textarea } from './Textarea';

describe('Textarea', () => {
    it('renders the base class on a textarea element', () => {
        const { container } = render(<Textarea />);
        const ta = container.querySelector('textarea')!;
        expect(ta).not.toBeNull();
        expect(ta.className).toBe('oj-textarea');
    });

    it('merges a custom className after the base class', () => {
        const { container } = render(<Textarea className="extra" />);
        expect(container.querySelector('textarea')!.className).toBe('oj-textarea extra');
    });

    it('forwards native props (placeholder, rows, disabled)', () => {
        const { container } = render(<Textarea placeholder="hint" rows={5} disabled />);
        const ta = container.querySelector('textarea')!;
        expect(ta.getAttribute('placeholder')).toBe('hint');
        expect(ta.getAttribute('rows')).toBe('5');
        expect((ta as HTMLTextAreaElement).disabled).toBe(true);
    });

    it('forwards value and onChange', () => {
        const onChange = vi.fn();
        const { container } = render(<Textarea value="seed" onChange={onChange} />);
        expect((container.querySelector('textarea') as HTMLTextAreaElement).value).toBe('seed');
    });
});
