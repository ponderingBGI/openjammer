import { render, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { SegmentedControl, Tabs } from './SegmentedControl';

const OPTIONS = [
    { value: 'a', label: 'Alpha' },
    { value: 'b', label: 'Beta' },
    { value: 'c', label: 'Gamma' },
];

describe('SegmentedControl', () => {
    it('renders a tablist of tabs with the base class and no orientation modifier', () => {
        const { container } = render(
            <SegmentedControl aria-label="g" options={OPTIONS} value="a" onChange={() => {}} />,
        );
        const list = container.querySelector('[role="tablist"]')!;
        expect(list.className).toBe('oj-seg');
        expect(list.getAttribute('aria-label')).toBe('g');
        expect(list.getAttribute('aria-orientation')).toBe('horizontal');
        const tabs = container.querySelectorAll('[role="tab"]');
        expect(tabs.length).toBe(3);
        expect(tabs[0]!.textContent).toBe('Alpha');
    });

    it('marks only the selected segment active and selected', () => {
        const { container } = render(
            <SegmentedControl aria-label="g" options={OPTIONS} value="b" onChange={() => {}} />,
        );
        const tabs = container.querySelectorAll<HTMLButtonElement>('[role="tab"]');
        expect(tabs[0]!.className).toBe('oj-seg__btn');
        expect(tabs[1]!.className).toBe('oj-seg__btn is-active');
        expect(tabs[1]!.getAttribute('aria-selected')).toBe('true');
        expect(tabs[0]!.getAttribute('aria-selected')).toBe('false');
    });

    it('puts only the selected segment in the tab order', () => {
        const { container } = render(
            <SegmentedControl aria-label="g" options={OPTIONS} value="c" onChange={() => {}} />,
        );
        const tabs = container.querySelectorAll<HTMLButtonElement>('[role="tab"]');
        expect(tabs[0]!.getAttribute('tabindex')).toBe('-1');
        expect(tabs[2]!.getAttribute('tabindex')).toBe('0');
    });

    it('renders buttons as type=button', () => {
        const { container } = render(
            <SegmentedControl aria-label="g" options={OPTIONS} value="a" onChange={() => {}} />,
        );
        expect(container.querySelector('[role="tab"]')!.getAttribute('type')).toBe('button');
    });

    it('calls onChange with the clicked value', () => {
        const onChange = vi.fn();
        const { container } = render(
            <SegmentedControl aria-label="g" options={OPTIONS} value="a" onChange={onChange} />,
        );
        const tabs = container.querySelectorAll<HTMLButtonElement>('[role="tab"]');
        tabs[2]!.click();
        expect(onChange).toHaveBeenCalledWith('c');
    });

    it('moves and selects with arrow keys, wrapping at the ends', () => {
        const onChange = vi.fn();
        const { container } = render(
            <SegmentedControl aria-label="g" options={OPTIONS} value="a" onChange={onChange} />,
        );
        const list = container.querySelector('[role="tablist"]')!;
        fireEvent.keyDown(list, { key: 'ArrowRight' });
        expect(onChange).toHaveBeenLastCalledWith('b');
        fireEvent.keyDown(list, { key: 'ArrowLeft' });
        expect(onChange).toHaveBeenLastCalledWith('c'); // wraps past the start
        fireEvent.keyDown(list, { key: 'End' });
        expect(onChange).toHaveBeenLastCalledWith('c');
        fireEvent.keyDown(list, { key: 'Home' });
        expect(onChange).toHaveBeenLastCalledWith('a');
    });

    it('uses up/down arrows when vertical', () => {
        const onChange = vi.fn();
        const { container } = render(
            <SegmentedControl
                aria-label="g"
                orientation="vertical"
                options={OPTIONS}
                value="a"
                onChange={onChange}
            />,
        );
        fireEvent.keyDown(container.querySelector('[role="tablist"]')!, { key: 'ArrowDown' });
        expect(onChange).toHaveBeenLastCalledWith('b');
    });

    it('blocks clicks and keys, and marks the group, when disabled', () => {
        const onChange = vi.fn();
        const { container } = render(
            <SegmentedControl aria-label="g" options={OPTIONS} value="a" onChange={onChange} disabled />,
        );
        const list = container.querySelector('[role="tablist"]')!;
        expect(list.className).toContain('is-disabled');
        const tabs = container.querySelectorAll<HTMLButtonElement>('[role="tab"]');
        expect(tabs[0]!.disabled).toBe(true);
        tabs[2]!.click();
        fireEvent.keyDown(list, { key: 'ArrowRight' });
        expect(onChange).not.toHaveBeenCalled();
    });

    it('applies the vertical orientation modifier and aria-orientation', () => {
        const { container } = render(
            <SegmentedControl
                aria-label="g"
                orientation="vertical"
                options={OPTIONS}
                value="a"
                onChange={() => {}}
            />,
        );
        const list = container.querySelector('[role="tablist"]')!;
        expect(list.className).toContain('oj-seg--vertical');
        expect(list.getAttribute('aria-orientation')).toBe('vertical');
    });

    it('merges a custom className after the base classes', () => {
        const { container } = render(
            <SegmentedControl
                aria-label="g"
                className="mine"
                options={OPTIONS}
                value="a"
                onChange={() => {}}
            />,
        );
        expect(container.querySelector('[role="tablist"]')!.className).toBe('oj-seg mine');
    });
});

describe('Tabs', () => {
    it('is a vertical SegmentedControl', () => {
        const { container } = render(
            <Tabs aria-label="g" options={OPTIONS} value="a" onChange={() => {}} />,
        );
        const list = container.querySelector('[role="tablist"]')!;
        expect(list.className).toContain('oj-seg--vertical');
        expect(list.getAttribute('aria-orientation')).toBe('vertical');
    });
});
