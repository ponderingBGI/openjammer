# UX-1 — the first fix wave, cut into lanes

Written 2026-09-02 by the orchestrator from `FH-1-LOG.md`, `UX-INV-REPORT.md`,
`HEURISTIC-AUDIT.md` and the accepted follow-ups in `../redesign-new-dna/FINAL-REVIEW.md`.
Ranking rule from `00-PLAN.md`: severity × personas hit × proximity to first run.

Every lane: Opus builder, strict file ownership, never `git add/commit/stash/checkout/reset`,
Playwright under `node`, private port, report to `plans/ux-intuitive/UX-1x-REPORT.md` with
what changed / verified (output quoted) / could NOT verify / risks. Every lane is followed by an
adversarial gate that re-runs the persona task that surfaced each item, then the orchestrator
runs the six gates and commits by pathspec. Lanes touching the same file are serialized.

## Decisions (settled — do not relitigate in prompts)

| # | Decision | Why |
|---|---|---|
| U1 | The browser tier gets the native tier's transport frame, not a fork; a missing wasm export is a build-time failure, never a silent probe. | covenant #2/#4; UX-INV Q2 |
| U2 | A denormal flush is hygiene, not a fault. Only NaN/Inf raise `NonFinite`. Recirculating kernels get floors so subnormals never form. | UX-INV Q1 |
| U3 | On a clean boot the song is restored from the newest non-quarantined backup, silently, arrangement only (the graph is zustand's). Backup flush is forced before the clean-exit marker. Crash restore keeps its toast and its breaker. | UX-INV Q3 |
| U4 | `openjammer:new-project` is replaced by a direct call; native `prompt()`/`confirm()` leave `projectStore` for the inline `alertdialog` pattern `AppMenuBar` already has. | UX-INV Q4; HA-15 |
| U5 | Outputs fan out. Grabbing a connected output starts a NEW cable. Moving a cable = grab it at its input end or grab the cable body. Cable hit-path never sits above nodes during a drag. | UX-INV Q5 |
| U6 | A fresh track is *unbound* and says so on the track, before Play: "No instrument yet — choose one ⌄". Choosing binds through a `setTrackRef` verb (undoable). | UX-INV Q2 cause 2; FH-1 F11 |
| U7 | The transport pill is the one place a performer is told about the transport. `transportError` renders on the pill (warning dot + reason in `title`), the sky band mirrors it. A button whose label says Play never stops the song. | HA-03 |
| U8 | Ports get `role`, `aria-label`, `title`, a ≥24 px hit pad, an idle tint at reduced chroma (type is a property of the socket), and one roving tab stop per node. Keyboard connect: Enter on a focused port arms it, Enter on a compatible port completes, Esc cancels. This closes the open decision in `docs/shell.md`. | HA-02, HA-12, HA-19 |
| U9 | Forward Tab from the topbar lands on the first control inside the active surface; the surface-toggle fires only when the previous focus was not that surface root. `docs/shell.md` becomes true rather than rewritten. | HA-01 |
| U10 | Vocabulary, one word each: the ruled surface is the **Song** (its card is the Song node; "arrangement" survives only as the store/module name); the ruler is the **timeline**; the AI is **Pi** everywhere the player reads; the plugin dialog is **Plugins**; the `add` node is **Sum**; the palette shows `def.description`, instruments show their display name. | HA-10, HA-11 |
| U11 | Dead tools ship or die: Erase and Knife ship on both the Song and the roll (click = delete / split at pointer, per `02-timeline-interaction-spec.md`); the Time tool binding is removed. | HA-13, code-value #8 |
| U12 | Every history-recording verb selects what it made and announces `HistoryEntry.label` in the polite live region; Undo/Redo titles carry the label. | HA-07, HA-09 |
| U13 | `Ctrl+K` gets a topbar affordance (`⌘K` ghost button) and joins the beginner five; the "Scroll → Zoom" row becomes `Ctrl+Scroll`; the shortcut card also shows for `exp: 'some'`. | HA-08, HA-24 |
| U14 | No un-Escapable overlay. The error boundary takes Esc = *Try to recover* and collapses to a corner chip; the three inline confirms take Esc. | HA-14, HA-23 |
| U15 | The beat rig's step sequencer becomes a real card in the Song node's language (title bar, well, grid inside the card, cells in `--accent-two`, never the state colour). | FINAL-REVIEW §2 #3 |

## Lanes

### UX-1A — engine truth (RUNNING; Rust/wasm/worklet)
D1 `drain_transport` on the native frame plumbing + wasm rebuild + export-contract test + the
`Reflect.get` probe removed. D2 `sanitize` split + denormal floors in sampler one-pole, delay
feedback, and every other recirculating kernel. D3 `e2e/engine-real.spec.ts`, probe-free.
Owns `crates/**`, `src/audio/worklets/**`, `src/audio/wasm/pkg/**`, `OjcoreWasmExecutor.ts`,
`docs/ARCHITECTURE.md`.

### UX-1B — durability and first-run truth (after the W6-SHIP commit)
- U3 song restore on clean boot (`useCrashRecovery.ts`, `App.tsx` flush-before-marker, `webPayloads.ts`).
- U4 new-project direct call (`App.tsx`, `AppMenuBar.tsx`, `CommandBar` entry, Safe Mode Start Fresh) and native dialogs out of `projectStore.ts`.
- U6 unbound track + `setTrackRef` (`ArrangementSurface.tsx:49` default ref, `TrackLaneView.tsx`, `PluginsPanel.tsx` `choose()` honours `trackId`, `arrangementStore` verb + history test, `docs/timeline.md`).
- U7 transport error on the pill (`TransportPillHost.tsx`, `SkyBand.tsx`; the `arrangementStore.ts:75` message names the likely cause when a track is unbound).
- HA-04/05 empty canvas state + hint gate (`HintBubble.tsx`, `NodeCanvas.tsx` zero-node branch).
- HA-06 one latency source (`engineHealthStore.ts`, `LatencyChip.tsx`).
- HA-16 instrument faceplate copy (`InstrumentNode.tsx`, `InstrumentVisualNode.tsx`).
- HA-27 offline chip copy (`Topbar.tsx` chip text only).
- Gate re-runs FH-1 tasks 4–6 verbatim.

### UX-1C — canvas grammar (after the W6-SHIP commit; parallel with 1B)
- U5 fan-out + cable z-order (`NodeWrapper.tsx:264-266`, `NodeCanvas.css:34-36`, tests).
- U8 ports (`packages/oj-ui/.../Port/*`, `NodeWrapper.tsx` port rendering, keyboard connect in `NodeCanvas.tsx`, `docs/shell.md` §ports, `oj-ui` story + Code Connect gate).
- U9 forward Tab (`src/keymap/arbiter.ts`, `docs/shell.md:80-82` stays as written because it becomes true).
- U12 select-new + live-region label (`useCommandSources.ts`, `ContextMenu.tsx`, `Topbar.tsx` undo/redo titles, the live region owner).
- HA-17 bounds-based spawn occupancy + viewport clamp (`spawnPlacement.ts`).
- HA-19 Knob `title` (`Knob.tsx`).
- HA-21 emoji → category glyphs (`ContextMenu.tsx`).
- HA-26 Edit verbs in the canvas menu + a node menu (`ContextMenu.tsx`, `NodeCanvas.tsx:280-283`).
- Gate re-runs FH-1 task 3 and the HA keyboard-only walk.

### UX-1D — words, help, copy (after 1B/1C commit)
- U10 vocabulary sweep (`SkyBand.tsx`, `PluginsPanel.tsx` title, `CommandBar.tsx:577-581`, `registry.ts:603`, `useCommandSources.ts:332`, `AiPanel.tsx`, `TrackLaneView` instrument name, docs).
- U13 help rows + `⌘K` topbar affordance + card for `some` (`HelpPanel.tsx`, `Topbar.tsx`, `onboardingStore.ts` consumers).
- HA-25 disabled reasons + Drums aria (`PianoRoll.tsx:677,736`).
- HA-28 type chip = category only; `MODE n` to a state pip (`NodeShell.tsx`, `SpeakerNode.tsx`, `KeyboardVisualNode.tsx`).
- HA-30 imperative empty states (`SongNode.tsx`, `PortPanelNode.tsx`, `ContainerNode.tsx`).
- HA-29 hint/help corners reserved in the rig layout.
- From FH-4 (coder persona, `FH-4-LOG.md`): the help card's `Ctrl+K · Ask the AI` row must be true on the tier it is shown on (browser: "Ctrl+K · Commands", and Ctrl+K's empty result for a sentence says where the AI lives); `W` Ghost Mode must fire while the Keys node holds QWERTY (route it as a level action like E/Q, or rebind and fix the doc); `docs/agent-tools.md` Tab claim corrected to the shipped behaviour; the "First time" coach line names both add-node routes (right-click, Ctrl+K); the agent trust card gains one sentence on blast radius ("It only ever edits the canvas, live, and Ctrl+Z undoes every change") beside the privacy sentence.
- **U16 (new decision): authoring a node is a first-class affordance.** A `Create a node…` entry in the Add menu, the palette and the canvas context menu. Native tier: opens the Pi conversation pre-seeded with the `author_code_node` flow. Browser tier: an honest inline card ("Authoring runs on the desktop app — here is what it looks like") with the docs link, never a dead end. `docs/creating-nodes.md` is split: a player-facing page first, the contributor page after.
- The pill's `space` keycap: keep the honest removal, but show `Space · sustain` in mode 2 so the affordance is replaced, not lost (`TransportPillHost.tsx:161-169`).

