import { render } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { DeviceSelect, type DeviceSelectItem } from './DeviceSelect';

const ITEMS: DeviceSelectItem[] = [
    { id: 'a', label: 'Built-in Microphone' },
    { id: 'b', label: 'Scarlett 2i2', lowLatency: true },
    { id: 'c', label: 'USB Mic' },
];

describe('DeviceSelect', () => {
    it('renders the base class and shows the selected label on the trigger', () => {
        const { container } = render(
            <DeviceSelect
                ariaLabel="Microphone"
                items={ITEMS}
                value="b"
                open={false}
                onToggle={() => {}}
                onSelect={() => {}}
            />,
        );
        expect(container.querySelector('.oj-device-select')).not.toBeNull();
        const trigger = container.querySelector('.oj-device-select__trigger')!;
        expect(trigger.textContent).toContain('Scarlett 2i2');
        expect(trigger.getAttribute('aria-label')).toBe('Microphone');
        expect(trigger.getAttribute('aria-expanded')).toBe('false');
    });

    it('falls back to the placeholder when no item matches value', () => {
        const { container } = render(
            <DeviceSelect
                ariaLabel="Microphone"
                placeholder="No device"
                items={ITEMS}
                value="missing"
                open={false}
                onToggle={() => {}}
                onSelect={() => {}}
            />,
        );
        expect(container.querySelector('.oj-device-select__label')!.textContent).toBe(
            'No device',
        );
    });

    it('does not render the list when closed', () => {
        const { container } = render(
            <DeviceSelect
                ariaLabel="Microphone"
                items={ITEMS}
                value="a"
                open={false}
                onToggle={() => {}}
                onSelect={() => {}}
            />,
        );
        expect(container.querySelector('.oj-device-select__list')).toBeNull();
    });

    it('renders one option per item when open and marks the selected one', () => {
        const { container } = render(
            <DeviceSelect
                ariaLabel="Microphone"
                items={ITEMS}
                value="b"
                open
                onToggle={() => {}}
                onSelect={() => {}}
            />,
        );
        const list = container.querySelector('.oj-device-select__list')!;
        expect(list.getAttribute('role')).toBe('listbox');
        const options = list.querySelectorAll('.oj-device-select__option');
        expect(options.length).toBe(3);
        const selected = list.querySelector('[aria-selected="true"]')!;
        expect(selected.textContent).toContain('Scarlett 2i2');
        expect(selected.className).toContain('is-active');
    });

    it('shows a bolt only on low-latency devices', () => {
        const { container } = render(
            <DeviceSelect
                ariaLabel="Microphone"
                items={ITEMS}
                value="a"
                open
                onToggle={() => {}}
                onSelect={() => {}}
            />,
        );
        const options = container.querySelectorAll('.oj-device-select__option');
        // Only the second item (Scarlett 2i2) is low-latency.
        expect(options[0]!.querySelector('.oj-device-select__option-bolt')).toBeNull();
        expect(options[1]!.querySelector('.oj-device-select__option-bolt')).not.toBeNull();
        expect(options[2]!.querySelector('.oj-device-select__option-bolt')).toBeNull();
    });

    it('fires onToggle when the trigger is clicked', () => {
        const onToggle = vi.fn();
        const { container } = render(
            <DeviceSelect
                ariaLabel="Microphone"
                items={ITEMS}
                value="a"
                open={false}
                onToggle={onToggle}
                onSelect={() => {}}
            />,
        );
        (container.querySelector('.oj-device-select__trigger') as HTMLButtonElement).click();
        expect(onToggle).toHaveBeenCalledTimes(1);
    });

    it('fires onSelect with the clicked device id', () => {
        const onSelect = vi.fn();
        const { container } = render(
            <DeviceSelect
                ariaLabel="Microphone"
                items={ITEMS}
                value="a"
                open
                onToggle={() => {}}
                onSelect={onSelect}
            />,
        );
        const options = container.querySelectorAll<HTMLButtonElement>(
            '.oj-device-select__option',
        );
        options[2]!.click();
        expect(onSelect).toHaveBeenCalledWith('c');
    });

    it('forwards native props and merges className onto the root', () => {
        const { container } = render(
            <DeviceSelect
                ariaLabel="Microphone"
                items={ITEMS}
                value="a"
                open={false}
                onToggle={() => {}}
                onSelect={() => {}}
                className="extra"
                data-testid="picker"
            />,
        );
        const root = container.querySelector('.oj-device-select')!;
        expect(root.className).toContain('extra');
        expect(root.getAttribute('data-testid')).toBe('picker');
    });
});
