/**
 * Toolbar - Photoshop-style menu bar with dropdown menus
 */

import { useCallback, useRef } from 'react';
import { toast } from 'sonner';
import { useGraphStore } from '../../store/graphStore';
import { useCanvasStore } from '../../store/canvasStore';
import { useAudioStore } from '../../store/audioStore';
import { useProjectStore } from '../../store/projectStore';
import { useTransportStore } from '../../store/transportStore';
import { exportWorkflow, downloadWorkflow, loadWorkflowFromFile, importWorkflow } from '../../engine/serialization';
import { DropdownMenu, type MenuItemOrSeparator } from './DropdownMenu';
import { useOnlineStatus } from '../../hooks/usePWA';
import './Toolbar.css';

export function Toolbar() {
    const fileInputRef = useRef<HTMLInputElement>(null);

    const nodes = useGraphStore((s) => s.nodes);
    const connections = useGraphStore((s) => s.connections);
    const clearGraph = useGraphStore((s) => s.clearGraph);
    const loadGraph = useGraphStore((s) => s.loadGraph);
    const deleteSelected = useGraphStore((s) => s.deleteSelected);
    const undo = useGraphStore((s) => s.undo);
    const redo = useGraphStore((s) => s.redo);

    const zoom = useCanvasStore((s) => s.zoom);
    const resetView = useCanvasStore((s) => s.resetView);
    const zoomTo = useCanvasStore((s) => s.zoomTo);
    const ghostMode = useCanvasStore((s) => s.ghostMode);
    const toggleGhostMode = useCanvasStore((s) => s.toggleGhostMode);

    const isAudioContextReady = useAudioStore((s) => s.isAudioContextReady);
    const currentMode = useAudioStore((s) => s.currentMode);
    const isToolbarFocused = currentMode === 1;

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

    // Online status
    const isOnline = useOnlineStatus();

    // Global transport state for play/pause (continuous sources like loopers)
    const isGloballyPaused = useTransportStore((s) => s.isGloballyPaused);
    const toggleGlobalPause = useTransportStore((s) => s.toggleGlobalPause);

    // Transport controls
    const handlePlayStop = useCallback(() => {
        toggleGlobalPause();
    }, [toggleGlobalPause]);

    // Export workflow
    const handleExport = useCallback(() => {
        try {
            const workflow = exportWorkflow(nodes, connections, 'OpenJammer Workflow');
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
            const { nodes: importedNodes, connections: importedConnections } = importWorkflow(workflow);
            loadGraph(importedNodes, importedConnections);
        } catch (err) {
            console.error('Failed to import workflow:', err);
            toast.error('Failed to import workflow. Please check the file format.');
        }

        e.target.value = '';
    }, [loadGraph]);

    // New workflow (legacy - just clears canvas)
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
            const graphData = {
                nodes: Array.from(nodes.values()),
                edges: Array.from(connections.values()),
                viewport: { x: 0, y: 0, zoom },
            };
            await saveProject(graphData);
            toast.success('Project saved');
        } catch (err) {
            console.error('Failed to save project:', err);
            toast.error(`Failed to save project: ${(err as Error).message}`);
        }
    }, [projectName, nodes, connections, zoom, saveProject, handleNewProject]);

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
            resetView();
        } catch (err) {
            console.error('Failed to open recent project:', err);
            toast.error(`Failed to open project: ${(err as Error).message}`);
        }
    }, [openRecentProject, loadGraph, clearGraph, resetView]);

    // Zoom controls
    const handleZoomIn = useCallback(() => {
        zoomTo(zoom * 1.2);
    }, [zoom, zoomTo]);

    const handleZoomOut = useCallback(() => {
        zoomTo(zoom / 1.2);
    }, [zoom, zoomTo]);

    const handleResetView = useCallback(() => {
        resetView();
    }, [resetView]);

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
        // Legacy workflow operations
        {
            id: 'new',
            label: 'New Canvas',
            shortcut: projectIsSupported ? undefined : `${cmdKey}+N`,
            onClick: handleNew,
        },
        {
            id: 'import',
            label: 'Import Workflow...',
            shortcut: projectIsSupported ? undefined : `${cmdKey}+O`,
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
            id: 'delete',
            label: 'Delete Selected',
            shortcut: 'Del',
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
            shortcut: `${cmdKey}+=`,
            onClick: handleZoomIn,
        },
        {
            id: 'zoom-out',
            label: 'Zoom Out',
            shortcut: `${cmdKey}+-`,
            onClick: handleZoomOut,
        },
        {
            id: 'reset-view',
            label: 'Reset View',
            shortcut: `${cmdKey}+0`,
            onClick: handleResetView,
        },
        { type: 'separator' },
        {
            id: 'ghost-mode',
            label: ghostMode ? '✓ Ghost Mode' : 'Ghost Mode',
            shortcut: 'W',
            onClick: toggleGhostMode,
        },
        {
            id: 'help',
            label: 'Help',
            shortcut: '?',
            onClick: handleToggleHelp,
        },
    ];

    return (
        <div className={`toolbar ${isToolbarFocused ? 'toolbar-focused' : ''}`}>
            {/* Menu Bar */}
            <div className="toolbar-menus">
                <DropdownMenu label="File" items={fileMenuItems} />
                <DropdownMenu label="Edit" items={editMenuItems} />
                <DropdownMenu label="View" items={viewMenuItems} />
            </div>

            <div className="toolbar-separator" />

            {/* Undo/Redo Buttons */}
            <button
                className="toolbar-btn toolbar-btn-icon"
                onClick={undo}
                title="Undo (Ctrl+Z)"
            >
                ↶
            </button>
            <button
                className="toolbar-btn toolbar-btn-icon"
                onClick={redo}
                title="Redo (Ctrl+Shift+Z)"
            >
                ↷
            </button>

            <div className="toolbar-separator" />

            {/* Global Play/Pause */}
            <button
                className="toolbar-btn toolbar-btn-icon"
                onClick={handlePlayStop}
                disabled={!isAudioContextReady}
                title={isGloballyPaused ? 'Resume All (Space)' : 'Pause All (Space)'}
            >
                {isGloballyPaused ? '▶' : '⏸'}
            </button>

            <div className="toolbar-separator" />

            {/* Settings */}
            <button
                className="toolbar-btn toolbar-btn-icon"
                onClick={() => window.dispatchEvent(new CustomEvent('openjammer:toggle-settings'))}
                title="Settings"
            >
                ⚙️
            </button>

            {/* Spacer to push status to right */}
            <div style={{ flex: 1 }} />

            {/* Project Status */}
            {projectName && (
                <div className="toolbar-status" title={`Project: ${projectName}`}>
                    <span className="toolbar-status-icon">📁</span>
                    <span className="toolbar-status-text">
                        {projectName}
                    </span>
                </div>
            )}

            {/* Online Status */}
            {!isOnline && (
                <div className="toolbar-status toolbar-status-offline" title="You are offline">
                    <span className="toolbar-status-icon">📴</span>
                    <span className="toolbar-status-text">Offline</span>
                </div>
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
