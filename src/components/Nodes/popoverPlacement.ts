/**
 * Where an anchored popover actually fits, in VIEWPORT space.
 *
 * A node faceplate's popover (the instrument picker) lives inside the canvas's
 * TRANSFORMED subtree, so `position: absolute; top: 100%` alone puts it wherever
 * the node happens to be — including entirely below the fold, which is exactly
 * what a player hit when the instrument sat low on the canvas: the whole menu
 * opened off-screen with no way to reach it.
 *
 * Deciding is this module's job; measuring and applying is the caller's, which
 * is what makes the rule pure and unit-testable. It lives beside the faceplates
 * rather than inside one so the component file stays a component file
 * (react-refresh). `Canvas/ContextMenu` solves the same problem inline for a
 * PORTALLED, point-anchored menu; if a third popover needs this, that one should
 * come here too rather than a third copy being written.
 */

/** Breathing room kept between the popover and any viewport edge. */
const VIEWPORT_PAD = 8;
/** Gap between the card and the picker, in unzoomed node pixels. */
export const PICKER_GAP = 6;

export interface Rect { top: number; bottom: number; left: number; right: number }
export interface Size { width: number; height: number }

export interface PopoverPlacement {
    /** Viewport-space top/left the popover should occupy. */
    top: number;
    left: number;
    /** Height it is allowed to take — never taller than the viewport allows. */
    maxHeight: number;
    /** It opens ABOVE the anchor (there was no room below). */
    flipped: boolean;
}

/**
 * Prefers BELOW — that is where the eye expects a dropdown. Flips above only
 * when below cannot hold the popover and above holds more, then clamps both axes
 * and caps the height, so the result is always fully on screen.
 */
export function placePopover(
    anchor: Rect,
    size: Size,
    viewport: Size,
    gap: number = PICKER_GAP,
    pad: number = VIEWPORT_PAD,
): PopoverPlacement {
    const roomBelow = viewport.height - pad - (anchor.bottom + gap);
    const roomAbove = anchor.top - gap - pad;
    const flipped = size.height > roomBelow && roomAbove > roomBelow;

    const room = Math.max(0, flipped ? roomAbove : roomBelow);
    const maxHeight = Math.max(0, Math.min(size.height, room, viewport.height - pad * 2));

    const rawTop = flipped ? anchor.top - gap - maxHeight : anchor.bottom + gap;
    const topLimit = Math.max(pad, viewport.height - maxHeight - pad);
    const top = Math.min(Math.max(pad, rawTop), topLimit);

    // Left-aligned with the card; right-aligned when that would overflow.
    const rawLeft = anchor.left + size.width > viewport.width - pad
        ? anchor.right - size.width
        : anchor.left;
    const leftLimit = Math.max(pad, viewport.width - size.width - pad);
    const left = Math.min(Math.max(pad, rawLeft), leftLimit);

    return { top, left, maxHeight, flipped };
}
