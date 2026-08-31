# The timeline — OpenJammer's DAW

OpenJammer's `Song` node opens into a complete arrangement surface: tracks and clips,
MIDI editing, mixer and automation, recording, and finished-file export. It follows the
same architectural rule as the canvas: the human interface and the agent edit one shared
document with one reversible vocabulary. There is no agent-only song model and no second
audio engine.

For the architectural boundary, see [BOUNDARY.md §9](BOUNDARY.md#9-one-core-two-clocks--offline-render-is-not-a-third-executor).
For the agent's callable contract, see [agent-tools.md](agent-tools.md).

## Entering and leaving the DAW

Add **Utility → Song** from the canvas, select it, then press **E** or use the node's
interior action. The arrangement replaces the canvas without unmounting it. Press **Tab**
to move between the Song interior and its parent canvas; focus, selection, and transport
shortcuts follow the active surface. An empty Song names every way in: the compact
**Paper Sketch**, the full 24-bar **First Light**, **Record something** (adds an armed
track), **Draw a clip** (adds a track and arms the Draw tool), and a ghost link for a bare
empty track.

**`E` in, `Q` out — in every mode, with the note row as the fall-through.** On the canvas
those two keys collide with the computer-keyboard note row (`q w e r t y u i o p` is row 1),
and installing a rig selects that rig's keyboard mode so typing plays it straight away. Every
preset that carries a Song carries a keyboard, so for a first-run player the two conditions
always coincided and `E` over a selected Song node was a note: the level grammar was dead in
exactly the songs that had somewhere to go. `canvas.enterNode` and `canvas.exitLevel` are now
registered **before** the note row and **consume their key only when they change level** —
`E` when exactly one selected node can be entered (a Song opens the arrangement), `Q` when you
are inside a node. Nothing selected, nothing enterable, already at the root: the key falls
through and plays its note, which is how a jam looks. The alternative — scoping the note row
to a focused keyboard node — was rejected because the row is played while looking at the whole
canvas with nothing focused; that would have cost real playing to buy one key. In config mode
(mode 1) both keys still always belong to the canvas, since there is no note behind them.

**The surface, top to bottom.** A 56px **sky band** carries the song's name and the `Tab`
keycap on the left, the surface's own utilities on the right — edit mode (Slide / Ripple),
punch, mixer, export, timeline zoom — and reserves its middle for the ONE floating
transport pill, which is identical here, on the canvas and in the piano roll. Everything
about TIME lives in that pill (play, stop, return-to-start, record, bar.beat, tempo, loop,
metronome, the master meter). Undo and redo are *not* duplicated in the sky band: they are
document-scoped, they already sit in the topbar, and `Ctrl+Z` reaches them from anywhere.
Record and transport failures appear as a **chip in the sky band's utility cluster** plus
the existing `aria-live` region — never a modal, and never a banner that pushes the ruler
off the bar you were reading.

The band is a **three-column grid**, and the pill's lane
(`--arrangement-sky-pill-reserve`) is reserved **symmetrically**. The pill is
`position: fixed; left: 50%`, centred on the window rather than on any column, so a
one-sided reserve only protects the side it is on: with the old flex gap the right-flushed
utility cluster slid under the pill below ~1024px and hid which edit mode was armed. The
reserve is `calc(var(--oj-transport-pill-width, 428px) + 4px)`, and the width in it is
**published by the pill** — `TransportPillHost` measures itself with one `ResizeObserver`
and writes `--oj-transport-pill-width` on the document element only when the number
changes. A literal 432px was a copy of a measurement: adding a transport zone would have
put the pill back over the armed edit mode with every test still green.

Three widths, in the order the band gives way. **At ≤1180px the cluster's controls
compact** to 24px — that is the width the cluster actually starts *wrapping* at, and two
30px rows plus the 3px gap is 63px inside a 56px band, so compacting any later leaves the
ruler's sections row painting over the bottom of the zoom chip (measured 2.2px of overflow
across 1030–1177). Compacted, two rows are 24 + 3 + 24 = 51px and fit, and 1100–1180 goes
back to a single row. **At ≤1024px** the `Tab` hint goes. **At ≤900px** the zoom chip
leaves — the one control that is genuinely redundant, since `Ctrl+wheel`, `+`/`-` and
`Ctrl+0` all still reach it. No arrangement utility is ever moved behind an overflow menu,
because "which mode am I in" must be readable without a click.

