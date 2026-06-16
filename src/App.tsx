/**
 * OpenJammer - Node-based music generation tool
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { Toaster, toast } from 'sonner';
import { NodeCanvas } from './components/Canvas/NodeCanvas';
import { Toolbar } from './components/Toolbar/Toolbar';
import { Breadcrumbs } from './components/Toolbar/Breadcrumbs';
import { HelpPanel } from './components/Toolbar/HelpPanel';
import { SettingsPanel } from './components/Settings/SettingsPanel';
import { CommandBar } from './components/CommandBar/CommandBar';
import { DevLogPanel } from './components/DevLog/DevLogPanel';
import { IssueReporter } from './components/IssueReporter/IssueReporter';
import { CollabControl } from './components/Collab/CollabControl';
import { MIDIIntegration } from './components/MIDI';
import { LatencyWarningBanner } from './components/LatencyWarningBanner';
import { initAudioContext, isAudioReady, getLatencyMetrics } from './audio/audioContext';
import { getExecutor } from './audio/executor';
import type { GraphNode, Connection } from './engine/types';
import { initMidiVoiceRouting, disposeMidiVoiceRouting } from './midi';
import { useAudioStore } from './store/audioStore';
import { useGraphStore } from './store/graphStore';
import { useProjectStore } from './store/projectStore';
import { useCanvasStore } from './store/canvasStore';
import { useKeybindingsStore } from './store/keybindingsStore';
import { applyTheme, getSavedThemeId, getThemeById } from './styles/themes';
import { logError } from './utils/log';
import './styles/global.css';

function App() {
  const [showActivation, setShowActivation] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const setAudioContextReady = useAudioStore((s) => s.setAudioContextReady);
  const audioConfig = useAudioStore((s) => s.audioConfig);
  const updateAudioMetrics = useAudioStore((s) => s.updateAudioMetrics);

  // Initialize theme
  useEffect(() => {
    const savedId = getSavedThemeId();
    const theme = getThemeById(savedId);
    if (theme) applyTheme(theme);
  }, []);

  // Check if audio is already ready
  useEffect(() => {
    if (isAudioReady()) {
      setShowActivation(false);
      setAudioContextReady(true);
    }
  }, [setAudioContextReady]);

  // Listen for settings toggle event (custom event)
  useEffect(() => {
    const handleToggleSettings = () => setShowSettings(prev => !prev);
    window.addEventListener('openjammer:toggle-settings', handleToggleSettings);
    return () => window.removeEventListener('openjammer:toggle-settings', handleToggleSettings);
  }, []);

  // Initialize AudioGraphManager when audio context is ready
  const isAudioContextReady = useAudioStore((s) => s.isAudioContextReady);
  useEffect(() => {
    if (!isAudioContextReady) return;

    // Create subscription wrappers for graph store
    // Zustand's subscribe returns an unsubscribe function
    const subscribeToNodes = (callback: (nodes: Map<string, GraphNode>) => void) => {
      let prevNodes = useGraphStore.getState().nodes;
      return useGraphStore.subscribe((state) => {
        if (state.nodes !== prevNodes) {
          prevNodes = state.nodes;
          callback(state.nodes);
        }
      });
    };

    const subscribeToConnections = (callback: (connections: Map<string, Connection>) => void) => {
      let prevConnections = useGraphStore.getState().connections;
      return useGraphStore.subscribe((state) => {
        if (state.connections !== prevConnections) {
          prevConnections = state.connections;
          callback(state.connections);
        }
      });
    };

    const getNodes = useGraphStore.getState().getNodes;
    const getConnections = useGraphStore.getState().getConnections;

    const executor = getExecutor();
    executor.initialize(
      subscribeToConnections,
      subscribeToNodes,
      getNodes,
      getConnections
    );

    // Wire control-side MIDI -> voice routing (U13). Resolves incoming MIDI
    // events against the live graph and drives the Executor note seam. Uses the
    // default routing context (graph store + executor + MIDIManager).
    initMidiVoiceRouting();

    return () => {
      disposeMidiVoiceRouting();
      executor.dispose();
    };
  }, [isAudioContextReady]);

  // ========================================
  // Autosave - watches graph changes and saves to project folder
  // ========================================
  const projectName = useProjectStore((s) => s.name);
  const projectHandleKey = useProjectStore((s) => s.handleKey);
  const saveProject = useProjectStore((s) => s.saveProject);

  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Initialize to null to defer initialization until after hydration (inside useEffect)
  const lastVersionRef = useRef<number | null>(null);
  const isSavingRef = useRef(false);

  // Autosave when graph changes (debounced) - using version counter for efficient change detection
  useEffect(() => {
    // Only autosave if a project is open
    if (!projectName || !projectHandleKey) return;

    // Initialize version ref with current state (after hydration is complete)
    if (lastVersionRef.current === null) {
      lastVersionRef.current = useGraphStore.getState().version;
    }

    // Subscribe to graph changes
    const unsubscribe = useGraphStore.subscribe((state) => {
      // Skip if version hasn't changed (efficient O(1) check vs O(n) JSON.stringify)
      if (state.version === lastVersionRef.current) return;

      // Clear existing timeout
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }

      // Debounced save (3 seconds after last change)
      saveTimeoutRef.current = setTimeout(async () => {
        if (isSavingRef.current) return;

        const currentVersion = useGraphStore.getState().version;
        if (currentVersion === lastVersionRef.current) return;

        isSavingRef.current = true;
        try {
          const graphData = {
            nodes: Array.from(useGraphStore.getState().nodes.values()),
            edges: Array.from(useGraphStore.getState().connections.values()),
            viewport: {
              x: useCanvasStore.getState().pan.x,
              y: useCanvasStore.getState().pan.y,
              zoom: useCanvasStore.getState().zoom,
            },
          };
          await saveProject(graphData);
          lastVersionRef.current = currentVersion;
        } catch (err) {
          logError('app', 'autosave failed', { error: String(err) });
        } finally {
          isSavingRef.current = false;
        }
      }, 3000);
    });

    return () => {
      unsubscribe();
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [projectName, projectHandleKey, saveProject]);

  // Periodic backup save every 30 seconds (checks if version changed)
  useEffect(() => {
    if (!projectName || !projectHandleKey) return;

    const interval = setInterval(async () => {
      if (isSavingRef.current) return;

      const currentVersion = useGraphStore.getState().version;

      // Skip if nothing changed since last save
      if (currentVersion === lastVersionRef.current) return;

      isSavingRef.current = true;
      try {
        const graphData = {
          nodes: Array.from(useGraphStore.getState().nodes.values()),
          edges: Array.from(useGraphStore.getState().connections.values()),
          viewport: {
            x: useCanvasStore.getState().pan.x,
            y: useCanvasStore.getState().pan.y,
            zoom: useCanvasStore.getState().zoom,
          },
        };
        await saveProject(graphData);
        lastVersionRef.current = currentVersion;
      } catch (err) {
        logError('app', 'Periodic backup failed:', { error: String(err) });
      } finally {
        isSavingRef.current = false;
      }
    }, 30000);

    return () => clearInterval(interval);
  }, [projectName, projectHandleKey, saveProject]);

  // Save on tab close/switch
  useEffect(() => {
    if (!projectName || !projectHandleKey) return;

    const handleVisibilityChange = async () => {
      if (document.hidden && !isSavingRef.current) {
        // Set flag immediately to prevent race conditions
        isSavingRef.current = true;

        const currentVersion = useGraphStore.getState().version;

        // Skip if nothing changed since last save
        if (currentVersion === lastVersionRef.current) {
          isSavingRef.current = false;
          return;
        }

        // Save immediately when tab is hidden
        try {
          const graphData = {
            nodes: Array.from(useGraphStore.getState().nodes.values()),
            edges: Array.from(useGraphStore.getState().connections.values()),
            viewport: {
              x: useCanvasStore.getState().pan.x,
              y: useCanvasStore.getState().pan.y,
              zoom: useCanvasStore.getState().zoom,
            },
          };
          await saveProject(graphData);
          lastVersionRef.current = currentVersion;
        } catch (err) {
          logError('app', 'Failed on tab switch:', { error: String(err) });
        } finally {
          isSavingRef.current = false;
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [projectName, projectHandleKey, saveProject]);

  // Emergency backup on beforeunload (tab close/refresh)
  useEffect(() => {
    if (!projectName || !projectHandleKey) return;

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      const currentVersion = useGraphStore.getState().version;
      if (currentVersion !== lastVersionRef.current) {
        // Emergency backup to localStorage
        try {
          localStorage.setItem('openjammer-emergency-backup', JSON.stringify({
            timestamp: Date.now(),
            projectName,
            nodes: Array.from(useGraphStore.getState().nodes.values()),
            edges: Array.from(useGraphStore.getState().connections.values()),
          }));
        } catch {
          // Ignore storage errors
        }
        e.preventDefault();
        e.returnValue = '';
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [projectName, projectHandleKey]);

  // Global keyboard shortcut for save (Ctrl+S / Cmd+S)
  useEffect(() => {
    const { matchesAction } = useKeybindingsStore.getState();

    const handleKeyDown = async (e: KeyboardEvent) => {
      // Skip if typing in input
      if ((e.target as HTMLElement).tagName === 'INPUT') return;

      // Handle Ctrl+S / Cmd+S - Save project
      if (matchesAction(e, 'file.save')) {
        e.preventDefault();

        // Only save if a project is open
        if (!projectName || !projectHandleKey) {
          // Dispatch event to trigger new project creation in Toolbar
          window.dispatchEvent(new CustomEvent('openjammer:new-project'));
          return;
        }

        // Check if already saving
        if (useProjectStore.getState().isSaving) return;

        try {
          const graphData = {
            nodes: Array.from(useGraphStore.getState().nodes.values()),
            edges: Array.from(useGraphStore.getState().connections.values()),
            viewport: {
              x: useCanvasStore.getState().pan.x,
              y: useCanvasStore.getState().pan.y,
              zoom: useCanvasStore.getState().zoom,
            },
          };
          await saveProject(graphData);
          toast.success('Project saved');
        } catch (err) {
          logError('app', 'manual save failed', { error: String(err) });
          toast.error(`Failed to save project: ${(err as Error).message}`);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [projectName, projectHandleKey, saveProject]);

  // Initialize audio context on user gesture
  const handleActivate = useCallback(async () => {
    try {
      await initAudioContext({
        sampleRate: audioConfig.sampleRate,
        latencyHint: audioConfig.latencyHint,
        lowLatencyMode: audioConfig.lowLatencyMode
      });
      setAudioContextReady(true);
      setShowActivation(false);

      // Get initial latency metrics
      const metrics = getLatencyMetrics();
      if (metrics) {
        updateAudioMetrics({
          ...metrics,
          lastUpdated: Date.now()
        });
      }
    } catch (err) {
      logError('app', 'Failed to initialize audio:', { error: String(err) });
      // alert('Failed to initialize audio. Please check your browser settings.');
    }
  }, [setAudioContextReady, audioConfig, updateAudioMetrics]);

  return (
    <>
      {/* Audio Activation Overlay */}
      {showActivation && (
        <div className="audio-activate-overlay">
          <button className="audio-activate-btn" onClick={handleActivate}>
            🎵 Start OpenJammer
          </button>
          <p>Click to enable audio (required by browsers)</p>
        </div>
      )}

      {/* Main Canvas */}
      <NodeCanvas />

      {/* Toolbar + Breadcrumbs */}
      <div className="toolbar-wrapper">
        <Toolbar />
        <Breadcrumbs />
      </div>

      {/* Settings Panel */}
      {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}

      {/* Command Bar (Ctrl/Cmd+K) - owns its own toggle + open state (U19) */}
      <CommandBar />

      {/* DevLog panel (Ctrl/Cmd+Shift+L) - owns its own toggle + open state (L4).
          Mounted always; gated to dev/canary and hidden until toggled. */}
      <DevLogPanel />

      {/* One-click issue reporter (L5) - opened by the `openjammer:report-issue`
          window event; bundles a redacted diagnostic snapshot + DevLog tail into a
          pre-filled GitHub issue. Always available (production users report too). */}
      <IssueReporter />

      {/* Collaboration Share/Join control + peer list (U23 — collab state plane) */}
      <CollabControl />

      {/* Help Panel */}
      <HelpPanel />

      {/* MIDI Integration - device detection, browser, and node creation */}
      <MIDIIntegration />

      {/* Latency Warning Banner - shows when latency is too high */}
      <LatencyWarningBanner onOpenSettings={() => setShowSettings(true)} />

      {/* Toast Notifications */}
      <Toaster
        position="top-left"
        richColors
        expand={true}
        visibleToasts={5}
        gap={12}
        offset="80px"
      />
    </>
  );
}

export default App;
