/**
 * DropdownMenu — the topbar's File / Edit / View trigger.
 *
 * The PANEL is the oj-ui `Menu` family: one menu vocabulary in the app, one set
 * of physics, one keyboard model (arrows / Home / End live inside `Menu`, Enter
 * and Space inside the row). This component owns only what a menu component
 * cannot: whether it is open, where it is anchored, and the Escape / Tab /
 * click-outside teardown that hands focus back to the trigger.
 *
 * @security XSS Considerations:
 * - `label` and `shortcut` are rendered as text content.
 * If they are ever sourced from user input or an external API they MUST be
 * sanitized first. Today every label is hardcoded in the codebase and safe.
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { Button, Menu, MenuItem, MenuSeparator } from '@openjammer/oj-ui';
import './DropdownMenu.css';

/**
 * Menu item configuration
 * @property id - Unique identifier for the menu item
 * @property label - Display text (must be sanitized if from external source)
 * @property shortcut - Optional keyboard shortcut display (must be sanitized if from external source)
 * @property onClick - Callback when item is selected
 * @property disabled - Whether the item is disabled
 * @property submenu - Optional nested submenu items
 */
export interface MenuItemConfig {
    id: string;
    label: string;
    shortcut?: string;
    onClick?: () => void;
    disabled?: boolean;
    submenu?: MenuItemOrSeparator[];
}

export interface MenuSeparatorConfig {
    type: 'separator';
}

export type MenuItemOrSeparator = MenuItemConfig | MenuSeparatorConfig;

interface DropdownMenuProps {
    label: string;
    items: MenuItemOrSeparator[];
    disabled?: boolean;
}

function isSeparator(item: MenuItemOrSeparator): item is MenuSeparatorConfig {
    return 'type' in item && item.type === 'separator';
}

/** The rows arrow navigation can land on — enabled, direct children only. */
const ENABLED_ROW = '.oj-menu > .oj-menu-item:not([aria-disabled="true"])';

export function DropdownMenu({ label, items, disabled = false }: DropdownMenuProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [openSubmenuId, setOpenSubmenuId] = useState<string | null>(null);
    const [focusedId, setFocusedId] = useState<string | null>(null);
    const menuRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);

    const actionableItems = items.filter((item): item is MenuItemConfig => !isSeparator(item));

    const close = useCallback((restoreFocus = false) => {
        setIsOpen(false);
        setOpenSubmenuId(null);
        setFocusedId(null);
        if (restoreFocus) triggerRef.current?.focus();
    }, []);

    const open = useCallback(() => {
        if (disabled) return;
        setIsOpen(true);
        setFocusedId(actionableItems[0]?.id ?? null);
    }, [disabled, actionableItems]);

    const toggle = useCallback(() => {
        if (isOpen) close();
        else open();
    }, [isOpen, close, open]);

    // Close on click outside.
    useEffect(() => {
        if (!isOpen) return;
        function handleClickOutside(e: PointerEvent) {
            if (!menuRef.current?.contains(e.target as Node) && !triggerRef.current?.contains(e.target as Node)) {
                close();
            }
        }
        document.addEventListener('pointerdown', handleClickOutside);
        return () => document.removeEventListener('pointerdown', handleClickOutside);
    }, [isOpen, close]);

    // Land focus on the first row when the panel opens, so the arrows the `Menu`
    // owns have somewhere to start from.
    useEffect(() => {
        if (!isOpen) return;
        menuRef.current?.querySelector<HTMLElement>(ENABLED_ROW)?.focus();
    }, [isOpen]);

    /**
     * Escape and Tab are the only keys this component still owns — Escape means
     * "give me my trigger back", Tab means "let me out of here". Arrows belong to
     * the `Menu` panel; Enter and Space belong to the row.
     */
    useEffect(() => {
        if (!isOpen) return;
        function handleKeyDown(e: KeyboardEvent) {
            if (e.key === 'Escape') {
                e.preventDefault();
                close(true);
            } else if (e.key === 'Tab') {
                close(false);
            }
        }
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, close]);

    const activate = (item: MenuItemConfig) => {
        if (item.disabled) return;
        if (item.submenu) {
            setOpenSubmenuId(openSubmenuId === item.id ? null : item.id);
            return;
        }
        item.onClick?.();
        close();
    };

    const renderRow = (item: MenuItemConfig) => {
        const hasSubmenu = Boolean(item.submenu);
        const isSubmenuOpen = openSubmenuId === item.id;
        const classes = [
            'dropdown-item',
            focusedId === item.id && 'dropdown-item-focused',
            item.disabled && 'dropdown-item-disabled',
            hasSubmenu && 'dropdown-item-has-submenu',
        ]
            .filter(Boolean)
            .join(' ');

        // A row is EITHER a leaf (onSelect fires it) or a disclosure (onClick
        // toggles it). Never both — wiring both would fire the action twice.
        const rowHandlers = hasSubmenu
            ? { onClick: () => activate(item) }
            : { onSelect: () => activate(item) };

        return (
            <MenuItem
                key={item.id}
                className={classes}
                label={item.label}
                shortcut={item.shortcut}
                disabled={item.disabled}
                aria-expanded={hasSubmenu ? isSubmenuOpen : undefined}
                onFocus={() => setFocusedId(item.id)}
                onMouseEnter={() => {
                    setFocusedId(item.id);
                    setOpenSubmenuId(hasSubmenu ? item.id : null);
                }}
                {...rowHandlers}
                submenu={
                    hasSubmenu && isSubmenuOpen ? (
                        <Menu
                            ariaLabel={item.label}
                            className="dropdown-submenu"
                            onEscape={() => setOpenSubmenuId(null)}
                        >
                            {item.submenu!.map((subItem, subIndex) =>
                                isSeparator(subItem) ? (
                                    <MenuSeparator key={`sub-sep-${subIndex}`} />
                                ) : (
                                    <MenuItem
                                        key={subItem.id}
                                        className={`dropdown-item${subItem.disabled ? ' dropdown-item-disabled' : ''}`}
                                        label={subItem.label}
                                        shortcut={subItem.shortcut}
                                        disabled={subItem.disabled}
                                        onSelect={() => {
                                            if (subItem.disabled) return;
                                            subItem.onClick?.();
                                            close();
                                        }}
                                    />
                                ),
                            )}
                        </Menu>
                    ) : undefined
                }
            />
        );
    };

    return (
        <div className="dropdown-menu" ref={menuRef}>
            <Button
                ref={triggerRef}
                variant="ghost"
                className={`dropdown-trigger ${isOpen ? 'dropdown-trigger-open' : ''}`}
                onClick={toggle}
                disabled={disabled}
                aria-haspopup="true"
                aria-expanded={isOpen}
            >
                {label}
            </Button>

            {isOpen && (
                <Menu ariaLabel={label} className="dropdown-content" onEscape={() => close(true)}>
                    {items.map((item, index) =>
                        isSeparator(item) ? <MenuSeparator key={`sep-${index}`} /> : renderRow(item),
                    )}
                </Menu>
            )}
        </div>
    );
}
