import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from 'react';
import { Port } from '../Port/Port';
import './KeyTile.css';

export type KeyTileVariant = 'key' | 'pad' | 'black' | 'white';

export interface KeyTileProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    /** The key/pad's name (a note name, drum label, or glyph). */
    label?: ReactNode;
    /** Optional keyboard shortcut shown in the inset keycap hint. */
    hint?: ReactNode;
    /** Pressed / lit — the tile brightens with the accent (no blur). */
    active?: boolean;
    /** Live connection — colors the embedded Port's core dot. */
    connected?: boolean;
    /** Optional square width in pixels; use 34 for compact canvas vignettes. */
    size?: number;
    /**
     * Tile shape. `white`/`black` are tall piano keys (white-fill / ink-fill);
     * `key` is a square computer-style key; `pad` is a rounded drum pad. The
     * tile itself is the playable surface and hosts an embedded control Port.
     */
    variant: KeyTileVariant;
    'data-node-id'?: string;
    'data-port-id'?: string;
    'data-port-type'?: string;
}

/**
 * A keyboard key or drum pad that is itself a port. The tile is the playable,
 * pressable surface; `active` gives it the solid New DNA hit treatment. It embeds a
 * control Port (numbers/triggers leave the key, so the port is grey) as its
 * connection target. The `...rest` — including the canvas's `data-node-id` /
 * `data-port-id` / `data-port-type` and pointer handlers — forwards to the tile
 * button, since pressing the key both plays it and is the connection anchor.
 * Theme-agnostic (semantic tokens only). Replaces the KeyboardVisual keys and
 * the MIDIVisual keys/pads.
 */
export function KeyTile({
    label,
    hint,
    active = false,
    connected = false,
    size,
    variant,
    className,
    type = 'button',
    style,
    'data-node-id': dataNodeId,
    'data-port-id': dataPortId,
    'data-port-type': dataPortType,
    ...rest
}: KeyTileProps) {
    const classes = [
        'oj-key-tile',
        `oj-key-tile--${variant}`,
        active && 'is-active',
        connected && 'is-connected',
        className,
    ]
        .filter(Boolean)
        .join(' ');

    return (
        <button
            type={type}
            className={classes}
            style={{
                ...(size == null ? {} : { '--oj-key-tile-size': `${size}px` }),
                ...style,
            } as CSSProperties}
            {...rest}
        >
            <Port
                className="oj-key-tile__port"
                kind="control"
                direction="output"
                connected={connected}
                /* The TILE is the button here, and it names itself. A socket
                   that also claimed `role="button"` would nest one control
                   inside another, and its `aria-label` would be folded into the
                   tile's own accessible name ("C4" becoming "Control out —
                   drag to connect C4"). Hidden from the tree, still a pointer
                   target, still visible. */
                role={undefined}
                aria-hidden={true}
                data-node-id={dataNodeId}
                data-port-id={dataPortId}
                data-port-type={dataPortType}
            />
            {label != null && <span className="oj-key-tile__label">{label}</span>}
            {hint != null && <span className="oj-key-tile__hint">{hint}</span>}
        </button>
    );
}
