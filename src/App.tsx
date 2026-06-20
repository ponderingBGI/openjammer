/**
 * OpenJammer - Node-based music generation tool
 */

import { useState, useCallback, useEffect, useRef, lazy, Suspense } from 'react';
import { Toaster, toast } from 'sonner';
import { NodeCanvas } from './components/Canvas/NodeCanvas';
import { Toolbar } from './components/Toolbar/Toolbar';
import { Breadcrumbs } from './components/Toolbar/Breadcrumbs';
import { HelpPanel } from './components/Toolbar/HelpPanel';
// The full settings surface (panels, guides, the low-latency walkthrough) is a
// modal opened on demand — never part of first paint. Code-split it behind a
// real dynamic import so its weight stays out of the entry chunk; it is already
// rendered only when `showSettings` is true, so the Suspense fallback is never
// seen on the hot path (it loads the first time the gear is opened).
const SettingsPanel = lazy(() =>
    import('./components/Settings/SettingsPanel').then((m) => ({
        default: m.SettingsPanel,
    })),
);
import { CommandBar } from './components/CommandBar/CommandBar';
import { DevLogPanel } from './components/DevLog/DevLogPanel';
import { IssueReporter } from './components/IssueReporter/IssueReporter';
import { AudioHealthPanel } from './components/AudioHealth/AudioHealthPanel';
import { useEngineHealthToast } from './components/EngineHealthDot/useEngineHealthToast';
import { PwaUpdatePrompt } from './components/PwaUpdatePrompt';
import { NativeUpdaterRunner } from './components/NativeUpdaterRunner';
import { PluginsPanel } from './components/Plugins/PluginsPanel';
import { CollabControl } from './components/Collab/CollabControl';
import { MIDIIntegration } from './components/MIDI';
import { LatencyWarningBanner } from './components/LatencyWarningBanner';
import { initAudioContext, isAudioReady, getLatencyMetrics } from './audio/audioContext';
import { getExecutor, isTauri } from './audio/executor';
import type { GraphNode, Connection } from './engine/types';
import { initMidiVoiceRouting, disposeMidiVoiceRouting } from './midi';
import { useAudioStore } from './store/audioStore';
import { useGraphStore } from './store/graphStore';
import { useProjectStore } from './store/projectStore';
import { useCanvasStore } from './store/canvasStore';
import { useKeybindingsStore } from './store/keybindingsStore';
import { applyTheme, getSavedThemeId, getThemeById } from '@openjammer/oj-tokens';
import { isEditableTarget } from './utils/editableTarget';
import './styles/global.css';

