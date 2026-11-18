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
import { nodeDefinitions, menuCategories, getNodeDefinition } from "../../engine/registry";
import type { NodeCategory, NodeType, Position } from "../../engine/types";
import { getNodeDimensions, useGraphStore } from "../../store/graphStore";
import { useCanvasStore } from "../../store/canvasStore";
import { useCanvasNavigationStore } from "../../store/canvasNavigationStore";
import { registerAll } from "../../store/commandRegistry";
import type { Action, ActionCtx, Command } from "../../store/commandRegistry";
import { seedPaletteLearning } from "../../store/paletteLearningSeed";
import { useAiLearningStore } from "../../store/aiLearningStore";
import { getInvoke } from "../../ai/tauri";
import { useEditingContextStore } from "../../store/editingContextStore";
import { applyPianoRollQuantize } from "../PianoRoll";
import { useUiViewStore } from "../../store/uiViewStore";
import { freeSpawnPoint, measureRenderedCards, spawnCardSize, type SpawnBounds, type SpawnBox } from "../../utils/spawnPlacement";
import { requestNewProject } from "../Shell/newProjectDialog";

// Human-readable group label per category (matches the menu's casing).
const CATEGORY_LABEL: Record<NodeCategory, string> = {
  instruments: "Instruments",
  input: "Input",
  effects: "Effects",
  routing: "Routing",
  output: "Output",
  utility: "Utility",
};

/**
 * The palette's spawn point: the canvas position that puts the CARD's centre at
 * the viewport's centre.
 *
 * `addNode` takes a top-LEFT, and this used to return the viewport centre
 * unadjusted — so the card hung down and to the right of the middle, and anything
 * taller than about 400px was already partly off the bottom edge before a single
 * cascade step was taken. Half the card's size is the whole correction, and it is
 * also what makes "centre of the screen" mean what a player would expect.
 */
function viewportCenter(card: { width: number; height: number }): Position {
  const rect = useCanvasStore.getState().canvasRect;
  const screenCenter: Position = {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  };
  const centre = useCanvasStore.getState().screenToCanvas(screenCenter);
  return { x: centre.x - card.width / 2, y: centre.y - card.height / 2 };
}

/**
 * The REAL, rendered size of every card currently on the canvas, in canvas px,
 * keyed by node id.
 *
 * The rule itself — and the argument for measuring the surface instead of
 * trusting the registry's `dimensions` — lives with the placement rule in
 * `utils/spawnPlacement.ts`. This is the app-side wiring: the zoom and the node
 * type lookup come from the stores, which that module deliberately does not know
 * about.
 */
function measuredCards() {
  return measureRenderedCards(
    useCanvasStore.getState().zoom,
    (nodeId) => useGraphStore.getState().nodes.get(nodeId)?.type,
  );
}

/**
 * The visible canvas, in CANVAS space — the rectangle a newly added card has to
 * stay inside to be seen.
 *
 * A card that lands off-screen is the same failure as a card that lands under
 * another one: the gesture promised a card appearing and the player got nothing.
 * `viewportCenter()` puts the card's top-LEFT at the centre, so a tall card
 * already overflows before any cascade, and the cascade then pushed it further.
 * Returns `undefined` before the canvas has been measured, in which case the
 * placement rule simply skips the containment test.
 */
