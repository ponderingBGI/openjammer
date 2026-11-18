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

`Tab` means two things and both are right: on the **stage floor** it **switches surface**
(the keycap in the topbar says so), on a control it **walks to the next control**. The
keymap arbiter draws that line by the event's target — `Tab` only reaches
`view.toggleArrangement` when the target is `document.body` or a `[data-surface-root]`
element **itself**. Anything *inside* a surface — a node, a faceplate, a port, a clip, a
track header — keeps native traversal.

That last clause is the fix for W5-P6's F7. The rule used to match every DESCENDANT of a
surface root, so one `Tab` with focus on a node port swapped the visible surface and hid
the card the player was working on: no port, knob or pad on the canvas was reachable by
keyboard at all. Now a `Tab` from the empty stage brings up the other surface, and a `Tab`
inside a card means what it means everywhere else.

### Ports: named, reachable, and typed at rest

This section used to record an OPEN product decision — canvas ports were not in the tab
order, a measured keyboard-only session found **0 of 84 ports tabbable**, and a
keyboard-only player could build a rig's cards from `Ctrl+K` and had no route to connect
them. The decision is made (UX-1 **U8**). What shipped:

- **Every socket says what it is.** `Port` renders `role="button"` with an `aria-label` and
  the same words as a `title`, built from its type, its direction and the name its row
  prints beside it: *"Audio out — drag to connect, or press Enter"*, *"Control in — Level —
  drag to connect, or press Enter"*. `PortRow` forwards its label, so all fourteen
  faceplates get it without a prop threaded through any of them. A caller that knows better
  still wins — a gated port keeps its own "why this is inert" title.
- **The target is bigger than the drawing.** The well stays 18px, because that is the size a
  socket should read at; a concentric invisible ≥24px pad carries the pointer
  (`--oj-port-hit`). Nothing scales on hover: the thing you are aiming at never moves. The
  two places where the drawn size *is* the target — a `KeyTile`'s embedded socket, where the
  tile is the playable surface, and the MiniLab panel's dense control sockets — opt out by
  name.
- **The legend reads before the cable exists.** An idle socket is tinted with its own type
  at reduced chroma and goes full strength once something is plugged in. The previous rule
  ("an idle socket carries nothing, so it reads as nothing") confused the signal with the
  socket: what a port *may* carry is stamped on the connector, and it is exactly what the
  player needs while deciding where to drag.
- **One roving tab stop per card, not one per port.** `Tab` walks cards; `Arrow` keys walk
  that card's sockets. The piano roll already learned this — its notes used to be 128 stops
  and are now one — and that is the failure mode a naive "make it all tabbable" fix would
  have reproduced on the canvas. The stop is written straight to the DOM by `NodeCanvas`
  (one `MutationObserver`), because twenty-three faceplates render their own ports and the
  rule belongs in one place.
