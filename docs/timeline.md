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
unless the document contains a `loop` location.

Saved projects carry the normalized arrangement alongside the visual graph. Entity ids
are deterministic and `normalizeArrangement` is idempotent, so reopening and conducting
a song preserves its result.

## Arrangement editing contracts

Every committed edit is a serializable `Verb` from `src/song/verbs.ts`. `applyVerb` returns
an exact inverse and `applyVerbs` makes a batch one undo step. Pointer previews may be
transient, but drop/commit always enters this command log. The same laws are pinned by the
BC contract tests:

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

## Piano roll

Double-click a MIDI clip to open its piano roll. It shares the song clock and source-note
ids, so note edits immediately update the arrangement and remain undoable with the parent
song. The shipped tools cover draw, select/move/copy, resize, velocity, erase, step entry,
transpose and quantize.

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

## Agent parity

The agent first calls `describe_arrangement`, which reports stable ids, ppq, bar positions,
tracks, clips, note detail, sections and automation targets. It changes the song with
`edit_timeline`, an ordered batch of the same operations used by the UI: track and clip
edits, grid/nudge, range editing, piano-roll notes, mixer/automation, loop/punch, and
recording controls. Validation and application are atomic; one bad operation lands none of
the batch, and a successful batch is one Ctrl+Z step.

`export_song` uses the native export contract rather than a special agent renderer. Tool
registration, advertised schemas, and this documentation are guarded by the agent parity
and documentation drift tests.

## Honest gaps

The DAW is usable end to end today: arrange, edit notes, mix and automate playback, record,
preview, save/reopen, and export. The remaining named gaps are deliberately narrow:

- take-lane expansion and comping UI;
- Write/Touch automation capture;
- plugin delay compensation;
- stems and reversible track freeze.

These extend the shared `Arrangement`/Verb/Timeline path; none requires a parallel DAW
model or changes the real-time core boundary.
