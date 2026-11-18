/**
 * DropdownMenu Component Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { DropdownMenu, type MenuItemOrSeparator } from '../DropdownMenu';

describe('DropdownMenu', () => {
    const mockOnClick = vi.fn();

    const defaultItems: MenuItemOrSeparator[] = [
        { id: 'item1', label: 'Item 1', onClick: mockOnClick },
        { id: 'item2', label: 'Item 2', shortcut: 'Ctrl+I', onClick: mockOnClick },
        { type: 'separator' },
        { id: 'item3', label: 'Item 3', onClick: mockOnClick, disabled: true },
    ];

    beforeEach(() => {
        cleanup();
        mockOnClick.mockClear();
    });

    describe('rendering', () => {
        it('should render trigger button with label', () => {
            render(<DropdownMenu label="File" items={defaultItems} />);

            expect(screen.getByRole('button', { name: /File/i })).toBeInTheDocument();
        });

        it('should not decorate the trigger with a chevron', () => {
            render(<DropdownMenu label="File" items={defaultItems} />);

            expect(screen.queryByText('▾')).not.toBeInTheDocument();
        });

        it('should not show dropdown content by default', () => {
            render(<DropdownMenu label="File" items={defaultItems} />);

            expect(screen.queryByRole('menu')).not.toBeInTheDocument();
        });

        it('should set aria-expanded to false when closed', () => {
            render(<DropdownMenu label="File" items={defaultItems} />);

            const trigger = screen.getByRole('button');
            expect(trigger).toHaveAttribute('aria-expanded', 'false');
        });

        it('should disable trigger when disabled prop is true', () => {
            render(<DropdownMenu label="File" items={defaultItems} disabled />);

            expect(screen.getByRole('button')).toBeDisabled();
        });
    });

    describe('opening/closing', () => {
        it('should open dropdown on trigger click', () => {
            render(<DropdownMenu label="File" items={defaultItems} />);

            fireEvent.click(screen.getByRole('button'));

            expect(screen.getByRole('menu')).toBeInTheDocument();
        });

        it('should close dropdown on second trigger click', () => {
            render(<DropdownMenu label="File" items={defaultItems} />);

            const trigger = screen.getByRole('button');
            fireEvent.click(trigger);
            expect(screen.getByRole('menu')).toBeInTheDocument();

            fireEvent.click(trigger);
            expect(screen.queryByRole('menu')).not.toBeInTheDocument();
        });

        it('should set aria-expanded to true when open', () => {
            render(<DropdownMenu label="File" items={defaultItems} />);

            fireEvent.click(screen.getByRole('button'));

            expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'true');
        });

        it('should close on Escape key', () => {
            render(<DropdownMenu label="File" items={defaultItems} />);

            fireEvent.click(screen.getByRole('button'));
            expect(screen.getByRole('menu')).toBeInTheDocument();

            fireEvent.keyDown(document, { key: 'Escape' });
            expect(screen.queryByRole('menu')).not.toBeInTheDocument();
        });

        it('should close on Tab key', () => {
            render(<DropdownMenu label="File" items={defaultItems} />);

            fireEvent.click(screen.getByRole('button'));
            expect(screen.getByRole('menu')).toBeInTheDocument();

            fireEvent.keyDown(document, { key: 'Tab' });
            expect(screen.queryByRole('menu')).not.toBeInTheDocument();
        });

        it('should not open when disabled', () => {
            render(<DropdownMenu label="File" items={defaultItems} disabled />);

            fireEvent.click(screen.getByRole('button'));

            expect(screen.queryByRole('menu')).not.toBeInTheDocument();
        });
    });

    describe('menu items', () => {
        it('should render all menu items', () => {
            render(<DropdownMenu label="File" items={defaultItems} />);
            fireEvent.click(screen.getByRole('button'));

            expect(screen.getByText('Item 1')).toBeInTheDocument();
            expect(screen.getByText('Item 2')).toBeInTheDocument();
            expect(screen.getByText('Item 3')).toBeInTheDocument();
        });

        it('should render shortcuts when provided', () => {
            render(<DropdownMenu label="File" items={defaultItems} />);
            fireEvent.click(screen.getByRole('button'));

            expect(screen.getByText('Ctrl+I')).toBeInTheDocument();
        });

        it('should render separators', () => {
            render(<DropdownMenu label="File" items={defaultItems} />);
            fireEvent.click(screen.getByRole('button'));

            expect(screen.getByRole('separator')).toBeInTheDocument();
        });

        it('should mark disabled items with aria-disabled', () => {
            render(<DropdownMenu label="File" items={defaultItems} />);
            fireEvent.click(screen.getByRole('button'));

            const disabledItem = screen.getByText('Item 3').closest('[role="menuitem"]');
            expect(disabledItem).toHaveAttribute('aria-disabled', 'true');
        });

        it('should call onClick when clicking an item', () => {
            render(<DropdownMenu label="File" items={defaultItems} />);
            fireEvent.click(screen.getByRole('button'));

            fireEvent.click(screen.getByText('Item 1'));

            expect(mockOnClick).toHaveBeenCalledTimes(1);
        });

        it('should close dropdown after clicking an item', () => {
            render(<DropdownMenu label="File" items={defaultItems} />);
            fireEvent.click(screen.getByRole('button'));

            fireEvent.click(screen.getByText('Item 1'));

            expect(screen.queryByRole('menu')).not.toBeInTheDocument();
        });

        it('should not call onClick for disabled items', () => {
            render(<DropdownMenu label="File" items={defaultItems} />);
            fireEvent.click(screen.getByRole('button'));

            fireEvent.click(screen.getByText('Item 3'));

            expect(mockOnClick).not.toHaveBeenCalled();
        });
    });

    describe('keyboard navigation', () => {
        const menu = () => screen.getByRole('menu');
        const row = (text: string) => screen.getByText(text).closest('[role="menuitem"]') as HTMLElement;

        it('should focus first item when opening', () => {
            render(<DropdownMenu label="File" items={defaultItems} />);
            fireEvent.click(screen.getByRole('button'));

            expect(document.activeElement).toBe(row('Item 1'));
            expect(row('Item 1')).toHaveClass('dropdown-item-focused');
        });

        it('should navigate down with ArrowDown', () => {
            render(<DropdownMenu label="File" items={defaultItems} />);
            fireEvent.click(screen.getByRole('button'));

            fireEvent.keyDown(menu(), { key: 'ArrowDown' });

            expect(document.activeElement).toBe(row('Item 2'));
            expect(row('Item 2')).toHaveClass('dropdown-item-focused');
        });

        it('should navigate up with ArrowUp', () => {
            render(<DropdownMenu label="File" items={defaultItems} />);
            fireEvent.click(screen.getByRole('button'));

            fireEvent.keyDown(menu(), { key: 'ArrowDown' });
            fireEvent.keyDown(menu(), { key: 'ArrowUp' });

            expect(document.activeElement).toBe(row('Item 1'));
        });

        it('should wrap around when navigating past last item', () => {
            render(<DropdownMenu label="File" items={defaultItems} />);
            fireEvent.click(screen.getByRole('button'));

            // Item 3 is disabled, so the enabled ring is Item 1 -> Item 2 -> Item 1.
            fireEvent.keyDown(menu(), { key: 'ArrowDown' });
            fireEvent.keyDown(menu(), { key: 'ArrowDown' });

            expect(document.activeElement).toBe(row('Item 1'));
        });

        it('should wrap around when navigating before first item', () => {
            render(<DropdownMenu label="File" items={defaultItems} />);
            fireEvent.click(screen.getByRole('button'));

            fireEvent.keyDown(menu(), { key: 'ArrowUp' });

            // The disabled Item 3 is skipped: the last ENABLED row is Item 2.
            expect(document.activeElement).toBe(row('Item 2'));
        });

        it('should jump to the ends with Home and End', () => {
            render(<DropdownMenu label="File" items={defaultItems} />);
            fireEvent.click(screen.getByRole('button'));

            fireEvent.keyDown(menu(), { key: 'End' });
            expect(document.activeElement).toBe(row('Item 2'));

            fireEvent.keyDown(menu(), { key: 'Home' });
            expect(document.activeElement).toBe(row('Item 1'));
        });

        it('should activate item with Enter', () => {
            render(<DropdownMenu label="File" items={defaultItems} />);
            fireEvent.click(screen.getByRole('button'));

            fireEvent.keyDown(row('Item 1'), { key: 'Enter' });

            expect(mockOnClick).toHaveBeenCalledTimes(1);
        });

        it('should activate item with Space', () => {
            render(<DropdownMenu label="File" items={defaultItems} />);
            fireEvent.click(screen.getByRole('button'));

            fireEvent.keyDown(row('Item 1'), { key: ' ' });

            expect(mockOnClick).toHaveBeenCalledTimes(1);
        });

        it('should not activate disabled item with Enter', () => {
            render(<DropdownMenu label="File" items={defaultItems} />);
            fireEvent.click(screen.getByRole('button'));

            fireEvent.keyDown(row('Item 3'), { key: 'Enter' });

            expect(mockOnClick).not.toHaveBeenCalled();
        });

        it('should never let arrow navigation land on a disabled row', () => {
            render(<DropdownMenu label="File" items={defaultItems} />);
            fireEvent.click(screen.getByRole('button'));

            for (let i = 0; i < 5; i++) fireEvent.keyDown(menu(), { key: 'ArrowDown' });

            expect(document.activeElement).not.toBe(row('Item 3'));
        });
    });

    describe('mouse interactions', () => {
        it('should highlight item on mouse enter', () => {
            render(<DropdownMenu label="File" items={defaultItems} />);
            fireEvent.click(screen.getByRole('button'));

            const secondItem = screen.getByText('Item 2').closest('[role="menuitem"]');
            fireEvent.mouseEnter(secondItem!);

            expect(secondItem).toHaveClass('dropdown-item-focused');
        });
    });

    describe('accessibility', () => {
        it('should have aria-haspopup on trigger', () => {
            render(<DropdownMenu label="File" items={defaultItems} />);

            expect(screen.getByRole('button')).toHaveAttribute('aria-haspopup', 'true');
        });

        it('should have aria-label on menu', () => {
            render(<DropdownMenu label="File" items={defaultItems} />);
            fireEvent.click(screen.getByRole('button'));

            expect(screen.getByRole('menu')).toHaveAttribute('aria-label', 'File');
        });

        it('should have role="menuitem" on items', () => {
            render(<DropdownMenu label="File" items={defaultItems} />);
            fireEvent.click(screen.getByRole('button'));

            const menuItems = screen.getAllByRole('menuitem');
            expect(menuItems.length).toBe(3); // 3 items, not counting separator
        });
    });
});
