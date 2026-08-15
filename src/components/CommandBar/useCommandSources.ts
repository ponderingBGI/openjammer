/**
 * Command sources (U19 → M4)
 *
 * Derives the initial set of {@link Action}s from existing app data and wires
 * them into the {@link register registry} for the lifetime of the mounted
 * command bar:
 *
 * 1. Node-add actions — one per registered {@link nodeDefinitions} entry that
 *    appears in a user-facing {@link menuCategories} bucket, grouped by the
 *    node's {@link NodeCategory}. (`registry.ts` is imported READ-ONLY.)
 *    M4 promotes these from legacy zero-arg `Command`s into real {@link Action}s
 *    offered on BOTH surfaces (`surfaces: ['palette','menu']`) with a `path` for
 *    the menu's nested categories — so the right-click menu is a FILTERED
 *    PROJECTION of this same registry. `run(ctx)` spawns at the menu's clicked
 *    `ctx.point` (and inside `ctx.node`) when present, else at viewport centre.
 * 2. App actions — trivial global toggles dispatched as the same window
 *    CustomEvents the toolbar/menus already listen for (settings, help). These
 *    stay palette-ONLY (`surfaces: ['palette']`): the curated right-click menu
 *    is for new users and need not surface app chrome.
 *
 * Future AI-generated nodes register through the SAME `commandRegistry`
 * singleton, so they appear on BOTH surfaces automatically without touching
 * this file.
 */

import { useEffect } from "react";
import { nodeDefinitions, menuCategories } from "../../engine/registry";
import type { NodeCategory, NodeType, Position } from "../../engine/types";
import { useGraphStore } from "../../store/graphStore";
import { useCanvasStore } from "../../store/canvasStore";
import { useCanvasNavigationStore } from "../../store/canvasNavigationStore";
import { registerAll } from "../../store/commandRegistry";
import type { Action, ActionCtx, Command } from "../../store/commandRegistry";
import { seedPaletteLearning } from "../../store/paletteLearningSeed";
import { useAiLearningStore } from "../../store/aiLearningStore";
import { getInvoke } from "../../ai/tauri";
import { useArrangementStore } from "../../store/arrangementStore";
import { useEditingContextStore, gridTicks } from "../../store/editingContextStore";
import { deleteTime, insertTime } from "../../song/ops";
import { timebase } from "../../song/time";
import { applyPianoRollQuantize } from "../PianoRoll";
import { useUiViewStore } from "../../store/uiViewStore";

// Human-readable group label per category (matches the menu's casing).
const CATEGORY_LABEL: Record<NodeCategory, string> = {
  instruments: "Instruments",
  input: "Input",
  effects: "Effects",
  routing: "Routing",
  output: "Output",
  utility: "Utility",
};

/** The canvas-space centre of the current viewport (the palette's spawn point). */
function viewportCenter(): Position {
  const screenCenter: Position = {
    x: window.innerWidth / 2,
    y: window.innerHeight / 2,
  };
  return useCanvasStore.getState().screenToCanvas(screenCenter);
}

/** The canvas level the user is currently viewing (the default add parent). */
function currentParentId(): string | null {
  return useCanvasNavigationStore.getState().currentViewNodeId;
}

/**
 * Spawn a new node of `type` for either surface. Mirrors NodeCanvas's add path
 * (canvas coords -> addNode with the active parent) without importing anything
 * from the read-only Nodes lane.
 *
 * - Palette: `ctx.point` is undefined → spawn at the viewport centre, inside the
 *   level the user is viewing.
 * - Context menu (M4): `ctx.point` is the clicked canvas point; if the user
 *   right-clicked a node, `ctx.node` is the spawn parent.
 *
 * RE-READs the stores at call time (mutation discipline) — never the snapshot.
 */
function addNodeFromCtx(type: NodeType, ctx?: ActionCtx): void {
  const canvasPos = ctx?.point ?? viewportCenter();
  const parentId = ctx?.node?.id ?? currentParentId();
  useGraphStore.getState().addNode(type, canvasPos, parentId);
}

/**
 * Build the node-add actions. Only node types surfaced in `menuCategories`
 * become actions — internal/visual helper types (e.g. `*-visual`,
 * `canvas-input`) are intentionally excluded, exactly as the right-click menu
 * excludes them.
 *
 * Each is a real {@link Action} offered on BOTH surfaces: `targets` cover the
 * canvas point + selection the menu carries, and `path` places it in the menu's
 * nested category. The id stays `node.add.<type>` (so `frecencyKey === id` is
 * unchanged across M2's learning).
 */
