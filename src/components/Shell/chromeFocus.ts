/**
 * Chrome focus — give the stage its focus back after a MOUSE activation.
 *
 * `Tab` in OpenJammer means two different things depending on where the player
 * is, and both are right: on the stage it switches surface (the keycap in the
 * topbar says so), and on a control it walks to the next control. The keymap
 * arbiter draws that line by looking at the event's target — `Tab` only reaches
 * `view.toggleArrangement` when the target is `document.body` or a
 * `[data-surface-root]` element ITSELF. Focus inside a surface (a node, a port,
 * a clip) walks natively like anything else; that is W6-UI's narrowing of
 * W5-P6's F7, and it is why the surface root is the thing this file hands focus
 * back to.
 *
 * That guard is only honest if a *click* does not silently park focus on a piece
 * of chrome. Click the play button, walk away, press `Tab` — without this the
 * target is still the play button and the surface never switches, which is not
 * what the player asked for and not what the app has always done.
 *
 * So: a pointer activation hands focus back; a keyboard activation keeps it.
 * `event.detail === 0` is the standard, cross-browser discriminator — a click
 * synthesised by `Enter`/`Space` on a focused control carries no click count,
 * a real pointer click always does. No `:focus-visible` heuristics, which is
 * where the first attempt at this went wrong: Chromium raises `:focus-visible`
 * on the `Tab` keydown itself, so it cannot tell walking from clicking.
 *
 * Attach it ONCE on a chrome container; clicks from every control inside bubble
 * to it, so no button has to remember the policy.
 */
export function releaseChromeFocus(event: { detail: number }): void {
    // Enter/Space on a focused control: the player is traversing with the
    // keyboard and taking their place away would strand them mid-row.
    if (event.detail === 0) return;

    const active = document.activeElement;
    if (!(active instanceof HTMLElement)) return;
    if (active === document.body) return;

    // The click may have handed focus to something that needs it: a field the
    // control just turned into (the tempo scrubber, the bar.beat readout), or a
    // menu/popover trigger whose panel owns the keyboard while it is open.
    if (active.isContentEditable) return;
    if (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT') return;
    if (active.hasAttribute('aria-haspopup')) return;
    if (active.getAttribute('aria-expanded') === 'true') return;

    active.blur();
}
