/**
 * AppMenuBar — File / Edit / View, the three ghost triggers at the head of the
 * topbar.
 *
 * This is what remains of the old floating toolbar pill once the transport moved
 * into the {@link TransportPill} and the status cluster moved to the topbar's
 * right: the document verbs, and nothing else. Every shortcut keycap is read
 * from the LIVE keymap, so a rebound key is never advertised wrong.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useGraphStore } from '../../store/graphStore';
import { useCanvasStore } from '../../store/canvasStore';
import { useProjectStore } from '../../store/projectStore';
import { useTransportStore } from '../../store/transportStore';
import { useArrangementStore } from '../../store/arrangementStore';
import { arrangementForExport, readArrangement } from '../../song/project';
import { collectSaveData } from '../../persistence/collectSaveData';
import { clearEmergencyBackup } from '../../persistence/recovery';
import { exportWorkflow, downloadWorkflow, loadWorkflowFromFile, importWorkflow } from '../../engine/serialization';
import { getExecutor } from '../../audio/executor';
import { DropdownMenu, type MenuItemOrSeparator } from '../Toolbar/DropdownMenu';
import { keyComboToString, useKeybindingsStore } from '../../store/keybindingsStore';
import { Button, Callout, Input } from '@openjammer/oj-ui';
import { useConfirmFocus } from './confirmFocus';
import { newProjectInvoker, requestNewProject, useNewProjectDialog, type NewProjectIntent } from './newProjectDialog';
import { isTauri } from '../../audio/executor';

/**
 * A question the menu bar has to ask before it does something irreversible.
 *
 * Never a native `confirm()`. That dialog blocks the main thread, cannot be
 * styled or Escaped like the rest of the app, and — the reason it matters here —
 * rips the keyboard away from an instrument that may be sounding. This is the
 * same in-UI grammar Settings uses: a Callout carrying `role="alertdialog"`,
 * two real Buttons, the safe one first and the focused one.
 */
interface MenuConfirm {
    /** Identity, so swapping one question for another remounts the dialog. */
    id: string;
    tone: 'danger' | 'info';
    title: string;
    body: string;
    /** The word on the consequential button — always a verb, never "OK". */
    confirmLabel: string;
    confirmVariant: 'danger' | 'primary';
    onConfirm: () => void;
    /** Cancel and Escape both land here — a question asked must always answer. */
    onCancel?: () => void;
}

/**
 * "Where does my work actually live?" — answered before it is asked.
 *
 * A first-run player who presses Ctrl+S has no project, and the honest answer is
 * not a shrug: their work IS kept (in this browser, through a reload), and it is
 * NOT kept the way they think (clearing site data, another machine, another
 * browser — gone). So the dialog says both, and offers the one thing that fixes
 * it: a folder on their own computer that every save writes into.
 *
 * It is not a native dialog for the reason every other question in this app is
 * not one (HA-15), and the confirm button is the user gesture the folder picker
 * needs, so the OS dialog still opens from a real click.
 */
