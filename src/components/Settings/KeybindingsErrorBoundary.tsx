/**
 * Error Boundary for KeybindingsPanel
 *
 * Catches rendering errors during keybinding capture to prevent
 * the entire settings panel from crashing.
 */

import { Component, type ReactNode } from 'react';

interface Props {
    children: ReactNode;
}

interface State {
    hasError: boolean;
    error: Error | null;
}

export class KeybindingsErrorBoundary extends Component<Props, State> {
    constructor(props: Props) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
        console.error('KeybindingsPanel error:', error, errorInfo);
    }

    handleReset = (): void => {
        this.setState({ hasError: false, error: null });
    };

    render(): ReactNode {
        if (this.state.hasError) {
            return (
                <div className="keybindings-error">
                    <h4>Something went wrong</h4>
                    <p>
                        An error occurred while rendering the keybindings panel.
                        This may have been caused by invalid keybinding data.
                    </p>
                    <button onClick={this.handleReset}>
                        Try Again
                    </button>
                </div>
            );
        }

        return this.props.children;
    }
}
