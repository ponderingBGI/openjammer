# The app shell — topbar, transport, first run, rigs

The shell is the frame around the instrument: one rule at the top, one transport floating
under it, and — exactly once, on a machine that has never opened OpenJammer — three
questions over a blurred preview of the studio you are about to get.

Its whole job is to disappear. The loudest thing on screen is the patch; after that the
transport; after that nothing.

---

## Topbar

A fixed 46px band (`--oj-topbar-height`) on `--bg-node-header`, closed by one
`--border-subtle` hairline. `src/components/Shell/Topbar.tsx`.

**Left — where you are.** The brand dot and name, then File / Edit / View as ghost
triggers (`Shell/AppMenuBar.tsx` → `Toolbar/DropdownMenu.tsx`, which renders the oj-ui
`Menu` family so the app has ONE menu vocabulary). Breadcrumbs appear only when you are
inside a node.

**Centre — which surface.** `Canvas / Arrangement` as a segmented control, with the live
`Tab` keycap beside it. It lives here rather than in the transport pill because *where you
are editing* is a document-scope choice, not a fact about time.

**Right — how things are.** Undo / redo (the UNIFIED history: graph and timeline alike),
the engine-health dot, the latency chip, the project and offline chips, the collaboration
control, the theme toggle, settings.

Every shortcut keycap in the menus and on the switcher is read from the LIVE keymap, so a
rebound key is never advertised wrong.

### The latency chip

High latency used to be a full-width banner that collided with the arrangement's transport
row and covered the canvas. It is now a `--warning-ink` chip in the status cluster showing
the honest round-trip in milliseconds; pressing it opens a popover with the same diagnosis
and the same three actions (**Fix now**, **Ask AI**, **Dismiss**) over the same store.
A warning must be seen without stealing the moment.

### `Tab`, focus, and the chrome

`Tab` means two things and both are right: on the stage it **switches surface** (the
keycap in the topbar says so), on a control it **walks to the next control**. The keymap
arbiter draws that line by the event's target — `Tab` only reaches
`view.toggleArrangement` when the target is `document.body` or inside a
`[data-surface-root]`.

That guard is only honest if a click does not silently park focus on chrome, so the
topbar and the transport pill each **release focus after a POINTER activation** and keep
it after a keyboard one (`src/components/Shell/chromeFocus.ts`). The discriminator is
`event.detail !== 0` — a click synthesised by `Enter`/`Space` carries no click count, a
real pointer click always does. No `:focus-visible`: Chromium raises it on the `Tab`
keydown itself, so it cannot tell walking from clicking. Fields the control just opened
(the tempo scrubber, the `bar.beat` readout) and menu/popover triggers keep their focus,
because something else is about to need it.

---

## The transport pill

`packages/oj-ui/src/components/TransportPill` (presentational) driven by
`src/components/Shell/TransportPillHost.tsx` (the wiring).

ONE pill, floating top-centre, identical on the canvas, the arrangement and the piano
roll, so a performer's hand learns a single place for *is it running and where am I*. The
ruled surfaces reserve the lane it occupies (`--oj-surface-top`) so it never covers a bar.

Zones appear only when they are **true**:

| Zone | When | Notes |
|---|---|---|
| Play / Stop | always | 32px accent circle. Also the browser's audio-unlock gesture. Shows **Stop only once the engine has confirmed it**. |
| Record | a Song exists | Disabled with *"Arm a track first"* until a track is armed. |
| Return to start | a Song exists | |
| `bar.beat` readout | a Song exists | Click to type a position. Muted while a transport command is unconfirmed. |
| Tempo | always | Drag `Δx/3` per BPM, `Shift` fine, `Alt` coarse, clamped 20–300, ONE `setTempo` on release. Without a Song it is inert and says why. |
| Loop · Metronome | a Song exists | Long-press or right-click the metronome for the count-in. |
| Meter | always | Master output level. |
| `space` keycap | only where Space really is the transport | See below. |

**One gesture.** The pill's play button and `Space` both call
`transportStore.toggleGlobalPause()`, so they can never disagree. What that MEANS is
honest about the document: with a Song it plays and stops the song; without one it is the
global hold for continuous sources (loopers), which stays separately reachable as
*View → Pause loopers*.

**The `space` hint is conditional.** On the canvas, Space carries the transport only in
config mode (modes 2–9 give it to the sustain pedal); on the piano roll it is not bound at
all. An advertised key that does nothing is worse than no hint, so the keycap hides.

