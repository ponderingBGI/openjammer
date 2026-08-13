import type { HTMLAttributes } from 'react';
import './Kbd.css';

export interface KbdProps extends HTMLAttributes<HTMLElement> {
    /**
     * Marks a remapped binding (a user-customized shortcut). Tints the keycap
     * with `--accent-secondary` so a custom key reads as deliberately changed,
     * not stock. Per Mono-Means-Exact the glyph stays in `--font-mono`.
     */
    custom?: boolean;
}

/**
 * A single keyboard-key glyph. Renders a `<kbd>` keycap: faint fill, hairline
 * border, mono type (Mono-Means-Exact — a shortcut is read literally). Theme-
 * agnostic, styled only via semantic tokens. Replaces the app's
 * `.command-bar-kbd` / `.keybindings-shortcut` / `.dropdown-item-shortcut`.
 */
export function Kbd({ custom = false, className, ...rest }: KbdProps) {
    const classes = ['oj-kbd', custom && 'oj-kbd--custom', className]
        .filter(Boolean)
        .join(' ');

    return <kbd className={classes} {...rest} />;
}
