import { render, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { Menu, MenuItem, MenuCategory, MenuSeparator } from './Menu';

describe('Menu', () => {
    it('renders a labelled role=menu panel with the base class', () => {
        const { container } = render(
            <Menu ariaLabel="File">
                <MenuItem label="New" />
            </Menu>,
        );
        const menu = container.querySelector('[role="menu"]')!;
        expect(menu.className).toContain('oj-menu');
        expect(menu.getAttribute('aria-label')).toBe('File');
    });

    it('fires onSelect on click and Enter for a leaf item', () => {
        const onSelect = vi.fn();
        const { container } = render(
            <Menu ariaLabel="m">
                <MenuItem label="Save" onSelect={onSelect} />
            </Menu>,
        );
        const item = container.querySelector('.oj-menu-item')!;
        fireEvent.click(item);
        fireEvent.keyDown(item, { key: 'Enter' });
        expect(onSelect).toHaveBeenCalledTimes(2);
    });

    it('does not fire onSelect when disabled', () => {
        const onSelect = vi.fn();
        const { container } = render(
            <Menu ariaLabel="m">
                <MenuItem label="Close" disabled onSelect={onSelect} />
            </Menu>,
        );
        const item = container.querySelector('.oj-menu-item')!;
        expect(item.getAttribute('aria-disabled')).toBe('true');
        expect(item.getAttribute('tabindex')).toBe('-1');
        fireEvent.click(item);
        fireEvent.keyDown(item, { key: 'Enter' });
        expect(onSelect).not.toHaveBeenCalled();
    });

    it('renders a shortcut as a Kbd keycap', () => {
        const { container } = render(
            <Menu ariaLabel="m">
                <MenuItem label="Save" shortcut="Ctrl S" />
            </Menu>,
        );
        const kbd = container.querySelector('kbd.oj-kbd')!;
        expect(kbd.textContent).toBe('Ctrl S');
        expect(kbd.className).toContain('oj-menu-item__shortcut');
    });

    it('marks a submenu row with aria-haspopup and the modifier class', () => {
        const { container } = render(
            <Menu ariaLabel="m">
                <MenuItem
                    label="Export"
                    submenu={
                        <Menu ariaLabel="Export">
                            <MenuItem label="WAV" />
                        </Menu>
                    }
                />
            </Menu>,
        );
        const item = container.querySelector('.oj-menu-item--has-submenu')!;
        expect(item.getAttribute('aria-haspopup')).toBe('true');
        expect(item.querySelector('.oj-menu-item__submenu')).not.toBeNull();
    });

    it('does not fire onSelect for a submenu parent row', () => {
        const onSelect = vi.fn();
        const { container } = render(
            <Menu ariaLabel="m">
                <MenuItem
                    label="Export"
                    onSelect={onSelect}
                    submenu={
                        <Menu ariaLabel="Export">
                            <MenuItem label="WAV" />
                        </Menu>
                    }
                />
            </Menu>,
        );
        const item = container.querySelector('.oj-menu-item--has-submenu')!;
        fireEvent.click(item);
        expect(onSelect).not.toHaveBeenCalled();
    });

    it('moves focus down/up across enabled items with arrow keys', () => {
        const { container } = render(
            <Menu ariaLabel="m">
                <MenuItem label="One" />
                <MenuItem label="Two" />
                <MenuItem label="Three" />
            </Menu>,
        );
        const menu = container.querySelector('[role="menu"]')!;
        const items = container.querySelectorAll<HTMLElement>('.oj-menu-item');

        fireEvent.keyDown(menu, { key: 'ArrowDown' });
        expect(document.activeElement).toBe(items[0]);

        fireEvent.keyDown(menu, { key: 'ArrowDown' });
        expect(document.activeElement).toBe(items[1]);

        fireEvent.keyDown(menu, { key: 'ArrowUp' });
        expect(document.activeElement).toBe(items[0]);

        // Wraps to the last item from the top.
        fireEvent.keyDown(menu, { key: 'ArrowUp' });
        expect(document.activeElement).toBe(items[2]);
    });

    it('jumps to the ends with Home and End', () => {
        const { container } = render(
            <Menu ariaLabel="m">
                <MenuItem label="One" />
                <MenuItem label="Two" />
                <MenuItem label="Three" />
            </Menu>,
        );
        const menu = container.querySelector('[role="menu"]')!;
        const items = container.querySelectorAll<HTMLElement>('.oj-menu-item');

        fireEvent.keyDown(menu, { key: 'End' });
        expect(document.activeElement).toBe(items[2]);

        fireEvent.keyDown(menu, { key: 'Home' });
        expect(document.activeElement).toBe(items[0]);
    });

    it('skips disabled items during arrow navigation', () => {
        const { container } = render(
            <Menu ariaLabel="m">
                <MenuItem label="One" />
                <MenuItem label="Two" disabled />
                <MenuItem label="Three" />
            </Menu>,
        );
        const menu = container.querySelector('[role="menu"]')!;
        const items = container.querySelectorAll<HTMLElement>('.oj-menu-item');

        fireEvent.keyDown(menu, { key: 'ArrowDown' });
        expect(document.activeElement).toBe(items[0]);
        fireEvent.keyDown(menu, { key: 'ArrowDown' });
        // Skips the disabled middle row.
        expect(document.activeElement).toBe(items[2]);
    });

    it('fires onEscape when Escape is pressed', () => {
        const onEscape = vi.fn();
        const { container } = render(
            <Menu ariaLabel="m" onEscape={onEscape}>
                <MenuItem label="One" />
            </Menu>,
        );
        fireEvent.keyDown(container.querySelector('[role="menu"]')!, { key: 'Escape' });
        expect(onEscape).toHaveBeenCalledTimes(1);
    });

    it('renders a non-interactive category header', () => {
        const { container } = render(
            <Menu ariaLabel="m">
                <MenuCategory label="Effects" />
                <MenuItem label="Reverb" />
            </Menu>,
        );
        const category = container.querySelector('.oj-menu-category')!;
        expect(category.getAttribute('role')).toBe('presentation');
        expect(category.querySelector('.oj-menu-category__label')!.textContent).toBe('Effects');
        // Not focusable / not an item.
        expect(category.getAttribute('tabindex')).toBeNull();
    });

    it('renders a separator with role=separator', () => {
        const { container } = render(
            <Menu ariaLabel="m">
                <MenuItem label="One" />
                <MenuSeparator />
                <MenuItem label="Two" />
            </Menu>,
        );
        const sep = container.querySelector('.oj-menu-separator')!;
        expect(sep.getAttribute('role')).toBe('separator');
    });

    it('merges a custom className onto the item', () => {
        const { container } = render(
            <Menu ariaLabel="m">
                <MenuItem label="One" className="extra" />
            </Menu>,
        );
        const item = container.querySelector('.oj-menu-item')!;
        expect(item.className).toContain('oj-menu-item');
        expect(item.className).toContain('extra');
    });
});