Below it, one scroll container owns both axes. The **ruler stack** is 64px in three rows —
section chips and mark pins (22px), the loop/punch brace row (14px), bar numbers (28px) —
and is `position: sticky; top: 0`; the **track-header column** is `position: sticky;
left: 0` inside the same scroller, so the browser pixel-locks them and no rAF-synchronised
`translateX` can shear the ruler off the field. Every x — grid line, ruler tick, clip edge,
playhead, brace — comes from `crispLineX` in `src/song/rulerMarks.ts`, so a clip edge lands
exactly on its bar line at every zoom. The ruler's 200×64 **corner** holds the grid chip,
the magnet, the tool strip (`V B X`) and follow-playhead — beside the field they act on.
On the piano-roll surface that corner narrows to the roll's own key-bed gutter, so bar 1
sits exactly above tick 0 rather than 124px to its right.

Everything **transient** the field draws — the drag ghost and its readout, the snap
hairline, the marquee, the loop wash, the range selection and the playhead line — lives in
ONE **field overlay pane** (`.arrangement-field-overlay`), laid over the scroller's field
viewport and clipped to it. The rule those overlays share is not a stacking order but a
boundary: above the clips, never on the chrome. A z-index cannot say that — the ghost has
to outrank the clip it is moving *and* the sticky ruler's playhead cap has to outrank the
ruler — so the pane states it as a clip instead. It holds its children in timeline-content
coordinates and counter-translates by the live scroll offsets, written straight onto the
DOM in the scroll handler so the overlays never trail the clips they point at by a frame.
The drag readout is *clamped* whole inside the pane rather than cropped: half a number is
worse than a moved one. The playhead's 9px **cap** is the one piece drawn outside the pane
— it lives in the ruler's own viewport, which already begins at the header edge and
already clips.

Cap and line are driven by **one writer** (`usePlayheadTransform`) and, critically, by one
**call**: the scroller's `onScroll` invokes `writeScrollTransforms()` once and every
scroll-synchronous element moves inside that event. The cap is a direct child of
`.arrangement-ruler-viewport`, *not* of `.arrangement-ruler-content` — the content box is
counter-translated from React state committed in a rAF, and while the cap rode it a single
wheel notch pulled the cap **150px** off its own line for a frame (one frame of scroll at
any rate). Out in the viewport the cap writes its own `-scrollLeft`, so line and cap mark
the same instant at rest and mid-wheel alike. The ruler's three rows still ride the React
transform; closing *that* lag is a separate decision about the grid canvas.

A **track header** is 200px (drag-resizable 160–320) and carries a 4px colour stripe —
6px and accent when the track is selected; it is the one sanctioned vertical bar on this
surface, because it is the track's identity, the same colour its clips wear on their left
edge. Under the name sits the **level bead**, a 3px `--success-ink` bar driven by the
signal writer — `--success-ink`, not `--accent-success`, because the latter is 2.99:1 on
the header in light and the bead is the one element here that reports live sound, so it
must never be the dimmest pixel. It is the ONLY animated element in the field region, so "which track is
making that noise?" is answered at one stationary, pixel-cheap place instead of by
repainting every clip at 60fps. Section chips are document locations, not decorative
labels; a `kind: 'mark'` renders as a triangle pin with its name, never as a chip that
appears to span a section it does not own.

The **mixer drawer** is 188px (`M`), one 124px strip per track plus a 92px master. The
**automation lane** is 96px; its parameter select, live value, `Off | Play` and
`Step | Linear` live in the 200px header column, in line with the track header above them —
one column of controls, one column of time.

## The song document and playback

`Arrangement` in `src/song/types.ts` is the persisted source of truth. MIDI and audio
sources own media; clips are windows onto those sources; tracks bind clips to graph refs;
locations describe sections, marks, loop/punch and song ranges; automation lanes target
addressable graph or mixer parameters.

`conduct(arrangement, backend)` is the single pure lowering. It emits the same native or
wasm `OjGraph`, normalized `TempoMap`, and immutable sample-addressed `Timeline` used by
preview and offline bounce. Backend remapping changes engine manifest ids, not musical
time. Playback publishes those documents to the active executor; the transport freezes
honestly on stop and auto-stops after the authored release tail.

