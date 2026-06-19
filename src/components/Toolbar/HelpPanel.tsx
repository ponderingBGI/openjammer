/**
 * Help Panel - Keyboard shortcuts, mode indicator, and tips
 */

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@openjammer/oj-ui';
import { useAudioStore } from '../../store/audioStore';

const HELP_DISMISSED_KEY = 'openjammer:help-dismissed';

export function HelpPanel() {
    // Default to visible, but check localStorage for dismissed state
    const [isVisible, setIsVisible] = useState(() => {
        const dismissed = localStorage.getItem(HELP_DISMISSED_KEY);
        return dismissed !== 'true';
    });

    const currentMode = useAudioStore((s) => s.currentMode);
    const isModeUnassigned = useAudioStore((s) => s.isModeUnassigned);

    // Handle close and persist to localStorage
    const handleClose = useCallback(() => {
        setIsVisible(false);
        localStorage.setItem(HELP_DISMISSED_KEY, 'true');
    }, []);

    // Handle toggle from View menu
    const handleToggle = useCallback(() => {
        setIsVisible((prev) => {
            const newValue = !prev;
            if (!newValue) {
                localStorage.setItem(HELP_DISMISSED_KEY, 'true');
            } else {
                localStorage.removeItem(HELP_DISMISSED_KEY);
            }
            return newValue;
        });
    }, []);

    // Listen for toggle event from toolbar
    useEffect(() => {
        const handler = () => handleToggle();
        window.addEventListener('openjammer:toggle-help', handler);
        return () => window.removeEventListener('openjammer:toggle-help', handler);
    }, [handleToggle]);

    // Get mode description
    const getModeLabel = () => {
        if (currentMode === 1) return 'Config';
        return `Keyboard ${currentMode}`;
    };

    if (!isVisible) {
        return (
            <Button
                variant="ghost"
                className={`help-btn-minimized ${isModeUnassigned ? 'warning' : ''}`}
                onClick={handleToggle}
                style={{
                    position: 'fixed',
                    bottom: 'var(--space-md)',
                    right: 'var(--space-md)',
                    background: 'var(--bg-node)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-lg)',
                    zIndex: 50
                }}
            >
                {isModeUnassigned ? '⚠️' : '❓'} Help
            </Button>
        );
    }

    return (
        <div className={`help-panel ${isModeUnassigned ? 'help-panel-warning' : ''}`}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3>🎹 OpenJammer</h3>
                <Button variant="ghost" iconOnly onClick={handleClose} style={{ color: 'var(--text-muted)' }}>
                    ✕
                </Button>
            </div>

            {/* Mode Indicator */}
            <div className="help-mode-indicator">
                <span className="help-mode-label">Mode:</span>
                <span className={`help-mode-value ${currentMode === 1 ? 'mode-config' : 'mode-keyboard'}`}>
                    <kbd>{currentMode}</kbd> {getModeLabel()}
                </span>
            </div>

            {/* Warning for unassigned mode */}
            {isModeUnassigned && (
                <div className="help-mode-warning">
                    <span className="warning-icon">⚠️</span>
                    <span>No keyboard assigned to key {currentMode}. Create a Keyboard node and set its number to {currentMode}.</span>
                </div>
            )}

            <ul>
                <li><kbd>1</kbd> Config mode (toolbar)</li>
                <li><kbd>2-9</kbd> Keyboard modes</li>
                <li><kbd>Right Click</kbd> Add nodes</li>
                <li><kbd>Drag</kbd> Box select</li>
                <li><kbd>Alt + Drag</kbd> Pan canvas</li>
                <li><kbd>Scroll</kbd> Zoom in/out</li>
                <li><kbd>W</kbd> Ghost Mode</li>
                <li><kbd>Delete</kbd> Remove selected</li>
                <li><kbd>Ctrl+Z</kbd> Undo</li>
                <li><kbd>Ctrl+Y</kbd> Redo</li>
            </ul>

            <div style={{
                marginTop: 'var(--space-sm)',
                paddingTop: 'var(--space-sm)',
                borderTop: '1px solid var(--border-subtle)',
                fontSize: 'var(--text-xs)',
                color: 'var(--text-muted)'
            }}>
                <strong>Keyboard:</strong> Q-P (high), A-L (mid), Z-/ (low)
            </div>
        </div>
    );
}
