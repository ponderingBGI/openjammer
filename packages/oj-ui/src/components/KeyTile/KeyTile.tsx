import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Port } from '../Port/Port';
import './KeyTile.css';

export type KeyTileVariant = 'key' | 'pad' | 'black' | 'white';

export interface KeyTileProps
    extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'title'> {
    /** The key/pad's name (a note name, drum label, or glyph) — Caveat voice. */
    label?: ReactNode;
    /** Pressed / lit — the tile brightens with the accent (no blur). */
    active?: boolean;
    /** Live connection — brightens the embedded Port and gives it its glow. */
    connected?: boolean;
    /**
     * Tile shape. `white`/`black` are tall piano keys (white-fill / ink-fill);
     * `key` is a square computer-style key; `pad` is a rounded drum pad. The
     * tile itself is the playable surface and hosts an embedded control Port.
     */
    variant: KeyTileVariant;
}

/**
 * A keyboard key or drum pad that is itself a port (DESIGN.md §5). The tile is
 * the playable, pressable surface — `active` lights it with the accent and a
 * hard offset shadow shrinks on press (Press-Is-Physical, no blur). It embeds a
 * control Port (numbers/triggers leave the key, so the port is grey) as its
 * connection target. The `...rest` — including the canvas's `data-node-id` /
 * `data-port-id` / `data-port-type` and pointer handlers — forwards to the tile
 * button, since pressing the key both plays it and is the connection anchor.
 * Theme-agnostic (semantic tokens only). Replaces the KeyboardVisual keys and
 * the MIDIVisual keys/pads.
 */
export function KeyTile({
    label,
    active = false,
    connected = false,
    variant,
    className,
    type = 'button',
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
        <button type={type} className={classes} {...rest}>
            <Port
                className="oj-key-tile__port"
                kind="control"
                direction="output"
                connected={connected}
            />
            {label != null && <span className="oj-key-tile__label">{label}</span>}
        </button>
    );
}