function NewProjectDialog({
    intent,
    supported,
    restoreTo,
    onCancel,
    onCreate,
}: {
    intent: NewProjectIntent;
    supported: boolean;
    restoreTo: () => HTMLElement | null;
    onCancel: () => void;
    onCreate: (name: string) => void;
}) {
    const [name, setName] = useState('Untitled song');
    const cancelRef = useRef<HTMLButtonElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    // The name field is where the answer goes, so that is where focus lands —
    // except when there is nothing to fill in, when it is the way out.
    useConfirmFocus(true, supported ? inputRef : cancelRef, restoreTo);
    /*
     * …and the keyboard goes back where it came from when this UNMOUNTS.
     * `useConfirmFocus` restores on a real open -> close while it is still
     * mounted; this dialog is removed from the tree outright, so that path never
     * runs and focus fell to `<body>`. `restoreTo` is read through a ref so the
     * cleanup always sees the current commit's closure.
     */
    const restoreRef = useRef(restoreTo);
    useEffect(() => { restoreRef.current = restoreTo; });
    useEffect(() => () => { restoreRef.current()?.focus(); }, []);

    const saving = intent === 'save-current';
    const title = saving ? 'Save this song to a folder' : 'New project';

    return (
        <Callout
            variant="info"
            title={title}
            className="oj-menu-confirm oj-new-project"
            role="dialog"
            aria-label={title}
            onKeyDown={(event) => {
                if (event.key !== 'Escape') return;
                event.stopPropagation();
                onCancel();
            }}
        >
            {supported ? (
                <>
                    <p className="oj-menu-confirm__body">
                        {saving
                            ? 'Right now this song is only kept in this browser — it survives a reload, but not clearing site data, and it cannot follow you to another machine.'
                            : 'A project is a folder on your computer. OpenJammer writes the song and the canvas into it every time you save.'}
                    </p>
                    <p className="oj-menu-confirm__body">
                        Pick a folder you own and every {isTauri() ? 'save' : 'Ctrl+S'} writes both halves there — the song and the canvas.
                    </p>
                    <label className="oj-new-project__field">
                        <span>Project name</span>
                        <Input
                            ref={inputRef}
                            value={name}
                            aria-label="Project name"
                            onChange={(event) => setName(event.target.value)}
                            onKeyDown={(event) => {
                                if (event.key !== 'Enter') return;
                                event.preventDefault();
                                onCreate(name);
                            }}
                        />
                    </label>
                </>
            ) : (
                <p className="oj-menu-confirm__body">
                    This browser cannot open a folder on your computer (that needs Chrome or Edge).
                    Your work is still kept in this browser and comes back when you reopen — and
                    File ▸ Export Workflow… writes a file you own right now.
                </p>
            )}
            <div className="oj-menu-confirm__actions">
                <Button ref={cancelRef} variant="secondary" data-autofocus="true" onClick={onCancel}>
                    {supported ? 'Not now' : 'Close'}
                </Button>
                {supported && (
                    <Button variant="primary" onClick={() => onCreate(name)}>
                        Choose a folder…
                    </Button>
                )}
            </div>
        </Callout>
    );
}