**The transport gesture is three states, not a toggle.** One gesture — `Space`, or the
pill's button — and what it means depends on where the transport is. Rolling: **Stop**, and
the playhead freezes exactly where it is. Stopped *away from the tick playback last started
at*: the **second Stop**, which returns the playhead there; the button says so, showing a
solid rewind mark and the name "Return to where playback started" rather than a play triangle
that would not play. Anywhere else: **Play**. So stop-stop rewinds and a further press plays
from the origin it just returned to, and there is no "return on stop" preference to find.
`stopReturnsToOrigin()` in `arrangementStore` is the one predicate all four callers read —
`transportStore.toggleGlobalPause` (the pill and canvas `Space`), `arrangement.transport`,
`pianoroll.transport`, and the pill's glyph — so the key and the button can never disagree
about what the next press does. The arm is cleared by anything that re-aims the transport
(`play`, `seek`, `record`) and by the honest end-of-song halt, because a rewind nobody asked
for is a musical accident. Loop range is absent
unless the document contains a `loop` location. Enabling Loop without such a range does
not create an implicit whole-song loop: playback still stops at the authored end.

Saved projects carry the normalized arrangement alongside the visual graph. Entity ids
are deterministic and `normalizeArrangement` is idempotent, so reopening and conducting
a song preserves its result.

## Arrangement editing contracts

Every committed edit is a serializable `Verb` from `src/song/verbs.ts`. `applyVerb` returns
an exact inverse and `applyVerbs` makes a batch one undo step. Pointer previews may be
transient, but drop/commit always enters this command log. The same laws are pinned by the
BC contract tests:

Agent edits requested during a live performer gesture queue without interrupting it, then
apply atomically as their own undo entry when the gesture ends. A rejected queued edit is
reported in the transport status and in the next `describe_arrangement` result.

- Grid units and magnetic snap are BC-05/06. A drag begins only after BC-12's movement
  threshold and dominant axis is established.
- Move is Slide by default (BC-09); Ripple is explicit (BC-10). Trim and split preserve
  source-window meaning (BC-17/20); slip moves content under the clip (BC-19).
- Nudge is grid-aware (BC-21). Object and range selection are exclusive (BC-23), and
  range delete/split preserve material outside the range (BC-25).
- Selection, cut, copy-drag, paste and repeat-paste remain atomic and clipboard-safe
  (BC-14, BC-26–29). Delete does not unexpectedly replace the clipboard.

The editing context owns grid, snap, tools, selection, focused viewport, and clipboard.
That keeps arrangement commands deterministic whether invoked by mouse, keyboard,
command bar, or agent.

### Wave 3 gesture and navigation contract

Every timeline drag uses one surface-scoped pointer lifecycle. Capture loss is non-terminal;
window pointer-up commits, while pointer-cancel, blur, Escape, and that surface unmounting
restore the exact pre-gesture document. Arrangement teardown never aborts a piano-roll
gesture. Preview writes share one animation frame. The dominant axis freezes after the
4 px threshold (scaled 1.75 for coarse pointers), copy-drag is **Alt** held during the drag
and requires 12 px horizontally, and edge auto-scroll stops after 400 ms when the pointer
stops moving. Ctrl/Cmd during a drag inverts snap; it does not copy.

**Who owns a finger.** The field is one `overflow: auto` scroller, and a scroller claims
every touch that crosses its slop unless a descendant says otherwise — so until the
declarations existed the whole timeline was pointer-only in practice: a touch drag on a clip
went `pointerdown` → `pointercancel`, the gesture correctly restored the pre-gesture
document, and the clip never moved. Everything the hand **grabs** is `touch-action: none` —
the clip (and therefore its trim, fade and slip zones, which are descendants), the ruler
stack with its section chips and braces, the lane-height and header-width dividers, the track
reorder grip, automation points, mixer faders and pan scrubbers, and the piano roll's note
field, key bed, velocity lane and scroomer. The scroll container itself is `pan-x pan-y`, and
`.arrangement-lane` is deliberately left alone: empty lane ground is how a finger pans the
field, and a surface that cannot be scrolled by touch is worse than a time range that cannot
be drawn by one. Measured: a finger moves a clip and `scrollLeft`/`scrollTop` do not change;
a finger on bare lane ground scrolls the field and no range is written.

