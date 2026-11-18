# Track 3 — heuristic audit

The expert, code-aware pass. Everything below was **measured in the running app first** and
then located in code; nothing is read off a report. Where I expected a problem and found
none, it is in [Checked and cleared](#checked-and-cleared) with the evidence.

**Method.** `vite` dev server on `:5242`, driven headlessly by node + Playwright
(`.scratch/ha/*.mjs`, captures in `.scratch/ha/shots/`). Fresh browser context per walk.
1440×900 and 1280×800, light and dark, plus one `prefers-reduced-motion: reduce` pass.
Both first-run (`oj-onboarding-v1` absent) and returning-user profiles; theme forced via
`localStorage['openjammer-theme']` (`packages/oj-tokens/src/index.ts:24`).

> One environment note, stated once so no finding leans on it silently: the dev server
> would not start until `.scratch/**` was excluded from Vite's watcher — a parallel lane's
> live Chromium profile makes chokidar die with `EBUSY` on its locked `Cookies` file
> (`vite.config.ts:358-360` ignores only `target/**`). I ran with an audit-local config
> override in `.scratch/ha/vite.ha.config.ts`; I did **not** change the repo config. Worth
> a one-line fix in `vite.config.ts` for anyone running a browser out of `.scratch/`.

**What this builds on.** `plans/redesign-new-dna/FINAL-REVIEW.md` §2's weakest five are not
re-reported. Three of them have since landed (drum heuristic, roll roving tabindex, palette
cascade) and are verified fixed below; two are extended by new evidence (**HA-02** deepens
the port gap; **HA-17** shows what the cascade fix did and did not buy).

**Severity.** `S1` blocked · `S2` wrong mental model formed · `S3` slowed · `S4` cosmetic.
Rank is `severity × how many users hit it × proximity to first run` — an S2 that every
first-run player meets in ninety seconds outranks an S1 only a keyboard-only expert reaches.

---

## Ranked findings

| id | dimension | S | finding | evidence | file:line | one-line fix |
|---|---|---|---|---|---|---|
| **HA-01** | 7 keyboard | **S1** | There is **no forward-Tab route into any surface**. From the topbar's last control, Tab walks pill → hint ✕ → help ✕ → `document.body` → then canvas↔arrangement forever. Zero canvas controls are ever reached. `docs/shell.md:80-82` states the opposite ("the way back in is a `Tab` forward from the topbar, which lands on the first control inside the active surface") — measured false. | `.scratch/ha/w9.log`, `shots/w9-topbar-forward-light.json`, `shots/w7-tabs-light.json` | `src/keymap/arbiter.ts:34-39`; doc claim `docs/shell.md:80-82` | Let a **second consecutive** bare `Tab` on a surface root fall through to native traversal instead of toggling again (toggle only when the previous focus was not that root). |
| **HA-02** | 1, 7, 8 | **S1** | Ports are not merely un-tabbable — they are `<span>`s with **no `role`, no `aria-label`, no `title`** (42/42 measured). The app's single most-used verb is invisible to assistive tech, has no hover affordance, and its only cue is `cursor: crosshair`. FINAL-REVIEW §3 found the tab gap; the accessibility-tree gap is new. | `shots/w7-ports-light.json`; `.scratch/ha/w16.log` ("hovered port title: (no title on hovered port)") | `packages/oj-ui/src/components/Port/Port.tsx`; `Port.css:20-33`, hover rule `:45-47`; `src/components/Nodes/NodeWrapper.tsx:616` (only *disabled* ports get a `title`) | Give every port `role="button"`, an `aria-label` ("Audio out — drag to connect"), a `title`, and one roving tab stop per node — exactly as `PianoRoll` now does. |
| **HA-03** | 3 state honesty | **S1** | When the engine does not acknowledge a transport command, the **pill quietly reverts to a Play glyph while the Song card still reads "playing"**, and the only report — *"The audio engine did not acknowledge the transport command"* — renders **on the arrangement sky band only**, i.e. on a surface the player is not looking at. Pressing the button labelled *Play* then **stops** the song. | `.scratch/ha/w11.log` (4 s of `pillPlay:"Play"` beside `songChip:"… playing …"`, then "after pressing pill" → `stopped`); `shots/w11-beat-dark.png` | error text `src/store/arrangementStore.ts:75`; glyph rule `src/components/Shell/TransportPillHost.tsx:151`; **only** renderer `src/components/Arrangement/SkyBand.tsx:89` | Render `transportError` in the pill itself (a `--warning-ink` dot on the button + the reason in its `title`), so the one place a performer looks is the one place it is told. |
| **HA-04** | 3, 6 | **S2** | The beginner hint asserts **"This rig is already making sound"** with no rig-existence check. On an empty canvas (zero nodes, zero cables) it still claims a rig is sounding and tells you to "press the keys" that are not there — while the Speaker meter, when there *is* a rig, reads `-∞ dB` two inches away. | `shots/w5-emptycanvas-light.json`, `shots/w5-empty-canvas-light.png`; `shots/w17-canvas-dark-1440.png` (hint vs `-∞ dB`) | `src/components/Shell/HintBubble.tsx:20` (gate is persona + dismissal only) | Gate on `nodes.size > 0` and swap the verb: *"Press a key — nothing here can break."* |
| **HA-05** | 6 empty states | **S2** | **The empty canvas has no empty state.** Delete everything (or open with a pre-answered profile) and the paper says nothing at all — no copy, no affordance, no "right-click to add". The only route out is a gesture with no on-screen twin. | `shots/w5-emptycanvas-light.json` (`nodes: 0`, body text is chrome only); `shots/w5-empty-canvas-light.png` | no zero-node branch exists in `src/components/Canvas/NodeCanvas.tsx`; the only `nodes.length === 0` test in the app is an autosave guard, `src/App.tsx:404` | One centred line + two buttons, in the language `ArrangementSurface.tsx:262-285` already uses: *"An empty canvas. Add a node — right-click, or ⌘K."* |
| **HA-06** | 3 state honesty | **S2** | Two contradicting latency claims sit **side by side in the same status cluster** on the first-run screen: the health dot's own description says *"browser engine — an honest 15–25 ms"*, and the chip 8 px to its right reads **116–132 ms** in warning ink. A number with no word next to it, in an alarm colour, is the first thing a novice's eye lands on. | `shots/w3-status-jam-light.json` (both strings captured together); `shots/w2-canvas-light-1440.png` | static claim `src/store/engineHealthStore.ts:117-120`; measured chip `src/components/Shell/LatencyChip.tsx:113,127` | Make the tier label read the measurement (`~${roundTrip} ms on this machine`), or drop the tier sentence and let the chip be the single source. |
| **HA-07** | 2 feedback | **S2** | **No user-facing verb produces a visible confirmation.** Measured across add-node, undo, Space, `Ctrl+S`, theme change and disconnect: no toast, no selection, no `aria-live` announcement — the live region never says anything but *"Canvas surface active"*. A palette add does not even **select** the card it just made, so on a busy canvas you cannot tell which one is new. | `shots/w6-verbs-light.json` (7 probes; `toasts` and `live` identical throughout; `selected: 0` after every add); `.scratch/ha/w16.log` (disconnect: `toasts: []`) | `src/components/CommandBar/useCommandSources.ts:83-91` (`addNode`'s returned id is discarded) | Select the newly added node, and announce every history-recording verb through the existing polite live region using `HistoryEntry.label` (see **HA-09**). |
| **HA-08** | 1 discoverability | **S2** | The beginner's shortcut card shows **only the first five rows** — so `Tab`, `Del`, `Ctrl+Z` and **`Ctrl+K`** are never advertised to the one persona that needs them. The app's headline discovery gesture is hidden from beginners *and* has no clickable entry point anywhere. Worse, one of the five rows a beginner does get is **false**: *"Scroll → Zoom"* — plain wheel **pans**; zoom needs Ctrl/⌘. | `shots/w2-canvas-light-1440.png` (card shows exactly 5 rows); `shots/w17-canvas-dark-1440.png` | `src/components/Toolbar/HelpPanel.tsx:29-41` (`SHORTCUTS`), `:45` (`BEGINNER_COUNT = 5`), `:36` (the false row); behaviour `src/components/Canvas/NodeCanvas.tsx:564,577` | Fix `:36` to `Ctrl+Scroll`; promote `Ctrl+K` into the beginner five; add a `⌘K` affordance to the topbar. |
| **HA-09** | 2, 4 | **S2** | **Undo is unlabelled, and the label already exists.** `HistoryEntry.label` is written by every gesture and rendered **nowhere** — the button says only "Undo (Ctrl+Z)". Consequence measured: after a failed port drag, one `Ctrl+Z` removed **all ten cables and the whole rig** with no name, no warning, no announcement. | `.scratch/ha/w16.log` ("cables after undo: 0"); `shots/w16-after-disconnect.png` | field `src/store/historyStore.ts:60,135,143,157`; button `src/components/Shell/Topbar.tsx:85-90` — grep for a renderer returns nothing | Put the label in the button's `title`/`aria-label` (*"Undo Install beat rig"*) and in the live region. Zero new state; it is already in the store. |
| **HA-10** | 5 vocabulary | **S2** | **Raw engine identifiers ship as user-facing copy in the two most-read discovery surfaces.** The palette renders the `NodeType` string as a chip on every add row — `keyboard-visual`, `container`, `add` — so it literally shows **"Add Add"**; the arrangement track header shows `karplus-nylon` / `gm-synth-drum` beside a *Choose instrument* control. Meanwhile the registry's human `description` strings exist and are never displayed. | `shots/w5-palette-light.json`, `shots/w5-palette-light.png`; `shots/w15-roll-notes.json` (`"t": "karplus-nylon"`); `shots/w11-transport-dark.json` (`gm-synth-drum`) | chip `src/components/CommandBar/CommandBar.tsx:577-581`; node named `'Add'` `src/engine/registry.ts:603`; unused copy `registry.ts:604` | Render `def.description` in the palette row instead of `def.type`; rename the `add` node to *Sum*; show the instrument's display name, not its catalogue id. |
| **HA-11** | 5 vocabulary | **S2** | Four concepts have no single word. Worst three: **Song / Arrangement / Timeline all appear inside one 56 px band**; the **AI has five names** (*the agent* / *the AI* / *Philia* / *Pi* / *the assistant*), two of them colliding inside single strings; and the plugin panel's own dialog is titled **"Browser"** while everything that opens it says *Plugins* and its search box says *sounds and effects*. Full table below. | `shots/w4-empty-light.json` + `.scratch/ha/w14.log` (`"Paper Sketch No. 1 \| Tab \| canvas \| … \| Export \| 28 bars"`); `shots/w10-esc.json` (`Plugins: opened=["Browser"]`) | `src/components/Arrangement/SkyBand.tsx:81,97,102`; `src/components/Plugins/PluginsPanel.tsx:178,181,190,217`; `src/components/CommandBar/useCommandSources.ts:332` vs `AiPanel.tsx:1120` | Pick one word per row of the vocabulary table and sweep. |
| **HA-12** | 1, 5 | **S2** | **Port colour — the legend `PRODUCT.md` §5 says a player learns in seconds — is absent exactly when it is needed.** An idle socket of every type renders identically (measured: `--audio` and `--control` wells both `fill rgb(42,40,34)`, `border rgb(128,124,111)`); the type colour appears only on `.is-connected`. So while you are choosing *where to drag*, the surface tells you nothing. Deliberate and argued at `Port.css:57-61` — I think the argument is wrong: a port's type is a property of the socket (what may be plugged in), not of the signal currently in it. | `.scratch/ha/w13d.log`; `shots/w12-ports-canvas-dark-1280.json` | `packages/oj-ui/src/components/Port/Port.css:57-70` | Tint the idle core at reduced chroma (or ring it), so the type reads before the cable exists. |
| **HA-13** | 1, 2 | **S2** | **Three dead tools with live affordances.** The arrangement's **Erase (`X`) button** is rendered and does nothing (`ArrangementSurface.tsx:372` is the only place the arrangement tool is read and it tests `=== 'draw'`); arrangement **Knife (`K`)** and **Time (`T`)** are bound keys with no behaviour and no button; the piano roll's **Knife button** is rendered and has no behaviour. A control that responds to a click by doing nothing is worse than an undiscovered gesture. | `shots/w15-roll-notes.json` (`"K"`, `aria-label "Knife tool"`, rendered and enabled); `shots/w14-arrangement-light-1280.png` (`V B X` strip) | `src/components/Arrangement/ArrangementSurface.tsx:372`; buttons `src/components/Arrangement/RulerStack.tsx:193-203`; roll `src/components/PianoRoll/PianoRoll.tsx:82,717`; bindings `src/store/keybindingsStore.ts:230-233,268` | Ship the behaviour or remove the button and the binding (code-value #8). |
| **HA-14** | 4 recoverability | **S2** | The **app error boundary is the one unprompted, un-Escapable, full-screen overlay that can fire mid-set**. It has no keydown handler at all, no ✕, no backdrop dismiss — only *Try to recover* and *Reload app* — while its own copy admits *"Your audio may still be playing."* Everything else that blocks is boot-gated (Safe Mode) or user-opened. | `src/components/AppErrorBoundary.tsx:64-82` read in full; overlay inventory `shots/w10-esc.json` | `src/components/AppErrorBoundary.tsx:64` (`role="alertdialog"`, no listener); mounted `src/main.tsx:43` | Add Escape → *Try to recover*, and let the card collapse to a corner chip so the patch stays visible while the show goes on. |
| **HA-15** | 4 recoverability | **S2** | **Native `prompt()` and `confirm()` still ship** in the project-create path — blocking the main thread, un-Escapable by app code, and directly contradicting the rule the codebase itself writes down two files away (*"Never a native `confirm()` … rips the keyboard away from an instrument that may be sounding"*). | code read; not reachable headlessly without the File System Access picker | `src/store/projectStore.ts:516,526`; the rule it breaks: `src/components/Shell/confirmFocus.ts:5-9`, `src/components/Shell/AppMenuBar.tsx:30-33` | Reuse the inline `role="alertdialog"` confirm pattern `AppMenuBar.tsx:428-462` already implements. |
| **HA-16** | 5, 3 | **S2** | The Instrument faceplate — the second card in every preset rig — opens with **"Playing. Note, octave and offset appear when a Keyboard node's row bundle arrives."** The first word is false (nothing is playing) and *"row bundle"* is internal vocabulary, on the first card a stranger reads. | `shots/w2-canvas-light-1440.png`, `shots/w8-beat-dark-1280.png`, `shots/w17-canvas-dark-1440.png` — visible in all three rigs, both themes | `src/components/Nodes/InstrumentNode.tsx:534-535`; `src/components/Nodes/InstrumentVisualNode.tsx:174` | *"Connected — play the keys. Per-row tuning appears when a Keyboard's rows arrive as a group."* |
| **HA-17** | 2 feedback | **S3** | The palette cascade (FINAL-REVIEW §2 #1) **landed**, and half the problem survived: occupancy is tested on node **positions within 14 px**, not on card **bounds**, and `desired` is the viewport centre — which is exactly where the rig already is. Measured: three palette adds landed at (720,496) → (747,523) → (773,549), each ~88 % occluding the last and the whole pile sitting on top of the Instrument/Effect/Speaker chain, with the 477×381 Library card running off the bottom of a 900 px viewport. | `shots/w6-rects-3adds-light.json`; `shots/w6-after-3adds-light.png` | `src/utils/spawnPlacement.ts:47-52` (`OCCUPIED_RADIUS = 14`, point test); caller `src/components/CommandBar/useCommandSources.ts:90` | Test the candidate **rectangle** against sibling rectangles, and clamp the result inside the viewport. The cascade shape is right; the occupancy test is what needs to change. |
| **HA-18** | 8, 1 | **S3** | **The inline piano roll opens at the arrangement's zoom, where a half-beat note is 4.8 × 6.2 px** — and `resizeEdge` returns `null` for anything ≤ 10 px wide, so at the default zoom a note **cannot be trimmed at all**, only moved. The only way to zoom the roll is `Ctrl+wheel`, which is advertised nowhere on the surface. | `.scratch/ha/w15.log` (all 129 notes exactly `4.8 × 6.2`; after one `Ctrl+wheel`: `10.8`); `shots/w14-inline-roll-light-1280.png` | `src/components/PianoRoll/geometry.ts:152-159` (`if (width <= 10) return null`); zoom `src/components/PianoRoll/PianoRollSurfaceHost.tsx:54-65` | Give the inline roll a minimum note width (or its own opening zoom), and put the zoom on the roll's own control strip. |
| **HA-19** | 8 cold hands | **S3** | Sub-24 px targets on the paths that matter: **ports 15–17 px** (the most-repeated gesture in the app), the **latency chip 61×23** with a **19×18 Dismiss**, the arrangement tool strip **26×22**, grid chip **67×22**, snap/follow **22×22**, track reorder handle **12×19**, track colour swatch **14×14**. And `Knob` — the app's primary continuous control — has **no `title` attribute anywhere in the file**, so its Shift-fine, double-click-reset and focused-wheel behaviours are undiscoverable by any means. | `shots/w2-inv-canvas-light-1440.json`, `shots/w4-inv-papersketch-light.json`, `.scratch/ha/w13d.log`; `shots/w9-knobs-light.json` | `packages/oj-ui/oj-tokens.css:25` (`--port-size: 18px`); `packages/oj-ui/src/components/Knob/Knob.tsx` (0 occurrences of `title=`); `src/components/Shell/LatencyChip.tsx:118-129` | Add an invisible ≥24 px hit pad around ports and 22 px chrome buttons; give `Knob` one `title` naming drag · Shift · double-click. |
| **HA-20** | 2, 3 | **S3** | An **`aria-live="assertive"` region permanently contains the words "Recording stopped"** whenever the arrangement is mounted and nothing is recording — so a screen-reader user is interrupted with a false event every time they enter the surface. Confirmed present in the band's own text on a document that has never recorded. | `.scratch/ha/w14.log` (sky-band text ends `… \| 28 bars \| Recording stopped`); `shots/w11-transport-dark.json` (`live: ["Recording stopped", …]` at t+400 ms) | `src/components/Arrangement/SkyBand.tsx:111` | Render the region **empty** at rest and write into it only on a transition; `assertive` is also the wrong level for a status. |
| **HA-21** | brand / taste | **S3** | The canvas right-click menu — the only discoverable twin for *add a node* — is the one surface in the instrument that uses **emoji**: `⌨️ 🎻 🔄 ✨ 🔧 🔊`. Its own comment says they are kept to stay *"byte-faithful"* to the pre-redesign UI, i.e. they were never re-decided under the New DNA. `PRODUCT.md` lists "a toy" as an explicit anti-reference. | `.scratch/ha/w16.log`; `shots/w16-context-menu.png` | `src/components/Canvas/ContextMenu.tsx:63-75` | Replace with the six oj-ui category glyphs, or drop icons entirely — the labels carry it. |
| **HA-22** | 1, 5 | **S3** | With the inline roll open, **two identical `V B X` tool strips are on screen at once** meaning different things (arrangement tools in the ruler corner, roll tools in the roll) — and the arrangement's `X` is one of the dead tools from **HA-13**. Nothing distinguishes them. | `shots/w14-inline-roll-light-1280.png` (both strips visible); `shots/w15-roll-notes.json` (two `Select tool` / `Draw tool` / `Erase tool` triples) | `src/components/Arrangement/RulerStack.tsx:193-203` and `src/components/PianoRoll/PianoRoll.tsx:716-731` | Scope-label the roll's strip, or hide the arrangement's while a roll is open. |
| **HA-23** | 4 recoverability | **S3** | Three inline confirms do not handle Escape, so Escape falls through to the modal underneath: **"Reset every shortcut?"** and the shortcut-conflict prompt both close **all of Settings**; the Updates roll-back confirm and the AI YOLO confirm are the same shape. The other four inline confirms in the app *do* handle it. | overlay sweep `shots/w10-esc.json` (the five top-level overlays all clear); confirms read in source | `src/components/Settings/KeybindingsPanel.tsx:332-360,443` (no `onKeyDown`); `src/components/Settings/UpdatesPanel.tsx:402-425`; `src/components/CommandBar/AiPanel.tsx:1074-1099`; the pattern that works: `src/components/Shell/AppMenuBar.tsx:436-441` | Copy the `AppMenuBar` handler into the three. |
| **HA-24** | 6 first run | **S3** | Escaping or skipping the first run writes `exp: 'some'`, which **silently withholds the beginner scaffolding from the person most likely to skip**: the open shortcut card and the "nothing can break" hint both require `exp === 'first'`. Measured: `Escape` on question 1 stored `{"exp":"some","goal":"jam","theme":"light"}` and the canvas came up with neither. Deliberate and argued (`onboardingStore.ts:41-45`); the argument optimises for the impatient pro and pays with the nervous novice. | `shots/w1-after-escape.json`; `shots/w1-02-after-escape.png` | `src/store/onboardingStore.ts:41-47`; consumers `src/components/Shell/HintBubble.tsx:20`, `src/components/Toolbar/HelpPanel.tsx:60` | Show the shortcut card for `some` too (it is dismissible): a pro closes it once, a novice keeps a lifeline. |
| **HA-25** | 2, 3 | **S3** | Disabled controls do not say **why**, breaking the app's own good pattern. The roll's **Quantize** is disabled with `title="Quantize the selected notes"` — no mention that nothing is selected — while the transport's Record gets it right (*"Arm a track first — open the arrangement with Tab"*). The **Drums** toggle beside it has no `aria-label`, no `title` and no pressed state. | `shots/w15-roll-notes.json` (`{"t":"Quantize","d":true,"title":"Quantize the selected notes"}`, `{"t":"Drums","title":"","al":null}`) | `src/components/PianoRoll/PianoRoll.tsx:736`, `:677`; the good pattern `src/components/Shell/TransportPillHost.tsx:225` | Make every disabled control's `title` the *reason*; give `Drums` `aria-pressed` + a name. |
| **HA-26** | 1, 4 | **S3** | **There is no context menu on the arrangement, on the piano roll, or on a node** — right-click on a node is explicitly suppressed. And the one context menu that exists carries **no verbs at all**: six add-node categories and *Cancel*. So delete, copy, paste, duplicate and select-all have no pointer route anywhere in the app. | `shots/w16-context-menu.png` (text: `ADD NODE · Input · Instruments · Routing · Effects · Utility · Output · Cancel`) | suppression `src/components/Canvas/NodeCanvas.tsx:280-283`; menu contents `src/components/Canvas/ContextMenu.tsx:203-207`; absent handlers: no `onContextMenu` anywhere under `src/components/Arrangement/` | Add the six Edit verbs to the canvas menu, and give clips/notes/tracks a menu of their own. |
| **HA-27** | 3, 6 | **S3** | The offline reassurance — the sentence that matters most to a performer on a stage with no Wi-Fi — lives **only in a `title` attribute**: the chip says `Offline`, and *"You are offline — everything still works"* appears on hover only. Invisible on touch and to anyone not hunting. | `src/components/Shell/Topbar.tsx:110-111` read in source; the chip is state-driven and not reproducible headlessly | `src/components/Shell/Topbar.tsx:110-111` | Put the four words in the chip the first time it appears, then let it shrink. |
| **HA-28** | 5 | **S4** | The node type chip — one repeated slot on every faceplate — carries **four different kinds of information**: a category (`INSTRUMENT`), a plural category (`EFFECTS`), an abbreviation (`OUT` on Speaker) and a **live mode state** (`MODE 2` on Keys). The one slot the eye learns first does not mean one thing. | `shots/w2-canvas-light-1440.png`, `shots/w17-canvas-dark-1440.png` (all four visible at once) | `packages/oj-ui/src/components/NodeShell/NodeShell.tsx:62`; `src/components/Nodes/SpeakerNode.tsx`, `src/components/Nodes/KeyboardVisualNode.tsx` | Reserve the chip for the category; move `MODE 2` to its own state pip. |
| **HA-29** | 8 | **S4** | Two persistent overlays **cover the rig at both audit widths**: the keyboard help card sits on the Speaker faceplate and the hint bubble on the bottom-left of the patch, at 1440×900 and 1280×800 alike. Neither can be moved, only closed. | `shots/w2-canvas-light-1440.png`, `shots/w17-canvas-dark-1440.png`, `shots/w8-beat-dark-1280.png` | `src/components/Toolbar/HelpPanel.tsx:97`; `src/components/Shell/HintBubble.tsx:15` | Reserve their corners in the rig-layout pass, or let the rig place itself clear of them. |
| **HA-30** | 6 | **S4** | Three empty states in node faceplates are purely descriptive and name no next action: *"Nothing arranged yet."* (Song), *"No inputs yet" / "No outputs yet"* (Ports panel), *"no ports published"* (Container) — even where the affordance is right there (`Open arrangement ⟨E⟩`). Roughly two thirds of the app's empty states *do* name an imperative; the misses cluster on faceplates. | source read across the empty-state inventory | `src/components/Nodes/SongNode.tsx:86`; `src/components/Nodes/PortPanelNode.tsx:70,78`; `src/components/Nodes/ContainerNode.tsx:156` | One imperative each: *"Nothing arranged yet — press E to open the arrangement."* |

**Counts: S1 × 3, S2 × 13** (S3 × 11, S4 × 3).

---

## Per-dimension detail

### 1 · Hidden gestures with no visible twin

The full enumeration is the [table below](#hidden-gestures-without-twins). The shape of the
problem:

- **The canvas is the worst-covered surface.** Its five core gestures — drag-to-connect,
  click-a-cable-then-`Delete`, two-click connect, header-drag to move, Shift-header to add
  to a selection — have **zero** twins between them: no tooltip, no menu item, no palette
  entry. `DESIGN.md:746` records `cursor: crosshair` as the affordance for the first, and
  that is the whole of it.
- **The arrangement is the worst-covered *grammar*.** Every selection modifier
  (`Alt` = object marquee, `Shift` = extend, `Ctrl` = toggle,
  `ArrangementSurface.tsx:404-406`) and every clip-drag modifier (`Shift` axis-lock,
  `Alt` copy, `Alt+Shift` relative, `Ctrl` snap-invert, `Ctrl+Shift` slip,
  `useClipGesture.ts:86-106,182,199`) is undiscoverable. Twelve modifiers, no twin.
- **Where twins exist they are excellent.** The metronome long-press is the model:
  `TransportPill.tsx:359` names it in the `title` (*"hold or right-click for count-in"*),
  offers `aria-haspopup="menu"`, and gives `ArrowDown` as a keyboard route. Section-chip
  rename (`RulerStack.tsx:276`, one `title` teaching three gestures) and the roll's Quantize
  (three twins) are the same quality. The gap is not skill; it is that only some surfaces
  got the pass.
- **Two taught gestures are wrong in the product.** `HelpPanel.tsx:36` teaches
  *"Scroll → Zoom"* when plain wheel pans (**HA-08**); `docs/timeline.md:115` says `M` opens
  the mixer when `M` is the metronome and the mixer has no key at all.

### 2 · Feedback for every verb

Measured with seven probes across one session (`shots/w6-verbs-light.json`):

| verb | within the frame | audible | honest? |
|---|---|---|---|
| add node (palette) | card appears — possibly under another (**HA-17**), not selected, not announced | no | **no** |
| add node (right-click) | same, at the clicked point — the point *is* the feedback | no | ok |
| connect | cable draws | yes (later) | ok |
| disconnect | cable disappears; nothing else | yes | thin |
| delete | node disappears | yes | thin |
| undo / redo | graph changes; **nothing names what changed** (**HA-09**) | yes | **no** |
| play / stop | pill glyph — **except when the engine does not confirm** (**HA-03**) | yes | **no** |
| record | pill dot + lane ring + `aria-live`; best-covered verb in the app | yes | yes |
| save (`Ctrl+S`) | **nothing at all** in the browser tier | — | **no** |
| theme change | instant repaint; no announcement | — | ok |
| mute / solo | button state | yes | ok |
| quantize | notes move | yes | ok |
| plugin scan | folder count + honest empty state (`PluginsPanel.tsx:169-171`) | — | yes |
| install rig | the whole canvas fills | yes | yes |
| agent apply | live graph edits, undoable with plain `Ctrl+Z` — correct per `agents.md`, and honestly disabled on the browser tier (`CommandBar.tsx:611`) | yes | yes |

**Does the visible cue tell you sound is happening?** Partly. The master meter
(`Shell/masterSignal.ts`, dB-scaled) and the track level bead are genuinely good. But the
one screen every new player sees pairs a `-∞ dB` meter with a sentence claiming the rig *is
already making sound* (**HA-04**) — so the app's most prominent audio claim is the one thing
on screen the meter contradicts.

### 3 · State honesty

| question | answered? | where |
|---|---|---|
| is the transport rolling | **not when the engine stalls** — **HA-03** | pill glyph, `TransportPillHost.tsx:151` |
| what does Space do *right now* | **yes, and well.** The keycap appears only where Space is really bound (`TransportPillHost.tsx:166-169`). Verified live: absent on the canvas in mode 2, present on the arrangement. The argument at `:161-165` — *"an advertised key that does nothing is worse than no hint"* — is right and I would keep it. Its cost, which FINAL-REVIEW named, is real: the pill loses its only keyboard affordance the instant a rig lands. The fix is not to re-add the lying keycap; it is to give the pill a *different true* hint in mode 2 (`1` returns Space to the transport). | |
| which surface has focus | yes — segmented switcher + a polite `aria-live` "Canvas surface active" | `SurfaceSwitcher.tsx` |
| is the engine healthy | yes — dot + word, and IDLE is deliberately not an alarm | `engineHealthStore.ts:122-131` |
| which latency tier | **two contradicting answers, adjacent** — **HA-06** | |
| is there unsaved work | **no.** Nothing on screen distinguishes saved from dirty, and `Ctrl+S` is silent (**HA-07**) | `Topbar.tsx:105` shows only the project *name* |
| which node is selected | yes on the canvas; **not after an add** (**HA-07**) | |
| what the agent is about to change | by design, nothing — it emits reversible verbs and the canvas *is* the preview. Correct per `agents.md`. | |

### 4 · Recoverability

- **Esc reach is genuinely good at the top level.** All five overlays I could open closed on
  one Escape: Settings, command palette, Audio health, DevLog, Plugins
  (`shots/w10-esc.json`). The shared `Modal` primitive
  (`packages/oj-ui/src/components/Modal/Modal.tsx:74-78`) is doing real work.
- **It breaks one level down** — three inline confirms fall through and close the modal
  beneath them (**HA-23**).
- **Undo reach** is broad — graph, arrangement, document and library on one spine — but
  **unlabelled** (**HA-09**). Two things sit outside it by design and say so: opening a
  document clears the log, and `{ record: false }` writes stay out. What is *not* undoable
  and *not* written down: theme change, panel opens, tool selection, the onboarding answers.
  None of those need to be undoable; one line in `docs/shell.md` would close the question the
  way the port paragraph tries to.
- **No modal blocks mid-set except one** — the error boundary (**HA-14**) — plus two native
  dialogs in the project path (**HA-15**). Safe Mode is boot-gated and cannot fire mid-set.
  The latency chip is correctly a chip rather than the banner it used to be, and its popover
  is non-blocking.
- **Device loss / context suspension:** the cold-start case is well covered (attention pulse,
  IDLE dot, and the Audio-health panel's *"Press play once and this fills in"*). The *loss*
  case funnels into **HA-03** — the report exists and lands on the wrong surface.

### 5 · Vocabulary

See the [vocabulary table](#vocabulary-table). Two structural notes beyond the words:

- **The connection has no name at all.** There is no `aria-label`, `title` or button text for
  a cable anywhere in `src/components` — the object a player drags every minute is unnamed to
  assistive technology. In prose it is a *cable*; the verb is *wire* in three places and
  *connect* in five.
- **`agents.md:168` documents a port type that does not exist.** The shipping union is
  `'audio' | 'control' | 'universal'` (`src/engine/types.ts:12`); `'technical'` was retired
  and is actively migrated away (`graphStore.ts:1969-1974`). The covenant loads every session
  and teaches a dead name. (FINAL-REVIEW §6 flagged it; still true.)

### 6 · Empty states and first run

Two thirds of the app's empty states name an imperative, and the best of them —
`ArrangementSurface.tsx:262-285` — is the model: a headline (*"An empty page."*), a sentence
that also teaches recovery (*"Ctrl+Z undoes anything"*), five ranked actions, and a ghosted
preview of the surface behind them. Verified live (`shots/w4-empty-light.json`).

Against that bar:

- **The empty canvas has none at all** (**HA-05**) — the worst gap, because it is the screen a
  player reaches by deleting their work, and it is where the beginner hint is simultaneously
  claiming a rig is playing (**HA-04**).
- **"No MIDI device" does not exist** — the section simply unmounts
  (`src/components/MIDI/MIDIDeviceBrowser.tsx:194`); nothing says *plug in a controller*. The
  *preset*-search empty state right beside it is excellent, which makes the absence read as
  an oversight rather than a decision.
- **"No plugin folders are configured yet"** (`PluginsPanel.tsx:172`) names a problem with no
  route to the setting — the weakest of the panel's three, whose siblings are both good.
- **The empty roll clip** says *"press B, then draw."* — correct content, but lowercase,
  unpunctuated, no `Kbd`, no button: typographically unlike every sibling
  (`PianoRoll.tsx:789`).
- **First run itself is strong.** Three questions, one tap each, number keys, live theme
  preview, a real focus trap, and the finishing tap doubles as the audio unlock. The keyboard
  path works end to end (`1` `1` `1` completed it and installed the rig, `.scratch/ha/w7.log`).
  Its two costs are **HA-24**, and that the first thing it hands you is a canvas with a
  warning chip on it (**HA-06**).

### 7 · Keyboard-only session, end to end

| step | result |
|---|---|
| complete onboarding | **works** — `1` `1` `1`; focus lands on the first option of each step |
| add a node | **works** — `Ctrl+K`, type, `Enter`. But the new card is not selected and nothing is announced (**HA-07**) |
| **connect it** | **DEAD END.** 42/42 ports have no role, no name, no tab stop (**HA-02**). There is no alternative route: no palette command connects two nodes, no menu item does, and the agent — the documented fallback — is desktop-only |
| **reach any canvas control at all** | **DEAD END.** `F6`, `Enter`, arrows, and forward `Tab` from the topbar all fail (**HA-01**). Knobs are correct (`role="slider"`, `tabindex="0"`; `ArrowUp` moved `FREQUENCY` 900 → 964) and unreachable without a mouse |
| play | works where Space is bound; the pill can lie about the result (**HA-03**) |
| open the roll | **works** — `Tab` to the arrangement, then `E`/`Enter` on a clip |
| edit a note | reachable (roving tabindex landed) but 4.8 px wide and un-trimmable at the opening zoom (**HA-18**) |
| undo | works, unlabelled (**HA-09**) |
| save | works, silent (**HA-07**) |
| both themes | no difference in any of the above |
| `prefers-reduced-motion: reduce` | clean — see *cleared* |

The two-cycle on forward `Tab` is deliberate and documented (`arbiter.ts:24-28`). **I do not
accept the argument as it stands**, because the escape hatch it depends on does not exist:
`docs/shell.md:80-82` says a forward Tab from the topbar lands inside the active surface, and
it does not (**HA-01**). With that route restored the two-cycle is defensible; without it the
canvas is mouse-only, and `PRODUCT.md` calls keyboard reach "first-class and non-negotiable".

`docs/shell.md:64-69` asks, honestly, for a product decision on port tabbability. **HA-01**
forces it: with no route into the surface at all, "deliberately out of the tab order" is no
longer an available answer.

### 8 · Cold hands, dim stage

- **Contrast: clean.** Measured with real colour resolution (canvas-2D `oklch` → sRGB) and
  full alpha compositing of the ancestor background chain: **zero** text below its WCAG floor
  on the dark beat-rig canvas at 1280×800 (`.scratch/ha/w13d.log`). Port wells clear the 3:1
  non-text floor at **3.96:1**.
- **Type:** nothing interactive under 13 px except the key-tile labels (11 px) and their note
  hints (9 px) — which are content on an instrument face, not UI, and are monospace and
  high-contrast. The 9.5 px port-row labels (`ROW 1`) are the one I would look at on real
  hardware at real distance.
- **Hit targets:** the sub-24 px list is **HA-19**. The one that matters most is the port,
  because it is both the smallest *and* the most repeated.
- **Precision drags with no keyboard alternative:** the ruler scrub, the loop/punch brace
  drag, the lane-height separator (`role="separator"`, `tabIndex=0`, and **no key handler** —
  `TrackLaneView.tsx:214`), the automation point drag, and every port drag.

---

## Vocabulary table

One row per concept; "shown" lists only strings a user actually reads.

| concept | words actually shown | verdict |
|---|---|---|
| the timeline document | **Song** (`registry.ts:734`, `SkyBand.tsx:97`, `keybindingsStore.ts:64,220-222`) · **Arrangement** (`SurfaceSwitcher.tsx:23`, `SkyBand.tsx:81`, `SongNode.tsx:99`, ~40 keymap labels) · **Timeline** (`SkyBand.tsx:102`, `keybindingsStore.ts:218-219`) · **Project** (`Topbar.tsx:105`, `AppMenuBar.tsx:298-326`) | **4-way.** `SkyBand.tsx:81/97/102` puts three of them in one 56 px band. **`Song` = the document, `Arrangement` = the surface; retire *Timeline* from labels.** |
| the patch | **Canvas** (`SurfaceSwitcher.tsx:22`, `AppMenuBar.tsx:333`) · **Workflow** (`AppMenuBar.tsx:339,343`) · **Patch** (`SettingsPanel.tsx:171`) · **Rig** (`Onboarding.tsx:60`, `HintBubble.tsx:25`, `SettingsPanel.tsx:172`) · **Setup** (`SettingsPanel.tsx:169`) | **5-way**, two of them in one sentence (`SettingsPanel.tsx:171-172`). **`Canvas` = the surface, `Rig` = what is on it; `Workflow` is the file format and should never be a menu verb.** |
| the sound-maker | **Instrument** (`registry.ts:115`, `InstrumentNode.tsx:595`) · **Voice** (`InstrumentNode.tsx:518,605`) · **Sounds** (`PluginsPanel.tsx:190,217`) | **3-way inside one card** — `:595` searches *instruments*, `:605` picks a *voice*. **`Instrument`.** |
| clip | **Clip** everywhere · **Region** in 3 waveform-editor labels (`AudioClipVisual.tsx:164`, `WaveformEditorModal.tsx:634`, `WaveformView.tsx:64`) | near-consistent; *Region* reads as a synonym to the Pro-Tools audience. **`Clip`.** |
| track | **Track** everywhere · **Lane** leaks once (`TrackLaneView.tsx:214`) · **Strip** in the mixer (`MixerDrawer.tsx:51,117`) | **consistent + one leak.** |
| back to zero | **Return to where playback started** (`TransportPill.tsx:415`) · **Return to start** (`:477-478`) — two buttons a centimetre apart · `RewindGlyph` (`:132`) whose *word* belongs to the AI panel (`AiPanel.tsx:739`) · **Go to Song Start** in the keymap (`keybindingsStore.ts:221`) | **4-way.** **Say `Return to start` on both buttons; let the armed one add "— where playback started".** |
| adding a thing | **Add** (dominant) · **Use / Insert** — *the same button*, per open-context (`Plugins/browserModel.ts:11`) · **Create** · **New** · **Install** (correctly reserved for OS-level things) | **5-way**, plus `registry.ts:603` names a node `Add`, so the palette shows **"Add Add"** (**HA-10**). **`Add` for graph objects, `New` for documents.** |
| node | **Node** everywhere · **card** leaks once (`LooperNode.tsx:1367`); `DESIGN.md` says *card*, the product says *node* | **consistent to users.** |
| the connection | *cable* in prose (`AppMenuBar.tsx:158`, `MIDINode.tsx:179`) · verb split *wire* (`LibraryNode.tsx:1567`, `SamplerNode.tsx:554`) / *connect* (5 sites) · **no label on the object itself, anywhere** | **name it `cable`, label it, and pick `connect` as the verb.** |
| port | words consistent (*In* / *Out*); **case split** — `SamplerNode.tsx:561` `'Out'` vs `InstrumentNode.tsx:529` `'OUT'` on adjacent cards. The `IN`/`AUDIO` split FINAL-REVIEW found is **fixed** | **one case rule.** |
| plugin | the panel is titled **Browser** (`PluginsPanel.tsx:178,181`), opened by **Plugins** (`useCommandSources.ts:269`), searched as **sounds and effects** (`:190`), and everything inside says **plugins** — `:190` contradicts itself on one line (`aria-label="Search plugins"` + `placeholder="Search sounds and effects…"`) | **4-way. `Plugins`.** |
| library / browser | **Library** = the canvas file node · **Browser** = the plugin panel *and* the MIDI picker *and* Chrome (`LibraryNode.tsx:1624`) | **"Browser" is overloaded three ways.** |
| silencing | Mute · Solo · Bypass (plugins, correctly) · Disarm · **Silence every layer ↔ Unmute every layer** — one toggle, two verbs (`LooperNode.tsx:1141,1146`) · **Hold all sound** (`TransportPillHost.tsx:216`) | **mostly clean; fix the Looper toggle.** |
| the AI | **the agent** · **the AI** · **Philia** · **Pi** · **the assistant** — colliding in-string: *"AI: Turn Philia memory on"* (`useCommandSources.ts:332`) vs *"The agent … drives Pi"* (`AiPanel.tsx:1120`). Bonus: `AiPanel.tsx:927-928` hardcodes **⌘K** on every platform while `AppMenuBar.tsx:280` computes it | **5-way, the worst in the app. One name.** |

---

## Hidden gestures without twins

A twin means a *clickable or listed* route, not a Settings entry. Every keyboard action is
rebindable and searchable in Settings → Keybindings, which is a real safety net but is not
discovery.

| gesture | file:line | twin |
|---|---|---|
| **drag a port to connect** | `src/components/Nodes/NodeWrapper.tsx:644` → `:249-280` | **none** — `cursor: crosshair` only |
| **two-click connect** (release on the origin does not cancel) | `NodeWrapper.tsx:294-297` | **none — advertised nowhere** |
| **click a cable → `Delete`** (the only pointer route to disconnect other than dragging off a port) | `packages/oj-ui/src/components/Cable/Cable.tsx:89` → `NodeCanvas.tsx:1266` | **none** |
| Ctrl + marquee = port multi-select | `NodeCanvas.tsx:309,428-448` | **none** |
| right-drag = pan | `NodeCanvas.tsx:275-284` | none (`Alt+Drag` has a help row) |
| plain wheel = pan | `NodeCanvas.tsx:577` | **none — and the help card teaches the opposite** (`HelpPanel.tsx:36`) |
| node header drag; **Shift** = additive select | `NodeWrapper.tsx:175-182,669` | **none** |
| 8-way resize grips; panel separator | `common/ResizeHandles.tsx:70`; `common/PanelSeparator.tsx:46` | **none** — CSS cursor only |
| **Knob**: drag · **Shift** fine · **double-click** reset · focused wheel | `Knob/Knob.tsx:150,192,295,323` | **none** — no `title` in the file at all |
| tempo drag **Shift**/**Alt**; tempo arrow keys | `TransportPill.tsx:191,263` | partial — the `title` stops at "drag / double-click" |
| arrangement selection modifiers: **Alt** object marquee · **Shift** extend · **Ctrl** toggle | `ArrangementSurface.tsx:404-406` | **none (×3)** |
| clip-drag modifiers: **Shift** axis · **Alt** copy · **Alt+Shift** relative · **Ctrl** snap-invert · **Ctrl+Shift** slip | `useClipGesture.ts:92,199,98,99,182` | **none (×5)** |
| lane resize **Alt** = all lanes; **double-click** = default height; track-name **double-click** rename | `TrackLaneView.tsx:214,137` | **none (×3)** |
| loop/punch brace creation by dragging the braces row (**Alt** = punch) | `RulerStack.tsx:296` | **none** |
| ruler scrub | `RulerStack.tsx:228-247` | **none** |
| **double-click a MIDI clip** → piano roll | `TrackLaneView.tsx:189` | **none in the UI** (docs only) |
| automation: **double-click** add point · **Shift+drag** range | `AutomationLaneView.tsx:63,69` | **none (×2)** |
| roll: field **double-click** draw · **Ctrl+drag** draw · **Ctrl** copy-drag · **Shift** absolute resize · key-bed audition · **Alt** velocity ramp · **Ctrl+wheel** zoom | `PianoRoll.tsx:703,476,334,361,753,878`; `PianoRollSurfaceHost.tsx:58` | **none (×7)** |
| canvas clip **double-click** → waveform editor | `AudioClipVisual.tsx:62` | **none** |
| `Ctrl+K` | `keybindingsStore.ts:136` | **no clickable entry point in the app**, and hidden from beginners (**HA-08**) |
| clipboard + selection verbs (`Ctrl+C/V/D/A`), all nudges, split `S`, `End`, marker traversal, spatial selection, mute-clips `0`, the roll's 16-key step keybed | `keybindingsStore.ts:132-133,144-145,152-163,193-204,241-261,272-287` | **none** — and there is no context menu on the arrangement, the roll or a node (**HA-26**) |
| **`E` in / `Q` out** | `keybindingsStore.ts:141-142` | **yes, and well** — `SongNode.tsx:90-100` *"Open arrangement ⟨E⟩"*, `ContainerNode.tsx:159-166`, breadcrumbs `Breadcrumbs.tsx:60` |
| **`Tab` between surfaces** | `keybindingsStore.ts:134` | **yes** — the switcher renders the live keycap (`SurfaceSwitcher.tsx:167-182`) |
| **metronome long-press → count-in** | `TransportPill.tsx:343-368` | **yes — the best in the repo**: `title`, `aria-haspopup`, and an `ArrowDown` keyboard route |
| **section-chip rename / Alt+double-click marker** | `RulerStack.tsx:207-227` | **yes** — one `title` teaches all three (`:276`) |
| **quantize** | `keybindingsStore.ts:262` | **yes ×3** — roll button, lane menu, palette |
| **grid coarser/finer `[` `]`** | `keybindingsStore.ts:225-226` | **yes** — the grid chip's `title` names both keys |
| **tool select/draw/erase** on both surfaces | `keybindingsStore.ts:229-231,265-267` | **yes** — `V B X` strips … but two of them are on screen at once meaning different things (**HA-22**) and one is dead (**HA-13**) |

---

## Checked and cleared

Things I expected to be wrong and measured as fine. Each was verified, not assumed.

1. **The drum-mode heuristic is fixed.** FINAL-REVIEW §2 #2's `pitches.size <= 16 && every
   pitch in [35,81]` is gone; `shouldAutoDetectDrums` now requires a real kit signal and ties
   go to melodic (`src/components/PianoRoll/geometry.ts:137-150`). Verified live: the
   starter's "Nylon Chords" opens as **Pitched notes** with a `C5 / C4` gutter
   (`shots/w14-roll-light.json`, `shots/w14-inline-roll-light-1280.png`).
2. **The roll is no longer a tab trap.** 129 notes, **1** tabbable (`shots/w14-roll-light.json`).
   The aria labels are still excellent: *"A3, tick 0, duration 480, velocity 64"*.
3. **The palette no longer stacks on one point** — `src/utils/spawnPlacement.ts` landed and
   cascades by 28 px. What it did not fix is **HA-17**.
4. **Reduced motion: pass.** `document.getAnimations({subtree:true})` filtered to
   `playState === 'running'` returned **`[]`** on first-run onboarding, on the canvas with the
   beat rig installed, and on the arrangement, at 1280×800 (`.scratch/ha/w17.log`).
5. **Contrast: pass.** Zero text below its WCAG floor, measured with `oklch` resolution and
   full alpha compositing (`.scratch/ha/w13d.log`). My first pass reported three failures at
   1.01–1.28:1 — that was **my** bug (regex-parsing `oklch()` as RGB), not the app's. Port
   wells: 3.96:1 against the card, clearing the 3:1 non-text floor.
6. **Escape closes every top-level overlay** — Settings, command palette, Audio health,
   DevLog, Plugins, all on one press (`shots/w10-esc.json`). The breakage is one level down
   (**HA-23**).
7. **The `-6.0` I saw inside the third onboarding option is not a leak** — it is inside an
   `aria-hidden` glyph illustrating a dense fader readout (`Onboarding.tsx:244` →
   `Onboarding/glyphs.tsx`). It never reaches the accessible name.
8. **The Instrument and Effect cards in the jam rig are not occluding each other** — they
   overlap by exactly **4 px**, and the sentence that looks clipped is inside its own card
   (`shots/w3-rects-jam-light-1440.json`). The rig layout is sound; the *palette* layout is
   not (**HA-17**).
9. **The `IN`/`AUDIO` port-name split is fixed.** All four faceplates in the jam rig now read
   `IN` / `OUT` (`shots/w2-canvas-light-1440.png`). Only the *case* split survives (see the
   vocabulary table).
10. **The `space` keycap's conditional appearance is right.** Verified present on the
    arrangement and absent on the canvas in mode 2. The argument at
    `TransportPillHost.tsx:161-165` holds — see dimension 3 for the follow-up I would ship
    instead of reverting it.
11. **The empty-Song state is the best copy in the app** and I could not fault it — headline,
    imperative, five ranked actions, a ghosted preview, and it teaches `Ctrl+Z` in passing
    (`ArrangementSurface.tsx:262-285`, `shots/w4-empty-light.json`).
12. **The meter is honest.** dB-scaled, `__master__` while conducting and the loudest speaker
    otherwise (`Shell/masterSignal.ts`) — a quiet held note is visible, where a linear bar
    would have hidden it.
13. **There is exactly one focus ring** across every stop I walked, on both themes — the
    single visual language `PRODUCT.md` promises a keyboard player.

---

## The top ten I would ship first, and why

1. **HA-01 — restore a forward-`Tab` route into a surface.** Everything else in the keyboard
   story is downstream of it, and `PRODUCT.md` calls keyboard reach non-negotiable. Small:
   one condition in `arbiter.ts`.
2. **HA-04 + HA-05 — the empty canvas.** One gate and one empty state. The cheapest fix on the
   list, and it removes the app's most confident false statement.
3. **HA-02 — name the port.** `role` + `aria-label` + `title` + one roving tab stop. The
   `title` alone gives the app's most-used gesture its first twin ever; the rest unblocks a
   whole class of player, and it settles the open question `docs/shell.md:64-69` asks.
4. **HA-03 — put the transport error on the pill.** The pill is documented as the one place a
   performer looks; today a stalled engine reports itself on a surface they are not on, and
   the button labelled *Play* stops the song.
5. **HA-07 + HA-09 — select the new node, and say what undo undid.** Both are near-free
   (`addNode` already returns the id; `HistoryEntry.label` is already written) and together
   they answer the two commonest questions in the app: *did that work* and *what did I just
   lose*.
6. **HA-08 — fix the false help row and put `Ctrl+K` in the beginner five.** A one-word
   correction plus one array reorder, on the only teaching surface a novice is given.
7. **HA-10 — stop shipping engine ids as copy.** Swap `def.type` for `def.description` in the
   palette, rename the `add` node, show instrument display names. "Add Add" is the single most
   embarrassing string in a product whose brand word is *crafted*.
8. **HA-13 — kill or ship the three dead tools.** A button that does nothing when clicked
   teaches a player that the instrument is unreliable, which is the one thing it cannot
   afford. Code-value #8 says the same.
9. **HA-14 + HA-15 — no un-Escapable overlay, no native dialog.** Two small changes that make
   the Live Performance Rule true rather than aspirational, and one of them is already written
   down as law two files away.
10. **HA-11 — one word per concept, starting with the AI's five names and the sky band's
    three.** The largest *cheap* win: nothing behaves differently, and every surface stops
    arguing with its neighbour.

Below the line but worth naming: **HA-17** (bounds-based spawn occupancy) and **HA-18** (the
inline roll's opening zoom) are the two that will annoy a *returning* player most, and
**HA-21** (emoji) is the only place the instrument reads like a toy.