function buildNodeActions(): Action[] {
  const userFacingTypes = new Set<NodeType>(
    menuCategories.flatMap((category) => category.items)
  );

  const result: Action[] = [];
  for (const type of userFacingTypes) {
    const def = nodeDefinitions[type];
    if (!def) continue;
    const label = CATEGORY_LABEL[def.category] ?? def.category;
    result.push({
      id: `node.add.${type}`,
      title: `Add ${def.name}`,
      group: label,
      path: [label],
      keywords: [
        def.type,
        def.category,
        def.description,
        "add",
        "node",
        "create",
      ],
      targets: ["global", "canvasPoint", "selection"],
      surfaces: ["palette", "menu"],
      run: (ctx) => addNodeFromCtx(type, ctx),
    });
  }
  return result;
}

/**
 * App-action commands sourced from menus/keybindings where trivially available.
 * These reuse the existing window CustomEvent seam (see App.tsx / HelpPanel.tsx).
 *
 * Left as legacy zero-arg {@link Command}s on purpose: normalisation maps them to
 * `surfaces: ['palette']`, so they appear ONLY in the Ctrl+K palette (the strict
 * SUPERSET) and never clutter the curated right-click menu.
 */
function buildAppCommands(): Command[] {
  return [
    {
      id: "pianoroll.quantize",
      title: "Quantize selected notes",
      group: "Piano Roll",
      keywords: ["quantize", "notes", "grid", "swing", "strength"],
      run: () => {
        const surface = useUiViewStore.getState().surface === "pianoroll" ? "pianoroll" : "arrangement";
        applyPianoRollQuantize(useEditingContextStore.getState().viewports[surface].selection.noteIds);
      },
    },
    {
      id: "arrangement.delete-time",
      title: "Delete selected time",
      group: "Arrangement",
      keywords: ["delete", "time", "ripple", "close gap"],
      run: () => {
        const store = useArrangementStore.getState();
        const arrangement = store.arrangement;
        if (!arrangement) return;
        const selection = useEditingContextStore.getState().viewports.arrangement.selection;
        const clips = arrangement.tracks.flatMap((track) => track.clips).filter((clip) => clip.id !== undefined && selection.clipIds.includes(clip.id));
        if (!clips.length) return;
        const from = Math.min(...clips.map((clip) => clip.startTick));
        const to = Math.max(...clips.map((clip) => clip.startTick + clip.lengthTick));
        const trackIds = selection.trackIds.length ? selection.trackIds : arrangement.tracks.map((track) => track.id!).filter(Boolean);
        store.apply(deleteTime(arrangement, from, to, trackIds).verbs);
      },
    },
    {
      id: "arrangement.insert-time",
      title: "Insert time at playhead",
      group: "Arrangement",
      keywords: ["insert", "time", "ripple", "open gap"],
      run: () => {
        const store = useArrangementStore.getState();
        const arrangement = store.arrangement;
        if (!arrangement) return;
        const context = useEditingContextStore.getState();
        const tb = timebase(arrangement);
        const duration = gridTicks(context.gridUnit, tb.ticksPerBeat, tb.ticksPerBar, context.viewports.arrangement.pxPerTick, true) ?? tb.ticksPerBeat;
        const trackIds = context.viewports.arrangement.selection.trackIds.length ? context.viewports.arrangement.selection.trackIds : arrangement.tracks.map((track) => track.id!).filter(Boolean);
        store.apply(insertTime(arrangement, store.playheadTick, duration, trackIds).verbs);
      },
    },
    {
      id: "app.settings.toggle",
      title: "Open Settings",
      group: "App",
      keywords: ["settings", "preferences", "theme", "audio", "keybindings"],
      run: () =>
        window.dispatchEvent(new CustomEvent("openjammer:toggle-settings")),
    },
    {
      id: "app.help.toggle",
      title: "Toggle Help",
      group: "App",
      keywords: ["help", "shortcuts", "keys", "guide"],
      run: () =>
        window.dispatchEvent(new CustomEvent("openjammer:toggle-help")),
    },
    {
      // The on-device structured-log surface (L4). Available in every build so
      // a performer can pull up xruns / node faults / MIDI on stage. The AI
      // agent reads the same store via its `get_logs` tool.
      id: "app.devlog.toggle",
      title: "Toggle DevLog",
      group: "App",
      keywords: [
        "devlog",
        "log",
        "logs",
        "debug",
        "console",
        "diagnostics",
        "events",
        "xrun",
      ],
      run: () =>
        window.dispatchEvent(new CustomEvent("openjammer:toggle-devlog")),
    },
    {
      // The one-screen audio-health readout (§4) — same diagnostics the AI reads.
      id: "app.audio-health.toggle",
      title: "Audio health",
      group: "App",
      keywords: [
        "audio",
        "health",
        "latency",
        "sound",
        "diagnostics",
        "device",
        "status",
        "no sound",
      ],
      run: () =>
        window.dispatchEvent(new CustomEvent("openjammer:toggle-audio-health")),
    },
    {
      // Report a problem (L5/Phase 2) — opens the local diagnostic bundle
      // (DevLog tail + reveal log file + copy diagnostics). Nothing is
      // uploaded; the performer chooses what to share. Wires the previously
      // orphaned `openjammer:report-issue` seam the IssueReporter listens for.
      id: "app.report-issue",
      title: "Report a problem",
      group: "App",
      keywords: [
        "report",
        "issue",
        "bug",
        "problem",
        "diagnostics",
        "log",
        "support",
        "crash",
      ],
      run: () =>
        window.dispatchEvent(new CustomEvent("openjammer:report-issue")),
    },
    {
      // Bring-your-own plugin discovery (§3) — scan installed CLAP/VST3.
      id: "app.plugins.toggle",
      title: "Plugins",
      group: "App",
      keywords: [
        "plugin",
        "plugins",
        "clap",
        "vst",
        "vst3",
        "host",
        "bring your own",
        "effect",
        "instrument",
      ],
      run: () =>
        window.dispatchEvent(new CustomEvent("openjammer:toggle-plugins")),
    },
    {
      id: "app.project.new",
      title: "New Project",
      group: "App",
      keywords: ["new", "project", "create", "file"],
      run: () =>
        window.dispatchEvent(new CustomEvent("openjammer:new-project")),
    },
    {
      // D6 (M7): the Ctrl+K-superset entry into the AuthChooser. Palette-only
      // (a legacy Command → surfaces:['palette']) — the curated right-click
      // menu need not surface AI provider chrome. It opens the AI path's
      // configure flow via a window event the CommandBar listens for.
      id: "app.ai.configure",
      title: "Configure AI provider",
      group: "AI",
      keywords: [
        "ai",
        "auth",
        "provider",
        "key",
        "login",
        "opencode",
        "codex",
        "anthropic",
      ],
      run: () =>
        window.dispatchEvent(new CustomEvent("openjammer:configure-ai")),
    },
  ];
}

