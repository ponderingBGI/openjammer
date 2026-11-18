# 02 — Timeline interaction specification (New DNA)

Surface scope: the **arrangement** surface, the **piano roll** (inline lane + full surface),
the **transport**, the **mixer drawer**, and **automation lanes**.

Grounding rule used throughout: every element maps to something that already exists in
`src/song/types.ts` / `src/song/verbs.ts` / `src/song/ops.ts`, or is marked **[NEW]** with the
verb it must lower to. No parallel model is introduced. View-only state (zoom, lane height,
tool, follow) lives in `editingContextStore` / `trackLaneViewStore` and is **never** a verb.

Token roles are the New DNA names (`canvas / surface / inset / header / t1 / t2 / t3 / line /
line2 / acc / acc-hi / acc2 / ok / warn / bad / audio / ctl / on-acc / sh1 / sh2 / ring`).
Type: **Outfit** for all functional UI, **JetBrains Mono** for every exact value
(bar.beat, BPM, dB, tick, pitch, velocity, grid unit).

---

## 1. Principles for this surface

1. **Every gesture previews at 60 fps from local state and commits exactly one verb batch.**
   `beginGesture → previewGesture(…) → commitGesture` is the only shape; one release =
   one Ctrl+Z. Aborting (`Escape`, `pointercancel`) restores the pre-gesture document exactly.
2. **The playhead is the engine clock, never a timer.** Every moving pixel is derived from
   `arrangementStore.currentTick()` inside one `requestAnimationFrame` writing directly to
   `style.transform` — never React state, never `setInterval`. If the engine stops sending
   frames the playhead freezes honestly rather than drifting.
3. **Snap is felt, not fought.** Magnetism is a short-range assist toward *meaningful*
   anchors; a held modifier suspends it instantly and mid-drag; the snap that actually moved
   your value is shown as a hairline, so the grid never lies about what it did.
4. **Nothing moves under the cursor.** No auto-scroll while the pointer is stationary, no
   reflow on hover, no lane growing under a press, no smooth follow-scroll while a gesture or
   a hover-target is live. Follow-playhead pages, and disarms itself the moment you touch the field.
5. **No modal mid-set.** Every destructive or configuring interaction is either inline
   (rename in place, scrub in place) or a non-blocking popover dismissed with `Escape`.
   Errors are a chip in the chrome, never a dialog. `a held note beats a glitch`: an edit that
   the engine cannot take right now keeps the last good sound and marks itself, quietly.
6. **Calm ground, loud signal.** The field is `--canvas`/`--inset` with 1px `--line`
   hairlines. Saturated colour is reserved for **selection** (`--acc`), **transport state**
   (`--acc`, `--bad`), and **live level** (`--ok`). Only meters and the per-track level bead
   may animate with signal. Nothing else glows, ever.
7. **Legible in a dark room with cold hands.** All UI text ≥ 13px (mono micro-labels ≥ 9.5px
   uppercase, values ≥ 12px mono); interactive hit targets ≥ 24 × 24 px fine / 44 × 44 px
   coarse; ruler bar numbers always readable at every zoom via stride laddering.
8. **One vocabulary for hand, keyboard, palette and agent.** If a gesture cannot be expressed
   as a `Verb` (or an `EDIT_OPS` op), it is not shippable. §10 lists every gap.

---

## 2. Layout & chrome

### 2.1 Surface shell

```
┌────────────────────────────────────────────────────────────────────────────┐
│  SKY BAND  56px                                                            │
│  [song title · Tab hint]        ((( TRANSPORT PILL )))     [util cluster]  │
├──────────────┬─────────────────────────────────────────────────────────────┤
│ TOOL CORNER  │  RULER STACK  64px  (sections · braces · bars)              │
│   200×64     ├─────────────────────────────────────────────────────────────┤
│ TRACK HEADERS│  RULED FIELD  (grid canvas · clips · playhead · selection)   │
│   200 wide   │                                                             │
│   sticky-left│                                            sticky-top ruler  │
├──────────────┴─────────────────────────────────────────────────────────────┤
│  MIXER DRAWER  188px (collapsible, `M`)                                    │
└────────────────────────────────────────────────────────────────────────────┘
```

One scroll container owns both axes. The **ruler stack** is `position: sticky; top: 0` and
the **header column** is `position: sticky; left: 0` *inside that same scroller* — the browser
does the pixel-locking. No rAF-synchronised `translateX` compensation anywhere (that is the
source of the current one-frame shear between ruler and field).

**Pixel-lock rule.** Grid lines, ruler ticks, clip left edges, clip widths, the playhead and
the loop brace all derive x from the same helper:
`x = Math.round(tick * pxPerTick) + 0.5` for 1px strokes (`crispLineX` in `src/song/rulerMarks.ts`),
`Math.round(tick * pxPerTick)` for boxes. A clip edge must land *exactly* on its grid line at
every zoom level.

### 2.2 The transport pill — ONE pill, shared by canvas / arrangement / piano roll

**Decision:** a single `<TransportPill>` component, top-centre, is the only transport UI in
the app. It replaces `TransportStrip` (52px bar), the canvas transport, and the bar.beat
readout in `SharedSurfaceChrome`.
*Why:* the New DNA handoff specifies it; the covenant forbids a forked parallel version of a
control; and the performer's hands learn one place for "is it running and where am I" across
all three surfaces. Ruled surfaces **reserve** the 56px sky band above the ruler so the pill
never occludes bars — the pill's position rule stays identical everywhere.

Geometry: height **44px**, radius **99px**, `background: --surface`, `1px solid --line`,
`box-shadow: --sh2`, padding `6px 14px 6px 6px`, gap `10px`, hairline `1px --line` dividers
between zones. Centred with `left: 50%; transform: translateX(-50%)`, `top: 6px`.

| # | Zone | Control | Spec |
|---|---|---|---|
| 1 | Transport | **Play / Stop** | 32px circle, `--acc` fill, `--on-acc` glyph. Hover `scale(1.08)`, press `scale(.92)` (spring 260ms). Cold-load attention pulse: `scale 1 → 1.09`, 1.6s loop — **only** before the first user gesture of the session **and never while `isPlaying`, `isRecording`, or any clip/note exists in a rolling session** (a pulsing button on stage is noise). |
| 2 | Transport | **Record** | 28px, `--bad` ring; filled + 1200ms pulse while `isRecording`; 48% opacity when armed tracks exist but the playhead is outside the punch range (`punchRecordState() === 'outside'`). Disabled + tooltip "Arm a track first" when `armedTrackIds` is empty. |
| 3 | Transport | **Return to start** | 24px `↤`, `--t2`. Also `Home`. |
| 4 | Time | **bar.beat.tick readout** | 15px/500 JetBrains Mono, tabular-nums, `--t1`, min-width `8ch`, format from `formatBarBeat()` (`3.2` → `3.2.480` only when mid-beat). **Click to type** a position → `arrangementStore.seek()`. `--t3` while `transportPending !== null` (honest "not confirmed yet"). |
| 5 | Time | **BPM scrubber** | `120.0` + `BPM` micro-label (12px/600 mono value, 9px uppercase `--t3` label). `cursor: ew-resize`. Drag: `Δbpm = Δx / 3`, `Shift` = /10 (fine), `Alt` = ×5 (coarse). Clamp **20–300**. Double-click to type. Commits **one** `setTempo` verb on release. |
| 6 | State | **Loop** | `↻` 28px icon-button, `aria-pressed`. On = `--acc` glyph on `--inset`. Mutually exclusive with punch (already enforced in the store). |
| 7 | State | **Metronome** | `♩` 28px. Click toggles `setClick`. Long-press / right-click → count-in popover: `Off · 1 bar · 2 bars` (a `0/1/2` superscript renders on the glyph when > 0). Merges today's separate `♩` and `C1/C2` buttons. |
| 8 | Signal | **Live meter** | 6 bars × 3.5px wide, 18px tall, 2.5px gap, `--ok`, `transform: scaleY(var(--sig))`, `transition: 60ms linear`. Turns `--bad` above 0.99 and latches red for 1.2s (clip indicator). Fed from `subscribeSignalLevels()['__master__']`. **This is the only element in the pill that may animate with sound.** |

**Not in the pill: undo / redo.** *Why:* the pill is shared across surfaces and carries only
what is true on every surface and is about time. Undo is document-scoped, already global via
`Ctrl+Z`, and two extra buttons cost attention on stage. Undo/redo live in the sky band's
**utility cluster** (right, flush): `↶ ↷ | Grid chip | Mix | Export | ⋯` — 34 × 34 icon
buttons, `--t2`, disabled at `--t3` 45% when `canUndo/canRedo` is false.

Sky band left: song name (15px/600 Outfit, click-to-rename inline) + `Tab` keycap hint
(11px mono on `--inset`, 5px radius) reading "canvas".

### 2.3 Ruler stack — 64px, three rows