**The attention pulse** exists for exactly one reason — the browser has not let sound
through yet — so it runs only in the browser tier, only before the first gesture of the
session, and never while rolling. It is an expanding ring behind a button whose box never
moves (a hit target that oscillates is harder to hit); under reduced motion it becomes a
static ring.

**Nothing here goes through React state per frame.** The `bar.beat` readout and the meter
are written straight onto the DOM from the app's ONE shared animation frame
(`Arrangement/sharedAnimationFrame`). A rolling transport costs zero renders.

**The glyph waits for the engine.** `arrangementStore.isPlaying` is optimistic — it flips
the instant `play()` is called, and when the engine never acknowledges, the 1.5s timeout
raises a `transportError` and leaves `isPlaying` TRUE. The pill is the one place a
performer looks to ask *is it running*, so a **Stop** glyph over a frozen playhead is the
worst lie it can tell. It shows **Stop** only when the transport is playing, nothing is
pending a start, and there is no live transport error:

| Store state | Glyph | Readout |
|---|---|---|
| `transportPending: 'play'` — start unconfirmed | Play | `--text-muted` |
| `transportError` — engine refused or went silent | Play | — |
| playing, confirmed | Stop | normal |
| playing, `transportPending: 'seek'` mid-scrub | Stop | `--text-muted` |

Confirmation is one `TransportFrame` away, so on a healthy engine the flip is a frame, not
a delay a hand can feel — and the next confirmed frame clears a transient error by itself.
Stopping is instant in the other direction: `isPlaying` goes false with the gesture.

### The meter

`packages/oj-ui/src/components/Meter` — six bars, each a static track with a fill that
scales from one custom property, `--oj-meter-signal`. Above `0.99` it turns
`--accent-danger` and latches for 1.2s.

`Shell/masterSignal.ts` feeds it from the engine's existing per-node level stream:
`__master__` while a song is conducting, otherwise the loudest speaker node — the same
address the Speaker node's own meter reads. The value is published on a **dB scale**
(−60…0 dBFS → 0…1): a comfortably loud held note is about 0.02 RMS, which on a linear bar
is indistinguishable from silence.

---

## First run

`src/components/Onboarding/`. Three questions, one tap each, number keys `1`–`3`, `Esc` or
**Skip, take me in** to finish with defaults *keeping whatever you already answered*.

1. **Experience** → the density persona (`first` · `some` · `pro`).
2. **Goal** → which preset rig gets built (`jam` · `beat` · `sound`).
3. **Light or dark** → the theme, previewed live as you hover each swatch.

It renders over the REAL studio, blurred 5px and non-interactive: what you are about to
get, not a picture of it. The answers persist as
`localStorage['oj-onboarding-v1'] = { exp, goal, theme }`; their **absence** is the only
thing that opens the overlay. *Settings → Graphics → Redo setup* clears them.

**The browser gate.** On the browser tier the finishing tap is the user gesture that
unlocks Web Audio, so `OnboardingHost` calls `initAudioContext` **synchronously on that
click's own stack**, before touching anything else. Deferring it into a promise chain or
an effect loses the gesture and the rig comes up silent. Native has no gate (the Rust
engine is already running), so the copy there never pretends otherwise and the pill never
pulses.

**Accessibility.** A real focus trap, a labelled `aria-modal` dialog, number keys that
never fire while a field has focus, and no blur at all under `prefers-reduced-motion` or
`prefers-reduced-transparency`. The scrim sits at 55% because every word on it is
`--text-primary` — see the contrast arithmetic at the top of `Onboarding.css`.

### Personas

The persona sets where you START, never where you must stay. Every control stays reachable
at every density.

| | `first` | `some` | `pro` |
|---|---|---|---|
| Shortcut card | open, five rows | collapsed | collapsed |
| "Nothing can break" hint | shown on the canvas | — | — |
| Rig density | shortest chain that makes the promised sound | + a stereo stage | + width / extra stages |

---

## Preset rigs

`src/rigs/`. Built through the SAME reversible verbs a player drives by hand and the agent
emits — `graphStore.addNode` / `addConnection` inside ONE gesture, so the whole rig is a
single history entry and one `Ctrl+Z` takes it away. The beat rig's Song is inside that
same gesture (see below), not a document opened beside it.

| Goal | Real nodes | Sound |
|---|---|---|
| **jam** | `keyboard-visual` → `instrument` (`gm-electric-piano-1`) → `effect` (delay) → `speaker` | An electric piano with space on it. Click the keys, or play Q–P / A–L / Z–/. |
| **beat** | `keyboard-visual` → `instrument` (`gm-synth-drum`) → `effect` (reverb) → `speaker`, plus a `song` | An 8-step groove, looping on the real transport. |
| **sound** | `keyboard-visual` → `instrument` (`gm-pad-warm`) → `effect` (filter) → [`pan`] → [`width`] → `speaker` | A warm pad through a filter, with real `Knob`s. |