export function AppMenuBar() {
    const fileInputRef = useRef<HTMLInputElement>(null);

    /*
     * The one in-UI confirm this bar can raise. `DropdownMenu` closes on
     * activation without restoring focus, so the dialog takes focus on open and
     * hands it back to the File trigger on close — never to `<body>`.
     */
    const [confirming, setConfirming] = useState<MenuConfirm | null>(null);
    /*
     * The New Project dialog's open state lives in a store slice, not in an
     * event, so Ctrl+S / the palette / Safe Mode reach it by a CALL that cannot
     * silently miss (UX-INV Q4). This bar is its one renderer.
     */
    const newProjectIntent = useNewProjectDialog((state) => state.intent);
    const closeNewProject = useNewProjectDialog((state) => state.close);
    const menusRef = useRef<HTMLDivElement>(null);
    const confirmCancelRef = useRef<HTMLButtonElement>(null);
    useConfirmFocus(
        confirming !== null,
        confirmCancelRef,
        () => menusRef.current?.querySelector<HTMLElement>('.dropdown-trigger') ?? null,
    );

    const nodes = useGraphStore((s) => s.nodes);
    const connections = useGraphStore((s) => s.connections);
    const clearGraph = useGraphStore((s) => s.clearGraph);
    const loadGraph = useGraphStore((s) => s.loadGraph);
    const deleteSelected = useGraphStore((s) => s.deleteSelected);

    const zoom = useCanvasStore((s) => s.zoom);
    const resetView = useCanvasStore((s) => s.resetView);
    const zoomTo = useCanvasStore((s) => s.zoomTo);
    const ghostMode = useCanvasStore((s) => s.ghostMode);
    const toggleGhostMode = useCanvasStore((s) => s.toggleGhostMode);
    const customBindings = useKeybindingsStore((s) => s.customBindings);
    const shortcutFor = (actionId: string) => {
        void customBindings;
        const binding = useKeybindingsStore.getState().getBinding(actionId);
        return binding ? keyComboToString(binding) : undefined;
    };

    // Project state
    const projectName = useProjectStore((s) => s.name);
    const projectIsSupported = useProjectStore((s) => s.isSupported);
    const recentProjects = useProjectStore((s) => s.recentProjects);
    const isSaving = useProjectStore((s) => s.isSaving);
    const createProject = useProjectStore((s) => s.createProject);
    const openProject = useProjectStore((s) => s.openProject);
    const openRecentProject = useProjectStore((s) => s.openRecentProject);
    const saveProject = useProjectStore((s) => s.saveProject);
    const closeProject = useProjectStore((s) => s.closeProject);

    // Continuous sources (loopers). The transport GESTURE plays the song when one
    // exists, so this stays reachable here — consolidating the gesture must never
    // cost the capability.
    const isGloballyPaused = useTransportStore((s) => s.isGloballyPaused);

    // Export workflow
    const handleExport = useCallback(async () => {
        try {
            // Capture each hosted plugin's opaque state into node.data first (the
            // oj.state save half) so the export persists it and a reopen restores the
            // plugin. No-op on the browser tier; non-fatal if the engine declines.
            await getExecutor().capturePluginStates();
            // Persist the timeline alongside the graph (FROZEN-1): a reopened export
            // keeps its whole arrangement.
            const arr = useArrangementStore.getState().arrangement;
            const workflow = exportWorkflow(
                nodes,
                connections,
                'OpenJammer Workflow',
                arr ? arrangementForExport(arr) : undefined,
            );
            downloadWorkflow(workflow);
            toast.success('Workflow exported');
        } catch (err) {
            console.error('Failed to export workflow:', err);
            toast.error(`Failed to export workflow: ${(err as Error).message}`);
        }
    }, [nodes, connections]);

    // Import workflow
    const handleImport = useCallback(() => {
        fileInputRef.current?.click();
    }, []);

    const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        try {
            const workflow = await loadWorkflowFromFile(file);
            const { nodes: importedNodes, connections: importedConnections, arrangement } =
                importWorkflow(workflow);
            loadGraph(importedNodes, importedConnections);
            // Hydrate the timeline (or clear it when the import has none) — FROZEN-1.
            useArrangementStore.getState().setArrangement(readArrangement(arrangement) ?? null);
        } catch (err) {
            console.error('Failed to import workflow:', err);
            toast.error('Failed to import workflow. Please check the file format.');
        }

        e.target.value = '';
    }, [loadGraph]);

    // New Canvas — the project-less workflow: just clears the canvas.
    const handleNew = useCallback(() => {
        if (nodes.size === 0) {
            clearGraph();
            resetView();
            return;
        }
        setConfirming({
            id: 'new-canvas',
            tone: 'danger',
            title: 'Clear this canvas?',
            // Named for the canvas, and scoped to it — so it has to say that the
            // song is not part of the deal, or "New Canvas" quietly means two
            // different things depending on which surface you were looking at.
            body: `${nodes.size} node${nodes.size === 1 ? '' : 's'} and every cable between them go. Ctrl+Z will not bring them back. Your song keeps its tracks and clips — File ▸ New Project… starts both over.`,
            confirmLabel: 'Clear canvas',
            confirmVariant: 'danger',
            onConfirm: () => {
                clearGraph();
                resetView();
            },
        });
    }, [nodes.size, clearGraph, resetView]);

    /*
     * Project handlers.
     *
     * The New Project flow is the ONE place a project folder is created, and it
     * is reached by a direct call (`requestNewProject`) from File ▸ New
     * Project…, from Ctrl+S with nowhere to save, from the Ctrl+K palette and
     * from Safe Mode. It used to be an `openjammer:new-project` event that
     * nothing anywhere subscribed to (UX-INV Q4).
     *
     * The dialog asks for the name BEFORE the folder picker, because the picker
     * has to be the last thing before the OS dialog opens (it must be a direct
     * user gesture) and because a native `prompt()` mid-flow is the thing
     * HA-15 is about.
     */
    const runNewProject = useCallback(async (intent: NewProjectIntent, name: string) => {
        try {
            // The click that dismissed the dialog IS the user gesture the folder
            // picker needs, so nothing is lost against the old flow.
            await createProject({
                name,
                confirmOverwrite: (folderName) => new Promise<boolean>((resolve) => {
                    setConfirming({
                        id: `overwrite-${folderName}`,
                        tone: 'danger',
                        title: 'That folder already has a project',
                        body: `“${folderName}” already contains an OpenJammer project. Creating a new one there overwrites it.`,
                        confirmLabel: 'Overwrite it',
                        confirmVariant: 'danger',
                        onConfirm: () => resolve(true),
                        onCancel: () => resolve(false),
                    });
                }),
            });
            if (intent === 'save-current') {
                // Ctrl+S asked to SAVE. Clearing the canvas here is the trap the
                // investigation flagged: the same handler that starts a fresh
                // project must not be the one that answers "save this". Both
                // halves are kept, and both are written.
                await saveProject(collectSaveData());
                toast.success('Project saved');
            } else {
                /*
                 * A new project is a new DOCUMENT, and the document is two
                 * halves. Clearing only the canvas left the previous song
                 * loaded — it followed the player into the brand-new folder,
                 * was written there by the next Ctrl+S, and came back on every
                 * clean boot now that a clean boot restores the song. So the
                 * song goes with the canvas, and the backup that would resurrect
                 * it goes too.
                 */
                clearGraph();
                useArrangementStore.getState().setArrangement(null);
                clearEmergencyBackup();
                resetView();
            }
        } catch (err) {
            if ((err as Error).message !== 'Cancelled' &&
                (err as Error).message !== 'Cancelled - folder already contains a project' &&
                (err as DOMException).name !== 'AbortError') {
                console.error('Failed to create project:', err);
                toast.error(`Failed to create project: ${(err as Error).message}`);
            }
        }
    }, [createProject, saveProject, clearGraph, resetView]);

    const handleNewProject = useCallback(() => requestNewProject('new'), []);

    const handleOpenProject = useCallback(async () => {
        if (!projectIsSupported) {
            toast.error('File System Access API is not supported in this browser. Use Chrome or Edge for local project folders.');
            return;
        }

        try {
            const { manifest } = await openProject();
            // Load graph from manifest if it exists
            if (manifest.graph?.nodes && manifest.graph?.edges) {
                // Convert to expected format
                const importedNodes = manifest.graph.nodes as Parameters<typeof loadGraph>[0];
                const importedConnections = manifest.graph.edges as Parameters<typeof loadGraph>[1];
                loadGraph(importedNodes, importedConnections);
            } else {
                clearGraph();
            }
            // Hydrate the timeline from the project (or clear it when absent) — FROZEN-1.
            useArrangementStore.getState().setArrangement(readArrangement(manifest.arrangement) ?? null);
            resetView();
        } catch (err) {
            if ((err as DOMException).name !== 'AbortError') {
                const message = (err as Error).message;
                // Offer to create a new project if folder is empty
                if (message.includes('No project.openjammer found')) {
                    setConfirming({
                        id: 'create-project-here',
                        tone: 'info',
                        title: 'No project in that folder',
                        body: 'That folder has no OpenJammer project in it. Create a new one there instead? Your canvas and song are cleared for it.',
                        confirmLabel: 'Create project',
                        confirmVariant: 'primary',
                        // Straight into the create — the player already answered
                        // the only question the name dialog would ask, and this
                        // click IS the user gesture the folder picker needs. One
                        // intent must not cost three dialogs in a row.
                        onConfirm: () => { void runNewProject('new', 'Untitled song'); },
                    });
                } else {
                    console.error('Failed to open project:', err);
                    toast.error(`Failed to open project: ${message}`);
                }
            }
        }
    }, [projectIsSupported, openProject, loadGraph, clearGraph, resetView, runNewProject]);

    const handleSaveProject = useCallback(async () => {
        if (!projectName) {
            // Nowhere to save yet — ask for a home, then write THIS song into it.
            requestNewProject('save-current');
            return;
        }

        try {
            await saveProject(collectSaveData());
            toast.success('Project saved');
        } catch (err) {
            console.error('Failed to save project:', err);
            toast.error(`Failed to save project: ${(err as Error).message}`);
        }
    }, [projectName, saveProject]);

    const handleCloseProject = useCallback(() => {
        closeProject();
    }, [closeProject]);

    const handleOpenRecentProject = useCallback(async (project: typeof recentProjects[0]) => {
        try {
            const { manifest } = await openRecentProject(project);
            if (manifest.graph?.nodes && manifest.graph?.edges) {
                const importedNodes = manifest.graph.nodes as Parameters<typeof loadGraph>[0];
                const importedConnections = manifest.graph.edges as Parameters<typeof loadGraph>[1];
                loadGraph(importedNodes, importedConnections);
            } else {
                clearGraph();
            }
            // Hydrate the timeline from the project (or clear it when absent) — FROZEN-1.
            useArrangementStore.getState().setArrangement(readArrangement(manifest.arrangement) ?? null);
            resetView();
        } catch (err) {
            console.error('Failed to open recent project:', err);
            toast.error(`Failed to open project: ${(err as Error).message}`);
        }
    }, [openRecentProject, loadGraph, clearGraph, resetView]);

    // Zoom controls
    const handleZoomIn = useCallback(() => zoomTo(zoom * 1.2), [zoom, zoomTo]);
    const handleZoomOut = useCallback(() => zoomTo(zoom / 1.2), [zoom, zoomTo]);
    const handleResetView = useCallback(() => resetView(), [resetView]);

    // Detect platform for shortcut display
    const isMac = typeof navigator !== 'undefined' && navigator.platform.toUpperCase().indexOf('MAC') >= 0;
    const cmdKey = isMac ? '⌘' : 'Ctrl';

    // Build recent projects submenu
    const recentProjectsItems: MenuItemOrSeparator[] = recentProjects.length > 0
        ? recentProjects.map((project) => ({
            id: `recent-${project.handleKey}`,
            label: project.name,
            onClick: () => handleOpenRecentProject(project),
        }))
        : [{ id: 'no-recent', label: '(No recent projects)', disabled: true, onClick: () => {} }];

    // Menu definitions
    const fileMenuItems: MenuItemOrSeparator[] = [
        // Project section (Chrome/Edge only)
        ...(projectIsSupported ? [
            {
                id: 'new-project',
                label: 'New Project...',
                shortcut: `${cmdKey}+Shift+N`,
                onClick: handleNewProject,
            },
            {
                id: 'open-project',
                label: 'Open Project Folder...',
                shortcut: `${cmdKey}+Shift+O`,
                onClick: handleOpenProject,
            },
        ] as MenuItemOrSeparator[] : []),
        /*
         * Save is ALWAYS here. It used to render only once a project folder was
         * already open, so the first-run File menu had no Save in it at all and
         * a stranger concluded — correctly, from what they could see — that the
         * app had no save (FH-1 F12). Without a project it opens the dialog that
         * makes one and writes this song into it; the affordance is discoverable
         * before it is usable, which is the point.
         */
        {
            id: 'save-project',
            label: isSaving ? 'Saving...' : 'Save Project',
            shortcut: `${cmdKey}+S`,
            disabled: isSaving,
            onClick: handleSaveProject,
        },
        ...(projectName ? [
            {
                id: 'close-project',
                label: 'Close Project',
                onClick: handleCloseProject,
            },
        ] as MenuItemOrSeparator[] : []),
        ...(projectIsSupported ? [
            { type: 'separator' as const },
            {
                id: 'recent-projects',
                label: 'Recent Projects',
                submenu: recentProjectsItems,
            },
        ] as MenuItemOrSeparator[] : []),
        { type: 'separator' as const },
        // File-based workflow (project-less): new canvas, import/export workflow JSON
        {
            id: 'new',
            label: 'New Canvas',
            onClick: handleNew,
        },
        {
            id: 'import',
            label: 'Import Workflow...',
            onClick: handleImport,
        },
        {
            // NOT Ctrl+S. It used to claim the shortcut in a non-Chromium
            // browser, which was already false — `file.save` never reached the
            // exporter — and is now doubly so: Ctrl+S has its own honest answer.
            id: 'export',
            label: 'Export Workflow...',
            onClick: handleExport,
        },
    ];

    const editMenuItems: MenuItemOrSeparator[] = [
        {
            id: 'undo',
            label: 'Undo',
            shortcut: shortcutFor('edit.undo'),
            onClick: () => useGraphStore.getState().undo(),
        },
        {
            id: 'redo',
            label: 'Redo',
            shortcut: shortcutFor('edit.redo'),
            onClick: () => useGraphStore.getState().redo(),
        },
        { type: 'separator' },
        {
            id: 'delete',
            label: 'Delete Selected',
            shortcut: shortcutFor('edit.delete') ?? 'Del',
            onClick: deleteSelected,
        },
    ];

    // Help panel toggle
    const handleToggleHelp = useCallback(() => {
        window.dispatchEvent(new CustomEvent('openjammer:toggle-help'));
    }, []);

    const viewMenuItems: MenuItemOrSeparator[] = [
        {
            id: 'zoom-in',
            label: 'Zoom In',
            shortcut: shortcutFor('view.zoomIn'),
            onClick: handleZoomIn,
        },
        {
            id: 'zoom-out',
            label: 'Zoom Out',
            shortcut: shortcutFor('view.zoomOut'),
            onClick: handleZoomOut,
        },
        {
            id: 'reset-view',
            label: 'Reset View',
            shortcut: shortcutFor('view.resetView'),
            onClick: handleResetView,
        },
        { type: 'separator' },
        {
            id: 'ghost-mode',
            label: ghostMode ? '✓ Ghost Mode' : 'Ghost Mode',
            shortcut: shortcutFor('view.ghostMode') ?? 'W',
            onClick: toggleGhostMode,
        },
        {
            id: 'pause-continuous',
            // Space plays the SONG when one exists, so the looper hold needs its
            // own door. Named for what it does, not for what it used to be bound to.
            label: isGloballyPaused ? 'Resume loopers' : 'Pause loopers',
            onClick: () => {
                const transport = useTransportStore.getState();
                if (transport.isGloballyPaused) transport.resume();
                else transport.pause();
            },
        },
        { type: 'separator' },
        {
            id: 'help',
            label: 'Help',
            shortcut: '?',
            onClick: handleToggleHelp,
        },
    ];

    return (
        <div className="oj-topbar__menus" ref={menusRef}>
            <DropdownMenu label="File" items={fileMenuItems} />
            <DropdownMenu label="Edit" items={editMenuItems} />
            <DropdownMenu label="View" items={viewMenuItems} />

            {newProjectIntent && (
                <NewProjectDialog
                    intent={newProjectIntent}
                    supported={projectIsSupported}
                    // Back to whatever asked — the File trigger, the pill, a
                    // palette row — and only to the File trigger when that
                    // control is gone. Focus never falls to `<body>`.
                    restoreTo={() => newProjectInvoker() ?? menusRef.current?.querySelector<HTMLElement>('.dropdown-trigger') ?? null}
                    onCancel={closeNewProject}
                    onCreate={(name) => {
                        closeNewProject();
                        void runNewProject(newProjectIntent, name);
                    }}
                />
            )}

            {confirming && (
                <Callout
                    key={confirming.id}
                    variant={confirming.tone}
                    title={confirming.title}
                    className="oj-menu-confirm"
                    role="alertdialog"
                    aria-label={confirming.title}
                    onKeyDown={(event) => {
                        if (event.key !== 'Escape') return;
                        event.stopPropagation();
                        confirming.onCancel?.();
                        setConfirming(null);
                    }}
                >
                    <p className="oj-menu-confirm__body">{confirming.body}</p>
                    <div className="oj-menu-confirm__actions">
                        <Button
                            ref={confirmCancelRef}
                            variant="secondary"
                            data-autofocus="true"
                            onClick={() => { confirming.onCancel?.(); setConfirming(null); }}
                        >
                            Cancel
                        </Button>
                        <Button
                            variant={confirming.confirmVariant}
                            onClick={() => {
                                const pending = confirming;
                                setConfirming(null);
                                pending.onConfirm();
                            }}
                        >
                            {confirming.confirmLabel}
                        </Button>
                    </div>
                </Callout>
            )}

            {/* Hidden File Input */}
            <input
                ref={fileInputRef}
                type="file"
                accept=".json"
                onChange={handleFileChange}
                className="file-input-hidden"
            />
        </div>
    );
}
