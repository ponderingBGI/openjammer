# W4-P9 — Panels, dialogs and secondary surfaces (REDESIGN)

Lane: **P9** (Wave 4). Branch `t3code/openjammer-redesign-timeline`, same worktree.
Scope: every panel, dialog and secondary surface — Settings (all tabs), Guides, DevLog,
Plugins, Export, Dialogs, MIDI, Collab, AudioHealth, IssueReporter, Bench, the waveform
editor + clip visuals, the common separators/handles, and `AppErrorBoundary`.

Gates: `bunx tsc --noEmit -p tsconfig.app.json` ✅ (clean) · `bunx eslint src` ✅ (clean) ·
`bun run build` ✅ · owned vitest scope **16 files / 122 tests passing** (was 102; +20 net
new, 0 deleted) · browser sweep in light + dark with **zero console and zero page errors**.

---

## The one idea

Before this pass, "Settings" was five tabs that each invented their own row grammar: Audio
had `.oj-aud-row`, Updates had `.oj-upd-row`, Keybindings had `.keybindings-row`, About had
`.about-*`. The same setting looked slightly different depending on which tab you happened
to be on, and none of them agreed on where a label, a description and a control go.

**`SettingsPanel.css` is now the settings design system** — one `.oj-set-*` vocabulary
(section, section title, row, row text/label/description, row control, note, exact value,
actions) that Audio, Updates, About and Appearance all speak. Everything else in every
panel is an oj-ui part. That is the redesign; the literal-colour cleanup fell out of it.

---

## Per surface

### 1. Settings — `src/components/Settings/**`

**Change.** The hand-rolled `.minimal-settings-overlay` (its own scrim, its own `onKeyDown`
Escape, no focus trap, no focus restoration) is gone. The panel is an oj-ui **Modal**
(overlay Surface, xl radius, scrim, Escape, Tab trap, focus restore) with a **PanelHeader**
carrying the title, a per-tab subtitle and a version Chip, and a vertical **Tabs** sidebar.
Tabs renamed and reordered to read as a product: Appearance · Audio · Keybindings ·
Updates · About.

**The `SettingsPanel.css:97` contradiction is deleted.** That rule re-inked the active tab
with `inset 0 -1px 0 0 var(--text-primary)` in the narrow-viewport strip, which fought the
oj-ui contract that *selection RISES* (`--bg-node` + `--shadow-raised`). The narrow layout
now just wraps the same rising pills.

- **Appearance** — Theme (the existing 2-up `Swatch` radiogroup, kept, a11y intact), Density
  (`SegmentedControl`), First run → "Redo setup" (from S4).
- **Audio** — latency hero (`Surface` + `StatusDot` + a `--text-2xl` mono round-trip + verdict
  + `Chip`s for tier/rate/USB); Devices section using **`DeviceSelect`** on native (was a raw
  `Select` plus a floating bolt icon); Latency section with the `Toggle` and the tips
  `Callout`; Advanced disclosure with sample rate + **buffer hint as `SegmentedControl`** and
  click level as a real **`Slider`** (was a bare `<input type="range">`) with a mono `<output>`.
  Apply is `Button loading` (was a hand-built spinner+label that reflowed).
- **Keybindings** — see §2.
- **Updates** — hero + `ProgressBar` (indeterminate while checking, success when staged) +
  a "Staged" Chip; channel `SegmentedControl`; the rollback confirm is an in-panel danger
  `Callout`. The hero headline was a full sentence in the browser tier; it is now a headline
  ("Updates apply on reload") and the sentence lives on the row it explains.
- **About** — lede, version + licence `Chip`s, the diagnostics row, and two link buttons.

**States.** Tabs: rest / hover (colour only) / selected (rises) / focus ring. Rows: static.
Controls inherit oj-ui states. Disabled: the channel `SegmentedControl` when pinned.

**Screenshots.** `light|dark-settings-{appearance,audio,audio-advanced,keybindings,updates,about}.png`

### 2. Settings → Keybindings — the catalogue

