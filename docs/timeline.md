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
shortcuts follow the active surface. An empty Song offers two real starters: the compact
**Paper Sketch** and the full 24-bar **First Light** production.

The upper transport strip owns play/stop, record, the bar.beat position, tempo, loop and
punch state, undo/redo, mixer visibility, and export. The ruler below it carries section
chips, markers, ranges, and the playhead. Track headers stay fixed while the ruled song
field scrolls. Section chips are document locations, not decorative labels.

## The song document and playback

`Arrangement` in `src/song/types.ts` is the persisted source of truth. MIDI and audio
sources own media; clips are windows onto those sources; tracks bind clips to graph refs;
locations describe sections, marks, loop/punch and song ranges; automation lanes target
addressable graph or mixer parameters.

`conduct(arrangement, backend)` is the single pure lowering. It emits the same native or
wasm `OjGraph`, normalized `TempoMap`, and immutable sample-addressed `Timeline` used by
preview and offline bounce. Backend remapping changes engine manifest ids, not musical
time. Playback publishes those documents to the active executor; the transport freezes
honestly on stop and auto-stops after the authored release tail. Loop range is absent
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

Magnetic snap uses a 12 px grid radius and an 18 px radius for meaningful anchors; anchors
win equal-distance ties. It is disabled below 3 px per grid unit. Ctrl/Cmd held during
motion inverts snap, while Alt+Shift preserves the selection's relative offset. When snap
displaces the raw point by at least 1 px, the controller publishes the snapped tick and the
arrangement renders a positioned `.arrangement-snap-indicator`; its visual hairline styling
belongs to the CSS lane and is not part of this TypeScript round. This supersedes BC-06's
former flat 25 px law.

Empty-lane drag selects a snapped time range; Alt+drag is object marquee, Ctrl toggles
objects in that marquee, and Shift extends. Section/marker chips write
`selection.sectionIds`; Delete emits `removeLocation`. Double-clicking the empty band of
a section/marker chip or the uncovered sections row creates a marker, while double-clicking a
chip's **label** opens its inline rename; the two are told apart by the element the pointer
was pressed on, because pointer capture retargets the synthesized click to the capturing
element. **Ctrl+M** creates a marker at the playhead, and `addMarker` exposes the same
operation to the command/agent path.
Marker drag and inline rename use `moveLocation` and `setLocationName`. Draw tool B previews a ghost and creates
an empty MIDI source and clip as one `createClip` operation; a click/double-click creates
one bar. Track names edit inline (Enter/changed blur commits, Escape restores), tracks
reorder with `moveTrack`, the header colour input emits `setTrackColor`, lane height clamps
to 28–480 px (Alt applies the drag to every lane; double-click restores the default height —
220 px while an inline piano roll is open, 72 px otherwise — it does not measure content),
and header width clamps to 160–320 px. The lane divider is the bottom 5 px of each lane; the header
divider is a 6 px column at the header's right edge.

The ruler chrome is 64 px — sections 22, braces 14, bars 28 — declared once as
`--arrangement-ruler-height` in `gestureHandles.css`. Every ruled field overlay (ground, grid
anchor, playhead, loop wash, range selection, range marquee) reads that same variable, so the
playhead and the grid start exactly where the ruler ends; `RULER_HEIGHT` in
`ArrangementSurface.tsx` is its JS twin and must be changed with it. The
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
- visible CSS for the snap hairline, track level bead, inline track-name editor, brace row and
  brace glyphs, section-chip label, resize grips, and the track-colour swatch popover (the
  header still uses a raw `<input type="color">`); the bars row also overflows the ruler
  viewport by 2 px because the shell's 2 px bottom border is inside its 64 px box;
- bare `ArrowUp`/`ArrowDown` are consumed by the clip track-move binding even with nothing
  selected, so they do not scroll the field natively;
- Step entry is disarmed only from the toolbar Step button — no key disarms it;
- group-edge magnetic anchors for multi-clip drags;
- plugin delay compensation;
- stems and reversible track freeze.

These extend the shared `Arrangement`/Verb/Timeline path; none requires a parallel DAW
model or changes the real-time core boundary.