Wires resolve against the **live** node, not the registry: adding a `keyboard` replaces
its declared ports with its internal panel's `Row 1…3`, and an `instrument`'s single
`Bundle` becomes an expanding panel. A port NAME is a hint; the signal the cable carries
(`audio` or `control`) is the fallback.

Every voice is synthesised by the engine from a catalogue id. **There are no bundled
sample assets in this repository**, which is why no rig uses the Sampler: it would install
a node that makes no sound until the player finds a WAV.

**Every rig ships the ON-SCREEN keys** (`keyboard-visual`, D12). A beginner is told
“press the keys”, so the first canvas contains keys to press: three QWERTY rows that
light up, click to sound a note through the same seam typing uses, and end in the `ROW
1…3` / `PEDAL` sockets the cables leave from. All three rows are wired to the
instrument, so every key on the card plays (rows sound at octaves 5 / 4 / 3).

Two costs, written down rather than hidden:

- **The rows do not arrive as a detected BUNDLE.** `bundleManager.getBundleInfo` reads a
  container's `output-panel` port; a leaf keyboard's `row-1` is not one, so the
  instrument's input panel never expands and all three cables land on its single `IN`
  socket. The notes are identical either way — what is missing is the per-row
  `NOTE / OCT / OFF` tuning block, and the instrument says so in plain words. Giving a
  leaf row a synthesised bundle is the tracked follow-up.
- **There is no pad layout yet.** The faceplate draws keys only, so the beat rig gets
  keys rather than a promise of pads.

**Honest deviation:** the handoff's third rig asks for "an oscillator, a filter, knobs".
There is no standalone oscillator or filter NODE in the registry — those are DSP, and DSP
is plugin territory. The rig is expressed with what really exists.

**`Ctrl+Z` really does remove the rig.** Installing a rig switches the app into that rig's
keyboard mode so typing plays immediately, and the canvas used to gate its editing
shortcuts on config mode — which made `Ctrl+Z` dead from the moment a rig landed. The
chords (`Ctrl+Z` / `Ctrl+Shift+Z` / `Ctrl+C` / `Ctrl+V` / `Ctrl+A` / `Ctrl+D`) now run in
every mode; only the bare letters are mode-gated, because those are the notes.

### The beat rig's Song and the step grid

`src/rigs/beatSong.ts` builds a real `Arrangement`: one MIDI source, one track, one clip,
one bar, a loop location, and its own graph spec (drum voice → speaker). It plays on the
shared transport — pressing Stop stops it, the pill's readout is the truth, and the piano
roll opens the same notes.

**The Song leaves on the same `Ctrl+Z` as the nodes.** It is installed INSIDE the rig's
gesture, so nodes, cables and Song are one history entry: one undo takes the whole rig
away and puts back whatever song was open before, one redo brings all of it back. That
needs a swap the timeline's ordinary `Verb`s cannot express (a `Verb` edits a song that
exists; a rig crosses none→song), so the command-log carries one extra shape for exactly
this case — a `document` snapshot verb (`historyStore.EditVerb`,
`arrangementStore.setArrangement`'s `preserveHistory` option), applied in the order it was
recorded: a swap lands before the `Verb`s that edit the song it brought in, and on undo the
restore comes last, after the inverse verbs that still belong to the song being taken away.
Opening a document by hand still CLEARS the log, as it must: undo may never reach across
a document boundary and put half of one song inside another. The snapshot carries the
**loop arm** with the document, because `setArrangement` resets the transport: a redone beat
rig comes back looping exactly as the install left it, and an undo puts the loop switch back
where the player had it. That undo also stops playback — the song being played is gone.

`src/components/Shell/StepGrid.tsx` is a **thin view over that clip**: three rows × eight
cells, and every toggle goes through `drawNotes` / `eraseNotes` — the same operations a
piano-roll pencil stroke emits, in the same undo history. It appears only for the beat
rig's own source. The playhead column is a `data-step` attribute the shared frame writes;
no React render moves it.

---

## Safe Mode

`src/components/SafeMode/` wears the same full-screen card language as the first run — a
brand row, a 30px question, big option cards. The two moments a player ever sees a
full-screen OpenJammer should feel like the same product.

Unlike the first run its scrim is opaque: Safe Mode exists precisely because the state
behind it may be what crashed, so it is not on offer.