| Row | Height | Contents | Colours |
|---|---|---|---|
| Sections & marks | 22px | `kind: 'section'` chips (name, spans to next section/`songEnd`) and `kind: 'mark'` pins (7px triangle + name) | chip: `--inset` fill, `1px --line`, label 11px/600 Outfit `--t2`; selected chip: `--acc` 1.5px outline + ring |
| Loop / punch braces | 14px | loop brace (`--acc`, 3px tall bar with 7px end caps), punch brace (`--bad`, dashed) | empty row is `--canvas` |
| Bars | 28px | bar numbers (11px mono `--t3`) + tick marks per `getGridLadder()` stride | major bar `--line2`, beat `--line` |

Corner (200 × 64, sticky both axes, `--header` bg): grid chip (`1/16`, 12px mono on `--inset`,
click cycles, right-click = full list), magnet toggle (`∩`, `aria-pressed`), tool segmented
control (`V B X`), follow-playhead toggle (`⇥`).

### 2.4 Track headers — 200px wide (drag-resizable 160–320, view state)

Grid rows: `26px` (name) / `24px` (controls) / `1fr` (level bead + instrument chip).

- **Colour swatch / stripe**: 4px full-height bar on the left, `track.color` or the paper
  palette fallback. Selected track → 6px + `--acc`. Click swatch → 8-swatch popover →
  `setTrackName`-sibling verb `setTrackColor` **[NEW verb, see §10]**.
- **Name**: 14px/600 Outfit, ellipsis. Double-click → inline `<input>` (`--surface`,
  `1px --line2`, `--ring` on focus); Enter commits `setTrackName`, Escape reverts.
- **M / S / R**: 24 × 24 (`LaneButton`). Mute on = `--warn` glyph; Solo on = `--acc2` glyph;
  Record-arm on = `--bad` ring, recording = filled + pulse. Ctrl/Cmd+click Solo = exclusive
  solo (clears other solos in one compound verb). Alt+click M = "mute everything else".
- **Level bead**: a 3px × header-width bar under the name, `--ok`, `transform: scaleX(--sig)`.
  **This is the only glowing/animating element in the field region.** *Why:* "sound is
  visible" must answer "which track is making that noise?" without repainting every clip at
  60 fps, and the header is stationary so it never smears the field.
- **Automation `A`** and **instrument chip** as today.
- **Lane divider**: the bottom 5px of the header + lane is a `ns-resize` grip.

### 2.5 The ruled field

- Ground `--canvas`; alternate lane tint `--inset` at 40% for odd tracks; lane divider
  `1px --line`.
- Grid drawn on a `<canvas>` (existing `GridLayer`): bar `--line2`, beat `--line`, subdivision
  `--line` at 55% alpha; section markers 2px dashed `--acc2` at 45%.
- Past the song end: `--inset` wash (existing `.arrangement-song-end`) — the honest edge of the piece.
- **Clip**: radius 6px, `background: color-mix(in oklab, var(--track-tint) 12%, var(--surface))`,
  `1px solid --line`, 2px left border in the track tint, `--sh1`. 18px name bar at the top
  (13px/600 Outfit, tint 24%). MIDI content = `--t2` note rectangles at
  `0.55 + 0.45·vel/127` alpha; audio = waveform in `--audio` (teal).
  - selected → `1.5px --acc` border + `--ring`, **no fill drench** (background shifts by 6% only)
  - muted → `--inset` fill, name struck through, content at 40%
  - dragging → `--sh2`, 96% opacity
  - locked (`clip.locked`) → 1px dashed `--line2` border, `cursor: not-allowed` on edges
  - faulted host (plugin latch) → `--warn` 1.5px border + a `⚠` chip in the name bar
- **Playhead**: 2px `--acc` when rolling, 1.5px `--t2` when stopped, with a 9px triangular
  cap sitting in the bars row. **No glow.** State is carried by colour + motion, not blur.
- **Loop wash**: `--acc` at 6% over the loop span, full field height.
- **Range selection**: `--acc` at 10% fill, 1px `--acc` vertical edges, with a bar.beat label
  chip at each edge (11px mono on `--surface`).

### 2.6 Mixer drawer & automation lanes

Mixer drawer: 188px tall, bottom, `--header` bg, `1px --line` top hairline, one 124px strip
per track + 92px master. Strip: name 13px/600 · vertical fader (18px `--surface` thumb,
6px `--inset` track with `--acc` fill) · 8px × 76px meter (`--ok`, `--bad` when clipping) ·
`-6.0 dB` 12px mono readout · pan scrubber pill (`C` / `L34` / `R80`) · M/S.

Automation lane: 96px (existing `AUTOMATION_LANE_HEIGHT`), inset one hairline below its track.
Header row 28px: parameter `<Select>` · live value (12px mono) · `Off | Play` segmented ·
`Step | Linear` segmented. Field: default-value hairline `--line`, curve
`1.5px --acc2`, points 9px `--surface` circles with `1px --line2` (hover → `--acc2` fill,
selected → `--acc` + ring).

### 2.7 Piano roll layout

| Region | Size | Notes |
|---|---|---|
| Toolbar | 40px | tool segmented (`V B X K T`, 28px each) · grid chip · `Quantize` button · `⋯` opens quantize popover (grid / strength / swing / snap-start / snap-end) — the three number fields leave the always-on chrome |
| Scroomer | 12px | pitch-range window, drag to pan, drag its two `<b>` handles to zoom (exists) |
| Key bed | 48px pitched / 72px drum | white keys `--surface`, black keys `--inset`, C rows labelled 11px mono `--t3`, seam hairline at C and F; drum rows show GM names |
| Note field | fills | rows tinted: black-key rows `--inset` at 45%, C rows get a `--line2` top hairline |
| Velocity lane | 64px (56 field + 8px grip) | lollipops: 2px `--t2` stem + 7px head, selected `--acc` |

Row height: `clamp(6px, fieldHeight / pitchSpan, 22px)` (today's floor of 3px makes a note
ungrabbable). Note body: radius 3px, `--acc2` fill at `velocityOpacity()`, selected `--acc`
1.5px outline + ring; notes belonging to *other* clips render at 22% `--t3`, non-interactive.

---

## 3. Gesture catalogue

Global gesture laws:

- **Pointer Events only.** Every drag: `setPointerCapture` on press, window-level
  `pointermove/pointerup/pointercancel` listeners, cleanup on both paths (the current
  `useClipGesture` pattern). `touch-action: none` on clips, notes, the ruler, braces, points,
  faders and lane dividers; `touch-action: pan-x pan-y` on the scroll container.
- **Threshold** (`dragController.ts`, pinned by BC-12): **4px** to begin a drag; **12px
  horizontal** for a copy-drag (`COPY_DRAG_X_THRESHOLD_PX`) so an Alt-click never silently
  duplicates — note a copy-drag still begins on **4px vertical**, only X is raised. Multiply
  by `uiScale` and by **1.75 on coarse pointers**.
- **Dominant axis** established at threshold crossing (BC-12) and *frozen* for the gesture.
  `Shift` constrains motion to that axis.
- **Snap** (BC-05/06): magnetic radius **12px** to grid anchors, **18px** to *meaningful*
  anchors (other clip edges, section/mark ticks, loop & punch edges, the stopped playhead,
  clip start/end of the dragged selection). Meaningful anchors win ties. Snapping is disabled
  entirely below 3px/grid-unit. *Deviation: today it is a flat 25px to everything (§12-D1).*
- **Snap override**: hold `Ctrl` (Win) / `Cmd` (mac) **during motion** — inverts the current
  snap mode for as long as it is held, re-evaluated every move. Press-time `Ctrl` still means
  "toggle selection", so the two never collide (press phase vs move phase).
- **Escape** during any drag aborts: `abortGesture()` restores the pre-gesture arrangement,
  the ghost disappears, selection is untouched. The keymap arbiter already forwards only
  `Escape` while `dragActive`.
- **Auto-scroll**: `autoScrollDelta()` ramps from the field edge, max 22px/frame, **only while
  the pointer is moving**; a stationary pointer at the edge stops scrolling after 400ms
  (principle 4).
- **Readout**: every drag shows a mono chip that follows the cursor 14px below-right —
  `4.1.240  +1.2.0` (absolute bar.beat.tick + signed delta). 12px mono, `--surface` bg,
  `1px --line`, 6px radius, `--sh1`.

### 3.1 Arrangement — clip

