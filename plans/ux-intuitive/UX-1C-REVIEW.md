# UX-1C — adversarial review

Gate review of lane UX-1C (canvas grammar). Written 2026-09-02 against the uncommitted
worktree `t3code-2faff191`, branch `t3code/openjammer-redesign-timeline`. Every claim in
`UX-1C-REPORT.md` was treated as unverified and re-measured from scratch: my own Playwright
scripts under **node**, my own gate-local Vite config, dev server on **5252** only, scratch
in `.scratch/ux-1c-gate/`. No product file was edited and no git write was run.

## Verdict: **SHIP-AFTER-FIXES**

The lane's headline work is real and reproduces: **U5 fan-out is fixed** (the S1 bug from
UX-INV Q5 is gone and the cable hit-path no longer eats the drop), **U8 ports are named,
padded, typed at rest and wirable from the keyboard**, **U9's forward Tab lands in the
surface in exactly 4 presses**, **U12 selects and names every verb**, the **emoji are gone**,
the **Knob names its gestures**, and `visibleCanvasBounds()` now intersects the window. All
gates are green (`bun run build` included — the UX-1A break the report names is repaired).

But one item in the brief is **not delivered on the route it was raised for**, and it fails
silently in the way the audit specifically indicts. HA-26 exists because "delete, copy, paste,
duplicate and select-all have no pointer route anywhere in the app". After this lane they have
a menu row each — and **clicking Delete, Duplicate or Copy in that menu still does nothing**,
because a left mousedown on a menu row reaches the canvas through React's portal bubbling and
clears the selection before the row's `onSelect` runs. The keyboard route through the same menu
works. That is one `stopPropagation` away from correct, and it must be fixed before this lands.

**14 findings: 1 blocking (S1), 3 serious (S2), 10 minor (S3).**

---

## Findings

