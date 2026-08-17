import { useCallback, useEffect, useRef } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Surface } from '../Surface/Surface';
import './Modal.css';

export type ModalAlign = 'top' | 'center' | 'bottom';
export type ModalSize = 'sm' | 'md' | 'lg' | 'auto';

export interface ModalProps {
    /** Whether the dialog is mounted and visible. When `false`, renders nothing. */
    open: boolean;
    /** Called when the user dismisses — Escape, or a scrim click (if enabled). */
    onClose: () => void;
    /** Accessible name for the dialog (required — there is no visible title contract here). */
    ariaLabel: string;
    /** Where the panel sits in the viewport. Defaults to `center`. */
    align?: ModalAlign;
    /** Panel max-width step. `auto` hugs its content. Defaults to `md`. */
    size?: ModalSize;
    /** Whether clicking the scrim (outside the panel) closes the dialog. Defaults to `true`. */
    closeOnScrim?: boolean;
    /** The dialog body — compose PanelHeader, fields, buttons, etc. */
    children?: ReactNode;
}

/** Selector for the elements the focus trap and initial-focus pass consider focusable. */
const FOCUSABLE =
    'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * An accessible overlay dialog. A full-viewport scrim (the `--overlay-scrim`
 * wash, no blur — DESIGN.md Hard-Shadow) aligns a lifted Surface panel as a
 * `role="dialog"`. Escape and an optional scrim click close it; focus moves
 * into the panel on open, Tab is trapped within it, and the previously-focused
 * element is restored on close. Theme-agnostic: styled only via semantic CSS
 * variables. The single overlay primitive behind every dialog in the app.
 */
export function Modal({
    open,
    onClose,
    ariaLabel,
    align = 'center',
    size = 'md',
    closeOnScrim = true,
    children,
}: ModalProps) {
    const scrimRef = useRef<HTMLDivElement>(null);
    /** The element focused immediately before the dialog opened, to restore on close. */
    const restoreRef = useRef<Element | null>(null);

    /** Resolve the dialog panel (the Surface) from inside the scrim container. */
    const getPanel = () =>
        scrimRef.current?.querySelector<HTMLElement>('[role="dialog"]') ?? null;

    // Move focus into the panel on open; restore it to the prior element on close.
    useEffect(() => {
        if (!open) return;
        restoreRef.current = document.activeElement;
        const panel = getPanel();
        if (panel) {
            const first = panel.querySelector<HTMLElement>('[data-autofocus="true"]') ?? panel.querySelector<HTMLElement>(FOCUSABLE);
            (first ?? panel).focus();
        }
        return () => {
            const toRestore = restoreRef.current;
            if (toRestore instanceof HTMLElement) toRestore.focus();
        };
    }, [open]);

    // Escape to close, and a Tab focus trap kept within the panel.
    const onKeyDown = useCallback(
        (event: ReactKeyboardEvent<HTMLDivElement>) => {
            if (event.key === 'Escape') {
                event.stopPropagation();
                onClose();
                return;
            }
            if (event.key !== 'Tab') return;
            const panel = getPanel();
            if (!panel) return;
            const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
            if (focusable.length === 0) {
                // Nothing tabbable — keep focus parked on the panel.
                event.preventDefault();
                panel.focus();
                return;
            }
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            const active = document.activeElement;
            if (event.shiftKey && active === first) {
                event.preventDefault();
                last?.focus();
            } else if (!event.shiftKey && active === last) {
                event.preventDefault();
                first?.focus();
            }
        },
        [onClose],
    );

    const onScrimMouseDown = useCallback(
        (event: ReactMouseEvent<HTMLDivElement>) => {
            // Only a click that started on the scrim itself (not the panel) dismisses.
            if (closeOnScrim && event.target === event.currentTarget) onClose();
        },
        [closeOnScrim, onClose],
    );

    if (!open) return null;

    return createPortal(
        <div
            ref={scrimRef}
            className={`oj-modal__scrim oj-modal__scrim--align-${align}`}
            onMouseDown={onScrimMouseDown}
            onKeyDown={onKeyDown}
        >
            <Surface
                elevation="lifted"
                role="dialog"
                aria-modal="true"
                aria-label={ariaLabel}
                tabIndex={-1}
                className={`oj-modal oj-modal--size-${size}`}
            >
                {children}
            </Surface>
        </div>,
        document.body,
    );
}