**Change.** A search `Input`, a surface `SegmentedControl` (All / Global / Canvas /
Arrangement / Piano roll), live "N shown" + "N customised" Chips, then one section per
category with a **surface Chip on the heading**. Rows are `ListRow`s; the shortcut is an
oj-ui **`Kbd`** cap inside a ghost Button whose accessible name names the ACTION ("Change
the shortcut for Delete Selected") rather than the current key; a customised binding uses
`Kbd custom` (accent ink) and grows a revert `IconButton` in a **fixed-width slot** so the
cap never twitches sideways.

**Capture** is a bespoke box (there is no oj-ui part for "hold some keys and I'll read
them"): same footprint as the cap it replaces, accent border + the shared focus ring,
`role="status" aria-live="polite"`. The old version *blinked* on a 1s `pulse` keyframe.

**Conflicts** are an inline danger `Callout` **inside the row that raised them** — not a
second full-screen overlay stacked on the Settings overlay.

**UI-021 — the native `confirm()` is gone.** "Reset All to Defaults" now opens an in-panel
danger `Callout` (`role="alertdialog"`) with *Keep mine* / *Reset all*. `grep` over every
owned file: zero `confirm(`/`alert(`/`prompt(` calls (3 hits, all in comments explaining
why).

### 3. The keybindings catalogue — completeness

`src/store/keybindingsStore.ts` (catalogue + conflict UI only, per the ownership rule):

| | before | after |
|---|---:|---:|
| actions in `keybindingActions` | **68** | **169** |

**+101 timeline actions** added, every one of which a binding set already registered at
runtime and none of which was visible, rebindable or conflict-checked before:

- **Arrangement (36)** — `enter`, `exit`, `selectAll`, `muteClips`, `insertTime`,
  `deleteTime`, `moveTrackUp/Down`, `nudgeBarLeft/Right`, `selectSpatialLeft/Right/Up/Down`,
  `playFromSelection`, `loop`, `loopIn`, `loopOut`, `punch`, `metronome`, `addMarker`,
  `markerPrevious/Next`, `zoomIn/Out`, `fitSong`, `home`, `end`, `follow`, `snapToggle`,
  `gridCoarser/Finer`, `tool.{select,draw,erase,knife,time}` — i.e. the whole
  E/Q · V/B/X/K/T · L/I/O/P/M/F · `[`/`]` · Ctrl+M · Ctrl+Alt-arrows grammar.
- **Piano roll (65)** — 27 note-editing actions (undo/redo, selection undo/redo, cut/copy/
  paste/delete/duplicate, nudge ±fine, transpose ±octave, velocity ±, resize, quantize,
  escape/exit, transport), 5 tools, 12 step-entry keybed notes, and step advance/retreat/
  octave.

Grouped into new categories so the panel stays readable: `Arrangement`, `Arrangement
Transport`, `Arrangement View`, `Arrangement Tools`, `Piano Roll`, `Piano Roll Tools`,
`Piano Roll Step Entry` — each carrying its surface Chip.

**Two supporting changes, both inside "catalogue/conflict UI":**

1. `KeybindingAction.mode?: string`. Two actions on one surface whose modes are both set and
   *different* can never be live at the same moment (the piano roll's step-entry keybed is
   guarded on `stepEntry.trackId`, its tool letters on the negation), so `T` as
   *Step Entry F♯* and `T` as *Step Entry Tool* is not a conflict. `getConflictingActions`
   skips those pairs; everything else is unchanged (the existing scope test still passes).
2. `keyComboToString` now names `Escape` → `Esc` and `ArrowLeft` → `Left` etc. Spelled out,
   not glyphs: a keycap is read aloud as often as it is looked at.

**New test — `src/store/__tests__/keybindingsCatalogue.test.ts` (5 cases).** It reads the
source of every file that builds binding entries (`App.tsx`, `ArrangementSurface.tsx`,
`PianoRoll.tsx`, `DevLogPanel.tsx`, `AudioHealthPanel.tsx`, `PluginsPanel.tsx`), extracts
ids three ways (`actionId: 'x'`, the `[['x', …]] as const).map` tuple form, and the piano
roll's `canonical` map), and fails if any is missing from the catalogue. It also pins the
template-generated families explicitly, asserts a guard that the scan found >60 ids (so it
can never silently pass on an empty list), asserts **every id and every label is unique**,
and asserts every `arrangement.*`/`pianoroll.*` action carries a surface so conflicts stay
scoped. **UNVERIFIED:** the scan is a regex over source, not a runtime registry — the
binding sets are built inside components from live store closures and cannot be imported.
It under-reports rather than over-reports.

### 4. Guides — `src/components/Guides/**`

**Change.** `Guide.css` went **651 → ~440 lines** and is now literal-free (it had 23 literal
colours, including five tinted message cards and their icons drawn in raw hex — which is
exactly why a guide's "warning" looked nothing like a warning anywhere else).

- `GuideContainer` → oj-ui **Modal + PanelHeader**. It used to be a `role="dialog"` div with
  a hand-rolled Escape and **no focus trap at all**.
- `GuideInfoBox` → a thin adapter over **`Callout`** (info/success/warning/danger/tip).
- `GuideProgress` → **`ProgressBar`** (solid token fill, never the old gradient) + a mono
  count + a platform **`Chip`** using the shared `IconWindows/Apple/Linux`.
- `GuideStep` → the shared **`Spinner`** for `in_progress`, plus a visually-hidden status
  word so the state is never colour alone. **`in_progress` is the one state that draws the
  eye**: accent marker + the row lifts onto the node surface with `--shadow-raised`.
- `GuideTester` → its result is a `Callout`; its spinner is the shared one.
- **UI-026 follow-up:** the `GuideSection` header was a `<div onClick>` — now a real
  `<button aria-expanded>`, so Tab/Enter/Space work.
- Nine inline `style={{…}}` objects in `LowLatencyGuide` became `.guide-substep-*` classes.

**Two real bugs found by looking at the render and fixed:** the collapsed "Completed"
section was being squashed to an **8.8px hairline** by the column flex scroller (items
shrink by default — `.guide-content > * { flex: none }`), and the tester's inline SVG
glyphs had no box so they inflated to **45.7px**. The same shrink trap was pre-emptively
closed in the MIDI browser and the Plugins results list.

**Screenshots.** `light|dark-guide-lowlatency.png`

### 5. DevLog — `src/components/DevLog/**`

Level filter Chips keep `pressed` and their live counts but **lost their dot** (Chip renders
dot glyphs as nothing by contract anyway, and a dot in a chip reads as a second competing
signal). Rows are `ListRow`s with the **`StatusDot` on the row, beside the level word**;
timestamps and the whole table are mono with tabular figures; level colour is `*-ink`
everywhere, never the raw state hue, because it is 11px text on a tinted row. A ghost
**Copy** button copies exactly the filtered view, tab-separated. The correlation strip gained
a StatusDot and a `role="status"`.

**Bug found in the render:** the panel body is 960px but the Modal was `size="lg"` (760px),
so the search field and the entire "Ask AI to fix this" button were **clipped off the right
edge**. Now `size="auto"`.

**Screenshots.** `light|dark-devlog.png`, `reduced-motion-devlog.png`

### 6. Plugins — `src/components/Plugins/**`

Rows are `ListRow`s: name, vendor, family **Chip**, format **Chip**, and — only when there
is something to say — a `StatusDot` + words. **Every row used to say "● Ready" in green**;
a state colour on every healthy row is decoration, and decoration in a state colour is what
Signal-Not-Brand forbids. Benched plugins keep the 45° hatch (now 1px on 7px, `oklab`
mixed) plus a warning "Benched" Chip. Re-scan is a ghost Button that becomes
`Spinner + "Scanning…"`; the scan indicator is an indeterminate `ProgressBar` hairline along
the footer. Detail paths use `CodeBlock`.

**Three honest empty states** replace one shrug: filtered-to-nothing, a build that cannot
host plugins at all, and a genuine zero-result scan (with the folder count). The quarantine
drawer is a `Callout` + a `List`. Family chips are keyboard-operable with the shared ring.
`PluginWindowShell` is rebuilt from `IconButton`/`Menu`/`Toggle`/`StatusDot`/`Callout`; its
two 2px ink borders are hairlines and the unsaved marker is a dot **plus the word
"Unsaved"**. The dead `.oj-segmented-control` selector (the class does not exist; it is
`.oj-seg`) is gone.

`tokenLiteralGate` (Plugins + Bench literal gate, and the undeclared-variable gate over
Arrangement/Export/Plugins/Bench) stays green.

**Screenshots.** `light|dark-plugins.png`

### 7. Export dialog — `src/components/Export/**`

Format and bit depth were one `<select>` of five strings ("WAV 24-bit — recommended", "FLAC
16-bit — desktop only", …). They are **two decisions** now: a format `SegmentedControl` and a
bit-depth one whose options depend on the format (choosing FLAC drops 32-bit float rather
than keeping an illegal pair). Sample rate is a 4-up `SegmentedControl`. The tail is a
`SegmentedControl` + a mono **`ValueScrubber`** (was a number input plus a stray "seconds"
span). The preflight estimate is a mono `Chip`.

**The result is an honest `Callout` whose VARIANT is the verdict** — clipped → danger,
hot → warning, clean → success — with the three numbers in mono, each with its own dot, and
the path + actions inside it. The 2px-ink `fieldset` border is gone; `--accent-warning` /
`--accent-danger` as small text became `*-ink`.

**Found by looking at the render:** in the browser tier both controls were *disabled*
`SegmentedControl`s, and `.oj-seg.is-disabled` dims the whole control at 0.45 — so you could
not read which segment was selected. Off the desktop there is no choice to make, so the
value is now **stated** as a Chip with the reason beside it.

**New test — `src/components/Export/__tests__/ExportDialog.test.tsx` (7 cases):** the two
controls on desktop, the FLAC/32f pair fix, the browser tier stating its fixed values,
the four rates, the tail scrubber's appearance, the filename requirement, and the mono
preflight.

**Screenshots.** `light|dark-export.png`, `light|dark-export-fixed-tail.png`

### 8. Dialogs + MIDI

**RelinkSamplesDialog** — already Modal-based; rows are now hairline-separated rather than
gapped (a missing-file list is one document you work down), the footer rule is `--border-subtle`,
copy tidied.

**MIDIDeviceCard** — a real `<button>` with New DNA card physics (surface, one hairline,
sh1, `translateY(-2px)` hover, `scale(.96)` press, focus ring), an inset icon plate, and
**"Connected" as success-ink text beside a `StatusDot`**. Gone: the inset green ring, the
`statusPulse` glow keyframe, and two `rgba(0,0,0,…)` shadows.

**MIDIDeviceBrowser** — one scroller instead of two stacked ones (two independent scrollers
made it read as two panels), a "N connected" Chip in the header, a `Callout` empty state
that says a preset only adds labels and a picture, and a keycap footer
(`Tab` / `Enter` / `Esc`). Every card is a real button, so the browser is fully
Tab-operable and Escape is the Modal's.

**MIDIConnectionToast** — rebuilt on **Banner physics** (raised Surface, tone tints the title
only, actions pinned trailing) with a drawn 5-pin DIN glyph instead of an emoji on a glowing
gradient plate, and the auto-dismiss countdown as a hairline `ProgressBar` along the bottom
edge (1s linear, `transition: none` under reduced motion).

**Screenshots.** `light|dark-midi-browser.png`

### 9. Collab — `src/components/Collab/**`

**25 literals gone, including `box-shadow: 0 0 6px #22c55e`.** The control is no longer a
`position: fixed` island at `top:16 right:16` — it is a popover anchored to its own trigger
in the topbar's right cluster, with click-outside and Escape (restoring focus to the
trigger). The panel is an overlay `Surface`; the form is `Field`s; the peer list is
`ListRow`s with an 8px flat dot.

**PresenceOverlay** — the cursor label was `#fff` text on the peer's own arbitrary colour,
i.e. unknowable contrast. It is now a surface chip with the peer colour as an 8px dot
beside `--text-primary` text. The arrow keeps the peer fill but its outline is
`stroke: var(--bg-node)` in CSS, not a literal white in the TSX. The selection ring lost its
`0 0 0 1px` halo and its 2px dashed border became 1.5px.

`peer.color` is the **one** inline colour left in the lane, and it is data — each peer picks
their own — painting only a dot and a cursor fill.

**Screenshots.** `light|dark-collab.png`

**Coordination note (not a defect):** `Topbar.css:107-114` (lane S4) still carries three
declarations that sit the old floating island down (`position: static` + explicit panel
`top`/`right`). They are now obsolete — the control anchors itself — and the S4 comment says
they are "the only thing to delete when P9 restyles it". I did not touch that file. The
popover renders correctly either way; with the override removed it will also gain its
8px gap under the trigger instead of hanging off the window edge.

### 10. AudioHealth · IssueReporter · Bench

**AudioHealth** gained the thing it most needed: **a one-sentence verdict Callout above the
table**, whose variant is derived from the same numbers ("116 ms round-trip is too much to
play against" + what to do). It never says all-good while the engine is stopped. Rows are
`ListRow`s with mono tabular values; `md` instead of `sm` so nothing wraps.

**IssueReporter** — a "Local only" success Chip and a subtitle in the header; the redaction
notice is a `Callout` that turns warning when the log tail is truncated; footer buttons are
ghost + primary.

**Bench** — 2px ink borders → hairlines with `--shadow-raised`; hard-coded sizes → tokens;
the ghost-mode tab's count is warning-ink mono; Banner actions are primary + ghost. Stays in
the `tokenLiteralGate` scope, green.

### 11. Clips — `src/components/Clips/**`

**WaveformEditorModal** — the hand-rolled portal + `rgba(0,0,0,.7)` scrim is an oj-ui
**Modal**; the header is a **PanelHeader** with a live "N s of M s" selection Chip; the
footer has the zoom `Slider` with a mono readout and ghost/primary actions.

**The Canvas-2D drawing is now themed.** The DSP and geometry are untouched; a
`readWavePalette()` helper reads the live tokens from
`getComputedStyle(document.documentElement)` **once per render pass** (not per pixel column)
and the draw calls use it. The cropped region washes toward the panel ground instead of
black, so it darkens in dark mode and lightens in light mode. **No literals remain in the
TSX** (it had `#1a1a1a`, `rgba(0,212,170,…)`, `#3b82f6` and six white/black alphas).

**7 dead selectors removed** — `.waveform-editor-info`, `-info-row`, `-label`, `-value`,
`-value.highlight`, `-btn-small`, `-hint` (plus the duplicate `.waveform-editor-zoom` block
above the actions row). All were left over from an info bar the actions row replaced;
verified absent from the TSX.

**AudioClipVisual / ClipDragLayer** now state the **WaveformView physics** explicitly (the
CSS says so, with a note to change both together): surface + hairline + sh1, grab cursor,
`scale(0.96)` + overlay shadow while dragging, 1.5px accent outline selected, dashed for a
drop target. Gone: the teal `drop-shadow` halo on the trace (only signal glows), the 2px
accent ring, the 16px success halo on a drop zone, and six black-alpha shadows. An invalid
drop target is quieted, not painted alarm-red.

### 12. common — `src/components/common/**`

**PanelSeparator** — tokens only (it carried three literal fallbacks, so a broken theme
produced a *blue* grip from the retired palette). Both orientations kept: `direction` is a
public prop of a shared component.

**ResizeHandles** — corners are 1.5px hairlines, edges reveal a pill bar, hover/active take
the accent; nine literal grey fallbacks gone.

> **The audit's "8 of 14 selectors dead" is a FALSE POSITIVE and they are deliberately kept.**
> The detector is a substring match over `.ts`/`.tsx`, and this component builds class names
> with a template literal — `resize-handle-${handle}` — so no direction class ever appears
> literally in source. All eight are reachable: `handles` is a public prop whose **default is
> all eight** (`ALL_HANDLES`); the one caller today (`LibraryNode`) passes `['se','e','s']`.
> Deleting the other five would leave the component's own default rendering unstyled grips.
> Documented in the file header. Keep-on-doubt.

**ScrollContainer** — new 8-line `ScrollContainer.css` carrying only `scrollbar-width` +
`scrollbar-color` on an `oj-scroll` class the component now applies. The WebKit
`::-webkit-scrollbar*` rules in `global.css` are global and are **not duplicated**; what
they cannot express is the standard property Firefox uses, without which every scroller in
the app shows an OS-grey bar on a warm surface. The class is also applied to the Settings
pane/sidebar, the DevLog list and the Plugins results.

### 13. AppErrorBoundary — literal-only **on purpose**

Rewritten to the New DNA light palette in literals, with a `prefers-color-scheme: dark`
block, as a **Callout-shaped card**: surface fill, 1px hairline, 12px radius, layered soft
shadow, danger-ink title, the raw message in mono on the inset, flat inset buttons with
`scale(.96)` press and one focus ring. A `prefers-reduced-motion` block kills the press.

The **why** is documented at the top of both the CSS and the TSX: `main.tsx` imports this
file directly and mounts the boundary outside the app tree, because it renders when the app
tree has failed — and that failure may *be* the theme layer (the semantic tokens are written
onto `document.documentElement` at runtime by `applyTheme()`, so a crash before or during
that call leaves every `var(--x)` empty). A recovery card that renders black-on-black is not
a recovery card. The palette it transcribes is listed in the header, with the standing
instruction to update it by hand in the same commit if the palette moves.

---

## Contrast — measured, both themes

Measured by painting each token into a 1×1 canvas and reading the sRGB bytes back.
(The first run used `getComputedStyle().color` and produced **nonsense for every `oklch()`
token** — Chromium serialises those as `oklab(...)`, which a naive rgb parser reads as
garbage. Worth knowing for other lanes.)

| pair | light | dark |
|---|---:|---:|
| **muted on inset** (chips, keycaps, mono values) — *the tightest* | **4.57** | **4.50** |
| muted on surface | 5.49 | 5.05 |
| muted on header (settings sidebar) | 5.22 | 4.87 |
| secondary on surface (row descriptions) | 7.13 | 6.93 |
| secondary on inset | 5.92 | 6.18 |
| primary on surface | 17.05 | 14.36 |
| primary on inset (keycap on hover) | 14.17 | 12.81 |
| danger ink on surface (conflict callout) | 6.72 | 6.39 |
| danger ink on inset | 5.59 | 5.70 |
| warning ink on inset (benched chip) | 5.11 | 7.25 |
| success ink on surface (connected) | 6.39 | 6.80 |
| accent ink on surface (custom keycap) | 6.43 | 6.68 |
| audio ink on surface (Info level) | 6.53 | 6.78 |
| on-accent on accent (primary button) | 5.08 | 6.27 |

**Everything clears AA (4.5:1) for normal text in both themes.** The tightest pair is muted
text on the inset — the keycaps, the chip counts, the mono readouts — at 4.57 / 4.50. That
is a floor with no headroom: if `--text-muted` or `--bg-tertiary` moves at all, these go
under. Flagged for the token owner.

## Keyboard, focus, motion

- **Escape closes Settings: verified** (`escapeClosesSettings: true` in the browser run, plus
  a unit test). The S4 gate's UNVERIFIED item is closed.
- **Focus trap verified** in the browser (16 Tabs cycle through 5 stops, all inside the
  dialog, never escaping) and unit-tested for both Tab and Shift+Tab.
- **Focus restoration verified**: focus returns to the element that opened the dialog.
- Sidebar tabs are a roving-tabindex `tablist`; Arrow keys move *and* select.
- `prefers-reduced-motion` pass captured; the blanket rule from W1-S0S1 plus the Modal's own
  `animation: none`, the Spinner's held arc, the indeterminate ProgressBar's static fill and
  the toast countdown's `transition: none` all apply.

## Hygiene

- **Literal colours in owned files: 0** outside `AppErrorBoundary.css` (grep over every owned
  `.css` and `.tsx`).
- **Inline colour styles: 3**, all `peer.color` — data, not a literal.
- **Native `confirm()`/`alert()`/`prompt()`: 0** (3 grep hits, all comments explaining why).
- `tokenLiteralGate` green, including the undeclared-custom-property gate.

## Screenshots

`plans/redesign-new-dna/.scratch/w4-p9/` — **45 PNGs**, both themes:

`{light,dark}-settings-{appearance,audio,audio-advanced,keybindings,updates,about}` ·
`{light,dark}-keybindings-{search,surface-pianoroll,capturing,conflict,custom-cap,reset-confirm}` ·
`{light,dark}-{guide-lowlatency,devlog,audiohealth,plugins,issuereporter,collab,midi-browser,export,export-fixed-tail}` ·
`keyboard-settings-focus` · `reduced-motion-{settings-keybindings,devlog}` ·
`browser-results.json` (contrast, tab order, errors) · `verify.mjs`, `probe.mjs` (the harnesses).

Harness: `node plans/redesign-new-dna/.scratch/w4-p9/verify.mjs` against a dev server on
5221 (node, not bun). The dev server has been stopped.

---

## Deviations

1. **The keybindings panel is grouped by CATEGORY with a surface Chip per group**, not by a
   surface heading. Reason: `View` legitimately spans global *and* canvas actions, so a
   surface-first tree would print "View" twice; and the existing test iterates categories.
   Surface is still first-class — it is the filter and the chip.
2. **`KeybindingAction.mode`** is a small addition to the store beyond a pure catalogue
   append. It is what keeps the conflict UI honest for the piano roll's two mutually
   exclusive modes; without it, rebinding a tool letter reports a false conflict with the
   step-entry keybed.
3. **Export in the browser tier states its values as Chips** rather than showing disabled
   controls (§7). This is a deliberate departure from "format/bit depth as SegmentedControl"
   for the tier that has no choice to make.
4. **`ScrollContainer.css` is a new file** (8 lines). The brief said not to duplicate the
   global WebKit rules; it does not — it carries only the standard property those rules
   cannot express.
5. **Emoji device glyphs are kept** on `MIDIDeviceCard` (calmed onto an inset plate). They
   carry device type and there is no icon set for keyboard/pads/generic yet. Candidate for
   the oj-ui icon set later.
6. **`GuideStep`, `GuideTester`, `GuideProgress` keep their own class vocabulary** rather
   than being folded into oj-ui. They are guide-specific compositions of oj-ui parts; a
   `Guide*` family in the library would be app logic in a presentational package.

## UNVERIFIED

- **`RelinkSamplesDialog` has no screenshot.** It is reachable only from a library whose
  sample files have gone missing on disk, which a headless run cannot manufacture. The
  changes to it are small and CSS-only (hairline row separators, `--border-subtle` footer
  rule, copy). Needs a founder pass with a real broken library.
- **`PluginWindowShell` has no screenshot.** It renders in a separate Tauri plugin window; it
  does not exist in the browser tier. Rebuilt from oj-ui parts and typechecks, but the live
  layout is founder-verify-on-native.
- **The native-only halves of Settings → Audio** (the `DeviceSelect` output picker, the
  "Capture mic" row, the negotiated-buffer breakdown row) render only under Tauri. Same for
  Updates' auto-update controls, rollback and the pinned banner — the browser pass exercises
  the manual-download path only.
- **The keybindings-catalogue completeness test is a source scan**, not a runtime registry
  (reasoning in §3). It under-reports.
- **`bun run build` needed the dev server stopped first** — a concurrent `dist/assets` lock
  from another lane produced an `EPERM` on the first attempt. Green on the retry.
- **Mid-run, `tsc` briefly reported errors in `Arrangement/**` and `PianoRoll/**`** (a missing
  `./TransportStrip`, a `ClipDragPreview` shape change) while lane W4-TB was editing the
  shared worktree. Those files are not mine; the final `tsc` and `eslint` runs are clean.
- **No audio was played.** Nothing in this lane touches the audio path, but per the covenant:
  a taste-tier model or a human should sign off on feel with sound running.
