import type { HTMLAttributes } from 'react';
import './CodeBlock.css';

export interface CodeBlockProps extends HTMLAttributes<HTMLPreElement> {
    /**
     * Preformatted text to render. Provide either `text` or `children`; when
     * both are given, `children` wins (the native `<pre>` content path).
     */
    text?: string;
    /**
     * Optional cap on the visible height (any CSS length, e.g. `'320px'`).
     * When set, overflow scrolls inside the block rather than growing the layout.
     */
    maxHeight?: string;
    /**
     * Whether the text can be selected/copied. Defaults to `true` — a read-only
     * block exists so a player can grab its contents (e.g. an issue report).
     */
    selectable?: boolean;
}

/**
 * A read-only preformatted block — mono voice (Mono-Means-Exact), a faint
 * tertiary fill behind a hairline border. Theme-agnostic: styled entirely via
 * semantic CSS variables, so it follows the active theme. Replaces the issue
 * report `<pre>`.
 */
export function CodeBlock({
    text,
    maxHeight,
    selectable = true,
    className,
    style,
    children,
    ...rest
}: CodeBlockProps) {
    const classes = ['oj-code', !selectable && 'is-unselectable', className]
        .filter(Boolean)
        .join(' ');

    const mergedStyle = maxHeight ? { ...style, maxHeight } : style;

    return (
        <pre className={classes} style={mergedStyle} {...rest}>
            {children ?? text}
        </pre>
    );
}