| Element / gesture | Cursor | Hover | Press → drag | Modifiers | Live preview | Snap | Constraints | Commits (verb / op) | Ctrl+Z restores | Esc | Touch / pen |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **Clip body — click** | `default` | 1px `--line2` border lift | select on press if unselected, on release if already selected | `Ctrl/Cmd` toggle · `Shift` extend range across tracks | — | — | — | selection only (no history entry; own selection stack, `Ctrl+Alt+Z`) | previous selection via `Ctrl+Alt+Z` | clears selection | tap = select; long-press 500ms = context menu |
| **Clip body — drag** | `grab`→`grabbing` | — | 4px | `Shift` axis lock · `Alt` copy (12px x-threshold) · `Alt+Shift` relative snap (keeps original offset from nearest anchor) · `Ctrl` held mid-move = snap override | whole selection moves together with one clamped delta | grid + meaningful anchors | clamp `startTick ≥ 0`; vertical target = the track under the pointer (`data-track-id`); ripple mode forbids track change | `moveClips` (Slide, BC-09) or `rippleTracks` (Ripple, BC-10); `duplicateClips` when Alt | exact prior positions, one step | abort | drag with `touch-action:none`; pen identical |
| **Clip left/right edge** (hit zone `min(8px, width/2−1)`, **12px coarse**) | `ew-resize` | 3px `--acc` edge bar appears | 4px | `Ctrl` snap override · `Shift` = trim *all selected* clips to the same absolute tick | edge follows pointer; body content stays anchored (source window preserved, BC-17) | as above | `lengthTick > 0`; start-trim clamped to `sourceStart ≥ 0` | `trimClipStart` / `trimClipEnd` | exact prior window | abort | 12px zone, no hover affordance needed |
| **Clip top half** | `default` | — | *(reserved: no separate behaviour)* | — | — | — | — | — | — | — | — |
| **Clip bottom half** | `default` | — | *(reserved)* | — | — | — | — | — | — | — | — |
| **Clip content (slip)** | `move` (`ns-resize` disallowed) | — | 4px, press with `Ctrl+Shift` | slip is **unsnapped by default**; hold `Ctrl` during the move to snap to grid | waveform / notes slide under a fixed window | inverted | `sourceStart ≥ 0`, `≤ sourceLength − lengthTick` | `slipClip` (BC-19) | prior `sourceStart` | abort | requires the context menu → "Slip" on touch |
| **Clip corner (top-right, 10 × 10)** | `pointer` | fade-in on hover | click | — | — | — | — | opens the clip context menu (same items as right-click) | — | closes menu | always visible on coarse pointers |
| **Clip fade handles** (top-left / top-right triangles, 8px, shown when selected) | `ew-resize` | triangle fills `--acc` | 4px | `Alt` = change shape instead of length | fade curve redraws | grid | `0 ≤ lengthTick ≤ clip.lengthTick` | `setClipFade` | prior fade | abort | 14px coarse |
| **Clip — double-click** | — | — | — | — | — | — | MIDI only | opens the inline piano-roll lane (`togglePianoRoll`); on an audio clip opens the waveform editor | — | — | double-tap |
| **Clip — right-click / long-press** | — | — | — | — | — | — | — | context menu: Open piano roll `E` · Split at playhead `S` · Duplicate `Ctrl+D` · Rename · Mute `0` · Lock · Fades · Bounce · Colour · Delete `Del` | — | Esc closes | long-press 500ms, < 8px movement |

### 3.2 Arrangement — field, ruler, locations

| Element / gesture | Cursor | Press → drag | Modifiers | Preview | Snap | Commits | Ctrl+Z | Esc / touch |
|---|---|---|---|---|---|---|---|---|
| **Empty lane — drag** | `crosshair` | 4px | `Alt` = object marquee instead · `Shift` = extend the existing range | translucent `--acc` 10% range across every crossed track, with edge bar.beat chips | grid + anchors | **time-range selection** (`selectRange` op). Object marquee commits a clip-id selection. *Deviation: today the top/bottom half of the lane switches mode invisibly (§12-D2).* | selection stack | Esc clears; touch drag works (`touch-action:none` on the lane) |
| **Empty lane — click** | `crosshair` | — | — | — | — | clears selection. **Does not move the playhead** — an accidental locate mid-set is a musical accident; the ruler is the single locate surface. | — | — |
| **Empty lane — drag with Draw tool (`B`) / double-click** | `cell` | 4px | — | ghost clip outline with a live bar-length readout | grid | **[NEW gesture, existing verbs]** compound `addSource` (empty `MidiSource`, `lengthTick` = drawn span) + `addClip`; double-click = one bar | removes both | Esc aborts |
| **Audio file drop on a lane** | `copy` | — | — | drop line at the snapped tick + a `--acc` lane outline; `--bad` outline + "audio only" if the track is a MIDI instrument | grid | compound `addSource` (audio) + `addClip` | removes both | — |
| **Ruler bars row — click / drag** | `pointer` / `ew-resize` | immediate (no threshold; scrubbing is the point) | `Ctrl` snap override | playhead follows; audible scrub only when stopped | grid, magnetic to bars at low zoom | `seek(tick)` (transport, not a verb, not undoable) | n/a — transport is not history | — |
| **Ruler sections row — double-click empty** | `pointer` | — | — | — | grid | `addLocation` (`kind: 'mark'`, name `Mark N`) → inline rename field focused | removes the mark | Esc cancels the rename, mark stays |
| **Section / mark chip — drag** | `grab` | 4px | `Ctrl` snap override | chip + its dashed field line follow | grid + anchors | `moveLocation` | prior tick | abort |
| **Section chip right edge** | `ew-resize` | 4px | — | — | grid | `moveLocation` (endTick) | prior span | abort |
| **Section / mark chip — click / double-click** | `pointer` | — | `Alt+click` = locate playhead to it | — | — | click selects (`selection.sectionIds`); double-click renames → `setLocationName`; `Delete` → `removeLocation` **[wiring gap, §10]** | prior location | Esc |
| **Brace row — drag empty** | `crosshair` | 4px | `Alt` = punch instead of loop | brace grows live | grid | `setLoopRange` / `setPunchRange`. **[NEW gesture, existing verbs]** — today a loop can only be made from a selection | prior loop range | abort |
| **Loop brace body — drag** | `grab` | 4px | — | brace + wash move together | grid | `setLoopRange` (same length) | prior range | abort |
| **Loop brace end cap** | `ew-resize` | 4px | — | — | grid | `setLoopRange` | prior range | abort |
| **Loop brace — double-click** | `pointer` | — | — | — | — | `setLoopRange` with `location: undefined` (clears) | restores the loop | — |

### 3.3 Arrangement — track header, mixer, automation

| Element / gesture | Cursor | Press → drag | Modifiers | Preview | Commits | Ctrl+Z | Notes |
|---|---|---|---|---|---|---|---|
| **Header — click** | `default` | — | `Ctrl` toggle · `Shift` range | — | `selection.trackIds` | selection stack | today press-selects and replaces; must honour modifiers |
| **Header grab handle `⠿` — drag** | `grab`/`grabbing` | 4px vertical | — | the row lifts (`--sh2`) and a 2px `--acc` insertion hairline shows the drop index | **[NEW gesture, existing verbs]** compound `removeTrack` + `addTrack` at the new index | prior order | vertical only; auto-scroll at the edges |
| **Name — double-click** | `text` | — | — | — | `setTrackName` | prior name | Enter commits, Esc reverts, blur commits |
| **M / S** | `pointer` | — | `Ctrl` on S = exclusive solo (compound) · `Alt` on M = mute all others | — | `setTrackMute` / `setTrackSolo` | prior flags | one verb per click |
| **R (arm)** | `pointer` | — | — | — | `armTrack` (transport state, not history) | n/a | disabled + `--warn` chip when audio-arm on the wasm backend |
| **Lane divider — drag** | `ns-resize` | 2px (no 4px threshold; resizing is precise) | `Alt` = resize **every** lane | lanes resize live | `trackLaneViewStore.setLaneHeight` (view state, clamp 28–480) | not in history (view state) | double-click = fit to content |
| **Header right edge — drag** | `col-resize` | 2px | — | — | header width (view state, clamp 160–320) | not in history | — |
| **Fader — drag** | `ns-resize` | immediate | `Shift` fine (×0.2) · `Alt` snap to unity | audible at ≤ 20 Hz republish | `setTrackGain` — **one** verb on release | prior dB | double-click = 0.0 dB |
| **Fader — keyboard** | — | — | `Shift` = 3 dB step | — | `setTrackGain` per key | per key | arrow keys, 0.5 dB default (exists) |
| **Pan scrubber — drag** | `ns-resize` | immediate | `Shift` fine | audible | `setTrackPan` on release | prior pan | double-click = centre |
| **Automation point — drag** | `grab` | 2px | `Ctrl` fine (0.1×) · `Ctrl+Shift` finest (0.01×) + push-neighbours (BC-39) | curve redraws | `setAutomationPoint` / `moveAutomationPoints` | prior point | collision stop, never a swap |
| **Automation field — double-click** | `crosshair` | — | — | — | `setAutomationPoint` at snapped tick | removes it | — |
| **Automation point — Delete** | — | — | — | — | `removeAutomationPoint` | restores | point must be focused or selected |
| **Automation field — Shift+drag** | `crosshair` | 4px | — | range band, then vertical drag scales the enclosed points | `setAutomationRange` (BC-40, thinned at commit) | prior points | commit-time thinning is one step |

### 3.4 Piano roll