- **`Enter` arms, `Enter` lands, `Escape` drops.** A focused socket takes `Enter` to pick up
  a cable (the socket paints armed — the focus ring plus a filled core, the same picture the
  pointer path draws), `Tab`/arrows move to another card's socket, and `Enter` there
  completes. An incompatible target is refused *out loud* in the polite live region ("Two
  outputs cannot connect. Reach for an input.") rather than silently. Arming and landing
  dispatch the same pointer events the card already handles, so the keyboard route **is** the
  pointer route — ghost ports, instrument auto-expansion and the pending reconnect all behave
  identically, and `addConnection` is reached down exactly one path. This also closes UI-017
  (`plans/redesign-new-dna/03-canvas-app-reliability-audit.md:41`), whose keyboard route into
  `startConnecting` failed on `button === 0`.

One thing deliberately stays out of the tab order: a `KeyTile`'s socket. There the *tile* is
the control and it names itself; a socket claiming `role="button"` inside it would nest one
control in another and fold its label into the key's own name.

**The cable grammar, in one line each (U5).** An **output** is a fan-out point with no
cardinality, so grabbing a connected output starts a **new** cable and every cable already
leaving it stays — one voice can feed the speaker and the looper at once. An **input** holds
exactly one cable, so grabbing a connected input **picks that cable up**: drop it on another
input and the cable's destination moves (announced "Moved cable from X to Y", one `Ctrl+Z`);
drop it on an output and the cable's *source* changes instead. Dropping onto an occupied audio
input replaces what was there, which is what `graphStore.addConnection` has always done and is
now reachable by mouse — a settled cable's 14px hit path goes inert for the duration of a drag,
so the drop always lands on the port underneath rather than on the wire drawn over it. A card
cannot be wired to itself, on either route: the executor compiles an acyclic schedule, so the
rule lives in `addConnection` where both the pointer and the keyboard read it.

There is no cable-**body** drag. `Cable`'s hit path is a *select* target (then `Delete`), not a
handle; the way to move a cable is its input end.

`Shift+Tab` obeys the same target rule and **never toggles** — `view.toggleArrangement` is
bound to a bare `Tab` — so a backwards `Tab` from the stage floor walks into the chrome. In
practice it takes **two** presses, not one: the first lands on `document.body`, the second
enters the chrome and then walks File · Edit · View · Canvas · health · Collaborate · theme ·
Settings · Start sound · keyboard help.
That asymmetry is deliberate: it is the keyboard-only route off a surface, and the way back
in is a `Tab` forward from the topbar, which lands on the first control inside the active
surface.

That last sentence was **measured false** and is now true (UX-1 **U9**). The stage-floor
toggle was unconditional, so walking forward out of the chrome parked focus on
`document.body` and every further `Tab` toggled canvas ↔ song forever; zero canvas controls
were ever reached. The arbiter now distinguishes focus PARKED on the stage floor from focus
IN TRANSIT across it: a bare `Tab` whose immediately preceding key was also a bare `Tab` is
a traversal, and falls through to native focus movement into the active surface. Everything
else — a pointer (`pointerdown` resets it), any other key, or simply arriving on the empty
stage — parks focus, and the next `Tab` brings up the other surface exactly as the topbar
keycap says. One consequence worth stating because it is useful: a second consecutive `Tab`
on a surface root walks INTO the surface you just brought up, rather than toggling back.

**The two surfaces you cannot see never hold the tab order.** All three stay mounted (a
switch is instant and nothing loses its scroll), so each carries `inert` + `aria-hidden`
whenever it is not the active surface, and `hidden` once its transition has finished. The
`inert` is not belt-and-braces: during the 180ms transition-out the peer is still painted,
and that is exactly the window in which a `Tab` could have landed in it.

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
| Record | a Song exists | Disabled with *"Arm a track first — open the arrangement with Tab"* until a track is armed. |
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

| Store state | Glyph | Readout | A press means |
|---|---|---|---|
| `transportPending: 'play'` — start unconfirmed | Play | `--text-muted` | ask again (Esc stops) |
| `transportError` from a **play** — engine refused or went silent | Play + warning dot | — | ask again (Esc stops) |
| `transportError` from a **seek/stop** on a rolling song | Stop + warning dot | — | stop |
| a **record** start, confirmed or not | Stop | — | stop (finishes the take) |
| playing, confirmed | Stop | normal | stop |
| playing, `transportPending: 'seek'` mid-scrub | Stop | `--text-muted` | stop |

Confirmation is one `TransportFrame` away, so on a healthy engine the flip is a frame, not
a delay a hand can feel — and the next confirmed frame clears a transient error by itself.
Stopping is instant in the other direction: `isPlaying` goes false with the gesture.

**And the press agrees with the glyph.** The first two rows are the gap between what was
asked for and what was confirmed (`transportAwaitingEngine` in `arrangementStore`). The
glyph shows Play through them, so the gesture has to MEAN play: it calls `retryTransport`,
which re-issues the start. Asking `isPlaying` here instead is how a button labelled Play
came to *stop* the song (HA-03). The pill and Space read the same predicate — one owner,
so a label and its action cannot drift apart.

**The transport reports on the transport.** `transportError` used to render on the
arrangement's sky band and nowhere else, i.e. on a surface the player is not looking at
while they press Play on the canvas. It now rides the pill, and specifically the **play
button** — the control that wears the warning dot is the control a pointer hovers and a
keyboard lands on:

- a `--warning-ink` dot on the button (`data-transport-fault` on the host);
- the sentence appended to the **button's own `title`** (`TransportPill`'s `faultReason`),
  never the surrounding `role="group"`, where a hover shows "Play (space)" and a description
  is read on entry and never again;
- the same sentence as the **button's** `aria-describedby`.

The sky band mirrors it, but the sky band lives inside the arrangement surface, which is
`inert` and `aria-hidden` whenever the canvas is active — so it cannot be the one
announcement for a player pressing Play on the canvas. The pill carries a `polite`
`role="status"` region that speaks exactly when the arrangement cannot; the sentence is
announced once, never twice.

**Which command went unanswered decides what is said.** A track with no instrument explains
why nothing SOUNDED, so it is named on a **play or record** timeout only. A seek, a stop or
a loop toggle that goes unacknowledged keeps the engine wording — blaming a track there is a
wrong accusation with a promise attached ("it will play") to a question nobody asked.

**And there is always a way to stop.** While a start is unconfirmed the button says Play and
its press asks again, which would otherwise leave a performer with no gesture that ends a
song the engine may still be sounding. **Esc** is that gesture: in the wedged state only, it
calls `stop()` unconditionally and the pill reads stopped. It is named in the button's
tooltip, because a gesture nothing on screen mentions is a gesture only its author knows.
A seek or stop timeout on a rolling song never enters this state at all — the glyph stays
Stop, so the ordinary gesture still works.

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
