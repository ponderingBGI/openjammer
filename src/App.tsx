/**
 * OpenJammer - Node-based music generation tool
 */

import { useState, useCallback, useEffect, useLayoutEffect, useRef, useMemo, lazy, Suspense } from 'react';
import { Toaster, toast } from 'sonner';
import { NodeCanvas } from './components/Canvas/NodeCanvas';
import { Topbar } from './components/Shell/Topbar';
import { TransportPillHost } from './components/Shell/TransportPillHost';
import { HintBubble } from './components/Shell/HintBubble';
import { StepGrid } from './components/Shell/StepGrid';
import { OnboardingHost } from './components/Onboarding/OnboardingHost';
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
const SafeModeScreen = lazy(() =>
    import('./components/SafeMode/SafeModeScreen').then((m) => ({
        default: m.SafeModeScreen,
    })),
);
import { CommandBarHost } from './components/CommandBar/CommandBarHost';
import { DevLogPanel } from './components/DevLog/DevLogPanel';
import { IssueReporter } from './components/IssueReporter/IssueReporter';
import { AudioHealthPanel } from './components/AudioHealth/AudioHealthPanel';
import { useEngineHealthToast } from './components/EngineHealthDot/useEngineHealthToast';
import { PwaUpdatePrompt } from './components/PwaUpdatePrompt';
import { NativeUpdaterRunner } from './components/NativeUpdaterRunner';
import { Bench } from './components/Bench/Bench';
const PluginsPanel = lazy(() =>
    import('./components/Plugins/PluginsPanel').then((module) => ({
      default: module.PluginsPanel,
    })),
);
import { MIDIIntegration } from './components/MIDI';
import { initAudioContext, isAudioReady } from './audio/audioContext';
import { getExecutor, isTauri } from './audio/executor';
import type { GraphNode, Connection } from './engine/types';
import { initMidiVoiceRouting, disposeMidiVoiceRouting } from './midi';
import { useAudioStore } from './store/audioStore';
import { useGraphStore } from './store/graphStore';
import { useProjectStore } from './store/projectStore';
import { useEngineHealthStore, setEngineLive } from './store/engineHealthStore';
import { useCrashRecovery } from './persistence/recovery/useCrashRecovery';
import { useUsbLowLatencyDefault } from './hooks/useUsbLowLatencyDefault';
import { useAutoDetectedSampleRate } from './hooks/useAutoDetectedSampleRate';
import { writeEmergencyBackup } from './persistence/recovery';
import { collectSaveData } from './persistence/collectSaveData';
import { useArrangementStore } from './store/arrangementStore';
import { getSavedThemeId } from '@openjammer/oj-tokens';
import { useUiViewStore, type SurfaceId } from './store/uiViewStore';
import { useOnboardingStore } from './store/onboardingStore';
import { useBindingSet, useKeymapArbiter, useModalKeymap } from './keymap/useKeymap';
import { ArrangementSurface } from './components/Arrangement/ArrangementSurface';
import { ExportHost } from './components/Export';
import { PianoRollSurfaceHost } from './components/PianoRoll';
import { logger } from './utils/log';
import { getInvoke } from './ai/tauri';
import './styles/global.css';

function getDocumentVersion(): string {
  return `${useGraphStore.getState().version}:${useArrangementStore.getState().docVersion}`;
}

/**
 * Keep native plugin discovery out of the browser's first-paint bundle. The host
 * catches the first shortcut/command, then hands all later toggles to the mounted
 * panel's existing listeners. Once requested, the panel remains mounted so its
 * scan results and open/closed state survive subsequent toggles.
 */
function PluginsPanelHost() {
  const [requested, setRequested] = useState(false);
  const [context, setContext] = useState<'browse' | 'pick' | 'insert'>('browse');

  useBindingSet(useMemo(() => ({
    id: 'plugins-panel-toggle',
    scope: 'global' as const,
    entries: [{
      actionId: 'panel.plugins',
      run: () => {
        if (requested) window.dispatchEvent(new CustomEvent('openjammer:toggle-plugins'));
        else setRequested(true);
        return true;
      },
    }],
  }), [requested]));

  useEffect(() => {
    if (requested) return;
    const request = (event: Event) => {
      const requestedContext = (event as CustomEvent<{ context?: 'browse' | 'pick' | 'insert' }>).detail?.context;
      if (requestedContext) setContext(requestedContext);
      setRequested(true);
    };
    window.addEventListener('openjammer:toggle-plugins', request);
    window.addEventListener('openjammer:open-browser', request);
    return () => {
      window.removeEventListener('openjammer:toggle-plugins', request);
      window.removeEventListener('openjammer:open-browser', request);
    };
  }, [requested]);

  if (!requested) return null;
  return (
    <Suspense fallback={null}>
      <PluginsPanel initiallyOpen context={context} />
    </Suspense>
  );
}

