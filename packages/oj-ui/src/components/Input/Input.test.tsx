import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Input } from './Input';

describe('Input', () => {
    it('renders an input with the base class', () => {
        const { container } = render(<Input defaultValue="1" />);
        expect(container.querySelector('input')!.className).toBe('oj-input');
    });

    it('forwards value and native props', () => {
        const { container } = render(<Input value="7" onChange={() => {}} type="number" aria-label="gain" />);
        const el = container.querySelector('input')! as HTMLInputElement;
        expect(el.value).toBe('7');
        expect(el.getAttribute('type')).toBe('number');
        expect(el.getAttribute('aria-label')).toBe('gain');
    });
});
