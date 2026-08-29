/**
 * Topbar — the app's one piece of fixed chrome.
 *
 * It replaces the floating toolbar pill, which was a small dense island of
 * unrelated things (menus, undo, a play button, a gear, a health dot, a project
 * name) hovering over the patch. Splitting it in two makes both halves honest:
 * everything about TIME went into the floating transport pill; everything about
 * the DOCUMENT and its STATE lives here, on a rule, out of the stage's way.
 *
 * Left is where you are: brand, the document menus, the breadcrumbs when you are
 * inside a node, and the surface switch. Right is how things are: undo/redo,
 * engine health, the project and offline chips, latency, collaboration, theme,
 * settings. Nothing in the right cluster is louder than the patch.
 */

import { Chip, IconButton } from '@openjammer/oj-ui';
import { AppMenuBar } from './AppMenuBar';
import { Breadcrumbs } from '../Toolbar/Breadcrumbs';
import { SurfaceSwitcher } from './SurfaceSwitcher';
import { ThemeToggle } from './ThemeToggle';
import { LatencyChip } from './LatencyChip';
import { releaseChromeFocus } from './chromeFocus';
import { EngineHealthDot } from '../EngineHealthDot/EngineHealthDot';
import { CollabControl } from '../Collab/CollabControl';
import { useHistoryStore } from '../../store/historyStore';
import { useProjectStore } from '../../store/projectStore';
import { useOnlineStatus } from '../../hooks/usePWA';
import './Topbar.css';

const UndoGlyph = () => (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
        <path d="M4.4 3.2 1.8 5.8l2.6 2.6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M2 5.8h7.1a4.2 4.2 0 0 1 0 8.4H5.4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
);

const RedoGlyph = () => (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
        <path d="M11.6 3.2l2.6 2.6-2.6 2.6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M14 5.8H6.9a4.2 4.2 0 0 0 0 8.4h3.7" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
);

/*
 * Settings as SLIDERS, not a cog. A cog's spokes sit one button away from the
 * theme toggle's sun and read as a second sun at 16px — and two suns in a row is
 * exactly the half-second of "wait, what is that" this product does not spend.
 */
const SettingsGlyph = () => (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
        <path d="M1.6 4.2h12.8M1.6 8h12.8M1.6 11.8h12.8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <circle cx="5.2" cy="4.2" r="1.9" fill="var(--bg-node-header)" stroke="currentColor" strokeWidth="1.5" />
        <circle cx="10.6" cy="8" r="1.9" fill="var(--bg-node-header)" stroke="currentColor" strokeWidth="1.5" />
        <circle cx="5.2" cy="11.8" r="1.9" fill="var(--bg-node-header)" stroke="currentColor" strokeWidth="1.5" />
    </svg>
);

export function Topbar({ onOpenSettings }: { onOpenSettings: () => void }) {
    // The UNIFIED history — undo here reaches the graph and the timeline alike,
    // which is what a player means by "take that back".
    const canUndo = useHistoryStore((state) => state.cursor > 0);
    const canRedo = useHistoryStore((state) => state.cursor < state.entries.length);
    const projectName = useProjectStore((state) => state.name);
    const isOnline = useOnlineStatus();

    // A mouse click on any control in here hands focus back to the stage, so bare
    // `Tab` still switches surface afterwards; a keyboard activation keeps focus,
    // so a player traversing the topbar stays where they are.
    return (
        <header className="oj-topbar" onClick={releaseChromeFocus}>
            <div className="oj-topbar__cluster oj-topbar__cluster--left">
                <span className="oj-topbar__brand">
                    <i className="oj-topbar__brand-dot" aria-hidden="true" />
                    OpenJammer
                </span>
                <AppMenuBar />
                <Breadcrumbs />
            </div>

            <div className="oj-topbar__cluster oj-topbar__cluster--centre">
                <SurfaceSwitcher />
            </div>

            <div className="oj-topbar__cluster oj-topbar__cluster--right">
                <IconButton
                    label="Undo"
                    title="Undo (Ctrl+Z)"
                    icon={<UndoGlyph />}
                    disabled={!canUndo}
                    onClick={() => useHistoryStore.getState().undo()}
                />
                <IconButton
                    label="Redo"
                    title="Redo (Ctrl+Shift+Z)"
                    icon={<RedoGlyph />}
                    disabled={!canRedo}
                    onClick={() => useHistoryStore.getState().redo()}
                />

                <span className="oj-topbar__rule" aria-hidden="true" />

                <EngineHealthDot />
                <LatencyChip onOpenSettings={onOpenSettings} />
                {projectName && (
                    <Chip title={`Project: ${projectName}`} className="oj-topbar__project">
                        {projectName}
                    </Chip>
                )}
                {!isOnline && (
                    <Chip tone="warning" title="You are offline — everything still works">
                        Offline
                    </Chip>
                )}

                <span className="oj-topbar__rule" aria-hidden="true" />

                <CollabControl />
                <ThemeToggle />
                <IconButton
                    label="Settings"
                    title="Settings"
                    icon={<SettingsGlyph />}
                    onClick={() => window.dispatchEvent(new CustomEvent('openjammer:toggle-settings'))}
                />
            </div>
        </header>
    );
}
