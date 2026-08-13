import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { CodeBlock } from './CodeBlock';

describe('CodeBlock', () => {
    it('renders a pre with the base class and is selectable by default', () => {
        const { container } = render(<CodeBlock text="hi" />);
        const pre = container.querySelector('pre')!;
        expect(pre.className).toBe('oj-code');
        expect(pre.textContent).toBe('hi');
    });

    it('renders the text prop when no children are given', () => {
        const { container } = render(<CodeBlock text="from prop" />);
        expect(container.querySelector('pre')!.textContent).toBe('from prop');
    });

    it('prefers children over the text prop', () => {
        const { container } = render(<CodeBlock text="from prop">from children</CodeBlock>);
        expect(container.querySelector('pre')!.textContent).toBe('from children');
    });

    it('adds the unselectable modifier when selectable is false', () => {
        const { container } = render(<CodeBlock text="x" selectable={false} />);
        expect(container.querySelector('pre')!.className).toContain('is-unselectable');
    });

    it('applies maxHeight as an inline style', () => {
        const { container } = render(<CodeBlock text="x" maxHeight="120px" />);
        expect(container.querySelector('pre')!.style.maxHeight).toBe('120px');
    });

    it('merges a custom className and forwards native props', () => {
        const { container } = render(
            <CodeBlock text="x" className="extra" aria-label="report" id="rep" />,
        );
        const pre = container.querySelector('pre')!;
        expect(pre.className).toContain('oj-code');
        expect(pre.className).toContain('extra');
        expect(pre.getAttribute('aria-label')).toBe('report');
        expect(pre.getAttribute('id')).toBe('rep');
    });
});
