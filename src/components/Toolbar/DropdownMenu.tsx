/**
 * DropdownMenu - Photoshop-style dropdown menus for toolbar
 *
 * @security XSS Considerations:
 * - The `label` prop on MenuItem is rendered directly as text content
 * - The `label` prop on DropdownMenuProps is used for aria-label and button text
 * - The `shortcut` prop is rendered directly as text content
 *
 * If labels or shortcuts are sourced from user input or external APIs,
 * they MUST be sanitized before being passed to this component.
 * Currently, all labels are hardcoded in the codebase and are safe.
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { Button } from '@openjammer/oj-ui';
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
export interface MenuItem {
    id: string;
    label: string;
    shortcut?: string;
    onClick?: () => void;
    disabled?: boolean;
    submenu?: MenuItemOrSeparator[];
}

export interface MenuSeparator {
    type: 'separator';
}

export type MenuItemOrSeparator = MenuItem | MenuSeparator;

interface DropdownMenuProps {
    label: string;
    items: MenuItemOrSeparator[];
    disabled?: boolean;
}

function isSeparator(item: MenuItemOrSeparator): item is MenuSeparator {
    return 'type' in item && item.type === 'separator';
}

export function DropdownMenu({ label, items, disabled = false }: DropdownMenuProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [focusedIndex, setFocusedIndex] = useState(-1);
    const [openSubmenuId, setOpenSubmenuId] = useState<string | null>(null);
    const menuRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const itemRefs = useRef<(HTMLDivElement | null)[]>([]);

    // Get only actionable items (not separators) for keyboard navigation
    const actionableItems = items.filter((item): item is MenuItem => !isSeparator(item));

    const close = useCallback((restoreFocus = false) => {
        setIsOpen(false);
        setFocusedIndex(-1);
        setOpenSubmenuId(null);
        if (restoreFocus) {
            // Restore focus to trigger button when closing via Escape or Enter/Space
            triggerRef.current?.focus();
        }
    }, []);

    const open = useCallback(() => {
        if (!disabled) {
            setIsOpen(true);
            setFocusedIndex(0);
        }
    }, [disabled]);

    const toggle = useCallback(() => {
        if (isOpen) {
            close();
        } else {
            open();
        }
    }, [isOpen, close, open]);

    // Close on click outside
    useEffect(() => {
        if (!isOpen) return;

        function handleClickOutside(e: MouseEvent) {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                close();
            }
        }

        // Small delay to prevent immediate close when clicking trigger
        const timeoutId = setTimeout(() => {
            document.addEventListener('mousedown', handleClickOutside);
        }, 0);

        return () => {
            clearTimeout(timeoutId);
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [isOpen, close]);

    // Keyboard navigation
    useEffect(() => {
        if (!isOpen) return;

        function handleKeyDown(e: KeyboardEvent) {
            switch (e.key) {
                case 'Escape':
                    e.preventDefault();
                    close(true); // Restore focus to trigger
                    break;

                case 'ArrowDown':
                    e.preventDefault();
                    setFocusedIndex((prev) => {
                        const next = prev + 1;
                        return next >= actionableItems.length ? 0 : next;
                    });
                    break;

                case 'ArrowUp':
                    e.preventDefault();
                    setFocusedIndex((prev) => {
                        const next = prev - 1;
                        return next < 0 ? actionableItems.length - 1 : next;
                    });
                    break;

                case 'Enter':
                case ' ':
                    e.preventDefault();
                    if (focusedIndex >= 0 && focusedIndex < actionableItems.length) {
                        const item = actionableItems[focusedIndex];
                        if (!item.disabled && item.onClick) {
                            item.onClick();
                            close(true); // Restore focus after action
                        }
                    }
                    break;

                case 'Tab':
                    close(false); // Don't restore focus, allow natural tab flow
                    break;
            }
        }

        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, focusedIndex, actionableItems, close]);

    // Focus the current item when focused index changes
    useEffect(() => {
        if (isOpen && focusedIndex >= 0) {
            itemRefs.current[focusedIndex]?.focus();
        }
    }, [isOpen, focusedIndex]);

    const handleItemClick = (item: MenuItem) => {
        if (!item.disabled) {
            if (item.submenu) {
                // Toggle submenu on click
                setOpenSubmenuId(openSubmenuId === item.id ? null : item.id);
            } else if (item.onClick) {
                item.onClick();
                close();
            }
        }
    };

    const handleSubmenuItemClick = (subItem: MenuItem) => {
        if (!subItem.disabled && subItem.onClick) {
            subItem.onClick();
            close();
        }
    };

    // Track which actionable item index corresponds to each menu item
    let actionableIndex = -1;

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
                <span className="dropdown-chevron">▾</span>
            </Button>

            {isOpen && (
                <div
                    className="dropdown-content"
                    role="menu"
                    aria-label={label}
                >
                    {items.map((item, index) => {
                        if (isSeparator(item)) {
                            return <div key={`sep-${index}`} className="dropdown-separator" role="separator" />;
                        }

                        actionableIndex++;
                        const currentActionableIndex = actionableIndex;

                        const hasSubmenu = !!item.submenu;
                        const isSubmenuOpen = openSubmenuId === item.id;

                        return (
                            <div
                                key={item.id}
                                ref={(el) => { itemRefs.current[currentActionableIndex] = el; }}
                                className={`dropdown-item ${item.disabled ? 'dropdown-item-disabled' : ''} ${currentActionableIndex === focusedIndex ? 'dropdown-item-focused' : ''} ${hasSubmenu ? 'dropdown-item-has-submenu' : ''}`}
                                onClick={() => handleItemClick(item)}
                                onMouseEnter={() => {
                                    setFocusedIndex(currentActionableIndex);
                                    if (hasSubmenu) {
                                        setOpenSubmenuId(item.id);
                                    } else {
                                        setOpenSubmenuId(null);
                                    }
                                }}
                                role="menuitem"
                                tabIndex={-1}
                                aria-disabled={item.disabled}
                                aria-haspopup={hasSubmenu}
                                aria-expanded={hasSubmenu ? isSubmenuOpen : undefined}
                            >
                                <span className="dropdown-item-label">{item.label}</span>
                                {item.shortcut && (
                                    <span className="dropdown-item-shortcut">{item.shortcut}</span>
                                )}
                                {hasSubmenu && (
                                    <span className="dropdown-submenu-chevron">▸</span>
                                )}
                                {hasSubmenu && isSubmenuOpen && item.submenu && (
                                    <div className="dropdown-submenu" role="menu">
                                        {item.submenu.map((subItem, subIndex) => {
                                            if (isSeparator(subItem)) {
                                                return <div key={`sub-sep-${subIndex}`} className="dropdown-separator" role="separator" />;
                                            }
                                            return (
                                                <div
                                                    key={subItem.id}
                                                    className={`dropdown-item ${subItem.disabled ? 'dropdown-item-disabled' : ''}`}
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleSubmenuItemClick(subItem);
                                                    }}
                                                    role="menuitem"
                                                    aria-disabled={subItem.disabled}
                                                >
                                                    <span className="dropdown-item-label">{subItem.label}</span>
                                                    {subItem.shortcut && (
                                                        <span className="dropdown-item-shortcut">{subItem.shortcut}</span>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
