import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Callout } from './Callout';

describe('Callout', () => {
    it('renders the base class and defaults to the info variant', () => {
        const { container } = render(<Callout>Body</Callout>);
        const box = container.querySelector('.oj-callout')!;
        expect(box.className).toBe('oj-callout oj-callout--info');
        expect(box.getAttribute('role')).toBe('note');
        expect(box.textContent).toBe('Body');
    });

    it('applies the variant modifier', () => {
        const { container } = render(<Callout variant="danger">x</Callout>);
        expect(container.querySelector('.oj-callout')!.className).toContain('oj-callout--danger');
    });

    it('renders the icon (aria-hidden) only when provided', () => {
        const { container: without } = render(<Callout>x</Callout>);
        expect(without.querySelector('.oj-callout__icon')).toBeNull();

        const { container: withIcon } = render(<Callout icon={<svg data-testid="g" />}>x</Callout>);
        const icon = withIcon.querySelector('.oj-callout__icon')!;
        expect(icon).not.toBeNull();
        expect(icon.getAttribute('aria-hidden')).toBe('true');
        expect(icon.querySelector('svg')).not.toBeNull();
    });

    it('renders the title only when provided', () => {
        const { container: without } = render(<Callout>x</Callout>);
        expect(without.querySelector('.oj-callout__title')).toBeNull();

        const { container: withTitle } = render(<Callout title="Heads up">x</Callout>);
        const title = withTitle.querySelector('.oj-callout__title')!;
        expect(title).not.toBeNull();
        expect(title.textContent).toBe('Heads up');
    });

    it('places children in the content slot', () => {
        const { container } = render(<Callout>the message</Callout>);
        expect(container.querySelector('.oj-callout__content')!.textContent).toBe('the message');
    });

    it('merges a custom className and forwards native props', () => {
        const { container } = render(
            <Callout className="extra" id="c-1" data-foo="bar">
                x
            </Callout>,
        );
        const box = container.querySelector('.oj-callout')!;
        expect(box.className).toContain('oj-callout');
        expect(box.className).toContain('extra');
        expect(box.getAttribute('id')).toBe('c-1');
        expect(box.getAttribute('data-foo')).toBe('bar');
    });
});