function visibleCanvasBounds(): SpawnBounds | undefined {
  const canvas = useCanvasStore.getState();
  const rect = canvas.canvasRect;
  if (!rect.width || !rect.height) return undefined;
  /*
   * INTERSECT the canvas element with the window, do not just convert it.
   *
   * The canvas is a full-height 1440x900 box that starts BELOW the topbar
   * (measured: `top: 46`), so its own bottom 46px are off the screen. Trusting
   * the element's rect therefore told the placement rule that a strip it cannot
   * see was fair game, and every card that landed against that edge hung off the
   * real screen by the height of the chrome. "Visible" has to mean visible to
   * the player, not merely inside the scroller.
   */
  const left = Math.max(rect.left, 0);
  const top = Math.max(rect.top, 0);
  const right = Math.min(rect.left + rect.width, window.innerWidth);
  const bottom = Math.min(rect.top + rect.height, window.innerHeight);
  if (right <= left || bottom <= top) return undefined;
  const topLeft = canvas.screenToCanvas({ x: left, y: top });
  const bottomRight = canvas.screenToCanvas({ x: right, y: bottom });
  return { left: topLeft.x, top: topLeft.y, right: bottomRight.x, bottom: bottomRight.y };
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
 * - Palette: `ctx.point` is undefined → spawn at the viewport centre.
 * - Context menu (M4): `ctx.point` is the clicked canvas point.
 *
 * Either way the spawn PARENT is the level the player is currently looking at,
 * and nothing else. It used to be `ctx.node?.id ?? currentParentId()`, which
 * reads plausibly and is wrong on both surfaces: `buildPaletteCtx` sets
 * `ctx.node` to the SINGLE SELECTED node, which means "what this command is
 * about", not "where to put the next card". The menu never set it at all (right-
 * click on a card was suppressed until HA-26), so the branch had no correct
 * caller — and the moment an add started selecting what it made (U12), every
 * second palette add vanished INSIDE the first. Measured: `Add Looper` then
 * `Add Library` produced one visible card and one card nested a level down.
 *
 * Either way the point is only the STARTING wish: {@link freeSpawnPoint}
 * cascades off any sibling already sitting there. The palette had no point of
 * its own, so three adds in a row produced three cards on one pixel and the
 * player watched two of them land invisibly.
 *
 * RE-READs the stores at call time (mutation discipline) — never the snapshot.
 */
function addNodeFromCtx(type: NodeType, ctx?: ActionCtx): void {
  const parentId = currentParentId();
  // Real RECTANGLES, not origins: a 380px-tall Library and a 90px Multiplier are
  // not the same obstacle, and two big cards 30px apart cover each other almost
  // completely while their origins look comfortably separated.
  const measured = measuredCards();
  const siblings: SpawnBox[] = [];
  for (const node of useGraphStore.getState().nodes.values()) {
    if ((node.parentId ?? null) !== parentId) continue;
    // The card's REAL footprint where it is on screen; its declared one only as a
    // fallback. Reserving the largest card's size for every sibling would
    // artificially exhaust the canvas and push the run off-screen anyway.
    siblings.push({ position: node.position, ...(measured.byId.get(node.id) ?? getNodeDimensions(node)) });
  }
  const card = spawnCardSize(type, getNodeDefinition(type).dimensions);
  const canvasPos = freeSpawnPoint(ctx?.point ?? viewportCenter(card), siblings, card, visibleCanvasBounds());
  const id = useGraphStore.getState().addNode(type, canvasPos, parentId);
  /*
   * U12 / HA-07 — SELECT what you just made.
   *
   * `addNode`'s returned id was discarded here, and the measured consequence is
   * that a palette add produced no confirmation of any kind: `selected: 0` after
   * every one of seven probes. On a busy canvas — or after a cascade step moved
   * the card away from the point the player was looking at — there was no way to
   * tell WHICH card was new. Selecting it is the visible half of the answer (the
   * live region is the spoken half); it costs nothing, it is what a mouse add
   * would have done, and the ring is already drawn.
   *
   * Not part of the same history entry on purpose: selection is view state, and
   * an undo that also had to restore a selection is a bigger promise than this
   * needs to make.
   */
  useGraphStore.getState().selectNode(id);
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
function buildAppCommands(): Array<Command | Action> {
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
        window.dispatchEvent(new CustomEvent("openjammer:time-prompt", { detail: { mode: "delete" } }));
      },
    },
    {
      id: "arrangement.insert-time",
      title: "Insert time at playhead",
      group: "Arrangement",
      keywords: ["insert", "time", "ripple", "open gap"],
      run: () => {
        window.dispatchEvent(new CustomEvent("openjammer:time-prompt", { detail: { mode: "insert" } }));
      },
    },
    {
      id: "arrangement.loop-from-selection",
      title: "Loop from time selection",
      group: "Arrangement",
      keywords: ["loop", "range", "selection"],
      run: () => window.dispatchEvent(new CustomEvent("openjammer:loop-from-selection")),
    },
    {
      id: "arrangement.export-song",
      title: "Export song…",
      group: "Arrangement",
      keywords: ["bounce", "render", "master", "wav", "flac", "export"],
      targets: ["global"],
      surfaces: ["palette"],
      run: () => window.dispatchEvent(new CustomEvent("openjammer:export-song")),
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
      // A direct call, not an event: `openjammer:new-project` had no listener
      // anywhere in the app, so this entry did nothing at all (UX-INV Q4).
      run: () => requestNewProject("new"),
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