| Element / gesture | Cursor | Press → drag | Modifiers | Preview | Snap | Commits | Ctrl+Z | Touch / pen |
|---|---|---|---|---|---|---|---|---|
| **Note body — click** | `default` | — | `Ctrl` toggle · `Shift` add | — | — | selection | selection stack | tap |
| **Note body — drag** | `grab` | 4px | `Shift` = axis lock (time *or* pitch) · `Ctrl` copy · `Alt` snap override | every selected note moves by **one clamped delta** (BC-31); auditions the primary note through the executor | grid | `moveNotes` / `copyNotes` | prior positions, one step | pen pressure ignored while moving |
| **Note left/right edge** (`resizeEdge`: `min(8px, width/2−1)`, none below 10px width; body fallback `noteBodyResizeEdge` = first quarter is `start`) | `ew-resize` | 4px | `Shift` = absolute (all selected end on the same tick) | length follows | grid | `resizeNotes` (BC-32) | prior lengths | 12px coarse |
| **Note — right-click / Erase tool** | `pointer` | — | — | note flashes `--bad` 90ms then vanishes | — | `eraseNotes` (BC-34) | restores | Erase tool exists **because** touch/pen have no right button |
| **Empty grid — click (Draw tool or `Ctrl`)** | `cell` | — | — | ghost note at the snapped cell, `drawLength` long | grid | `drawNotes` (one overlap-aware batch, BC-30; policy per BC-34) + audition on/off 100ms | removes it | tap draws |
| **Empty grid — drag (Draw tool)** | `cell` | 3px | — | ghost note grows | grid | `drawNotes` with the dragged duration, floor `noteDragFloor(ppq)` | removes it | pen: `event.pressure > 0` → `vel = round(clamp(pressure,0.05,1) * 127)` **[NEW, uses existing `drawNotes` vel]** |
| **Empty grid — drag (Select tool)** | `crosshair` | 4px | `Shift` add · `Ctrl` toggle | dashed marquee, `--line2` | — | note-id selection | selection stack | — |
| **Key bed key — press** | `pointer` | — | — | key fills `--acc` | — | audition on/off through `auditionPianoRollNote` (no verb) | n/a | press-and-hold sustains |
| **Key bed — drag vertically** | `ns-resize` | 4px | — | pitch range pans | — | `rememberPitchRange` (view state) | not in history | matches the scroomer |
| **Scroomer window — drag** | `grab` | 2px | — | range pans | — | view state | — | handles at both ends zoom |
| **Velocity lollipop — drag** | `ns-resize` | immediate | `Shift` = set all selected to the same value | head follows, note opacity updates live | — | `setVelocity` on release, one verb (BC-33) | prior velocities | 14px hit target coarse |
| **Velocity lane — drag across (paint)** | `crosshair` | 4px | — | every crossed lollipop follows the pointer height | — | one `setVelocity` batch **[NEW gesture, existing op]** | one step | — |
| **Velocity lane — Alt+drag** | `crosshair` | 4px | — | linear ramp between press and release | — | `setVelocity` `mode: 'ramp'` — BC-33 already lowers an arbitrarily dense ramp to one batch | one step | — |
| **Step cursor (`T` on)** | — | — | — | 2px `--acc2` outline at `stepEntry.positionTick` | grid | `drawNotes` per key press (BC-36 lowers a chord keystroke to one batch); `Space` advances; `Backspace` retreats | per note | on-screen step pad on coarse pointers |

---

## 4. Keyboard catalogue

**Guards.** (a) `isEditableTarget()` short-circuits everything (already in `keymap/arbiter.ts`) —
extend it to the inline rename input, the bar.beat type-in, the BPM type-in and the quantize
popover fields. (b) While `dragActive`, only `Escape` is delivered. (c) Modal binding sets
consume everything; only the top-most modal participates. (d) `Ctrl` and `Cmd` are
interchangeable everywhere (`matchesKeyCombo` already ORs them); no binding uses `Ctrl` and
`Cmd` differently.

**Surface navigation.** `Tab` toggles canvas ↔ arrangement (global, exists). Add the *level*
grammar so the whole app reads the same way:

| Key | Canvas | Arrangement | Piano roll | Rationale |
|---|---|---|---|---|
| `E` | enter selected node | **enter selected MIDI clip → piano roll** | — | matches `canvas.enterNode` |
| `Q` | exit node level | **exit to canvas** | **exit to arrangement** | matches `canvas.exitLevel`; frees `Enter` |
| `Esc` | cancel action | clear selection (never while dragging) | close popover → clear selection → exit | |

*Change:* piano-roll `q` = quantize moves to **`Ctrl+Q`**. One navigation grammar across three
surfaces is worth more than one letter for quantize (which also has a button and Ctrl+K).

### 4.1 Global (unchanged)

`Ctrl+K` command bar · `Ctrl+S` save · `Ctrl+Shift+E` export · `Ctrl+Shift+L/H/P` panels ·
`Tab` surface toggle · `F6` return to host.

### 4.2 Arrangement surface

| Keys | Action | Status |
|---|---|---|
| `Space` | play / stop toggle | exists (`arrangement.transport`) |
| `Shift+Space` | play from the time-selection start (else loop start, else playhead) | **new** |
| `Space` ×2 (stop then stop) | return the playhead to where the last playback started | **new** — replaces a "return on stop" preference |
| `Home` / `End` | playhead to 1.1 / to song end | **new** |
| `Ctrl+←` / `Ctrl+→` | previous / next marker or section | **new** (`Ctrl+arrow` is free here) |
| `Ctrl+Z` / `Ctrl+Shift+Z` | undo / redo | exists |
| `Ctrl+Alt+Z` / `Ctrl+Alt+Shift+Z` | selection undo / redo | exists |
| `Ctrl+X` `Ctrl+C` `Ctrl+V` | cut / copy / paste (BC-26–28; delete never touches the clipboard, BC-27) | exists |
| `Ctrl+Shift+V` | repeat-paste ×N at the playhead | exists as an op, unbound |
| `Ctrl+D` | duplicate selection (range-aware, clipboard-neutral, BC-29) | exists |
| `Delete` / `Backspace` | delete selection (range delete preserves outside material, BC-25) | exists |
| `←` / `→` | nudge by grid (BC-21) | exists |
| `Shift+←/→` | fine nudge (grid ÷ 16) | exists |
| `Alt+←/→` | nudge by one bar | **new** |
| `↑` / `↓` | move selected clips to the track above / below (`moveClip` with `trackId`) | **new** |
| `Shift+↑/↓` | extend the track span of a time-range selection | **new** |
| `S` | split at the edit point / across the range | exists |
| `R` | toggle Slide ↔ Ripple | exists |
| `L` | loop from the time selection (`loopFromSelection`) | **new binding** (op + Ctrl+K entry exist) |
| `I` / `O` | set loop start / end to the playhead | **new** |
| `P` | toggle punch | **new** |
| `M` | toggle the mixer drawer | **new** |
| `F` | toggle follow-playhead | **new** |
| `0` | mute / unmute selected clips (`setClipMute`) | **new** |
| `V` / `B` / `X` | Select / Draw / Erase tool | **new** |
| `[` / `]` | coarser / finer grid unit | **new** |
| `Alt+G` | toggle snap (`toggleSnap`) | **new** (the magnet button exists) |
| `+` / `-` | zoom in / out around the playhead | **new** |
| `Ctrl+wheel` | zoom around the cursor | exists |
| `Shift+Z` | zoom to selection (or to loop if none) | bound but **stubbed — must be implemented** |
| `Ctrl+0` | zoom to fit the whole song | **new** |
| `E` | open the selected MIDI clip in the piano roll | replaces `Enter` (`Enter` kept as an alias) |
| `Ctrl+E` | insert time at the playhead (opens the inline amount popover) | **new** (event seam exists) |
| `Ctrl+Shift+Backspace` | delete selected time | **new** (event seam exists) |
| `Ctrl+A` | select all clips on the selected tracks (all tracks if none selected) | **new** |
| `Esc` | clear selection (guarded: never while dragging) | exists |

**Conflicts resolved.** `mode.1…9` and the `note.*` letter keys are global / canvas-scoped;
because surface sets run before global sets in `resolveKeydown`, the arrangement's letters
shadow them while the DAW is focused. That is intended — canvas note-input keys are meaningless
in the arrangement. `arrangement.split` (`s`) and the piano roll's step-entry `s` (= D) coexist
because they are different surfaces, once the piano roll gets its own binding set (below).

### 4.3 Piano-roll surface

**Structural change:** the piano roll's `onKeyDown` handler is replaced by a registered
`BindingSet { scope: 'surface', surface: 'pianoroll' }`. *Why:* today its keys live on a DOM
handler, so they are not rebindable, do not participate in the arbiter, and — critically —
**`Space` does not reach the transport from the piano-roll surface at all** (no `pianoroll`
binding set exists, so only global sets run). That is a bug, not a preference.