**An editor open in a lane owns its own pointers.** The inline piano roll renders *inside*
`.arrangement-lane`, in place of the clips, so the lane's empty-ground gesture excludes the
roll exactly as it already excluded `.arrangement-clip`. Without that, every press on a note
also started the arrangement's range-select: the roll wrote `noteIds` first and the lane
overwrote the surface selection last, so — since every roll keyboard action begins
`if (!selectedNoteIds.length) return` — transpose, velocity, nudge, duplicate and delete all
went dead the moment a pointer touched a note, while the full-surface roll kept working. The
inline lane and the surface are the same component and never get a second interaction model.

Magnetic snap uses a 12 px grid radius and an 18 px radius for meaningful anchors; anchors
win equal-distance ties. It is disabled below 3 px per grid unit. Ctrl/Cmd held during
motion inverts snap, while Alt+Shift preserves the selection's relative offset. When snap
displaces the raw point by at least 1 px, the controller publishes the snapped tick and the
arrangement renders a positioned `.arrangement-snap-indicator`; its visual hairline styling
belongs to the CSS lane and is not part of this TypeScript round. This supersedes BC-06's
former flat 25 px law.

Empty-lane drag selects a snapped time range; Alt+drag is object marquee, Ctrl toggles
objects in that marquee, and Shift extends. Section/marker chips write
`selection.sectionIds`; Delete emits `removeLocation`. Double-clicking a chip's **label**
opens its inline rename; double-clicking the **uncovered** sections row creates a marker;
and **Alt+double-click anywhere on the sections row — including on top of a chip — creates
a marker**. Alt is needed because a chip's label fills the whole chip, so on a song whose
sections span every bar (Paper Sketch does) there is no uncovered strip left to press, and
without the modifier marker creation by hand would be unreachable there. Rename stays the
plain gesture because it is far the commoner act. The two are otherwise told apart by the
element the pointer was pressed on, because pointer capture retargets the synthesized click
to the capturing element. The sections row carries the affordance as a tooltip —
`Double-click to rename · Alt+double-click to add a marker` — because a modifier nothing on
screen mentions is a gesture only its author knows. **Ctrl+M** creates a marker at the
playhead, and `addMarker` exposes the same operation to the command/agent path.
Marker drag and inline rename use `moveLocation` and `setLocationName`. Draw tool B previews a ghost and creates
an empty MIDI source and clip as one `createClip` operation; a click/double-click creates
one bar. Track names edit inline (Enter/changed blur commits, Escape restores), tracks
reorder with `moveTrack`, the header colour input emits `setTrackColor`, lane height clamps
to 28–480 px (Alt applies the drag to every lane; double-click restores the default height —
220 px while an inline piano roll is open, 72 px otherwise — it does not measure content),
and header width clamps to 160–320 px. The lane divider is the bottom 5 px of each lane; the header
divider is a 6 px column at the header's right edge.