function App() {
  useKeymapArbiter();
  const [showSettings, setShowSettings] = useState(false);
  // The three-step first run is the ONLY thing that opens over the studio, and
  // only when no answers have ever been stored. On the browser tier its final
  // tap is also the autoplay gesture (see OnboardingHost).
  const onboardingAnswers = useOnboardingStore((s) => s.answers);
  const showOnboarding = onboardingAnswers === null;
  const [toastTheme, setToastTheme] = useState<'light' | 'dark'>(() =>
    getSavedThemeId() === 'dark' ? 'dark' : 'light',
  );
  const setAudioContextReady = useAudioStore((s) => s.setAudioContextReady);
  const audioConfig = useAudioStore((s) => s.audioConfig);
  const updateAudioMetrics = useAudioStore((s) => s.updateAudioMetrics);
  const surface = useUiViewStore((s) => s.surface);
  const songNodeId = useUiViewStore((s) => s.songNodeId);
  const previousSurface = useRef<SurfaceId>(surface);
  const [exitingSurface, setExitingSurface] = useState<SurfaceId | null>(null);

  useLayoutEffect(() => {
    if (previousSurface.current === surface) return;
    const outgoing = previousSurface.current;
    previousSurface.current = surface;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setExitingSurface(null);
      return;
    }
    setExitingSurface(outgoing);
    const timer = window.setTimeout(() => setExitingSurface(null), 120);
    return () => window.clearTimeout(timer);
  }, [surface]);

  // Calm, deduped engine-dead toast (Phase 2). The ONLY toast the health store
  // raises — DEGRADED stays ambient; a fault storm yields one signal, not many.
  useEngineHealthToast();

  // Default Low Latency Mode ON when a USB / pro audio interface is in use — a
  // default, never an override, and never a mid-set restart (see the hook).
  useUsbLowLatencyDefault();

  // Once a backend reports its negotiated device rate, make Settings reflect the
  // truth. This is UI/store sync only — no stream rebuild, no surprise dropout.
  useAutoDetectedSampleRate();

  // Crash recovery (Track B P0): at boot, restore work that survived an unclean
  // shutdown — or, after repeated crashes, drop to Safe Mode rather than reopening
  // into a deadly crash cycle. Runs once, before the autosave effects engage.
  const recovery = useCrashRecovery();
  useModalKeymap('welcome', Boolean(showOnboarding || recovery.safeMode));

  useEffect(() => {
    const syncToastTheme = () => {
      setToastTheme(getSavedThemeId() === 'dark' ? 'dark' : 'light');
    };
    window.addEventListener('openjammer:theme-change', syncToastTheme);
    window.addEventListener('storage', syncToastTheme);
    return () => {
      window.removeEventListener('openjammer:theme-change', syncToastTheme);
      window.removeEventListener('storage', syncToastTheme);
    };
  }, []);

  // Check if audio is already ready (a hot reload, or a second mount).
  useEffect(() => {
    if (isAudioReady()) setAudioContextReady(true);
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

    // Create subscription wrappers for graph store.
    // Zustand's subscribe returns an unsubscribe function. CRITICAL: the executor
    // reconcile (graph → engine lowering) runs INSIDE this Zustand listener, and a
    // throw here would ABORT the store's listener loop — starving every subscriber
    // registered after it (the canvas re-render via `useGraphStore`, and the
    // persist middleware's post-loop `setItem`). That is exactly the "deleting a
    // node wedges the canvas + the delete doesn't persist" bug. So the reconcile is
    // isolated: a lowering error is logged and contained, never propagated, so a
    // graph edit ALWAYS re-renders live and ALWAYS persists.
    const log = logger('graph');
    const subscribeToNodes = (callback: (nodes: Map<string, GraphNode>) => void) => {
      let prevNodes = useGraphStore.getState().nodes;
      return useGraphStore.subscribe((state) => {
        if (state.nodes !== prevNodes) {
          prevNodes = state.nodes;
          try {
            callback(state.nodes);
          } catch (err) {
            log.error('node reconcile failed (contained; UI + persistence preserved)', {
              error: err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err),
            });
          }
        }
      });
    };

    const subscribeToConnections = (callback: (connections: Map<string, Connection>) => void) => {
      let prevConnections = useGraphStore.getState().connections;
      return useGraphStore.subscribe((state) => {
        if (state.connections !== prevConnections) {
          prevConnections = state.connections;
          try {
            callback(state.connections);
          } catch (err) {
            log.error('connection reconcile failed (contained; UI + persistence preserved)', {
              error: err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err),
            });
          }
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

    // Engine is up: lift the honest IDLE → LIVE so crash-recovery knows the
    // session reached a known-good state (Track B P0). Only lift out of IDLE,
    // never downgrade a real DEAD/DEGRADED signal (the native executor sets LIVE
    // on its first accepted graph push; this covers the browser tier).
    if (useEngineHealthStore.getState().health === 'IDLE') {
      setEngineLive('audio engine initialized');
    }

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
  const lastVersionRef = useRef<string | null>(null);
  const isSavingRef = useRef(false);

  // Autosave when graph changes (debounced) - using version counter for efficient change detection
  useEffect(() => {
    // Only autosave if a project is open
    if (!projectName || !projectHandleKey) return;

    // Initialize version ref with current state (after hydration is complete)
    if (lastVersionRef.current === null) {
      lastVersionRef.current = getDocumentVersion();
    }

    // Subscribe to graph changes
    const scheduleSave = () => {
      // Skip if version hasn't changed (efficient O(1) check vs O(n) JSON.stringify)
      if (getDocumentVersion() === lastVersionRef.current) return;

      // Clear existing timeout
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }

      // Debounced save (3 seconds after last change)
      saveTimeoutRef.current = setTimeout(async () => {
        if (isSavingRef.current) return;

        const currentVersion = getDocumentVersion();
        if (currentVersion === lastVersionRef.current) return;

        isSavingRef.current = true;
        try {
          await saveProject(collectSaveData());
          lastVersionRef.current = currentVersion;
        } catch (err) {
          console.error('[Autosave] Failed:', err);
        } finally {
          isSavingRef.current = false;
        }
      }, 3000);
    };
    const unsubscribeGraph = useGraphStore.subscribe(scheduleSave);
    const unsubscribeArrangement = useArrangementStore.subscribe(scheduleSave);

    return () => {
      unsubscribeGraph();
      unsubscribeArrangement();
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

      const currentVersion = getDocumentVersion();

      // Skip if nothing changed since last save
      if (currentVersion === lastVersionRef.current) return;

      isSavingRef.current = true;
      try {
        await saveProject(collectSaveData());
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

        const currentVersion = getDocumentVersion();

        // Skip if nothing changed since last save
        if (currentVersion === lastVersionRef.current) {
          isSavingRef.current = false;
          return;
        }

        // Save immediately when tab is hidden
        try {
          await saveProject(collectSaveData());
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

  // Default-on crash backup (Track B P0): persist the working graph to
  // localStorage on every change (debounced), REGARDLESS of whether a project
  // folder is connected, so an app/OS crash can restore unsaved work — and the
  // boot-time recovery (useCrashRecovery) actually reads it. This is the
  // localStorage tier of "default-on durability"; the crash-safe OPFS journal +
  // native fsync tiers are Track B P1. The previous code wrote this blob only
  // when a folder was connected AND never read it back on boot.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let lastBackupVersion = getDocumentVersion();

    const flush = () => {
      const saveData = collectSaveData();
      // Nothing meaningful to back up — don't clobber a good backup with empty.
      if (saveData.nodes.length === 0 && saveData.edges.length === 0 && !saveData.arrangement) return;
      writeEmergencyBackup({
        ...saveData,
        projectName: useProjectStore.getState().name,
      });
    };

    const scheduleBackup = () => {
      const currentVersion = getDocumentVersion();
      if (currentVersion === lastBackupVersion) return;
      lastBackupVersion = currentVersion;
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, 2000);
    };
    const unsubscribeGraph = useGraphStore.subscribe(scheduleBackup);
    const unsubscribeArrangement = useArrangementStore.subscribe(scheduleBackup);

    // Final flush on page hide (the hook marks the clean exit separately). No
    // "leave site?" prompt: with durable autosave the work is recoverable, so we
    // never nag the performer on the way out.
    const onPageHide = () => flush();
    window.addEventListener('pagehide', onPageHide);

    return () => {
      unsubscribeGraph();
      unsubscribeArrangement();
      window.removeEventListener('pagehide', onPageHide);
      if (timer) clearTimeout(timer);
    };
  }, []);

  useBindingSet(useMemo(() => ({
    id: 'app-global',
    scope: 'global' as const,
    entries: [
      {
        actionId: 'file.save',
        run: () => {
          if (!projectName || !projectHandleKey) {
            window.dispatchEvent(new CustomEvent('openjammer:new-project'));
            return true;
          }
          if (useProjectStore.getState().isSaving) return true;
          void saveProject(collectSaveData())
            .then(() => toast.success('Project saved'))
            .catch((err: Error) => {
              console.error('[Save] Failed:', err);
              toast.error(`Failed to save project: ${err.message}`);
            });
          return true;
        },
      },
      {
        actionId: 'window.focusHost',
        run: () => { void getInvoke()?.('plugin_window_focus_host'); return true; },
      },
      {
        actionId: 'view.toggleArrangement',
        run: () => {
          const current = useUiViewStore.getState().surface;
          const next = current === 'canvas' ? 'arrangement' : current === 'pianoroll' ? 'arrangement' : 'canvas';
          if (current === 'pianoroll') useUiViewStore.getState().closePianoRoll();
          else useUiViewStore.getState().toggle();
          requestAnimationFrame(() => {
            document.querySelector<HTMLElement>(`[data-surface-root="${next}"]`)?.focus({ preventScroll: true });
          });
          return true;
        },
      },
      ...Array.from({ length: 9 }, (_, index) => ({
        actionId: `mode.${index + 1}`,
        run: () => {
          useAudioStore.getState().setCurrentMode(index + 1);
          return true;
        },
      })),
    ],
  }), [projectName, projectHandleKey, saveProject]));

  /**
   * Unlock audio. Called from the FINAL onboarding tap and from the transport
   * pill's play button — both are real user gestures, and both call this
   * synchronously so the AudioContext is constructed on the gesture's own stack.
   * The browser's autoplay policy inspects exactly that.
   */
  const handleActivate = useCallback(() => {
    void (async () => {
      try {
        await initAudioContext({
          sampleRate: audioConfig.sampleRate,
          latencyHint: audioConfig.latencyHint,
          lowLatencyMode: audioConfig.lowLatencyMode
        });
        setAudioContextReady(true);
        // Latency is no longer read here. It is polled centrally from the ACTIVE
        // executor's backend (the effect below), so the native cpal stream and the
        // browser AudioContext never get confused for one another.
      } catch (err) {
        console.error('Failed to initialize audio:', err);
        // On native, sound is the Rust/cpal engine over IPC — it does NOT need the
        // Web AudioContext. If construction failed here, still boot the engine and
        // unlock the tools; never let a Web-Audio failure block the native canvas.
        if (isTauri()) {
          setAudioContextReady(true);
          return;
        }
        toast.error('Could not start audio', {
          description:
            'Check your browser/OS audio permissions and device, then try again. Open “Audio health” (Ctrl/Cmd+Shift+H) or ask the AI for help.',
        });
      }
    })();
  }, [setAudioContextReady, audioConfig]);

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

  // Central latency readout. Poll the ACTIVE executor's backend — the native cpal
  // stream (via `query_stream`) or the browser AudioContext — on a calm 1 s
  // cadence and publish the one honest number into the store. This replaces the
  // two old populators (the browser-only App-init read and the Settings-panel
  // monitor), so the native readout can never show the WebView2 decode context's
  // latency — the ghost that made a sub-5 ms MOTU stream report ~111 ms.
  useEffect(() => {
    if (!isAudioContextReady) return;
    let cancelled = false;
    const poll = async () => {
      const report = await getExecutor().getLatency();
      if (cancelled || !report) return;
      updateAudioMetrics({
        source: report.source,
        running: report.running,
        baseLatency: report.baseLatency,
        outputLatency: report.outputLatency,
        totalLatency: report.baseLatency + report.outputLatency,
        estimatedRoundTrip: report.roundTripMs,
        classification: report.classification,
        isBluetoothSuspected: report.isBluetoothSuspected,
        bufferFrames: report.bufferFrames,
        sampleRate: report.sampleRate,
        lastUpdated: Date.now(),
      });
    };
    void poll();
    const id = setInterval(() => void poll(), 1000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [isAudioContextReady, updateAudioMetrics]);

  return (
    <>
      {/* Safe Mode (Track B P0) — shown only after repeated crashes; offers calm
          choices instead of reopening into a deadly crash cycle. */}
      {recovery.safeMode && (
        <Suspense fallback={null}>
          <SafeModeScreen api={recovery} />
        </Suspense>
      )}

      {/* The first run: three taps over the REAL studio, blurred behind it.
          Suppressed in Safe Mode — two aria-modal dialogs must never co-render
          (a held note beats a glitch: one calm surface at a time). */}
      {!recovery.safeMode && <OnboardingHost onActivate={handleActivate} />}

      <div
        className={`surface-layer ${surface === 'canvas' ? 'surface-transition-in' : exitingSurface === 'canvas' ? 'surface-transition-out' : ''}`}
        data-surface-root="canvas"
        tabIndex={-1}
        hidden={surface !== 'canvas' && exitingSurface !== 'canvas'}
        inert={surface !== 'canvas' ? true : undefined}
        aria-hidden={surface !== 'canvas'}
      >
        <NodeCanvas />
      </div>

      <ArrangementSurface
        active={surface === 'arrangement'}
        visible={surface === 'arrangement' || exitingSurface === 'arrangement'}
        transition={surface === 'arrangement' ? 'in' : exitingSurface === 'arrangement' ? 'out' : undefined}
        songNodeId={songNodeId}
        onOpenSettings={() => setShowSettings(true)}
      />
      <PianoRollSurfaceHost
        active={surface === 'pianoroll'}
        visible={surface === 'pianoroll' || exitingSurface === 'pianoroll'}
        transition={surface === 'pianoroll' ? 'in' : exitingSurface === 'pianoroll' ? 'out' : undefined}
      />

      <div className="sr-only" aria-live="polite">
        {surface === 'canvas' ? 'Canvas surface active' : surface === 'pianoroll' ? 'Piano roll surface active' : 'Arrangement surface active'}
      </div>

      {/* The app shell: one rule at the top, one transport floating under it. */}
      <Topbar onOpenSettings={() => setShowSettings(true)} />
      <TransportPillHost onRequestAudio={handleActivate} />

      {/* Settings Panel */}
      {showSettings && (
        <Suspense fallback={null}>
          <SettingsPanel onClose={() => setShowSettings(false)} />
        </Suspense>
      )}

      {/* Command Bar (Ctrl/Cmd+K) - host stays eager; heavy palette UI loads on demand. */}
      <CommandBarHost />

      {/* One export surface shared by transport, Ctrl/Cmd+Shift+E, palette, and agent. */}
      <ExportHost />

      {/* DevLog panel (L4) — the on-device structured-log surface; the AI agent
          reads the same store. Toggled via the command palette / openjammer:toggle-devlog. */}
      <DevLogPanel />
      <Bench />

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
      <PluginsPanelHost />

      {/* Canvas companions: the beginner's one sentence, the beat rig's groove,
          and the shortcut card whose default follows the persona. */}
      {surface === 'canvas' && !showOnboarding && <HintBubble />}
      {surface === 'canvas' && <StepGrid />}
      {surface === 'canvas' && <HelpPanel />}

      {/* MIDI Integration - device detection, browser, and node creation */}
      <MIDIIntegration />

      {/* Toast Notifications */}
      <Toaster
        theme={toastTheme}
        position="top-left"
        expand={true}
        visibleToasts={5}
        gap={12}
        offset="80px"
      />
    </>
  );
}

export default App;