| Keys | Action | Status |
|---|---|---|
| `Space` | play / stop (or advance the step cursor when step entry is armed) | **fixes the gap** |
| `Ctrl+A` | select all notes in the clip | exists (DOM) |
| `Ctrl+X/C/V` | cut / copy / paste notes | exists (DOM) |
| `Ctrl+D` | duplicate notes by one grid | exists (DOM) |
| `Delete` / `Backspace` | delete notes | exists |
| `←` / `→` | nudge by grid; `Shift` = ÷4 | exists |
| `↑` / `↓` | transpose ±1; `Alt` = ±12 (octave) | exists |
| `Ctrl+↑/↓` | velocity ±10; `+Alt` = ±1; `+Shift` = set-absolute | exists |
| `,` / `.` | shorten / lengthen by grid; `Shift` = ÷4 | exists |
| `Ctrl+Q` | quantize the selection | **moved from `q`** |
| `V B X K T` | Select / Draw / Erase / Velocity / Step tools | **new** |
| `Q` | exit to the arrangement | **new** (was quantize) |
| `Esc` | close popover → clear selection → exit surface | exists (host) |
| `a w s e d f t g y h u j` | step-entry pitches (C…B) while `T` is armed | exists |
| `Z` / `Shift+Z` | previous / next octave for step entry | **new** |
| `Ctrl+wheel` | horizontal zoom · `Ctrl+Shift+wheel` vertical (row height) | exists / **new** |

---

## 5. Selection model

**Two exclusive kinds (BC-23), enforced in `editingContextStore.setSelection`:**

1. **Object selection** — `clipIds[]`, `noteIds[]`, `trackIds[]`, `sectionIds[]`,
   `automationPointIds[]`. Setting any of these clears `timeRange`.
2. **Range selection** — `timeRange { fromTick, toTick, trackIds[] }`. Setting it clears every
   object list.

`sectionIds` exists in the model but nothing writes it today — §10 lists the wiring.

**Modifiers** (identical on every surface, both platforms; `Cmd` ≡ `Ctrl`):

| Modifier | Meaning |
|---|---|
| none | replace selection |
| `Ctrl/Cmd` + click | toggle that object |
| `Shift` + click | extend — clips: every clip whose span intersects the union span, across tracks; notes: add; sections: add |
| `Ctrl/Cmd` + drag on empty | marquee **toggles** the hits |
| `Shift` + drag on empty | marquee / range **adds** to the current selection |
| `Alt` + drag on empty lane | object marquee instead of a time range |

**Visuals.** Selected object = `1.5px --acc` outline + `--ring` (`0 0 0 3px` accent-mix).
Background shifts by ≤ 6% only — **no fill drenching**, so a selected clip still reads its
own track tint and its own waveform. Range selection = 10% `--acc` wash with 1px `--acc`
edges and bar.beat edge chips. Marquee-in-progress = 1px dashed `--line2` + 6% `--t1` wash
(neutral: it is not a selection yet). Focus ring is the same `--ring` everywhere; focus and
selection are visually distinct (`outline: 1px dashed --t2; outline-offset: 3px` for focus on
an already-selected object).

**What selection means.**

| Operation | Object selection | Range selection |
|---|---|---|
| `Delete` | `removeClip` / `removeNote` / `removeAutomationPoint` / `removeLocation` | `deleteRange` — material outside the range survives (BC-25) |
| `Ctrl+X` / `Ctrl+C` | `captureCutBuffer` of the objects | capture of the range across its tracks |
| `Ctrl+V` | at the playhead, into the resolved target tracks | same; repeat-paste offsets by the buffer duration |
| `S` split | `splitAt` the edit point on selected clips | `splitRange` at both range edges |
| `Ctrl+D` | `duplicateClips` by the grid | `duplicateRange` — appended at `toTick` |
| `L` loop | (no-op; needs a range) | `setLoopRange` from the range |
| `Ctrl+E` insert time | at the playhead | at `fromTick`, length = range |

**Keyboard selection moves** (arrangement): `Tab` is surface navigation, so object traversal
uses `Alt+→ / Alt+←`? — no: those are bar-nudge. Use **`Ctrl+Alt+→ / ←`** to select the next /
previous clip on the same track and **`Ctrl+Alt+↑ / ↓`** for the same tick on the track
above / below; `Shift` added extends. **[NEW bindings, selection-only, no verb needed.]**

**Selection history** is separate from the document history (`selectionHistory`,
`Ctrl+Alt+Z`) — that stays; it is a genuinely good idea and already contract-tested.

---

## 6. Navigation

| Input | Action |
|---|---|
| `wheel` (deltaY) | vertical scroll of the lane stack |
| `Shift + wheel` | horizontal scroll |
| trackpad `deltaX` | horizontal scroll (native) |
| `Ctrl/Cmd + wheel` | **horizontal zoom around the cursor** — `zoomAroundPointer()` keeps the tick under the pointer fixed (exists) |
| pinch (browsers synthesise `ctrlKey` wheel) | same as Ctrl+wheel |
| `Ctrl+Shift + wheel` | vertical zoom = lane height for all lanes (clamped 28–480) |
| `Alt + wheel` over a selected note | velocity ±1 (`Shift` for ±10) |
| plain `wheel` in the piano roll | **always scrolls.** *Deviation: today plain wheel edits velocity whenever notes are selected, stealing the scroll (§12-D5).* |
| `+ / -`, `Ctrl+0`, `Shift+Z` | zoom in/out around the playhead · fit song · fit selection |

**Zoom limits** (`zoomAroundPointer`): `pxPerTick ∈ [4 / ticksPerBar, 4000 / ticksPerBar]`
— i.e. 4px per bar (whole-song overview) to 4000px per bar (≈ 1px per 4 ticks). Keep.

**Follow-playhead.** `editingContextStore.followPlayhead`, default **on**, mode **page**:
when the playhead leaves the right 15% of the field, the field jumps so the playhead sits at
1/6 from the left. *Why page, not smooth:* smooth follow slides clips under a stationary
cursor, which violates principle 4 and makes a mid-set grab a lottery. A `smooth` option
exists in the ruler-corner popover for those who want it (playhead pinned at 40%).
**Auto-disable** on: any manual scroll or zoom, any pointer-down in the field, the start of
any drag (the existing `followPlayhead` save/restore in `useClipGesture` becomes the general
rule). **Re-enable** on: the next `play()` from a stopped transport, or `F`.
*Deviation: `PlayheadLayer` currently auto-scrolls unconditionally, ignoring the flag (§12-D6).*

**Minimap / overview: no.** *Why:* it duplicates the ruler, costs a permanent band and a
second render of every clip, and every element must earn its place. The **section-chip row is
the overview** — at low zoom it is the map of the piece — backed by `Ctrl+0` (fit song) and
`Shift+Z` (fit selection). Revisit only if user testing shows people getting lost at
> 200 bars.

**Virtualization requirements** (`virtualizationWindow`, already pure and benchable):

- Only lanes intersecting `[scrollTop − 1 lane, scrollTop + height + 1 lane]` mount.
- Clips are filtered by `[visibleStartTick, visibleEndTick]` (exists).
- Ruler marks are stride-limited by `getGridLadder()` (exists).
- Grid is one `<canvas>`, repainted only when `(width, height, scrollLeft, pxPerTick, gridUnit,
  sections)` change.
- Playhead, meters, level beads, and the record ghost are written **directly to the DOM inside
  one shared rAF loop** — never React state. One loop for the whole surface, not one per
  component (today `PlayheadLayer`, `SharedSurfaceChrome`, `RecordGhost` and each `Meter` each
  run their own).
- Budget: **100 tracks × 400 clips scrolls and zooms at 60 fps**; a clip drag with 200 clips
  selected previews at 60 fps.

---

## 7. Transport & time

| Behaviour | Spec |
|---|---|
| **Play** | `Space` / pill. Starts from `playheadTick`. Optimistic: the button flips instantly; the readout stays `--t3` until the first confirmed `TransportFrame` (`transportPending` cleared). |
| **Play from selection** | `Shift+Space` — seeks to `timeRange.fromTick` (else loop start) and plays. |
| **Stop** | `Space` / pill. The playhead **freezes where it is** (honest). A second Stop returns it to the tick where playback last started. No "return on stop" preference — the double-tap covers both idioms with no settings surface. |
| **Pause** | Not modelled. `stop` + freeze *is* pause; a separate pause state would be a second transport model. |
| **Loop** | Pill toggle; range from the `loop` location. Mutually exclusive with punch (store already enforces). `L` sets the range from the time selection; `I`/`O` set its edges to the playhead. |
| **Punch** | Pill (secondary, in the `⋯` overflow) + `P`. `punchRecordState()` drives the record button's dimmed "outside punch" state. |
| **Record** | Requires ≥ 1 armed track, else the button is disabled with a tooltip (never a dialog). Count-in bars play the click before the punch/record span. Loop recording stacks takes with increasing `layerIndex`; the `×N` badge is a count, not a comp editor. |
| **Metronome / count-in** | One button; click toggles the click, long-press opens `Off · 1 · 2` bars. |
| **Tempo scrub** | `Δbpm = Δx / 3`; `Shift` ÷10, `Alt` ×5; **clamp 20–300**; double-click to type; one `setTempo` verb on release; live-audible while rolling at ≤ 20 Hz republish. |
| **Time format** | `formatBarBeat()` — `bar.beat`, extended to `bar.beat.tick` only mid-beat. Every readout in the app uses this function. Ticks are never shown raw except in the drag delta chip. |
| **Song end** | Playback auto-stops after `conduct().seconds`, which includes the authored release tail (exists). The field past `arrangementLengthTicks()` is washed `--inset`. The transport does not claim to be playing a finished song. |
| **Attention pulse** | The play button pulses (1.6s `scale(1 → 1.09)`) **only** on a cold load before the first user gesture — required because browsers will not autoplay. It stops permanently on the first gesture of the session and never runs while recording or playing. `prefers-reduced-motion` → a static `--acc` ring instead. |