function App() {
  // Native (Tauri) boots straight into a live canvas — no autoplay gate exists
  // there because sound comes from the Rust/cpal engine over IPC, not Web Audio.
  // The browser tier still shows the welcome screen (its gesture resumes Web Audio).
  const [showActivation, setShowActivation] = useState(() => !isTauri());
  const [showSettings, setShowSettings] = useState(false);
  const setAudioContextReady = useAudioStore((s) => s.setAudioContextReady);
  const audioConfig = useAudioStore((s) => s.audioConfig);
  const updateAudioMetrics = useAudioStore((s) => s.updateAudioMetrics);

  // Calm, deduped engine-dead toast (Phase 2). The ONLY toast the health store
  // raises — DEGRADED stays ambient; a fault storm yields one signal, not many.
  useEngineHealthToast();

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
          console.error('[Autosave] Failed:', err);
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
        console.error('[Autosave] Periodic backup failed:', err);
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
          console.error('[Autosave] Failed on tab switch:', err);
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
      // Skip if typing in an editable control.
      if (isEditableTarget(e.target)) return;

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
          console.error('[Save] Failed:', err);
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

      // One-time first-run hint: the fastest path to a first sound. Shown once
      // (localStorage-gated), dismissible, never blocking.
      try {
        if (!localStorage.getItem('oj-first-run-done')) {
          localStorage.setItem('oj-first-run-done', '1');
          toast('🎹 Make your first sound', {
            description:
              'Right-click the canvas → add a Keyboard and an Instrument, connect them to a Speaker, then press the Q–P keys. Press ? for help, or Ctrl/Cmd+K to ask the AI to build it for you.',
            duration: 12000,
          });
        }
      } catch {
        // localStorage may be unavailable (private mode) — the hint is optional.
      }

      // Web-Audio latency metrics are only meaningful in the browser tier; on
      // native, latency comes from the Rust/cpal engine, not this AudioContext.
      if (!isTauri()) {
        const metrics = getLatencyMetrics();
        if (metrics) {
          updateAudioMetrics({
            ...metrics,
            lastUpdated: Date.now()
          });
        }
      }
    } catch (err) {
      console.error('Failed to initialize audio:', err);
      // On native, sound is the Rust/cpal engine over IPC — it does NOT need the
      // Web AudioContext. If construction failed here, still boot the engine and
      // unlock the tools; never let a Web-Audio failure block the native canvas.
      if (isTauri()) {
        setAudioContextReady(true);
        setShowActivation(false);
        return;
      }
      toast.error('Could not start audio', {
        description:
          'Check your browser/OS audio permissions and device, then try again. Open “Audio health” (Ctrl/Cmd+Shift+H) or ask the AI for help.',
      });
    }
  }, [setAudioContextReady, audioConfig, updateAudioMetrics]);

  // Native (Tauri) auto-start: no autoplay gate. Run the same activation sequence
  // on mount so the Rust engine wires up (the App-init effect keyed on
  // isAudioContextReady fires) and getAudioContext() is non-null for the UI's
  // decode / waveform / WAV-export paths. The AudioContext is created best-effort;
  // on native a suspended context is fine and a throw can never block the canvas.
  useEffect(() => {
    if (isTauri()) {
      void handleActivate();
    }
  }, [handleActivate]);

  return (
    <>
      {/* Welcome screen (browser tier only — native auto-starts, see useState above) */}
      {showActivation && (
        <div
          className="oj-welcome"
          role="dialog"
          aria-modal="true"
          aria-labelledby="oj-welcome-title"
          onKeyDown={(e) => {
            // 2-element focus loop — aria-modal is asserted, so keep Tab inside.
            if (e.key !== 'Tab') return;
            const focusables = e.currentTarget.querySelectorAll<HTMLElement>(
              '.oj-welcome-option'
            );
            if (focusables.length === 0) return;
            const first = focusables[0];
            const last = focusables[focusables.length - 1];
            if (e.shiftKey && document.activeElement === first) {
              e.preventDefault();
              last.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
              e.preventDefault();
              first.focus();
            }
          }}
        >
          <div className="oj-welcome-card">
            <h1 id="oj-welcome-title" className="oj-welcome-title">
              OpenJammer
            </h1>
            <p className="oj-welcome-intro">
              A sketchbook you can play. Pick how you want to start.
            </p>

            <button
              type="button"
              className="oj-welcome-option oj-welcome-option--primary"
              onClick={handleActivate}
              autoFocus
            >
              <span className="oj-welcome-option-main">
                <span className="oj-welcome-option-label">
                  Play here in your browser
                </span>
                <span className="oj-welcome-option-sub">
                  Start instantly — honest ~15–25&nbsp;ms latency in the browser.
                </span>
              </span>
              <span className="oj-welcome-option-glyph" aria-hidden="true">
                &rarr;
              </span>
            </button>

            <a
              className="oj-welcome-option oj-welcome-option--secondary"
              href="/download"
            >
              <span className="oj-welcome-option-main">
                <span className="oj-welcome-option-label">
                  Download the desktop app
                </span>
                <span className="oj-welcome-option-sub">
                  Under-5&nbsp;ms MIDI→audio, plus hosted VST3 / AU / CLAP.
                </span>
              </span>
              <span className="oj-welcome-option-glyph" aria-hidden="true">
                &darr;
              </span>
            </a>
          </div>
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
      {showSettings && (
        <Suspense fallback={null}>
          <SettingsPanel onClose={() => setShowSettings(false)} />
        </Suspense>
      )}

      {/* Command Bar (Ctrl/Cmd+K) - owns its own toggle + open state (U19) */}
      <CommandBar />

      {/* DevLog panel (L4) — the on-device structured-log surface; the AI agent
          reads the same store. Toggled via the command palette / openjammer:toggle-devlog. */}
      <DevLogPanel />

      {/* L5 one-click "report a problem" reporter — captures a redacted log bundle. */}
      <IssueReporter />

      {/* Audio-health readout (§4) — the live diagnostics the AI reads, with fix-it. */}
      <AudioHealthPanel />

      {/* Channel-aware PWA update — applies on idle, never yanks the AudioContext. */}
      <PwaUpdatePrompt />

      {/* Native auto-update lifecycle (desktop): silent background download +
          install-after-close, with no self-reopen. Renders nothing; steals no focus. */}
      <NativeUpdaterRunner />

      {/* Plugins (§3) — discover your installed CLAP/VST3 plugins (desktop host). */}
      <PluginsPanel />

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
