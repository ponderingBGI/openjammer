import type { ReactNode, SVGProps } from 'react';
import './Icons.css';

export interface IconProps extends SVGProps<SVGSVGElement> {
    /** Pixel size of the square glyph. Defaults to 16. */
    size?: number;
    /**
     * Accessible name. When given, the icon is exposed as `role="img"` with a
     * `<title>`; when omitted, the icon is decorative (`aria-hidden`) and the
     * adjacent text/label carries the meaning (Signal-Not-Brand Rule).
     */
    title?: string;
}

/**
 * Shared wrapper for every named icon. Renders a square `<svg>` that inherits
 * the surrounding text color (`currentColor` on stroke/fill), so an icon is
 * never a literal color — it follows the active theme through whatever token
 * colors its parent's text. Handles the decorative-vs-labelled a11y split.
 */
function Icon({ size = 16, title, children, className, ...rest }: IconProps & { children: ReactNode }) {
    const classes = ['oj-icon', className].filter(Boolean).join(' ');
    const a11y = title ? { role: 'img' as const, 'aria-label': title } : { 'aria-hidden': true };

    return (
        <svg
            className={classes}
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            {...a11y}
            {...rest}
        >
            {title ? <title>{title}</title> : null}
            {children}
        </svg>
    );
}

/** A close / dismiss cross. */
export function IconClose(props: IconProps) {
    return (
        <Icon {...props}>
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
        </Icon>
    );
}

/** Disclosure chevron pointing down (an expanded/expandable region). */
export function IconChevronDown(props: IconProps) {
    return (
        <Icon {...props}>
            <polyline points="6 9 12 15 18 9" />
        </Icon>
    );
}

/** Disclosure chevron pointing right (a collapsed region / forward step). */
export function IconChevronRight(props: IconProps) {
    return (
        <Icon {...props}>
            <polyline points="9 18 15 12 9 6" />
        </Icon>
    );
}

/** A muted speaker — the silenced output state. */
export function IconMute(props: IconProps) {
    return (
        <Icon {...props}>
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
            <line x1="23" y1="9" x2="17" y2="15" />
            <line x1="17" y1="9" x2="23" y2="15" />
        </Icon>
    );
}

/** A speaker emitting sound — the live output state. */
export function IconSpeaker(props: IconProps) {
    return (
        <Icon {...props}>
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
            <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
            <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
        </Icon>
    );
}

/** A download / save-to-disk arrow into a tray. */
export function IconDownload(props: IconProps) {
    return (
        <Icon {...props}>
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
        </Icon>
    );
}

/** A lightning bolt — the low-latency / fast-path mark. */
export function IconBolt(props: IconProps) {
    return (
        <Icon {...props}>
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
        </Icon>
    );
}

/** A check mark — a completed / confirmed state (pair with a label). */
export function IconCheck(props: IconProps) {
    return (
        <Icon {...props}>
            <polyline points="20 6 9 17 4 12" />
        </Icon>
    );
}

/** A warning triangle (pair with a label per Signal-Not-Brand). */
export function IconWarning(props: IconProps) {
    return (
        <Icon {...props}>
            <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
        </Icon>
    );
}

/** The Windows platform mark — four pane tiles. */
export function IconWindows(props: IconProps) {
    return (
        <Icon fill="currentColor" stroke="none" {...props}>
            <path d="M3 5.5 10.5 4.4V11.4H3V5.5Z" />
            <path d="M12 4.2 21 3V11.4H12V4.2Z" />
            <path d="M3 12.6H10.5V19.6L3 18.5V12.6Z" />
            <path d="M12 12.6H21V21L12 19.8V12.6Z" />
        </Icon>
    );
}

/** The Apple platform mark. */
export function IconApple(props: IconProps) {
    return (
        <Icon fill="currentColor" stroke="none" {...props}>
            <path d="M16.36 12.78c-.02-2.05 1.67-3.03 1.74-3.08-.95-1.39-2.43-1.58-2.96-1.6-1.26-.13-2.46.74-3.1.74-.64 0-1.62-.72-2.67-.7-1.37.02-2.64.8-3.35 2.03-1.43 2.48-.37 6.15 1.03 8.16.68.98 1.49 2.08 2.55 2.04 1.02-.04 1.41-.66 2.65-.66 1.23 0 1.58.66 2.66.64 1.1-.02 1.8-1 2.47-1.99.78-1.14 1.1-2.24 1.12-2.3-.02-.01-2.15-.83-2.18-3.26Z" />
            <path d="M14.4 6.42c.56-.68.94-1.62.84-2.56-.81.03-1.79.54-2.37 1.22-.52.6-.98 1.56-.86 2.48.9.07 1.83-.46 2.39-1.14Z" />
        </Icon>
    );
}

/** The Linux platform mark (a Tux-style penguin silhouette). */
export function IconLinux(props: IconProps) {
    return (
        <Icon fill="currentColor" stroke="none" {...props}>
            <path d="M12 2c-1.93 0-3 1.66-3 3.6 0 .9.1 1.7.32 2.4-.7.9-1.86 2.4-2.66 4-.7 1.4-1.16 2.7-1.45 3.7-.2.7-.3 1.3-.06 1.8.2.4.6.6 1 .6.2.4.5.8 1 1.05.7.36 1.66.55 2.8.55h.1c1.14 0 2.1-.19 2.8-.55.5-.25.8-.65 1-1.05.4 0 .8-.2 1-.6.24-.5.14-1.1-.06-1.8-.29-1-.75-2.3-1.45-3.7-.8-1.6-1.96-3.1-2.66-4 .22-.7.32-1.5.32-2.4C15 3.66 13.93 2 12 2Z" />
        </Icon>
    );
}
