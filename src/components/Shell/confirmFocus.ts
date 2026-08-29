/**
 * Focus discipline for an in-UI confirm.
 *
 * OpenJammer answers "are you sure?" with a danger `Callout` carrying
 * `role="alertdialog"` rather than a native `confirm()`, because a native dialog
 * steals the keyboard from a live instrument and cannot be styled or dismissed
 * the way the rest of the app is. But an `alertdialog` that never RECEIVES focus
 * is the same bug with better paint: the announcement fires into nothing, the
 * keyboard is still on whatever was behind it, and Tab walks the page instead of
 * the question.
 *
 * So there is one rule here, and one place that keeps it:
 *   • On open, focus moves to the confirm's FIRST action — always the safe one
 *     (Cancel / Keep mine), never the destructive one.
 *   • On close, focus goes back where it came from, or to the element `restoreTo`
 *     names when the opener is gone or has become disabled by the very action
 *     just taken. It never falls to `<body>`.
 *
 * Only fires on a real open/close while the host is still mounted — an unmount
 * (a Modal closing with the confirm still up) leaves focus to the Modal, which
 * has its own restore.
 */

import { useEffect, useRef, type RefObject } from 'react';

export function useConfirmFocus(
    open: boolean,
    firstAction: RefObject<HTMLElement | null>,
    restoreTo?: () => HTMLElement | null | undefined,
): void {
    // Read through a ref so a caller can pass an inline closure without
    // re-running (and re-focusing) the effect on every render. Refreshed in an
    // effect declared BEFORE the focus one, so the focus effect always reads the
    // current commit's closure.
    const restoreRef = useRef(restoreTo);
    useEffect(() => {
        restoreRef.current = restoreTo;
    });

    const wasOpen = useRef(false);
    const previous = useRef<Element | null>(null);

    useEffect(() => {
        if (open) {
            if (!wasOpen.current) previous.current = document.activeElement;
            wasOpen.current = true;
            firstAction.current?.focus();
            return;
        }
        if (!wasOpen.current) return;
        wasOpen.current = false;

        const named = restoreRef.current?.();
        const before = previous.current;
        previous.current = null;
        const back =
            named ??
            (before instanceof HTMLElement && before.isConnected && !isDisabled(before)
                ? before
                : null);
        back?.focus();
    }, [open, firstAction]);
}

function isDisabled(element: HTMLElement): boolean {
    return (
        (element as HTMLButtonElement).disabled === true ||
        element.getAttribute('aria-disabled') === 'true'
    );
}