---

## 8. Feedback & states

### 8.1 State matrix

| State | Visual | Applies to |
|---|---|---|
| hover | `background: color-mix(in oklab, var(--t1) 6%, …)`, or a 1px `--line2` border lift; 120ms `--fast` | buttons, clips, notes, chips, points |
| focus-visible | `--ring` (one ring, everywhere) | every focusable |
| active / pressed | `scale(.96)` buttons, `scale(.94)` pads, 260ms spring | pill, lane buttons, tool strip |
| disabled | `--t3` at 45%, no hover, `cursor: not-allowed`, tooltip explains why | undo/redo, record, export while playing |
| selected | `1.5px --acc` + `--ring`, ≤ 6% fill shift | clips, notes, points, sections, tracks |
| dragging | `--sh2`, 96% opacity, cursor follows the gesture's cursor | clip / note ghost |
| pending (engine unconfirmed) | value in `--t3` + a 1px indeterminate hairline in the pill — **never a spinner** | bar.beat readout, transport |
| muted | `--inset` fill, name struck through, content 40% | clip, track |
| soloed | `--acc2` glyph on the S button; every non-soloed lane drops to 55% opacity | track |
| armed | `--bad` ring on R | track |
| recording | `--bad` fill + 1200ms pulse; a dashed `--bad` record ghost grows in the lane | R, pill, lane |
| faulted (plugin latch) | `1.5px --warn` clip border + `⚠` chip; a `--warn` chip in the utility cluster reading "1 plugin benched"; **audio keeps playing** | clip, track, chrome |
| stale (edit not yet live) | 1px `--warn` underline on the clip name for ≤ 500ms | clip |

### 8.2 Transient overlays

- **Drag ghost**: the moved object at 96% opacity with `--sh2`; the *original* stays visible at
  35% until commit, so you can see what you are changing (this is what makes an undo feel safe).
- **Snap indicator**: a 1px `--acc` vertical hairline at the snapped tick, shown **only when the
  snap actually displaced the raw value** by ≥ 1px. Fades in 80ms, out 120ms.
- **Drop-invalid**: 1.5px `--bad` outline on the target lane + the drag readout chip turns
  `--bad` with a two-word reason ("audio only", "locked"). No shake, no sound.
- **Readout chip**: `4.1.240  +1.2.0` following the cursor (see §3).
- **Edge chips on a range**: bar.beat at both edges of a time selection, so the range is
  legible without measuring.

### 8.3 Empty, loading, error

- **Empty song** (already good, retheme only): a ghosted 32-bar shell behind a `--surface`
  card with `--sh2`, "An empty page." + "Start a sketch, or ask the agent to dream one up.
  Ctrl+Z undoes anything." Actions: **Start from 'Paper Sketch'** (primary) · **Start from
  'First Light'** · "Add an empty track" (ghost link). **Add two more paths** so the empty
  state names every way in: **"Record something"** (adds one armed MIDI track and arms it) and
  **"Draw a clip"** (adds a track and switches to the Draw tool). Footer: `Tab` keycap →
  "back to the canvas".
- **Empty lane** hint: "drag audio here · press **B** and draw" — matching the real binding
  (today it says "press D", which is bound to nothing).
- **Loading**: skeleton, never a spinner — lane rows as `--inset` blocks with hairline
  dividers, ruler numbers in `--t3`, at 800ms crossfade to real content. Waveforms fade in per
  clip as `getWaveform()` resolves; a clip without peaks yet shows its name bar and an `--inset` body.
- **Errors**: `recordError` and export failures render as a `--warn` / `--bad` **chip in the
  utility cluster** (12px/600, tinted text only, no dot) plus the existing `aria-live` region.
  Never a modal.

### 8.4 Reduced motion

Every animation has a `prefers-reduced-motion: reduce` alternative and **no meaning is
carried by motion alone**:

| Motion | Reduced alternative |
|---|---|
| play-button attention pulse | static `--acc` ring |
| record pulse | solid `--bad` + 2px ring |
| spring press `scale(.96)` | instant background change only |
| snap-indicator fade | instant show/hide |
| surface transition in/out | instant swap (already handled) |
| meter 60ms lerp | instant value writes (already handled) |
| follow-playhead page jump | unchanged (a jump is not an animation) |
| skeleton crossfade | instant swap |

The playhead itself keeps moving under reduced motion — it *is* the clock, not decoration.

### 8.5 "A held note beats a glitch" — editing while playing

1. Structural edits (add / remove / move / trim / split) preview locally at 60 fps and
   republish the conducted graph **once, at commit** — never per pointer move.
2. Parameter edits (gain, pan, automation, tempo) are audible during the drag, republished at
   **≤ 20 Hz** (already implemented in `arrangementStore`), so pointer-rate input cannot flood
   the bridge.
3. If republication fails or the engine is degraded: **the last good sound keeps playing**, the
   affected clip/track takes the `stale`/`faulted` treatment, a chip appears in the chrome, and
   nothing steals focus. Recovery is the performer's call (a `Retry` in the chip).
4. `Ctrl+Z` while rolling never stops the transport; it re-publishes through the same path.
5. No edit may cause a re-layout that moves an element under the cursor: while `dragActive`,
   lane heights, header width and zoom are frozen.

---

## 9. Piano-roll specifics

