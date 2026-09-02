/**
 * AppErrorBoundary (§4 — panic-safe live UX).
 *
 * A render crash must never white-screen a live show. This top-level boundary
 * catches any rendering error in the app tree, routes it into the DevLog (so the
 * AI's `get_logs` and the issue reporter can see it), and shows a CALM recovery
 * card instead of a blank page: try-to-recover (re-mount the tree — enough for a
 * transient error) or reload. The audio engine runs in the AudioWorklet / native
 * host, off the React tree, so sound usually keeps playing through a UI crash —
 * the card says so, so a performer doesn't panic.
 *
 * STYLING: this is the ONE surface that must not use oj-ui components or design
 * tokens. It is what renders when the app has failed, and that failure may BE
 * the theme layer — `applyTheme()` writes the `--bg-node` / `--text-primary`
 * custom properties onto `document.documentElement` at runtime, so a crash
 * before or during that call leaves every `var(--x)` empty. So the markup is
 * plain elements and `AppErrorBoundary.css` is literal-only by design, with a
 * `prefers-color-scheme: dark` block the OS answers without any of our JS. See
 * the header comment in that file for the palette it transcribes.
 */

import { Component, createRef, type ErrorInfo, type ReactNode } from 'react';
import { logError } from '../utils/log';

interface Props {
    children: ReactNode;
}

interface State {
    error: Error | null;
    /**
     * Has the player already been shown the full card for this session?
     *
     * Once they have — by recovering, or by hiding it — the boundary never takes
     * the whole screen again: the next crash arrives as the corner chip. That is
     * U14's point. The first failure has to be unmissable; the fourth one during
     * the same set must not be, because by then the performer knows, and what
     * they need is to see their patch.
     */
    collapsed: boolean;
}

export class AppErrorBoundary extends Component<Props, State> {
    /** The card's primary action, focused on mount so Escape has somewhere to land. */
    private primaryRef = createRef<HTMLButtonElement>();

    constructor(props: Props) {
        super(props);
        this.state = { error: null, collapsed: false };
    }

    static getDerivedStateFromError(error: Error): Partial<State> {
        // Deliberately does NOT reset `collapsed`: a repeat crash after the
        // player has dealt with the first one comes back as the chip.
        return { error };
    }

    componentDidMount(): void {
        // A window listener rather than the overlay's `onKeyDown`: the crash may
        // have taken the element that had focus with it, and an Escape that only
        // works when the card happens to hold focus is not an escape.
        window.addEventListener('keydown', this.onKeyDown, true);
        // A crash during the FIRST render reaches the boundary as a mount, not
        // as an update, so the card would otherwise open with focus on <body>
        // and Tab would start from the top of the document.
        if (this.state.error && !this.state.collapsed) this.primaryRef.current?.focus();
    }

    componentDidUpdate(_: Props, previous: State): void {
        /*
         * THE WALL TAKES FOCUS. THE CHIP DOES NOT.
         *
         * The card is modal and unannounced, so it has to be where the keyboard
         * already is. The chip is a `role="status"` in the corner that exists
         * precisely so the show can go on — pulling focus out of whatever the
         * performer's hands were on, mid-set, to land on a button they did not
         * ask for is the thing HA-14 is about. `collapse()` still moves focus
         * deliberately: there it is continuity from the `Hide` button the
         * player just pressed.
         */
        if (!previous.error && this.state.error && !this.state.collapsed) this.primaryRef.current?.focus();
    }

    componentWillUnmount(): void {
        window.removeEventListener('keydown', this.onKeyDown, true);
    }

    componentDidCatch(error: Error, info: ErrorInfo): void {
        // Route into the DevLog ring (visible to the panel, the AI, the reporter).
        logError('ui', `Render crash: ${error.message}`, {
            stack: error.stack,
            componentStack: info.componentStack,
        });
    }

    /** Escape = *Try to recover* (HA-14). Only while the blocking card is up. */
    private onKeyDown = (event: KeyboardEvent): void => {
        if (event.key !== 'Escape' || !this.state.error || this.state.collapsed) return;
        event.preventDefault();
        event.stopPropagation();
        this.recover();
    };

    private recover = (): void => {
        this.setState({ error: null, collapsed: true });
    };

    /** Keep the failure, give the stage back. */
    private collapse = (): void => {
        this.setState({ collapsed: true }, () => this.primaryRef.current?.focus());
    };

    private reload = (): void => {
        window.location.reload();
    };

    render(): ReactNode {
        const { error, collapsed } = this.state;
        if (!error) return this.props.children;

        /*
         * THE CORNER CHIP.
         *
         * Errors are a chip in the chrome, never a dialog (timeline spec §1.5),
         * and "a held note beats a glitch": the audio is very likely still
         * playing, so what the player needs is their screen back and a way to
         * choose when to recover. `role="status"`, not `alertdialog` — it
         * announces once, takes no focus, and covers nothing.
         *
         * It deliberately does NOT re-render `children`. A boundary cannot catch
         * an error thrown by its own render, so drawing the failed subtree here
         * would rethrow straight past this boundary on the very next frame and
         * white-screen the app — the one outcome worse than the card. Whatever
         * is OUTSIDE the failed subtree keeps painting; re-mounting the subtree
         * is what `Recover` is for, and it is the player's call.
         */
        if (collapsed) {
            return (
                <div className="app-error-chip" role="status" aria-label="Something broke">
                    <span className="app-error-chip__text">
                        Something broke — your audio may still be playing.
                    </span>
                    <button ref={this.primaryRef} className="app-error-btn primary" onClick={this.recover}>
                        Recover
                    </button>
                    <button className="app-error-btn" onClick={this.reload}>
                        Reload
                    </button>
                </div>
            );
        }

        return (
            <div className="app-error-overlay" role="alertdialog" aria-label="Something went wrong">
                <div className="app-error-card">
                    <h2 className="app-error-title">Something went wrong</h2>
                    <p className="app-error-msg">{error.message || 'An unexpected error occurred.'}</p>
                    <p className="app-error-note">
                        Your audio may still be playing — this only affects the on-screen controls.
                        Press <kbd className="app-error-kbd">Esc</kbd> to try to recover, or hide this
                        and keep working.
                    </p>
                    {/*
                      * The primary action is FIRST — in the DOM, in the tab
                      * order and on the line. It is the one the card autofocuses
                      * and the one Escape performs, and a recommended action put
                      * last in reading order asks the player to look for the
                      * thing the card already put their hands on (N4).
                      */}
                    <div className="app-error-actions">
                        <button ref={this.primaryRef} className="app-error-btn primary" onClick={this.recover}>
                            Try to recover
                        </button>
                        <button className="app-error-btn" onClick={this.reload}>
                            Reload app
                        </button>
                        <button className="app-error-btn" onClick={this.collapse}>
                            Hide
                        </button>
                    </div>
                </div>
            </div>
        );
    }
}
