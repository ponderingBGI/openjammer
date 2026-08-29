/**
 * AppMenuBar — File / Edit / View, the three ghost triggers at the head of the
 * topbar.
 *
 * This is what remains of the old floating toolbar pill once the transport moved
 * into the {@link TransportPill} and the status cluster moved to the topbar's
 * right: the document verbs, and nothing else. Every shortcut keycap is read
 * from the LIVE keymap, so a rebound key is never advertised wrong.
 */

import { useCallback, useRef } from 'react';
import { toast } from 'sonner';
import { useGraphStore } from '../../store/graphStore';
import { useCanvasStore } from '../../store/canvasStore';
import { useProjectStore } from '../../store/projectStore';
import { useTransportStore } from '../../store/transportStore';
import { useArrangementStore } from '../../store/arrangementStore';
import { arrangementForExport, readArrangement } from '../../song/project';
import { collectSaveData } from '../../persistence/collectSaveData';
import { exportWorkflow, downloadWorkflow, loadWorkflowFromFile, importWorkflow } from '../../engine/serialization';
import { getExecutor } from '../../audio/executor';
import { DropdownMenu, type MenuItemOrSeparator } from '../Toolbar/DropdownMenu';
import { keyComboToString, useKeybindingsStore } from '../../store/keybindingsStore';

export function AppMenuBar() {
    const fileInputRef = useRef<HTMLInputElement>(null);

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
        if (nodes.size > 0) {
            if (!confirm('Clear current workflow? This cannot be undone.')) {
                return;
            }
        }
        clearGraph();
        resetView();
    }, [nodes.size, clearGraph, resetView]);

    // Project handlers
    const handleNewProject = useCallback(async () => {
        if (!projectIsSupported) {
            toast.error('File System Access API is not supported in this browser. Use Chrome or Edge for local project folders.');
            return;
        }

        try {
            // Pick folder FIRST (must be in direct response to user gesture)
            // The name will be prompted inside createProject after folder selection
            await createProject();
            clearGraph();
            resetView();
        } catch (err) {
            if ((err as Error).message !== 'Cancelled' &&
                (err as Error).message !== 'Cancelled - folder already contains a project' &&
                (err as DOMException).name !== 'AbortError') {
                console.error('Failed to create project:', err);
                toast.error(`Failed to create project: ${(err as Error).message}`);
            }
        }
    }, [projectIsSupported, createProject, clearGraph, resetView]);

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
                    const create = confirm(
                        'This folder doesn\'t contain an OpenJammer project.\n\n' +
                        'Would you like to create a new project here instead?'
                    );
                    if (create) {
                        handleNewProject();
                        return;
                    }
                } else {
                    console.error('Failed to open project:', err);
                    toast.error(`Failed to open project: ${message}`);
                }
            }
        }
    }, [projectIsSupported, openProject, loadGraph, clearGraph, resetView, handleNewProject]);

    const handleSaveProject = useCallback(async () => {
        if (!projectName) {
            // No project open - offer to create one
            handleNewProject();
            return;
        }

        try {
            await saveProject(collectSaveData());
            toast.success('Project saved');
        } catch (err) {
            console.error('Failed to save project:', err);
            toast.error(`Failed to save project: ${(err as Error).message}`);
        }
    }, [projectName, saveProject, handleNewProject]);

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
            ...(projectName ? [
                {
                    id: 'save-project',
                    label: isSaving ? 'Saving...' : 'Save Project',
                    shortcut: `${cmdKey}+S`,
                    disabled: isSaving,
                    onClick: handleSaveProject,
                },
                {
                    id: 'close-project',
                    label: 'Close Project',
                    onClick: handleCloseProject,
                },
            ] as MenuItemOrSeparator[] : []),
            { type: 'separator' as const },
            {
                id: 'recent-projects',
                label: 'Recent Projects',
                submenu: recentProjectsItems,
            },
            { type: 'separator' as const },
        ] as MenuItemOrSeparator[] : []),
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
            id: 'export',
            label: 'Export Workflow...',
            shortcut: projectIsSupported ? undefined : `${cmdKey}+S`,
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
        <div className="oj-topbar__menus">
            <DropdownMenu label="File" items={fileMenuItems} />
            <DropdownMenu label="Edit" items={editMenuItems} />
            <DropdownMenu label="View" items={viewMenuItems} />

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