### UX-1E — Song and roll tools, dialogs (after 1B/1C commit; parallel with 1D)
- U11 Erase/Knife ship, Time removed (`ArrangementSurface.tsx:372`, `RulerStack.tsx`, `PianoRoll.tsx:82,717`, `keybindingsStore.ts:230-233,268`, `docs/timeline.md`, e2e T-list additions).
- U14 error boundary Esc + corner chip; three confirms take Esc (`AppErrorBoundary.tsx`, `KeybindingsPanel.tsx`, `UpdatesPanel.tsx`, `AiPanel.tsx`).
- HA-18 inline roll opening zoom / minimum note width + zoom on the roll's strip (`PianoRollSurfaceHost.tsx`, `geometry.ts:152-159`).
- HA-20 live region empty at rest, polite (`SkyBand.tsx:111`).
- HA-22 one tool strip at a time (`RulerStack.tsx`, `PianoRoll.tsx`).
- U15 step-sequencer card (the beat rig's bottom strip; `src/components/Rigs/*` or wherever it lives — find it).


### UX-1F — the performer's keyboard (from `FH-2-LOG.md`; after 1D/1E commit)
- Every focusable control on the Song (instrument chevron, Mute, Solo, Arm, browser rows) fires on Enter and Space — real `<button>`s or a shared key handler; a keyboard-only walk test across the track header.
- The pill's fault state is visible text, not a dot: the reason renders as one line under the pill (micro voice) the first time and stays as the dot + title after; the Esc hint is in that line; the live region speaks it.
- Focus is selection for the keyboard: Delete/Enter on a focused clip or note acts on it (focus moves selection, as the roll's roving model already does).
- `M`: keep the spec's binding (metronome) but never silently — the pill shows the metronome state and the live region says it; add a Song-scoped track mute key (per `02-timeline-interaction-spec.md` §4; if none, `Shift+M` on the focused track) with the same feedback.
- The instrument browser never returns zero results after clearing the family filters its own empty state recommends; the stock drum kit (`gm-synth-drum`) is offered back in `pick` context.
- Spawn placement reserves the transport pill's rectangle (and the hint/help corners) so a new card never lands under chrome.
- Decision U17: sound truth. The header's "making sound" line reads the master meter, not the transport: rolling at −∞ dB for more than one bar reads "Rolling, but silent — check the track's voice" in warning ink. One source (the Speaker/master meter the shell already trusts).

## After UX-1
FH-2 (performer, keyboard-only) and FH-3 (sound designer) run against the post-1A build; FH-1
re-runs end to end; the HA lane re-measures its 30 rows. Then UX-2 from whatever survives.