The ruler chrome is 64 px — sections 22, braces 14, bars 28 — declared once as
`--arrangement-ruler-height` in `gestureHandles.css`. The brace row draws each range as a
3 px bar with 7 px end-cap grips: `--accent-primary` for the loop, a dashed
`--accent-danger` for punch. Ruler gestures round to whole ticks before they preview, so a
marker or a brace edge can never land on a fractional tick no verb in the model can express. Every ruled field overlay (ground, grid
anchor, playhead, loop wash, range selection, range marquee) reads that same variable, so the
playhead and the grid start exactly where the ruler ends; `RULER_HEIGHT` in
`ArrangementSurface.tsx` is its JS twin, `SKY_HEIGHT` is the twin of
`--arrangement-sky-height`, and both are pinned equal by test — the field overlay pane is
placed at `sky + ruler`, so a drift would offset every transient overlay from the field it
is supposed to be inside. The
positioned loop bracket is calculated from its start/end ticks, `pxPerTick`, and horizontal
scroll; the brace row creates, moves, and resizes loop/punch ranges. A press on the *empty*
brace row does not swallow the click: it keeps bubbling to the ruler scrub, so a click without
a drag still seeks, and the brace drag only takes the pointer — restoring the playhead — once
it passes the 4 px threshold. A press on an existing brace or end cap owns the pointer
outright. Scrubbing owns the
complete pointer stream; editor note audition remains disabled while transport is rolling.
Arrangement shortcuts include E/Q level navigation, Shift+Space, Shift+Z, Ctrl+0, +/-,
Alt+G, Home/End, Ctrl+Left/Right marker traversal, Alt+Left/Right bar nudge, Up/Down clip
track moves, Ctrl+Alt+arrows spatial selection (Shift extends), V/B/X/K/T tools,
bracket-key grid changes, L/I/O/P/M/F/0, Ctrl+M, Ctrl+E, Ctrl+Shift+Backspace, and Ctrl+A.
`I` and `O` clamp the loop they set: the range is always at least one grid unit long and never
starts below zero, so `O` with the playhead at 1.1 no longer emits an invalid location verb.
Two documented deviations from the interaction spec: spec §4.2 assigns `M` to the mixer while
the code binds `M` to the metronome (the mixer is the transport's **Mix** button), and spec
§4.3 assigns `K` to Velocity while both surfaces bind `K` to the knife.
Catalogue-backed actions are rebindable in Settings; the newer binding-set-local actions
use their documented defaults but are not yet listed in Settings. Follow-playhead defaults on in page
mode: crossing the rightmost 15% jumps to one-sixth from the left. Manual scroll, zoom, or
field interaction disarms it; play from stopped or F re-arms it. Reduced motion never stops
the playhead clock and adds no smooth-scroll animation.

## Piano roll

Double-click a MIDI clip to open its piano roll. It shares the song clock and source-note
ids, so note edits immediately update the arrangement and remain undoable with the parent
song. The shipped tools cover draw, select/move/copy, resize, velocity, erase, step entry,
transpose and quantize.

The inline lane and the full surface are the **same component at two heights** — the surface
adds a 40px toolbar and the clip-bounds brackets, never a second interaction model. The
toolbar carries only what a hand reaches for mid-take: the five tools (`V B X K T`, 28px
each), the quantize grid chip, `Quantize`, the drum-row override, and a `⋯` popover holding
grid / strength / swing, because those three number fields are set once a session and should
not cost permanent chrome. Notes are painted in the **`--acc2` ink** — `--universal-connection`
carried 60% of the way into `--text-primary`, so it darkens in light and lightens in dark
exactly as a real `--accent-two-ink` token would — at `velocityOpacity()`, whose ramp runs
**0.68 → 1.0**. Both numbers are set by the 3:1 floor rather than by taste: raw `--acc2` at
FULL opacity is only 3.35:1 on a white-key row, so no alpha floor alone could have carried
the quiet notes, and at the old 0.45 floor the softest note measured 1.65:1. Composited, the
softest note is now 3.2:1 light / 4.8:1 dark, and the ramp is still monotonic and still
exactly 1 at velocity 127. Selection is a 1.5px `--acc` outline plus the one
ring; notes belonging to other clips render at 22% and are non-interactive. A sharp is drawn
as a **short bar on the white ground** rather than a fill swap — every "inset" token in this
system goes *lighter* in dark, so a fill-based black key drew the keyboard upside-down, and
a shape cannot invert. Row height is `clamp(6px, fieldHeight / pitchSpan, 22px)`: the 6px
floor is the pointer contract, the 22px ceiling is what lets a narrow pitch range fill the
surface instead of floating above dead space.

### Key resolution and the `inherit` allowlist

Resolution is inside-out and, in order: an editable target or a native text copy yields
outright; a live pointer drag consumes everything except Escape; the top-most modal is
exclusive; then the focused binding set, each enclosing DOM surface outward, the active app
surface if it is not already in that ancestry, and finally the global sets. The first entry
whose combo matches, whose `guard` does not return `false`, and whose `run` returns `true`
wins and calls `preventDefault`.

**Fall-through is allowlisted, not blanket.** Only the innermost surface runs its whole set.
An enclosing surface contributes just the entries flagged `inherit: true` on the
`BindingEntry`. In the arrangement those are exactly seven: `arrangement.undo`,
`arrangement.redo`, `arrangement.transport` (Space), `arrangement.playFromSelection`
(Shift+Space), `arrangement.addMarker` (Ctrl+M), `arrangement.escape` and `arrangement.exit`.
Global sets — the command palette, save, export, panels, `Tab` — always run. Everything else
in the arrangement set is surface-local, so from a focused inline piano roll `s` cannot split,
`0` cannot mute, `r`, `e`, `l`, `i`, `o`, `p`, `f`, `m`, `[`, `]`, `v b x k`, the arrows,
Delete/Backspace, `Ctrl+D/E/A`, `Shift+Z`, `+`/`-`, `Ctrl+0`, `Home`/`End`, `Ctrl+←/→` and
`Alt+←/→` do nothing: an editor can never edit the thing it is editing from underneath.

Piano-roll keys live in one `surface: 'pianoroll'` binding set selected
by the focused roll, whether that roll is inline or full-surface. Editable fields keep their
native keys. Ctrl+Z / Ctrl+Shift+Z call shared document history from inline and full rolls,
and Space, Shift+Space and Ctrl+M reach the arrangement through the allowlist. Space
reaches transport unless Step is armed. `Q` closes the roll — collapsing an inline roll back
to its previous lane height, or leaving the full-surface roll — and `Escape` clears the
selection first, then closes. When the roll has nothing left to close, both entries return
`false` and the arrangement's inherited `exit` / `escape` runs, so there is never a dead key.
Ctrl+Q quantizes. T arms Step; while it
is armed, `a w s e d f t g y h u j` enter pitches, Space/Backspace move the cursor, Z and
Shift+Z change octave, and V/B/X/K do not steal those keystrokes. With Step disarmed,
V/B/X/K select, draw, erase, and knife. Plain wheel scrolls, Alt+wheel edits velocity,
Ctrl/Cmd+wheel zooms, and Ctrl/Cmd+Shift+wheel changes the visible pitch-row scale.
ResizeObserver measures the host and rows never shrink below 6 px. Drawing or step entry
beyond the active clip posts visible feedback; the clip is not silently extended.

Key-bed and scroomer drags use the same window-owned pointer controller as note gestures.
The velocity lane supports one-gesture paint and Alt-ramp. The piano-roll playhead, the
arrangement playhead, record ghost, mixer meters, and per-track level beads all write from
the shared timeline animation frame rather than independent loops.

Structural edits while playing preview visually. Parameter/automation previews currently
re-conduct the authored preview document at a bounded 20 Hz; there is not yet a direct
real-time parameter-preview command. Failure preserves the last good sound. Agent edits that
arrive during a performer gesture queue and apply atomically afterward as their own undo.

The note laws are BC-30–37: drawing is one overlap-aware batch; a multi-note move uses one
clamped delta; edge handles follow the shared hit-zone rule; velocity and transpose reject
an invalid whole gesture instead of partially corrupting it; step entry lowers to ordinary
note verbs; quantize uses fully quantized edges for duration. Piano-roll audition conducts
through the active executor rather than introducing a preview synth.

## Mixer and automation

The mixer is a view over each track's conducted output stage. Gain is stored in dB and pan
as `-1…+1`; mute and solo affect the same stage. Conduct inserts a Gain and Pan between a
track's reachable signal chain and its consumer, preserving shared downstream buses.
Meters address those exact output stages plus the master output.

Automation lanes target a graph ref and numeric parameter. `Play` and `Off` are the editing
states exposed today. Discrete points play directly; Linear segments are deterministically
densified at conduct time and ride engine smoothers. Point movement and guarded range
replacement follow BC-39/40, including collision stops and commit-time thinning. Mixer
gain automation stores dB and is converted to linear gain only during lowering.

**Write and Touch automation recording are not shipped.** Their document enum values are
reserved and protected on save/open, but the UI does not claim to capture them yet.

## Recording

Tracks can be armed for MIDI on both executors and for audio on native. Count-in and click
belong to the transport timeline. A recording pass commits clips and sources through the
same reversible arrangement verbs as manual editing. Loop recording stacks takes with
increasing `layerIndex`; the highest layer is the current take.

The compact `×N` layer badge is not a comp editor. **Take-lane expansion and comping UI are
still pending**; the stored layers and clip verbs are the seam that future UI will use.

## Export

**Export** opens the finished-file dialog. Native export supports WAV or FLAC, 16/24-bit or
32-bit float where applicable, 44.1–96 kHz, and fixed or automatic release tails. Browser
export renders faster than real time through the wasm engine and downloads stereo 24-bit
WAV. Both paths assemble the same conducted graph, `TempoMap`, and `Timeline`, and report
duration, peak and clipping instead of hiding a bad bounce.

The device-free native CLI accepts those same documents:

```bash
cargo run -p ojcore-native --features demo --bin render -- \
  --graph song.graph.json --timeline song.timeline.json \
  --tempo-map song.tempo-map.json --rate 48000 --bits 24 \
  --format wav --tail auto --out song.wav
```

Export does not yet provide a stem batch or track freeze. **Plugin delay compensation
(PDC) is also pending**, so tracks through latent hosted plugins are not time-aligned by a
DAW compensation layer.

Hosted instruments and effects use the same track-chain, automation, project-state, and
export path. Their format tiers and failure behavior are specified in the
[plugin hosting reliability contract](plugins-hosting.md); a faulted instance is benched or
auto-bypassed without muting unrelated tracks.

## Agent parity

The agent first calls `describe_arrangement`, which reports stable ids, ppq, bar positions,
tracks, clips, note detail, sections and automation targets. It changes the song with
`edit_timeline`, an ordered batch of the same operations used by the UI: track and clip
edits, grid/nudge, range editing, piano-roll notes, mixer/automation, loop/punch, and
recording controls. `addMarker { atTick, name? }` is the marker operation shared with
Ctrl+M and ruler double-click. Validation and application are atomic; one bad operation lands none of
the batch, and a successful batch is one Ctrl+Z step.

`export_song` uses the native export contract rather than a special agent renderer. Tool
registration, advertised schemas, and this documentation are guarded by the agent parity
and documentation drift tests.

## Honest gaps

The DAW is usable end to end today: arrange, edit notes, mix and automate playback, record,
preview, save/reopen, and export. The remaining named gaps are deliberately narrow:

- take-lane expansion and comping UI;
- Write/Touch automation capture;
- a direct RT automation-preview command (preview is currently authored-document, 20 Hz);
- Settings catalogue/conflict entries for the newest binding-set-local timeline shortcuts
  (about 25 ids, including every `arrangement.tool.*` and `pianoroll.*` action), so those
  cannot be rebound or conflict-checked yet;
- the **inline** piano roll's note field begins after its own 56 px scroomer + key bed, so
  its grid is offset from the arrangement ruler above it by that much; the FULL piano-roll
  surface is pixel-locked to its ruler (measured 0 px at three zooms). Closing the inline
  offset means either hiding 56 px of notes behind the key bed or moving the key bed across
  the track grid into the header column — a structural change, not a styling one;
- the track colour still uses a native `<input type="color">` (dressed as a swatch showing
  the track's *effective* tint) rather than the 8-swatch popover; the native picker is the
  only one that reaches the OS palette;
- `shouldAutoDetectDrums` false-positives on a pitched part whose ≤16 distinct pitches all
  fall in 35–81 (Paper Sketch's chord clip is one), so the roll opens in drum rows until the
  `Drums` toggle is pressed;
- `--acc` and `--acc2` are near-isoluminant by design (oklch L .66 light / .72 dark), so the
  accent **selection ring on a note** is 1.0–2.0:1 against the note's own fill and the
  selected state leans on the ring plus the focus halo outside it, not on the ring alone.
  The same question applies to the selection outline over a tinted clip fill (2.98–3.04:1 in
  light). Both are spec-level colour decisions (§2.5 / §2.7), not local CSS bugs, and both
  are recorded by gates in `Arrangement/__tests__/contrast.test.ts`;
- the surface still borrows `--universal-connection` — a *port* name — as its second accent,
  and derives the piano-roll note ink from it. A real `--accent-two` / `--accent-two-ink`
  token pair in `oj-tokens` would let it stop;
- bare `ArrowUp`/`ArrowDown` are consumed by the clip track-move binding even with nothing
  selected, so they do not scroll the field natively;
- Step entry is disarmed only from the toolbar Step button — no key disarms it;
- group-edge magnetic anchors for multi-clip drags;
- plugin delay compensation;
- stems and reversible track freeze.

These extend the shared `Arrangement`/Verb/Timeline path; none requires a parallel DAW
model or changes the real-time core boundary.