/**
 * Agent learning + CLI-parity actions (Phase 4/7). Desktop-only — gated on the
 * capability seam (`caps.agent !== 'none'`) so they never appear in the browser.
 * Thin wrappers over the native `ai_set_learning` / `ai_forget` commands; memory
 * is on by default, and the persistent global brain spans projects.
 */
function buildAiActions(): Action[] {
  const invokeAi = (cmd: string, args?: Record<string, unknown>): void => {
    const invoke = getInvoke();
    if (!invoke) return;
    void invoke(cmd, args ?? {});
  };
  const agentOnly = (ctx: ActionCtx): boolean => ctx.caps.agent !== "none";
  return [
    {
      id: "ai.learning.enable",
      title: "AI: Turn Philia memory on",
      group: "AI",
      keywords: [
        "ai",
        "Philia",
        "learn",
        "memory",
        "remember",
        "persistent",
        "intelligence",
      ],
      targets: ["global"],
      surfaces: ["palette"],
      enabled: agentOnly,
      run: () => {
        invokeAi("ai_set_learning", { enabled: true });
        // Reflect in the "memory: on" footer at once (the host read confirms it).
        useAiLearningStore.getState().setEnabled(true);
      },
    },
    {
      id: "ai.learning.disable",
      title: "AI: Turn Philia memory off",
      group: "AI",
      keywords: ["ai", "Philia", "learn", "memory", "stop", "off", "privacy"],
      targets: ["global"],
      surfaces: ["palette"],
      enabled: agentOnly,
      run: () => {
        invokeAi("ai_set_learning", { enabled: false });
        useAiLearningStore.getState().setEnabled(false);
      },
    },
    {
      id: "ai.learning.forget",
      title: "AI: Make Philia forget what it learned",
      group: "AI",
      keywords: ["ai", "Philia", "forget", "memory", "wipe", "reset", "clear"],
      targets: ["global"],
      surfaces: ["palette"],
      enabled: agentOnly,
      run: () => invokeAi("ai_forget"),
    },
  ];
}

/**
 * Register the derived command sources for as long as the command bar is
 * mounted. The registry is keyed by id, so this is safe across re-mounts.
 */
export function useCommandSources(): void {
  useEffect(() => {
    // D-LEARN (M7): seed the local frecency floor from Pi memory when the
    // platform's learning ceiling is 'pi-memory'. Additive + no-op on the
    // founder-gated empty stub, so this is always safe (never lowers a score).
    void seedPaletteLearning();
    return registerAll([
      ...buildNodeActions(),
      ...buildAppCommands(),
      ...buildAiActions(),
    ]);
  }, []);
}