- **Tools**: `V` Select · `B` Draw · `X` Erase · `K` Velocity · `T` Step. Persisted per
  surface in `viewports[surface].tool` (widen the union from `'select' | 'draw'`). Holding
  `Ctrl` with the Select tool temporarily acts as Draw (today's behaviour), and holding `Alt`
  with Draw temporarily acts as Select — so a one-off never costs a tool switch.
- **Draw on empty**: click = a note of `drawLength` at the snapped cell; drag = the dragged
  duration with floor `noteDragFloor(ppq)` (= `ceil(ppq/128)` = 8 ticks at PPQ 960 — distinct
  from the 1-tick model backstop, BC-30). Drum mode draws `durTick = 1` hits. An exact
  time+pitch duplicate is never minted (BC-30). Overlap resolution uses `overlapPolicy`
  (default `truncate-existing`, BC-34) and is **one batch** — an overlap never lands
  half-applied, and one inverse restores both side effects.
- **Audition**: through the executor (`auditionPianoRollNote` → `conduct` + `auditionNote`),
  never a preview synth. Auditions fire on draw, on note press, and on key-bed press;
  suppressed entirely while `isPlaying` (you are already hearing the part).
- **Overlap policy**: exposed in the `⋯` popover (`relax / reject / replace / truncate-existing
  / truncate-addition / extend`) — the model already carries all six.
- **Chord / multi-select move**: one clamped delta for the whole selection (BC-31); if any note
  in the selection would leave `[0,127]` or go below tick 0, the delta clamps for **all** —
  the gesture is never partially applied.
- **Resize edges**: `resizeEdge()` = `min(8px, width/2 − 1)`, disabled below 10px width so a
  short note is always movable rather than accidentally resized. `Shift` = absolute resize
  (every selected note ends on the same tick).
- **Velocity lane**: lollipop drag (one note), paint drag (many), `Alt`-drag ramp; `Ctrl+↑/↓`
  keyboard. A non-smush request at the 0/127 boundary rejects **wholly** (BC-33) — never
  partially corrupts. Transpose past 0/127 rejects the whole selection likewise (BC-35).
- **Quantize**: `Ctrl+Q` / button / Ctrl+K. The popover holds grid · strength (0–100) · swing
  (−150…150) · threshold · snap-start / snap-end. Duration uses fully quantized edges, swing
  displaces alternating grid points by `swing × grid / 300`, the threshold is inclusive, and
  both flags off emits no verbs (BC-37). Quantize is one verb batch and one undo.
- **Scale / drum display**: drum mode is auto-detected (`shouldAutoDetectDrums` + percussion
  instrument category) with an explicit override toggle and an `aria-live` note. Drum rows are
  fixed 18px with GM names; pitched rows use `clamp(6px, fit, 22px)`. **[Scale highlighting is
  out of scope for v1]** — it needs a key/scale field on `Arrangement` that does not exist, and
  inventing one would fork the document model.
- **Key bed audition**: press-and-hold sustains; drag vertically pans the pitch range (same as
  the scroomer).
- **Zoom / follow**: `Ctrl+wheel` horizontal (shares `pxPerTick` with the arrangement viewport
  when opened from it), `Ctrl+Shift+wheel` row height, scroomer for pitch. Follow-playhead uses
  the same page rule and the same `F` toggle.
- **Inline lane vs full surface**: the inline lane (220px, in the track) and the surface
  (`PianoRollSurfaceHost`) are **the same component** at two heights. The surface adds the
  clip-bounds brackets `[ ]` and the toolbar; it never gets a second interaction model.

---

## 10. Agent parity & Ctrl+K

Every gesture in §3 must have an `edit_timeline` equivalent (verb or `EDIT_OPS` op) so the
hand, the palette and Pi speak one vocabulary. Existing coverage is good: `moveClips`,
`trimClip`, `splitAt`, `duplicateClips`, `deleteClips`, `nudge`, `slipClip`, `deleteTime`,
`insertTime`, `deleteRange`, `splitRange`, `duplicateRange`, `selectRange`, `paste`,
`pasteRepeat`, `setGrid`, `drawNote`, `moveNotes`, `copyNotes`, `resizeNotes`, `eraseNotes`,
`setVelocity`, `transposeNotes`, `quantizeNotes`, the automation ops, `setTrackGain/Pan`,
`armTrack`, `setClick`, `setCountIn`, `record`.

**Gestures with no verb/op today:**

| Gesture (§) | Needs | Kind |
|---|---|---|
| Track colour swatch (§2.4) | `setTrackColor { trackId, color? }` | **NEW verb** (mirrors `setTrackName`; `track.color` already exists in the model) |
| Track reorder by drag (§3.3) | `moveTrack { trackId, index }` | **NEW verb** — expressible today only as `removeTrack`+`addTrack`, which loses ids; a first-class verb keeps ids stable for selection and the agent |
| Draw a clip on an empty lane (§3.2) | `createClip { trackId, startTick, lengthTick }` | **NEW op** lowering to compound `addSource`(empty midi) + `addClip` — the agent should not have to mint an empty source by hand |
| Loop/punch brace drag (§3.2) | none — `setLoopRange` / `setPunchRange` exist | wiring only |
| Marker create / rename / delete / select (§3.2) | none — `addLocation` / `setLocationName` / `removeLocation` / `moveLocation` exist | **wiring gap**: `selection.sectionIds` is never written and `removalVerbs()` never emits `removeLocation` |
| Velocity paint & ramp (§3.4) | none — `setVelocity { mode: 'ramp' }` exists | wiring only |
| Clip mute / lock (`0`, context menu) | none — `setClipMute` / `setClipLocked` exist | expose as ops in `EDIT_OPS` |
| Exclusive solo, mute-others | none — compound of `setTrackSolo` / `setTrackMute` | wiring only |
| Zoom / follow / tool / lane height | **none, deliberately** — view state, not document. The agent gets `setGrid` (which is editing context) but must not be able to move someone's viewport mid-set. | — |
| Transport locate (`seek`, `Home`, ruler) | none — transport is not history; `describe_arrangement` already reports position | — |

**Ctrl+K.** The palette is the strict superset of right-click. Existing entries
(`pianoroll.quantize`, `arrangement.insert-time`, `arrangement.delete-time`,
`arrangement.loop-from-selection`, `arrangement.export-song`) grow to cover every §4 action —
each palette entry shows its keycap in 11px mono, and each right-click menu is a curated
subset of the same command list. No command may exist only as a gesture.

---

## 11. Acceptance tests

Playwright / chromium, using the existing helpers in `e2e/journeys/support.ts`
(`activateBrowser`, `openStarter`, `loadFixture`, `pointerDrag`, `snapshot`) and the
`window.__openjammerE2E` bridge (`snapshot()`, `verbLog()`, `history()`, `selection()`,
`setFixture()`). Every test asserts **document state via `snapshot()`**, not DOM geometry,
except where geometry *is* the contract.

| # | § | Scenario | Steps | Assertion |
|---|---|---|---|---|
| T1 | 1, 3 | One gesture = one undo | `openStarter`; `pointerDrag(clip, 60)` | `history().cursor` +1; `Ctrl+Z` → `snapshot()` byte-identical to the pre-drag snapshot |
| T2 | 3 | Drag threshold | press on a clip, move 3px, release | `history().cursor` unchanged; clip `startTick` unchanged |
| T3 | 3 | Escape aborts | begin a drag, move 80px, press `Escape`, release | snapshot identical to pre-drag; `dragActive` false |
| T4 | 3 | Magnetic snap radius | zoom so 1 bar = 200px; drag a clip 10px past a bar line | `startTick` lands exactly on the bar; the snap hairline was visible |
| T5 | 3 | Snap override | repeat T4 holding `Control` during the move | `startTick` is the raw (unsnapped) value |
| T6 | 3 | Axis lock (BC-12) | drag a clip 60px right and 40px down with `Shift` | track unchanged, `startTick` changed |
| T7 | 3 | Copy-drag threshold | `Alt`-press and move 8px | no new clip; move to 20px → exactly one new clip, one history entry |
| T8 | 3 | Trim preserves the source window (BC-17) | `dragEdge(clip, 'start', +14)` | `startTick` and `sourceStart` both advance by the same delta; note content does not shift |
| T9 | 3 | Slip (BC-19) | `Ctrl+Shift` drag on a clip body | `sourceStart` changes, `startTick` and `lengthTick` do not |
| T10 | 3.2 | Loop brace creation | drag in the brace row from bar 3 to bar 7 | a `loop` location exists with those ticks; the loop wash spans them |
| T11 | 3.2 | Marker lifecycle | double-click the sections row → type "Chorus" → Enter → drag it → select → `Delete` | `addLocation`, `setLocationName`, `moveLocation`, `removeLocation` appear in `verbLog()` in order; one `Ctrl+Z` per step |
| T12 | 3.2 | Empty-lane drag selects time | drag across an empty lane region | `selection().timeRange` set, `clipIds` empty (BC-23) |
| T13 | 3.2 | Alt+drag on empty = marquee | `Alt`-drag over two clips | `clipIds.length === 2`, `timeRange` null |
| T14 | 3.2 | Draw a clip | press `B`, drag two bars on an empty lane | one new source + one new clip; a single `Ctrl+Z` removes both |
| T15 | 5 | Selection exclusivity (BC-23) | select a range, then click a clip | `timeRange` null, `clipIds.length === 1` |
| T16 | 5 | Delete preserves the clipboard (BC-27) | `Ctrl+C` a clip, select another, `Delete`, `Ctrl+V` | the pasted clip is the **copied** one |
| T17 | 5 | Range delete keeps outside material (BC-25) | select bars 3–5 across two tracks, `Delete` | clips outside the range are intact; clips crossing it are trimmed, not removed |
| T18 | 4 | Space plays from the piano-roll surface | open a MIDI clip with `E`, press `Space` | `isPlaying` true — this is the current gap |
| T19 | 4 | Level grammar | canvas `E` → node; arrangement `E` → piano roll; `Q` → arrangement; `Q` → canvas | `uiViewStore.surface` follows exactly |
| T20 | 4 | Text-field guard | focus the rename input, type "sss" | no split occurs; `history().cursor` unchanged |
| T21 | 6 | Ctrl+wheel zooms around the cursor | note the tick under x=600, `Ctrl+wheel` up | the same tick is still under x=600 (±1px) |
| T22 | 6 | Wheel scrolls the piano roll | select notes, plain wheel | velocities unchanged, `scrollTop` changed |
| T23 | 6 | Follow-playhead disarms on touch | play, let it page, then drag a clip | no scroll occurs during the drag; `followPlayhead` false after |
| T24 | 6 | Pixel-lock | scroll to bar 50 at three zoom levels; screenshot the ruler + field | a bar line in the grid canvas and its ruler tick differ by ≤ 1px |
| T25 | 6 | Virtualization | `loadFixture('hundredTracks')`, scroll to the middle | mounted `.arrangement-track` count ≤ viewport lanes + 4; no console errors |
| T26 | 7 | Honest stop at the end | play `Paper Sketch` to the end | `isPlaying` false, the playhead sits at the song end, no error |
| T27 | 7 | Double-stop returns | play from bar 5, stop, stop | `playheadTick` = the tick of bar 5 |
| T28 | 7 | Tempo scrub = one verb | drag the BPM 40px | exactly one `setTempo` in `verbLog()`; value within 20–300 |
| T29 | 7 | Record needs an arm | click Record with nothing armed | disabled / `recordError` chip; **no dialog** appears |
| T30 | 8 | Edit while playing holds the sound | play, then move a clip | `isPlaying` stays true across the whole gesture; no `pageerror`; the transport frame keeps advancing |
| T31 | 8 | Reduced motion | `page.emulateMedia({ reducedMotion: 'reduce' })`, cold load | the play button has no running animation; the record dot is solid |
| T32 | 8 | Empty state paths | fresh Song node | four affordances present: two starters, "Record something", "Draw a clip" |
| T33 | 9 | Draw + overlap is one batch (BC-30 / BC-34) | draw a note over an existing one | one history entry; the existing note is truncated, not duplicated; one inverse restores both |
| T34 | 9 | Multi-note move is one clamped delta (BC-31) | select 3 notes incl. the lowest, drag down past pitch 0 | all three keep their intervals; none is clamped independently |
| T35 | 9 | Velocity / transpose reject wholly (BC-33 / BC-35) | `Ctrl+Shift+↑` past 127, then `Alt+↑` past pitch 127, on mixed selections | either all change or none; no partial write |
| T36 | 9 | Quantize (BC-37) | `Ctrl+Q` on off-grid notes | starts on grid, durations from fully quantized edges, one undo; both snap flags off ⇒ zero verbs |
| T37 | 10 | Agent parity | for each §4 action, assert a matching `EDIT_OPS` / verb entry exists | `src/ai/__tests__/piToolParity.test.ts` fails if a new gesture ships without an advertised payload |
| T38 | 10 | Verb replay convergence | run the J3 "Editor's Hour" journey | replaying `verbLog()` onto the fixture reproduces `snapshot()` byte-for-byte, `history().cursor > 8`, every scope `'arrangement'` (already asserted; keep as the regression gate) |
| T39 | 3 | Touch parity | `page.touchscreen` drag of a clip and a note | same document result as the mouse path; no scroll occurs during the drag |
| T40 | 2, 8 | Contrast floors | extend `src/components/Arrangement/__tests__/contrast.test.ts` to the New DNA tokens, light **and** dark | text vs its ground ≥ 4.5:1; clip border / note fill / playhead ≥ 3:1 vs lane **and** vs clip; selection vs clip ≥ 3:1 (the old 2.9 carve-out ends with the accent outline) |
| T41 | 2 | Token purity | `tokenLiteralGate.test.ts` over the retheme | zero hex/rgb/hsl literals in Arrangement/PianoRoll CSS; zero `var(--…)` not declared in `oj-tokens.css` |
| T42 | 6 | Ruler ladder | assert `getGridLadder` at 104 / 48 / 36 / 9 / 8 / 4 / 2 px-per-bar | strides `1/1/1/1/1/4/16`, beats only ≥ ~48px/bar, subdivisions only ≥ 9px spacing — bar numbers stay legible at every zoom |
| T43 | 2 | Surface teardown | enter the arrangement, switch to Canvas, wait 300ms | the outgoing surface is `hidden` **and** `inert`; the incoming one is neither (existing law, must survive the pill refactor) |
| T44 | 1 | Gesture transaction (BC-01) | nest a mixer drag inside a clip drag, then abort | one history entry; abort restores byte-exact prior state and leaves the cursor unmoved |

---

## 12. Deviations from what exists today

| # | Change | Rationale (one line) |
|---|---|---|
| D1 | Snap magnet radius `25px → 12px` grid / `18px` meaningful anchors; snapping disabled below 3px per grid unit. **This amends BC-06** (`editingContracts.test.ts` "accepts only within 25px") — the contract test and `docs/timeline.md` must be updated with the change, not around it. The separate 25px constant inside `gridTicks()` (auto-coarsening the *displayed* grid) is unchanged. | 25px to *every* candidate means you can never place a clip off-grid at close zoom — snap is being fought, not felt. |
| D2 | Empty-lane drag: the invisible top-half/bottom-half mode switch is replaced by "drag = time range, `Alt`+drag = object marquee" | a mode boundary the eye cannot see is a mode the hand cannot trust (the e2e even has to aim at a 4px strip). |
| D3 | Mid-drag snap override moves from `Alt` (dead whenever copy-drag is active) to `Ctrl/Cmd` held during motion | the current `snapInvert` is unreachable during the most common gesture; press-phase `Ctrl` (toggle-select) and move-phase `Ctrl` never collide. |
| D4 | Piano-roll keys move from a DOM `onKeyDown` into a registered `surface: 'pianoroll'` binding set | today they are unrebindable, unscoped, and `Space` reaches no transport at all from the piano-roll surface. |
| D5 | Plain `wheel` in the piano roll always scrolls; velocity-by-wheel becomes `Alt+wheel` / the velocity lane | stealing the scroll wheel whenever notes are selected is the single most surprising behaviour in the editor. |
| D6 | `PlayheadLayer` must honour `followPlayhead` (default on, page mode, auto-disarms on manual scroll/zoom/gesture) | it currently auto-scrolls unconditionally, so the view yanks away while you are reading bar 40. |
| D7 | `Shift+Z` (zoom to selection) is implemented; `Ctrl+0` (fit song) and `+`/`-` are added | the binding exists and its handler `return false`s — a shortcut that does nothing is a lie in the help panel. |
| D8 | Piano-roll quantize `q → Ctrl+Q`; `Q` becomes "exit level" on both DAW surfaces; `E` becomes "enter clip" | one navigation grammar (`E` in, `Q` out) across canvas → arrangement → piano roll. |
| D9 | The 52px `TransportStrip`, the canvas transport, and `SharedSurfaceChrome`'s readout collapse into **one** floating pill + a sky-band utility cluster | one control, one place, three surfaces — a forked second transport is exactly what "extend, don't fork" forbids. |
| D10 | Ruler grows `46px → 64px` with a dedicated loop/punch brace row | there is currently **no gesture at all** to create or resize a loop range; that is the biggest missing verb-to-hand link. |
| D11 | Section chips become selectable (`selection.sectionIds`) and `Delete` emits `removeLocation` | the model already has `sectionIds` and `removeLocation`; nothing writes or emits them, so markers are create-only. |
| D12 | Track colour, track reorder and "draw a clip" gain `setTrackColor`, `moveTrack` and a `createClip` op | three gestures the surface visibly implies but no vocabulary supports (§10). |
| D13 | Lane hint text "press D and draw" → "press **B** and draw"; empty state gains "Record something" and "Draw a clip" | `D` is bound to nothing; the hint currently teaches a shortcut that does not exist. |
| D14 | Per-track **level bead** in the header replaces any notion of glowing clips/cables in the field | "sound is visible" satisfied at one stationary pixel-cheap place, without repainting the field at 60 fps. |
| D15 | Playhead never glows; it changes colour/width between rolling and stopped | the New DNA reserves glow for live-signal carriers; a position marker is not one. |
| D16 | One shared rAF loop drives the playhead, meters, level beads and the record ghost | today four+ independent loops run concurrently; on a 100-track song that is the difference between 60 fps and a stutter. |
| D17 | Count-in folds into the metronome button (long-press); punch moves to the pill overflow | the pill must stay small enough to be constant across surfaces; two rarely-touched buttons do not earn permanent width. |
| D18 | Piano-roll minimum row height `3px → 6px`; note resize disabled below 10px width (already) | a 3px row cannot be hit reliably by any pointer, so the editor silently becomes unusable when zoomed out. |
| D19 | Marquee-in-progress is neutral (`--line2` dashed) rather than accent-tinted | accent means *selected*; a marquee is a proposal, and colouring it accent pre-announces a result that may be empty. |
| D20 | No minimap / overview strip | the section row plus fit-to-song is the map; a second render of every clip is not worth a permanent band (revisit above ~200 bars). |
| D21 | The e2e suite's transport selectors change with the pill: `getByTitle('Play'\|'Stop'\|'Record'\|'Stop recording'\|'Open mixer'\|'Close mixer'\|'Count-in: off, 1 bar, or 2 bars')` become roles/labels on the pill and the utility cluster; J3's 4px-strip `selectRange` helper is replaced by a plain empty-lane drag | the suite has no `data-testid`, so it binds to titles that this spec deliberately changes — update `e2e/journeys/support.ts` and `e2e/arrangement-editing.spec.ts` in the same PR, not after. |
| D22 | The contrast test's `timelineSelection/timelineClipBg ≥ 2.9` carve-out is retired in favour of a ≥ 3:1 `--acc` outline + ring | the signed-off near-3:1 value existed because selection was carried by a fill; with an outline there is no reason to sit below the floor. |

**Doc follow-up.** `docs/timeline.md` must be updated in the same PR as the implementation:
the "Entering and leaving the DAW" paragraph (transport strip → pill), the editing-contracts
list (snap radii, the new modifier table, the range/marquee rule), and the honest-gaps list
(loop-brace creation and marker deletion stop being gaps; `setTrackColor` / `moveTrack` /
`createClip` join the vocabulary). Docs are part of the feature.
