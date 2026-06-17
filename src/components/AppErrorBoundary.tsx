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
 */

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { logError } from '../utils/log';

interface Props {
    children: ReactNode;
}

interface State {
    error: Error | null;
}

export class AppErrorBoundary extends Component<Props, State> {
    constructor(props: Props) {
        super(props);
        this.state = { error: null };
    }

    static getDerivedStateFromError(error: Error): State {
        return { error };
    }

    componentDidCatch(error: Error, info: ErrorInfo): void {
        // Route into the DevLog ring (visible to the panel, the AI, the reporter).
        logError('ui', `Render crash: ${error.message}`, {
            stack: error.stack,
            componentStack: info.componentStack,
        });
    }

    private recover = (): void => {
        this.setState({ error: null });
    };

    private reload = (): void => {
        window.location.reload();
    };

    render(): ReactNode {
        const { error } = this.state;
        if (!error) return this.props.children;

        return (
            <div className="app-error-overlay" role="alertdialog" aria-label="Something went wrong">
                <div className="app-error-card">
                    <h2 className="app-error-title">Something went wrong</h2>
                    <p className="app-error-msg">{error.message || 'An unexpected error occurred.'}</p>
                    <p className="app-error-note">
                        Your audio may still be playing — this only affects the on-screen controls.
                    </p>
                    <div className="app-error-actions">
                        <button className="app-error-btn primary" onClick={this.recover}>
                            Try to recover
                        </button>
                        <button className="app-error-btn" onClick={this.reload}>
                            Reload app
                        </button>
                    </div>
                </div>
            </div>
        );
    }
}