| id | sev | file:line | what | exact fix |
|---|---|---|---|---|
| **1C-01** | **S1** | `src/components/Canvas/ContextMenu.tsx:485-486` (host) / `src/components/Canvas/NodeCanvas.tsx:369-388` (the guard it reaches) | **Every selection-dependent verb in the context menu is a pointer no-op.** `ContextMenu`'s host is portalled to `document.body` but is a React *child* of the `.node-canvas` div, so React bubbles a menu row's `mousedown` to `handleMouseDown` (`NodeCanvas.tsx:1676`). The target is not a node or a port, so `:373-374` runs `clearSelection()` **and starts a marquee** — before the row's `onSelect` fires on click. Measured: select the Speaker, right-click it, mousedown on `Delete` → selection `[]`, box-selection started; mouseup → cards `4 → 4`, live region silent, undo untouched. Same for `Duplicate` and `Copy`. `Select all`, `Paste`, `Add …` and `Disconnect all cables` work only because none of them reads the prior selection. The keyboard route through the identical row works (`4 → 3`, "Delete selection"). The lane's unit test passes because jsdom calls `onSelect` directly and never sends the canvas a `mousedown`. HA-26 is unmet on the exact route it was raised for. | Add `onMouseDown={(e) => e.stopPropagation()}` (and `onMouseUp`) to the `.context-menu-host` div at `ContextMenu.tsx:484-487`. Belt and braces: extend the `isNodeOrPort` selector at `NodeCanvas.tsx:369-372` with `, .context-menu-host`. Then add a browser-level regression to `ContextMenu.test.tsx` that dispatches a real `mousedown` on the row (jsdom cannot catch this class of bug). |
| **1C-02** | **S2** | `src/components/Nodes/NodeWrapper.tsx:283`; report §1 | **U5's compensating gesture does not exist.** The report and `docs/shell.md` both state that with the output-grab now fanning out, "moving a cable means grabbing it at its **input** end". Measured: grab the Speaker's occupied `audio-in`, drop it on another card's `audio-in` (empty **or** occupied) → `LOST: []`, `GAINED: []`, `n 6 → 6`, **nothing announced**. It only works when the input-grab is dropped on an *output*, which re-sources the cable rather than moving its destination. So after this lane there is **no one-gesture way to move a cable's destination** — the natural DAW gesture fails quietly, which is the failure mode the audit's cross-cutting observation names. (Not a regression — it failed before too — but the report presents it as the working alternative, and it is not.) | Either (a) in `handlePortMouseUp`, when both the source and the target are inputs and a `pendingDisconnect` is armed, resolve the cable's far end from the store and reconnect *that* to the new input; or (b) if that is out of scope, say so in `UX-1C-REPORT.md` §1 and `docs/shell.md` and announce the refusal ("Drop this on an output, or grab the cable's other end") instead of silence. Do not ship the current sentence. |
| **1C-03** | **S2** | `src/a11y/historyPhrase.ts:102-104, 127-132` | **"Added 1 nodes."** Any card that arrives pre-wired is announced and titled by a count instead of a name, ungrammatically. Measured: `Add Sampler` → live "Added 1 nodes", undo `"Undo Add 1 nodes (Ctrl+Z)"`; the onboarding rig → "Added 4 nodes" for a 13-node install. Cause: `:104` requires `wires.length === 0` before the headline branch can name the card, but a Sampler's add records its internal `addConnection` verbs in the same entry, so it falls through to `:127-132`. This is HA-09's exact defect surviving for a whole class of cards, in the feature built to close it. | At `:104` drop the `wires.length === 0` condition when `rootAdds.length === 1` (internal wiring is the card's insides, not a separate verb). At `:132` pluralise: `${count} ${count === 1 ? 'node' : 'nodes'}` — and prefer naming the single root add over ever printing "1 node". Add a `historyPhrase.test.ts` case for a single root add that also carries connections. |
| **1C-04** | **S2** | `src/a11y/LiveAnnouncer.tsx:79` | **The re-announce nonce fails on the undo→redo→undo cycle, which is the case it exists for.** `' '.repeat(nonce % 2)` only alternates parity, so any two identical announcements separated by an *even* number of others render byte-identical and a screen reader stays silent. Measured: `Ctrl+Z` → `"Undo Add Speaker"`, `Ctrl+Shift+Z` → `"Redo Add Speaker "`, `Ctrl+Z` → `"Undo Add Speaker"` — the second undo is byte-identical to the first and is not read. (Four identical adds in a row *do* alternate correctly, so the mechanism half-works.) | Compare against the last rendered string rather than a parity bit: keep the previous rendered text in a ref and append one ` ` only when the new text equals it. Guarantees a diff for every repeat regardless of what came between. |
| **1C-05** | S3 | `src/components/Canvas/NodeCanvas.tsx:1616-1631` | **The keyboard route forks the connection-validity rules.** `handlePortKeyDown` builds its own refusal set. Measured: arming an Effect's `audio-out` and pressing Enter on the *same card's* `audio-in` is refused ("A card cannot be wired to itself"), while the identical pointer drag **creates the connection** (`6 → 7`, "Connected Effect to Effect"). Two rule sets for one gesture — the thing the report claims not to have done. The `canConnect` branch at `:1628` is also dead: `canConnect` only rejects same-direction and `disabled` ports, both already handled or filtered out of `keyboardPorts()`. | Move the self-wire rule into `graphStore.addConnection` (or `canConnect`) so both routes obey it, and have the keyboard read the rejection rather than pre-judging it. Then delete the dead `canConnect` branch. |
| **1C-06** | S3 | `packages/oj-ui/src/components/Port/Port.css:172-175` | **`[data-armed]` borrows `--focus-ring`.** While a cable is in the air the armed socket keeps the ring and the newly focused control has one too — measured: after arming and one `Tab`, an armed port and a focused button both wear it. `PRODUCT.md` §Accessibility is explicit that there is exactly one focus ring so a keyboard player never learns a second visual language; here it now means "focused" *or* "holding a cable". | Keep the accent border and the accent core (both already distinct and already sufficient) and drop `var(--focus-ring)` from the `[data-armed]` `box-shadow`, leaving `--shadow-inset`. The ring then means only "you are here". |
| **1C-07** | S3 | `src/utils/spawnPlacement.ts:299-313` | The sweep's cost note ("~2k cells against ~10 siblings") is a zoom-1 number. `bounds` are canvas px, so at `MIN_ZOOM = 0.25` (`canvasStore.ts:68`) they are 4× per axis: ~26k cells × siblings, ~13× the stated figure. Still off the audio path and still once per gesture, so this is a comment accuracy problem, not a performance bug. | Restate the bound as `O((W/zoom · H/zoom)/28²)` and give the min-zoom figure, or cap the sweep resolution when `zoom < 1`. |
| **1C-08** | S3 | `src/components/Nodes/NodeWrapper.tsx:622-637` + `packages/oj-ui/src/components/Port/Port.tsx:73-116` | A gated (`port.disabled`) socket overrides `title` with its reason but **not** `aria-label`, so assistive tech is told an inert port is "…drag to connect, or press Enter". Latent only — the registry ships no gated port today (measured: 0 in the DOM) — but the affordance is kept deliberately for future nodes. | In `renderPort`'s disabled branch pass `aria-label={port.disabledReason}` beside the existing `title`, or have `describePort` take a `disabled` flag the way it takes `placeholder`. |
| **1C-09** | S3 | `src/components/Nodes/__tests__/outputFanOut.test.tsx` (2nd case) | The test is named *"grabbing a CONNECTED input still picks that cable up **and moves it**"* but asserts only `pendingDisconnect === cable`; it never lands the cable. The move it implies is the silent no-op in **1C-02**, so the test's name is the strongest evidence for a behaviour the build does not have. | Rename to "…arms the pending disconnect", or extend it to land the cable and let it fail until 1C-02 is resolved. |
| **1C-10** | S3 | `packages/oj-ui/src/components/Knob/Knob.tsx:318-325` | The `title` is accurate on all four claims it makes (drag `:150`, Shift-fine `:150`, double-click reset `:296` correctly gated on `defaultValue`, wheel `:192` and arrows `:269` both focus-gated), but "Shift for fine" is unscoped — Shift is a *drag* modifier only, not a keyboard or wheel one — and `PageUp`/`PageDown` (±10) and `Home`/`End` (min/max) at `:277-287` are unnamed. | "Drag to change · Shift for a fine drag · double-click to reset · wheel or arrows when focused". Leave Page/Home/End to the help panel if the line would get too long. |
| **1C-11** | S3 | `src/components/Canvas/NodeCanvas.tsx:1524` | The `MutationObserver` watches `childList`/`subtree` only, but `keyboardPorts()` filters on the **attributes** `aria-hidden` and `data-port-disabled`. A port that becomes gated or ungated without a DOM insert leaves the card's roving stop pointing at an unreachable socket. Not reproducible today (nothing toggles those attributes at runtime), so the risk is forward-looking. | Add `attributes: true, attributeFilter: ['aria-hidden', 'data-port-disabled']` to the observe options. Self-retrigger is still impossible: our own write is `tabindex`, which is not in the filter. |
| **1C-12** | S3 | `src/components/CommandBar/useCommandSources.ts:385-390` | Unreported diff in a lane-owned file: the "New Project" command was changed from `window.dispatchEvent('openjammer:new-project')` to a direct `requestNewProject('new')`. That is UX-1B's **U4**, and the report's "files touched" section names the shared-file risk for `Topbar.tsx` but not for this one. | Name it in `UX-1C-REPORT.md` alongside the `Topbar.tsx` note, so whoever commits by pathspec reads the file once before landing. |
| **1C-13** | S3 | `src/audio/wasm/pkg/ojcore_wasm.d.ts:2`, `ojcore_wasm_bg.wasm.d.ts:2` | `bun run lint` is no longer clean as the report states: 2 warnings, "Unused eslint-disable directive". Both files are UX-1A's, generated by the wasm build. Exit code is still 0. | UX-1A's, not this lane's — but the report's gate table should say "2 warnings (UX-1A)" rather than "clean". |
| **1C-14** | info | `src/components/Shell/SkyBand.tsx` (other lane) | Three live regions coexist in the document; a second polite one still reads "Canvas surface active" at rest, so the new region is not the only thing an AT hears. That is **HA-20**, explicitly UX-1E's item — noted so the two are reconciled when 1E lands, not charged to this lane. | — |

---

## Claims verified, with evidence

All runs: headless Chromium under **node**, `--autoplay-policy=no-user-gesture-required`,
1440×900, dev server on 5252 via `.scratch/ux-1c-gate/vite.config.ts` (root config plus
`**/.scratch/**` in `server.watch.ignored`; nothing the app serves changes). Scripts and logs
in `.scratch/ux-1c-gate/`.

### U5 — outputs fan out (`g1-fanout.mjs`, `g1b-inputpickup.mjs`)

FH-1 task 3 verbatim, on the jam rig (instrument → delay → speaker):

```
A) delay OUT -> new effect IN (empty)   hit@target mid-drag: PORT(audio-in)
   LOST edges:   []
   GAINED edges: [".../audio-out -> .../audio-in"]
   SPEAKER STILL FED? true
   cables leaving Delay audio-out: 2
   total connections: 6 -> 7            <- an ADD, not a move
   after ONE Ctrl+Z: n=6  speakerFed=true  exactInverse=true
```

UX-INV Q5 measured `LOST: ["delay/audio-out -> speaker/audio-in"]`, `SPEAKER STILL FED? false`,
`6 before, 6 after`. **Fixed.**

The z-order half — the drop now lands on the port, not the cable:

```
C) new effect OUT -> speaker IN (occupied)  hit@target mid-drag: PORT(audio-in)
   cables into Speaker audio-in: 1          <- one-cable-per-input reachable by mouse again
   LOST: [delay -> speaker]   GAINED: [newEffect -> speaker]
   ONE Ctrl+Z exact: true
```

Q5 measured `NOT-A-PORT(path)` and zero graph change here. **Fixed.**

A **settled** cable is still clickable when not dragging (the `pointer-events` change is
correctly scoped to `.is-connecting`):

```
elementFromPoint at cable midpoint (idle): path.oj-cable__hit
visually selected cable groups: 1
Delete after cable click: 6 -> 5   SELECT+DELETE WORKS: true
.node-canvas.is-connecting at rest: false
```

Every drag above undid to an exact inverse in **one** `Ctrl+Z`. The input-pickup half is
**1C-02**.

### U8 — ports (`g2-ports.mjs`, `g3b-keyboard.mjs`, `g3c-connect.mjs`; both themes)

```
ports in DOM: 39  (aria-hidden: 30, all KeyTile sockets)
role=button: 9/9   aria-label: 9/9   title: 9/9
labels containing engine ids: 0
smallest DRAWN well: 17.2   smallest HIT pad: 24   pads under 24: 0
pad hit test around a port: {at0:PORT, up10:PORT, down10:PORT, left10:PORT, right10:PORT, drawn:17}
overlapping hit pads: 0
roving stops per card: [{4 ports,1 stop},{2,1},{2,1},{1,1}]  -> exactly one per card: true
.oj-port rules with glow/scale: 0   rules referencing --focus-ring: 2
```

Labels read `"Control out — ROW 1 — drag to connect, or press Enter"`, `"Audio in — drag to
connect, or press Enter"` — type + direction + row label, no engine ids. The pad is a real
target, not just a box: `elementFromPoint` 10px off-centre in all four directions still returns
the port, and no two pads collide.

Idle tint by type, resolved through a 1×1 canvas (never a regex over `oklch()`), on a rig with
an unconnected Effect present so both idle kinds exist:

```
LIGHT  idle audio rgb(36,125,123)   idle control rgb(124,121,111)   DIFFER: true
       live audio rgb(0,149,156)    live control rgb(143,140,130)
DARK   idle audio rgb(76,159,157)   idle control rgb(133,129,118)   DIFFER: true
       live audio rgb(0,180,188)    live control rgb(118,114,103)
```

HA-12 measured both wells as `rgb(42,40,34)`. **Fixed, in both themes.**

Roving behaviour, walked with real key presses and no `.focus()` call:

```
first PORT after 14 Tab presses (10 key tiles crossed)
ArrowDown x4 from row-1: ["row-2","row-3","pedal","row-1"]   same card: true
ArrowUp goes back: pedal
Tab from a port -> a control on a DIFFERENT card   left the card: true
```

Keyboard connect end to end, and it is a genuine fan-out:

```
focus  "Audio out — drag to connect, or press Enter"
Enter  armed: delay/audio-out   live: "Out armed. Move to another card's socket and press Enter to connect."
       armed paint: border oklch(0.66 0.19 40), core oklch(0.66 0.19 40)   (see 1C-06)
Tab while armed MOVED focus: true      <- the arbiter fix works
focus  "Audio in — …"  Enter
cables 6 -> 7   GAINED: [delay/audio-out -> freshEffect/audio-in]
live: "Connected Effect to Effect"     armed cleared: true
delay's audio-out now has 2 cables      <- fan-out, made with the keyboard
undo button: aria "Undo Connect Effect to Effect" / title "…(Ctrl+Z)"
ONE Ctrl+Z -> 6   live: "Undo Connect Effect to Effect"
```

The store really gained the edge (read back out of `openjammer-graph-v2`), and the history
label is the `addConnection` one — so the keyboard reaches `addConnection` down the pointer's
path, as claimed.

Refusals are announced and the cable stays in hand:

```
audio out -> audio out : "Two outputs cannot connect. Reach for an input."  n unchanged, still armed
same card out -> in    : "A card cannot be wired to itself."                n unchanged   (see 1C-05)
Escape                 : "Cable dropped."   armed cleared
```

`audio out -> control in` is **accepted** by both routes — that is `canConnect`'s documented
ANY-TO-ANY rule (`registry.ts:878-912`), not a lane defect, and the agreement between the two
routes is evidence for the shared path.

Story and Code Connect: `Port.stories.tsx` gains `Named` plus armed cells and exercises the new
`name` prop; `Port.figma.tsx` pins only `kind`/`direction`, neither of which changed, so it
needed no edit. `bunx figma connect parse` in `packages/oj-ui` → **exit 0, 53 components,
`Port` among them**.

### U9 — forward Tab (`g3b`, `g3c`; both themes, identical)

```
start: Settings [chrome]
 Tab 1 -> Hold all sound [chrome]
 Tab 2 -> Show keyboard help [chrome]
 Tab 3 -> BODY
 Tab 4 -> Row 1, key Q [canvas]
FIRST CANVAS CONTROL after 4 Tab presses          <- the lane's claim, confirmed
Shift+Tab: canvas control -> BODY                  MOVED BACK: true
```

From `document.body` with the traversal ended (a non-Tab key first), one bare `Tab` still
toggles: `surface canvas -> arrangement`. Parked on the stage floor after a pointer click, one
`Tab` toggles and a **second consecutive** `Tab` walks into the surface just brought up — both
halves of the rule, measured.

`arbiter.ts`'s two-cycle argument is intact: the toggle still exists and is still bound to a
bare `Tab` on a surface root; only the parked/in-transit discriminator is new, and the flag is
updated before every early return so a `Tab` inside a text field cannot leave it stale.
`useKeymap.ts` resets it on capture-phase `pointerdown`. `docs/shell.md` now carries the old
sentence *plus* an explicit paragraph saying it was measured false and is now true — the doc is
honest as written.

The drag guard's new `Tab` exemption is safe on the pointer path, measured on a real node drag:

```
surface during drag: canvas -> canvas   (must NOT change): true
focus moved mid-drag to: "Row 1, key Q"
the drag still completed: {945,210} -> {1112,335}   moved: true
```

The load-bearing half of the guard (no surface swap under a live gesture) survives; only focus
moves, and no edit can land from a `Tab`.

### U12 — every verb answers (`g4`, `g6`, `g7`)

```
live region at rest: {count:1, role:"status", aria-live:"polite", aria-atomic:"true", parent: body}
Add Looper  -> store-selected 1, dom-selected 1 | live "Added Looper"  | undo "Undo Add Looper (Ctrl+Z)"
Add Library -> store-selected 1, dom-selected 1 | live "Added Library" | undo "Undo Add Library (Ctrl+Z)"
root-level cards 4 -> 7 after three adds        <- NO nesting: the addNodeFromCtx parent bug is fixed
context-menu add (pointer):  roots 4 -> 5, selected 1, live "Added Looper"
context-menu add (keyboard): roots 5 -> 6, selected 1, live "Added Effect"
undo/redo titles AND aria-labels both carry the phrase and update after every verb
```

Selection is exactly one card, in the store and in the DOM, on both add routes. The
`addNodeFromCtx` parent bug the lane found is fixed and pinned by
`paletteSpawnPlacement.test.tsx` ("spawns at the level the player is looking at, never inside
the selection"). Four identical adds in a row each produced distinct region text. The
undo→redo→undo case did not — **1C-04**. `Add Sampler` is named by a count — **1C-03**.

### Spawn (`g4`, `g5-spawn-rm.mjs`)

Three palette adds on the jam rig at 1440×900, identical in both themes:

```
{"type":"looper", "x":659,"y":55, "w":240,"h":267,"inside":true}
{"type":"library","x":908,"y":46, "w":477,"h":381,"inside":true}
{"type":"sampler","x":705,"y":599,"w":214,"h":378,"inside":false}   <- 80% visible
```

I did **not** take the lane's "no free slot exists" on trust. Independent exhaustive 4px sweep
over the intersected visible bounds, against the six real rendered rects:

```
visible bounds (screen px): {l:0, t:46, r:1440, b:900}
occupied: 95,353 564x294 | 706,429 256x147 | 958,439 215x218 | 1211,429 221x246
          659,55 240x267 | 908,46 477x381
36,840 candidates tested for a 214x378 hole: NONE
```

**The claim is true.** `visibleCanvasBounds()` does intersect with the window: the canvas
element starts at `top: 46` and the returned bounds start there, not at 0.

**Ruling on "most visible" vs panning to the new card.** The fallback is the right call and I
would not change it. Panning the viewport on an add is a bigger promise than the verb makes: it
moves *everything the player is looking at* to solve a placement problem, and mid-set that is a
worse surprise than a card three-quarters on screen — the rig you are performing on slides out
from under your hands because you asked for one more effect. "Design for instant" is about the
player watching the change land, and at 80% visible with the header, the ports and the controls
on screen, selected, and named in the live region, they do. The honest gap is not the fallback,
it is that the player is never *told* the canvas is full; a one-line "No room on screen — the
card is at the edge" in the same live region would close it, and would cost nothing. Worth an
UX-1D copy item, not a change here.

### HA-21 / HA-26 menus (`g4`, `g7`, `g9`, `g10`)

```
CANVAS menu  aria-label "Canvas menu"
  headings: Add node · Edit
  Edit rows: Copy [disabled] <Ctrl+C> · Paste <Ctrl+V> · Duplicate [disabled] <Ctrl+D>
             Select all <Ctrl+A> · Delete [disabled] <Del>
  emoji: false   .oj-menu-item__icon count: 0   focusIsInMenu: true
  ArrowDown moves; Escape closes
NODE menu    aria-label "Speaker menu"
  headings: Speaker · Add node · Edit
  leads with Duplicate · Disconnect all cables · Delete, then the add categories
  right-click SELECTED the card: true (store + DOM)
  Disconnect all cables: cables 7 -> 6, ONE Ctrl+Z restores
```

Both menus in both themes, and under `reducedMotion: 'reduce'` the menu still opens. Rows that
need a selection are `aria-disabled` (and skipped by arrow nav) without one; Paste and Select
all are not. Each row shows its **current** binding via `keyComboToString(getBinding(id))`.

The verbs are genuinely one implementation, two routes — `NodeCanvas.tsx:290-320` defines
`canvasVerbs` and the keydown handler calls `verbsRef.current?.copy/paste/duplicate/selectAll/
remove` at `:774-836`; there is no second body. Verified by measurement too: menu `Select all`
selected all 6 root cards, and menu `Delete` **via the keyboard** deleted and produced
`"Undo Delete selection (Ctrl+Z)"` — the same entry the `Delete` key produces. The pointer route
into those same functions is **1C-01**.

No emoji anywhere in `ContextMenu.tsx` (one `→`, inside a prose comment).

### Knob (HA-19)

`title` present on the wrap at `Knob.tsx:325`, `rest.title` wins, omitted-when-`defaultValue`-
absent clause correct. Accurate against `:150` (Shift-fine drag), `:192-213` (wheel, gated on
`document.activeElement === el`), `:269-287` (arrows), `:296` (double-click reset gated on
`defaultValue`). Two small imprecisions: **1C-10**.

### Reduced motion (`g5`)

```
{"reduced":true,"role":"button","label":"Control out — ROW 1 — …","hitPad":"24px","drawn":17,"transition":"1e-05s"}
menu opens: true    armed works: true    live region speaks: true
```

### Gates (all re-run by me)

| gate | result |
|---|---|
| `bunx tsc --noEmit -p tsconfig.app.json` | **clean**, exit 0 |
| `bun run lint` | exit 0, **2 warnings** in `src/audio/wasm/pkg/**` (UX-1A's generated files) — see 1C-13 |
| `bun run test:run` | **3189 passed / 1 failed (249 files)**, exactly as reported |
| — the one failure | `CommandBar.test.tsx > Tab from search sends the typed prompt to AI` — timeout under full parallelism. **Re-run alone: 20/20 pass in 4.39s.** Another lane's file, confirmed flake, matches the recorded `voiceSynth` family |
| `bun run build` (`tsc -b && vite build`) | **GREEN** — `✓ built in 4.04s`, PWA precache 87 entries. The `browserExport.ts` `@ts-expect-error` break the report attributes to UX-1A has been repaired; `bunx vite build` was not needed |
| `bunx figma connect parse` (in `packages/oj-ui`) | **exit 0**, 53 components, `Port` present |

### The HA keyboard-only walk, as my own script (`g3b`, `g3c`)

topbar → 4× `Tab` → a canvas control → `Tab` to a port (14 presses total, 10 key tiles) →
arrows walk that card's four sockets and wrap → `Tab` leaves the card → `Enter` arms with a
spoken confirmation → `Tab` while armed moves focus → `Enter` on a compatible socket lands and
the store gains the edge → `Ctrl+Z` → live region says `"Undo Connect Effect to Effect"`.
**The walk completes end to end, with no mouse and no programmatic `focus()`.** Before this
lane it was two dead ends (HA-01, HA-02).

---

## Not verifiable / not verified

- **Audio actually playing.** Everything here is topology, focus and pixels. No sound was
  heard. The cable gestures reach the same `addConnection` the pointer always used, so the
  engine sees nothing new — but that is an argument, not a listen. The covenant's real test is
  still unrun for this lane, and the founder should drive one keyboard connect with a rig
  sounding before this ships.
- **A real screen reader.** `role`, `aria-label`, `aria-live`, `role="status"`, `aria-atomic`
  and the nonce were read out of the DOM. NVDA/VoiceOver were not run — which matters most for
  **1C-04**, where the failure is precisely "the AT does not re-read an identical string".
- **Touch.** The 24px pad was measured with `elementFromPoint`, not with touch events; the
  KeyTile and MiniLab opt-outs are reasoned from CSS and markup, as the lane says.
- **Native tier.** All runs are `vite dev` in Chromium. Nothing here is tier-specific but Tauri
  was not exercised.
- **Other viewport sizes.** Spawn containment was measured only at 1440×900.
- **The `disabled`-port label (1C-08)** is reasoned from code; the build ships no gated port, so
  it could not be measured.

---

## Ruling: the synthesised-pointer-event keyboard connect

**It is the right call, and it is one line of hardening away from being safe — but the lane's
own claim for it is broader than what shipped.**

The reuse is genuinely fork-free where it matters most. `NodeWrapper.handlePortMouseUp` is a
150-line accretion — ghost ports becoming real ports, an instrument growing inputs for a
multi-source drop, the pending reconnect resolving, the `beginGesture`/`endGesture` bracket that
makes all of it one `Ctrl+Z` — and a second keyboard implementation of that would be a second
set of bugs, permanently. Dispatching `mousedown`/`mouseup` at the socket means `addConnection`
is reached down exactly one path, and I measured that it is: the keyboard connect produced the
same history entry, the same label and the same one-press undo as the pointer. The mechanism is
also robust in the ways one worries about — `handlePortMouseDown`'s guard was already written
pointer-agnostic (`e.button != null && e.button !== 0`, with a comment naming UI-017), React 19
attaches at the root container so a native event dispatched on the port reaches the synthetic
handler, and the ports use `onMouseDown`/`onMouseUp` rather than Pointer Events, so there is no
pointer capture and no `pointerId` in the loop today. Nothing about `touch-action` applies to a
key press.

The fragility is real but narrow and *named*: the day someone converts the port handlers to
Pointer Events, or adds an `isTrusted`/`pointerId`/`e.pressure` check, the keyboard route dies
silently. `keyboardConnect.test.tsx` fails loudly if that happens, which is the correct
mitigation and it exists. The seam that should be shared is not the event — it is the *verb*:
`NodeWrapper` should expose `beginConnectionFrom(nodeId, portId)` and
`completeConnectionAt(nodeId, portId)` (the current handler bodies, minus the two lines of
event plumbing) on the same context it already hands `handlePortMouseDown`/`handlePortMouseUp`
down to the faceplates. The keyboard would then call the function instead of impersonating a
mouse, with byte-identical behaviour and no synthetic event at all. That is a ~20-line
refactor and I would ask for it as a follow-up, not a blocker.

What I *would* correct now is the claim. `docs/shell.md` and the report both say "the keyboard
route **is** the pointer route". Measured, it is not, in one respect that matters: the keyboard
enforces a self-wire prohibition the pointer does not (**1C-05**). The moment the keyboard grew
its own pre-flight refusal set — which it needed, because a refusal that says nothing is
indistinguishable from a broken key — it became a second opinion about what is legal. Either
push that opinion down into the store where both routes read it, or stop claiming parity.

---

*Dev server on 5252 stopped. No product file was edited; no git write was run.*

---
---

# Re-gate of the fix round

Written 2026-09-02 against the same uncommitted worktree, after the "Fix round — the 14 gate
findings" section of `UX-1C-REPORT.md`. Same discipline as the first gate: every claim treated as
unverified, my own Playwright scripts under **node**, my own gate-local Vite config, dev server on
**5252** only, scratch in `.scratch/ux-1c-regate/` (`r1-verbs.mjs`, `r2-move-stuck.mjs`,
`r3-menus-phrases.mjs`, `r4-resource.mjs`). No product file was edited and no git write was run.
UX-1E's files (`PianoRoll/**`, `RulerStack`, `SkyBand`, `useClipGesture`, `AppErrorBoundary*`,
`Settings/*Panel`, `AiPanel`, `StepGrid*`) were ignored.

## Verdict: **SHIP-AFTER-FIXES**

**All 14 first-round findings are fixed and every one reproduces in a real browser.** The two that
were "bigger than a patch" were taken the deeper way, as asked: the connection gesture is a shared
**verb** (`connectionVerbs.ts`) with no synthetic `MouseEvent` anywhere, and the self-wire rule
moved into `graphStore.addConnection` where both routes read it. The refactor is faithful — I
diffed the old 150-line `handlePortMouseUp` against the new module statement by statement and drove
every risky case live; nothing fell off in the move (evidence below). Gates: **tsc clean, lint exit
0 with ZERO warnings, build green, `figma connect parse` exit 0 / 53 components, 256 of 257 test
files pass**, the one red being the known `CommandBar` parallel-load flake (20/20 alone).

What holds it back is one thing the fix round introduced and did not measure: on a narrow but
reachable topology the new **move-cable** branch announces *"Moved cable from X to Y"* for a move
that **did not happen**, and — because nothing was recorded — the player's next `Ctrl+Z` undoes the
*previous* edit instead. A false confirmation followed by an undo that lands somewhere else is the
exact failure class this lane exists to close. It is a two-line guard.

**7 findings: 0 blocking, 1 serious (S2), 3 minor (S3), 3 info.** None of the 14 originals recurred.

---

## Findings

| id | sev | file:line | what | exact fix |
|---|---|---|---|---|
| **RG-01** | **S2** | `src/components/Nodes/connectionVerbs.ts:138-149` (with `src/store/graphStore.ts:817-824`) | **The move-cable branch announces a move it did not make, and the undo that follows lands on the previous gesture.** When one output already feeds *both* the grabbed input and the target input, `addConnection`'s duplicate-edge short-circuit (`graphStore.ts:817-824`, "Check if connection already exists" then `return existingConnection.id`) returns a **truthy** id without touching the graph. `reconnectConnection` passes that back, `moved` is truthy, and `:149` announces `Moved cable from X to Y`. Measured (`r2-move-stuck.mjs`, case E3): `fxA/audio-out` feeds both `speaker/audio-in` and `fxB/audio-in`; grab `speaker/audio-in`, drop on `fxB/audio-in` gives `LOST: []`, `GAINED: []`, `n 7 -> 7`, live **"Moved cable from Speaker to Effect"**, undo button still **"Undo Connect Effect to Speaker (Ctrl+Z)"** — the frame committed nothing, so one `Ctrl+Z` now undoes the *earlier* connect. The speaker is still fed, so no sound is lost; the lie and the misaimed undo are the harm. | Read the result back before speaking. After `:138`: `const landed = useGraphStore.getState().connections.get(moved as string);` and treat `landed?.targetNodeId !== node.id \|\| landed.targetPortId !== portId` — equivalently, `useGraphStore.getState().connections.has(pendingId)` still being true — as "nothing moved": `canvas.stopConnecting(); return { ok: false, reason: '<source> already feeds this input.' }`. Add the case to `outputFanOut.test.tsx` beside the existing move test. |
| **RG-02** | S3 | `src/components/Canvas/NodeCanvas.tsx:738-742` | **A keyboard-armed cable can be dropped in silence.** The socket-scoped `Escape` at `:1609-1617` announces "Cable dropped."; the global Priority-5 fallback at `:740` calls `stopConnecting()` and says nothing. Measured (`r2`, case F4): focus a socket, `Enter` (armed), `Tab` away, `Escape` gives `is-connecting` false while the live region still reads *"Out armed. Move to another card's socket and press Enter to connect."* The player is told the cable is in hand when it is not — HA-07's shape, inside the feature built to close it. Same silence on the `stopConnecting()` at `:380` (a stray left-click on empty paper kills an armed cable without a word; measured `r2` F3). | `announce('Cable dropped.')` next to the `stopConnecting()` at `:740`. Consider the same at `:380` — a click that discards a keyboard gesture is exactly the moment a keyboard player has no other feedback. |
| **RG-03** | S3 | `src/store/graphStore.ts:1877` + `:1739`; menu row at `src/components/Canvas/NodeCanvas.tsx:297` | **`Duplicate` is announced and titled as `Paste`.** `duplicateSelected` delegates to `pasteClipboard`, whose history frame is `begin('Paste nodes', 'graph')` at `:1739`, so both the menu row and `Ctrl+D` produce live **"Pasted nodes"** and **"Undo Paste nodes"**. Measured (`r3-menus-phrases.mjs`): `DUPLICATE: cards 4 -> 5 | live: Pasted nodes`. 1C-03 was the finding about naming a verb correctly and U10 is "one word for one concept"; duplicate — one of HA-26's five new pointer verbs — kept the wrong word. | Bracket the delegation: in `duplicateSelected`, `useHistoryStore.getState().begin('Duplicate nodes', 'graph')` before `:1877` and `commit()` in a `finally`. Nesting keeps the OUTER label (`historyStore.begin` only increments `depth` when a frame is open), so `pasteClipboard`'s own `'Paste nodes'` is correctly swallowed. Pin it with a store/`historyPhrase` case asserting `Undo Duplicate nodes`. |
| **RG-04** | S3 | `src/components/Canvas/NodeCanvas.tsx:295, 298-302` | **Two of the five new pointer verbs still answer with nothing.** `copy` and `selectAll` record no history, so `LiveAnnouncer` — which subscribes to the history store — can never name them, and neither call site uses the `announce()` channel that exists precisely for "gesture moments that record no history". Measured (`r3`): after clicking **Copy** in the menu the live region still held the *previous* sentence ("Pasted nodes"); the verb itself said nothing at all. U12's claim is that every verb answers; these two do not, on either route. | In `canvasVerbs.copy`, capture `useGraphStore.getState().selectedNodeIds.size` before the call and `announce('Copied N cards')`; in `selectAll`, `announce('Selected N cards')` after `selectNodes`. `announce` is already imported in this file. |
| **RG-05** | info | `src/components/Nodes/connectionVerbs.ts:102, 155-176` (`GROWS_INPUTS`, `isGhostPort`) | **About 50 lines of the new module are reachable only from a test.** `git grep ghost-input-` at `HEAD` and across the working tree hits exactly three places: the two in `connectionVerbs.ts` and `NodeWrapper.reconnect.test.tsx:11`, which synthesises the id. No faceplate emits a port id with that prefix — the live empty-slot affordance is `PortPanelNode`'s `empty-…` ids, which take the ordinary path (confirmed in a real render: the jam rig's instrument exposes `input-panel-…:empty-…`, no ghost). **Pre-existing** (dead at `HEAD` too) and carrying it across verbatim is the right call for a refactor — flagged only because agents.md value #8 says every production line is used, and the fix round is the moment this code was read. | Follow-up, not this lane: either route the `empty-` ids through this branch (which is what the affordance is *for*) or delete the branch and its test. Do not leave it unnamed. |
| **RG-06** | info | `src/components/Canvas/NodeCanvas.tsx:325` | `verbsRef.current = canvasVerbs` is assigned in the **render body**. React discourages ref writes during render: a concurrent render that is discarded can still leave the ref pointing at verbs from a commit that never happened. Benign today (the object derives from committed store state every render, and the keydown handler only reads it on a user event, after commit) and the comment above it explains *why* a ref rather than a closure — which is the right decision. | `useEffect(() => { verbsRef.current = canvasVerbs; }, [canvasVerbs])`. Same behaviour, no render-phase write. |
| **RG-07** | info | `src/components/Nodes/connectionVerbs.ts` / `src/components/Canvas/NodeCanvas.tsx:562-568` | **`blur` and `pointercancel` do not drop an in-air cable.** Measured (`r1-verbs.mjs`, F): mid-drag, `window.dispatchEvent(new Event('blur'))` leaves `is-connecting` `true`; a `pointercancel` on `.node-canvas` likewise. Both clear on the next `mouseup`. Pre-existing — `NodeWrapper`'s `blur` cleanup covers *node dragging* only, and the connection gesture's cancel is the `requestAnimationFrame` check in `handleMouseUp`. Every realistic escape hatch works: releasing the button over the topbar leaves nothing stuck, a click on empty paper always clears, `Escape` always clears, and a fresh drag afterwards lands normally — so there is no reachable stuck armed state, only a gap in the cancel set. | Follow-up: `window.addEventListener('blur', () => useCanvasStore.getState().stopConnecting())` alongside the existing node-drag cleanup, and the same on `pointercancel`. |

**Doc-accuracy note (not a finding).** `UX-1C-REPORT.md`'s aside on the stale `g1-fanout.mjs`
expectation says "a move deliberately **keeps the cable's id**". It does not: `addConnection` mints
`const id = generateId()` at `graphStore.ts:844` and deletes `replacingConnectionId` in the same
`set()`, so a move produces a new id. The substantive claim the aside defends — that the round trip
is exact — is true and I measured it; only the reason given is wrong.

---

## The refactor, diffed and driven

`git show HEAD:src/components/Nodes/NodeWrapper.tsx` (the 150-line `handlePortMouseUp` at `:283`
and `handlePortMouseDown` at `:249`) against `src/components/Nodes/connectionVerbs.ts`, statement by
statement. **Every behaviour is carried over.** The differences are all deliberate and all named in
the code:

| old behaviour | new home | status |
|---|---|---|
| non-primary-button guard (`e.button != null && e.button !== 0`, UI-017) | `NodeWrapper.tsx:250` | kept, still pointer-agnostic |
| pending-disconnect lookup on **inputs** | `connectionVerbs.ts:70-77` | kept |
| pending-disconnect lookup on **outputs** | — | **deliberately removed** (U5 fan-out; gated in round 1) |
| release-on-the-same-port keeps the cable in hand (click-to-connect) | `:93-96` | kept |
| ghost-port index parse, port growth, `actualFirstPortId` | `:155-172` | kept verbatim |
| `beginGesture`/`endGesture` bracket around the whole ghost gesture in a `try/finally` | `:153`, `:246` | kept, including the intentional nesting with `reconnectConnection`'s own bracket |
| auto-expansion for a multi-source drop (`sources.length > 1`) | `:180-196` | kept verbatim |
| re-read the node after each `updateNodePorts` (`updatedNode`, then `finalNode`) | `:174`, `:198` | kept |
| `pendingDisconnect && index === 0` -> `reconnectConnection`, else `addConnection`, both directions | `:205-222` | kept verbatim |
| index-offset targeting for sources 2..n | `:207-211` | kept |
| unconditional `stopConnecting()` at the end | `:234` | **changed**: a refusal now keeps the cable and the *caller* decides. `NodeWrapper` drops it (the button is up); the keyboard keeps it. Stated at both sites. |
| `if (!targetPort) return` (silent) | `:177` | **changed**: returns `{ ok: false, reason: 'That socket is gone.' }` — a refusal that says something |
| the keyboard's private pre-flight refusal set + the dead `canConnect` branch | — | **gone**; `refuseReason` (`:257-273`) translates the store's answer *after* it |

Everything in the module re-reads the stores at call time and touches no React state, so both call
sites really are one code path. `NodeWrapper.handlePortMouseUp` is now 12 lines;
`NodeCanvas.handlePortKeyDown`'s Enter branch is 6. **No `MouseEvent` is dispatched anywhere.**

One trap checked and cleared: the pointer path calls `announce(result.announcement ?? '')` on
success, i.e. `announce('')` for an ordinary connect — and `announce.ts:26` ignores empty strings,
so it cannot stomp the history announcement that names the new cable. Measured: an ordinary drop
still says `"Connected Effect to Speaker"`.

### Behaviours proven preserved, with evidence

All runs: headless Chromium under **node**, `--autoplay-policy=no-user-gesture-required`, 1440x900,
dev server 5252 via `.scratch/ux-1c-regate/vite.config.ts`.

**Ghost port + auto-expansion + the one-`Ctrl+Z` bracket.** Not drivable in the browser — no
faceplate emits a `ghost-input-` id (RG-05) — so it is proven where it *can* be:
`NodeWrapper.reconnect.test.tsx:60`, *"grows a ghost port on the generic instrument and undoes the
whole gesture with one Ctrl+Z"*, drives `handlePortMouseUp('ghost-input-3')` through the **new**
module and asserts the original cable gone, the port list grown, `cursor + 1` (**one** entry),
`open === null`, and that a single `undo()` restores both the cable **and** the exact original port
ids. It passes on the fix-round tree.

**Occupied audio input: replacement, one undo, exact redo** (`r1-verbs.mjs`, B):

```
LOST:   [rigEffect/audio-out -> speaker/audio-in]
GAINED: [freshEffect/audio-out -> speaker/audio-in]
n 6 -> 6        cables into speaker audio-in: 1
live: "Connected Effect to Speaker"   undo: "Undo Connect Effect to Speaker (Ctrl+Z)"
ONE Ctrl+Z exact: true      REDO exact: true
```

**Incompatible drops refuse, speak, and the cable is RELEASED for the mouse** (`r1`, C/C2):

```
same card out -> in : n 6 -> 6  live "A card cannot be wired to itself."              released: true
out -> out          : n 6 -> 6  live "Two outputs cannot connect. Reach for an input." released: true
```

**...and KEPT for the keyboard** (`r2`, G) — the one deliberate difference, gesture lifetime not
rules:

```
KEYBOARD self-wire: live "A card cannot be wired to itself."   still in hand: true
Escape clears: true
```

**Fan-out to two targets from one output** (`r1`, D): `cables leaving the fresh Effect's audio-out:
2`, `FAN-OUT: true`, live `"Connected Effect to Effect"`.

**Input pickup, move, undo, redo** (`r2`, E-clean — 1C-02's fix, with distinct sources so the
gesture is a real move):

```
LOST:   [rigEffect/audio-out -> speaker/audio-in]
GAINED: [rigEffect/audio-out -> fxB/audio-in]
n 6 -> 6   MOVED: true   cable in hand after: false
live: "Moved cable from Speaker to Effect"   undo: "Undo Move cable (Ctrl+Z)"
ONE Ctrl+Z exact: true   live "Undo Move cable"
REDO exact: true         live "Redo Move cable"
```

**...onto an OCCUPIED input** (`r2`, E2) — replacement and an exact round trip in one press:

```
n 7 -> 6   LOST 2 edges, GAINED 1   live "Moved cable from Speaker to Effect"
ONE Ctrl+Z exact round trip: true   n 6 -> 7
```

**...and the other half of the input grab — dropping on an OUTPUT re-sources the cable** (`r4`), the
`else` branch of the `pendingDisconnect` fork, which the refactor kept verbatim:

```
LOST:   [rigEffect/audio-out -> speaker/audio-in]
GAINED: [freshEffect/audio-out -> speaker/audio-in]
n 6 -> 6   live "Moved cable"   undo "Undo Move cable (Ctrl+Z)"   ONE Ctrl+Z exact: true
```

**Esc mid-air** (`r1`, F): `is-connecting` goes `true -> false`, live `"Cable dropped."`, and the
subsequent `mouseup` is inert.

**blur / `pointercancel` mid-drag**: see RG-07. No reachable stuck state — after all three
cancellation attempts in a row a fresh drag still lands normally.

### 1C-01 — the pointer verbs, in a real browser (`r3`)

`.click()` on a menu row sends `mousedown -> mouseup -> click`, exactly as a player does.

```
NODE MENU   aria-label "On-Screen Keys menu"
  rows: Duplicate | Disconnect all cables | Delete | [Add categories] | Copy | Paste | Duplicate |
        Select all | Delete | Cancel
  DELETE (pointer): cards 4 -> 3   live "Deleted selection"   undo "Undo Delete selection (Ctrl+Z)"
                    menu closed: true   ONE Ctrl+Z restores: true
  DUPLICATE:  cards 4 -> 5
  COPY+PASTE: cards 5 -> 6
  SELECT ALL: 6 of 6 cards
```

The round-1 S1 is gone: the same click that measured `4 -> 4` with a silent live region now deletes,
names the entry, and round-trips in one press.

**The marquee survives.** The `stopPropagation` is scoped to `.context-menu-host` and did not
swallow the canvas's own `mousedown` anywhere else:

```
Escape closes the menu: true
marquee visible mid-drag after right-click + Escape: true
marquee visible mid-drag straight after clicking a menu row: true
```

### 1C-03 / 1C-04 — the phrases (`r3`)

```
Add Sampler (pre-wired) -> live "Added Sampler, wired"  undo "Undo Add Sampler (Ctrl+Z)"
Add Looper              -> live "Added Looper"          undo "Undo Add Looper (Ctrl+Z)"
rig install (fresh profile) -> live "Installed Jam rig" undo "Undo Install Jam rig (Ctrl+Z)"
```

"Added 1 nodes" and "Undo Add 4 cards" are both gone. `buildRig.ts:89` swapping
`graph.beginGesture()` for `useHistoryStore.begin('Install <label>', 'graph')` is exactly
equivalent — `beginGesture` *is* `begin('Edit graph','graph')` (`graphStore.ts:329-335`) — so the
only change is the label. `compound` is handled in `historyPhrase`, as reported.

The re-announce cycle, read as **raw DOM text** (the ` ` pad shown as a trailing space):

```
undo1  "Undo Add Looper"
redo   "Redo Add Looper"
undo2  "Undo Add Looper "     <- a different string from undo1
redo2  "Redo Add Looper "
undo3  "Undo Add Looper"      <- a different string from undo2
every consecutive pair differs: true      distinct spoken sentences: 1
```

The parity bit is gone; the two-deep window over what was actually **rendered** does what it claims,
and the words never change. (Still not read by NVDA/VoiceOver — see "Not verified".)

### Gates (all re-run by me)

| gate | result |
|---|---|
| `bunx tsc --noEmit -p tsconfig.app.json` | **clean**, exit 0 |
| `bun run lint` | exit 0, **zero warnings**; `bunx eslint . --max-warnings 0` also exit 0 |
| `bun run test:run` | **256 of 257 files pass**; 1 red |
| — the one red | `CommandBar.test.tsx > Tab from search sends the typed prompt to AI` — the recorded parallel-load flake. **Re-run alone: 20/20 pass.** Not UX-1E's, not this lane's |
| `bun run build` (`tsc -b && vite build`) | **GREEN** — `built in 7.96s`, PWA precache 87 entries |
| `bunx figma connect parse` (in `packages/oj-ui`) | **exit 0, 53 components** |

No UX-1E reds: the `typeFloor` failures and the `SkyBand.tsx:99` warning the fix round reported
mid-round are both resolved on the current tree.

### Everything else in the diff the fix round does not mention

Checked, and all of it is round-1 work this gate already passed, or another lane's:

- `src/keymap/{arbiter.ts,useKeymap.ts}` + `arbiter.test.ts` — U9, gated in round 1.
- `packages/oj-ui/**` `Port.tsx` / `PortRow.tsx` / `KeyTile.tsx` / stories / tests — U8, gated in
  round 1.
- `src/store/editingContextStore.ts:80` and `keybindingsStore.ts:233` — U11: the `'time'` tool name
  and its `arrangement.tool.time` binding removed because nothing read them. Correct under
  code-value #8, and no reader remains.
- `src/components/Shell/Topbar.tsx` / `Topbar.css` — this lane's undo/redo titles sit beside UX-1B's
  offline-chip and studio-presence work, exactly as 1C-12 says. `useCommandSources.ts` likewise
  carries UX-1B's `requestNewProject('new')`. Both are named in the report now.
- `src/a11y/announce.ts` — new, small, correct: a module-level emitter with an empty-string guard,
  which is what makes the pointer path's `announce(result.announcement ?? '')` safe.
- `plans/redesign-new-dna/COVERAGE.md`, `docs/timeline.md`, `e2e/**`, `PianoRoll/**`,
  `AppErrorBoundary*`, `Settings/*Panel*`, `StepGrid*`, `SkyBand`, `RulerStack`, `useClipGesture` —
  UX-1E / other lanes, ignored as instructed.

`docs/shell.md`'s new **cable grammar** paragraph (`:101-114`) is accurate as written against
everything I measured, including "there is no cable-**body** drag".

---

## Not verified (unchanged from the first gate)

- **Audio actually playing.** Still topology, focus and pixels only. The verbs reach the same
  `addConnection` the pointer always used, so the engine sees nothing new — an argument, not a
  listen. The founder should drive one keyboard connect and one input-grab **move** with a rig
  sounding before this lands.
- **A real screen reader.** The nonce fix was read out of the DOM, not heard.
- **Touch, native tier, other viewports.** Unchanged.
- **The ghost-port gesture in a real browser.** Not drivable — see RG-05. Unit-proven only.

---

*Dev server on 5252 stopped. No product file was edited; no git write was run.*
