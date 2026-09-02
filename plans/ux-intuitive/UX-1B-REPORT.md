# UX-1B — durability and first-run truth

Builder lane, 2026-09-02. Seven items: U3, U4, U6, U7, HA-04/05, HA-06, HA-16/27, plus the
mid-lane addendum on the transport's stale-frame latch. Every gate below was run from this
worktree at the end of the lane; the FH-1 re-run is task-for-task from `FH-1-LOG.md`.

---

## 1. U3 — the song survives a clean close

**What changed**

| file:line | change |
|---|---|
| `src/persistence/recovery/emergencyFlush.ts` (new) | a registry so App's debounced backup `flush()` can be *called* by the clean-exit handler instead of racing it |
| `src/persistence/recovery/useCrashRecovery.ts:62-100` | `restoreSongOnCleanBoot()` — on `outcome.mode === 'clean'`, read the newest non-quarantined backup, validate it, apply **only** `setArrangement(arrangement)`, silently |
| `src/persistence/recovery/useCrashRecovery.ts:139-141` | the boot effect's `clean` branch calls it, inside the same effect, before the autosave effects engage |
| `src/persistence/recovery/useCrashRecovery.ts:196-205` | ONE `pagehide` handler: `flushEmergencyBackup()` **then** `markCleanExit()` |
| `src/persistence/recovery/recover.ts:294-307` | `markLoadedSnapshot()` — pins the snapshot a clean boot loaded, so a crash on it is still attributable to it |
| `src/App.tsx:421-436` | App registers its flush instead of owning a second `pagehide` listener |

`setArrangement` without `preserveHistory` **clears** the command log, so the restore lands at
zero history entries by construction — nothing goes through `apply()`. The backup is not
consumed on the clean path (it is the document, not an incident report); the crash path's
`clearEmergencyBackup()` is untouched. `WebPayloadSource.list()` already drops quarantined
snapshots, so the quarantine filter holds on the clean path for free.

**Evidence** — `src/persistence/recovery/__tests__/cleanBootRestore.test.tsx`, 9 tests:

```
✓ brings tracks, clips and notes back on an ordinary reopen
✓ says nothing — an ordinary reopen is not an incident
✓ costs no undo step, so the first Ctrl+Z cannot delete the song
✓ leaves the backup on disk — it is the document, not a report
✓ pins the snapshot it loaded, so a crash on it is still attributable
✓ never auto-loads a quarantined snapshot
✓ opens empty rather than throwing when the backup is torn
✓ still restores the graph AND announces itself after an unclean shutdown
✓ writes the pending backup, THEN marks the clean exit, from one handler
```

Browser (`.scratch/ux-1b/fh1-tasks456.log`, task 6 — draw → bind → notes → navigate away →
reopen):

```
BEFORE close: backupTracks:1 backupClips:1 backupNotes:2 backupGraphNodes:2
AFTER reopen: domTracks:1 domClips:1 emptyPage:false backupNotes:2
              marker.loadedSnapshotId:"emergency:1788341732473"
Undo disabled after reopen: true
task 6 song survives : PASS
task 6 no undo cost  : PASS
```

**Could NOT verify** — a literal OS-level tab close (a navigation away plus a fresh load on the
same persistent profile was used; both fire `pagehide`, and the marker confirms the clean path
was taken). The native tier. Multi-tab last-writer-wins is unchanged and still a real hazard
(UX-INV Q3 risk 3) — out of scope, unfixed.

**Risks** — graph/song skew inside the 2s debounce is mitigated by the forced flush *and* by
taking only the arrangement from the backup, but a hard kill inside that window still reopens
with a canvas newer than the song. Two tabs on one origin still stomp each other, and this
widens the blast radius from "my patch" to "my song"; `BroadcastChannel` leader election is the
real answer and is not here.

---

## 2. U4 — Ctrl+S and New Project do something

**What changed**

| file:line | change |
|---|---|
| `src/components/Shell/newProjectDialog.ts` (new) | a store slice with `requestNewProject(intent)` — a call, not an event |
| `src/components/Shell/AppMenuBar.tsx:65-146` | `NewProjectDialog` — an in-UI `role="dialog"`, name field, Escape, focus on the field and back to the File trigger |
| `src/components/Shell/AppMenuBar.tsx:186-225` | `runNewProject(intent, name)` — `'new'` clears the canvas, `'save-current'` saves this song into the new folder |
| `src/components/Shell/AppMenuBar.tsx:274` | `handleSaveProject` with no project → `requestNewProject('save-current')` |
| `src/components/Shell/AppMenuBar.tsx:330-378` | **Save Project is always in the File menu**; `Export Workflow…` no longer claims `Ctrl+S` |
| `src/App.tsx:446-455` | `file.save` with no project → the dialog |
| `src/components/CommandBar/useCommandSources.ts:390-393` | the palette's "New Project" → the call |
| `src/components/SafeMode/SafeModeScreen.tsx:101-108` | Safe Mode's "Open a different project" → the call |
| `src/store/projectStore.ts:68-85, 513-535` | `CreateProjectOptions { name?, confirmOverwrite? }`; **`prompt()` and `confirm()` are gone** |

`grep -rn "openjammer:new-project" src/ e2e/` now returns only comments explaining why it is
gone — no dispatcher, no dead event. The overwrite question is answered by the same inline
`alertdialog` the menu bar already had (HA-15), and it **fails closed**: no callback, no
overwrite.

The dialog's copy is the browser tier's honest durability story (UX-INV Q4): *"Right now this
song is only kept in this browser — it survives a reload, but not clearing site data, and it
cannot follow you to another machine. Pick a folder you own and every Ctrl+S writes both halves
there — the song and the canvas."* On a browser without File System Access it says so instead
of offering a button that cannot work.

**Evidence** — `src/components/Shell/__tests__/newProject.test.tsx`, 8 tests (dialog opens on a
direct call; the two intents say different things; Escape; the unsupported branch; Save in the
File menu with no project; no native dialogs left in `projectStore.ts`; fail-closed overwrite).
Browser:

```
Ctrl+S -> {"label":"Save this song to a folder", ...}
File menu: ["New Project...Ctrl+Shift+N","Open Project Folder...Ctrl+Shift+O",
            "Save ProjectCtrl+S","Recent Projects","New Canvas",
            "Import Workflow...","Export Workflow..."]
task 5 Ctrl+S answers : PASS
```

**Could NOT verify** — everything past the folder picker. `showDirectoryPicker` needs a real OS
dialog headless Chromium cannot satisfy, so `runNewProject`'s two branches (clear-canvas vs
save-current), the overwrite dialog against a real folder, and the "Project saved" toast are
**code-read and unit-tested only**. The native tier is untested.

**Risks** — `createProject`'s signature changed from `(name?: string)` to `(options?)`; the only
caller is `AppMenuBar`, and `tsc` is clean. `confirmOverwrite` resolves from React state, so a
component unmount mid-question leaves the promise pending and the create silently never
completes; the dialog is inside `AppMenuBar`, which is mounted for the app's whole life, so this
cannot happen today.

---

## 3. U6 — a fresh track is unbound and says so

**What changed**

| file:line | change |
|---|---|
| `src/song/verbs.ts:34-36, 240-286` | `setTrackRef`, `addGraphNode`, `removeGraphNode` — reversible, with exact inverses |
| `src/song/bindTrack.ts` (new) | `bindTrackVerbs` (the whole gesture as one array), `trackIsBound`, `unboundTracks` |
| `src/components/Plugins/PluginsPanel.tsx:56-63, 93-121, 148-153` | `trackId` is carried and honoured; `choose()` in `pick` context writes the voice into `arr.graph` and binds the track |
| `src/components/Plugins/browserModel.ts:12-27` | `isBindableTrackVoice` — `pick` lists only what can actually voice a track |
| `src/App.tsx:78-113` | `PluginsPanelHost` carries `trackId` through the first open |
| `src/components/Arrangement/TrackLaneView.tsx:66-83, 199-210` | the unbound chip, and the voice's display name instead of a raw ref |
| `src/components/Arrangement/ArrangementSurface.css:612-625` | the unbound chip's ink and width |
| `src/components/Arrangement/ArrangementSurface.tsx:49-66` | the ghost lanes stop pretending; the fresh track's ref is documented as deliberately unbound |
| `docs/timeline.md:176-201` | the three verbs, `bindTrack`, and what the UI does with them |
| `src/ai/tools.ts:211`, `docs/agent-tools.md:117` | the agent is told the verbs exist |

`bindTrackVerbs` adds the voice, gives the song a Speaker if it has none (a voice wired to
nothing is the same disappointment one step later), points the track at it, and removes the old
voice if nobody else wants it — applied as one array, so it is one history entry.

**F9, the three example tracks — I chose "make the empty state not pretend."** They were Paper
Sketch's tracks renamed "Track 1/2/3" behind an `aria-hidden` card, and FH-1 read them as her
song and watched her first action delete them. Making them real would mean an empty page that
silently installs three tracks nobody asked for. They are now blank ruled lanes: the geometry
that makes an empty page look like a page, without the names, instruments or refs they never
had (`ArrangementSurface.tsx:49-58`).

**Evidence** — `src/song/__tests__/bindTrack.test.ts` (10) + `src/components/Arrangement/__tests__/unboundTrack.test.tsx` (5), all passing, including `is exactly reversible`
(deep-equals the pre-bind arrangement after the inverse). Browser:

```
chip before binding: "No instrument yet"
  title: "This track has no instrument yet, so it makes no sound. Choose one and it plays."
picker offers: ["Strings, OpenJammer","Keys, OpenJammer","Winds, OpenJammer",
                "Instrument, OpenJammer","Sampler, OpenJammer"]
after picking Keys: chip "Keys" · backupGraphNodes 2 (voice + speaker)
then Play: playhead 1.1 -> 2.2.259   <- it rolls, and it is bound
task 4 track bound : PASS
```

**Could NOT verify** — whether the bound track *sounds*. This harness has no ears; the playhead
moving over a bound track and a two-node song graph is the strongest evidence available here.
Hosted VST3/CLAP instruments cannot voice a track at all (`specToGraph` builds from closed
registry types and carries no `pluginId`), so `pick` deliberately does not offer them.

**Risks** — changing `track.ref` orphans any automation lane that addressed the old ref by name;
a freshly drawn track has no automation, so this cannot bite today, but re-binding a track that
*does* have automation would. Not handled, and worth a follow-up. `addGraphNode`/`removeGraphNode`
now write `graph.connections` unconditionally (even empty) — an optional key that appears and
disappears cannot round-trip; every authored song already carries the key, so nothing changes in
practice.

---

## 4. U7 — the pill tells the truth

**What changed**

| file:line | change |
|---|---|
| `src/store/arrangementStore.ts:80-97` | `transportTimeoutMessage()` — names the unbound track when that is the cause |
| `src/store/arrangementStore.ts:960-975` | `transportAwaitingEngine()` — the one predicate the glyph and the gesture both read |
| `src/store/arrangementStore.ts:775-784` | `retryTransport()` — the only thing a button showing Play may do |
| `src/store/transportStore.ts:59-70` | the gesture asks that predicate first, so Space and the button agree |
| `src/components/Shell/TransportPillHost.tsx:150-168, 210-262` | the fault flag, the `title`, the accessible description |
| `src/components/Shell/TransportPillHost.css:25-63` | the `--warning-ink` dot on the button, and the hidden description |
| `docs/shell.md:143-176` | the glyph table gains a "a press means" column, and the reporting rule |

**The decision (HA-03).** DESIGN.md's law is that the glyph waits for the engine, so the glyph
stays **Play** while a start is unconfirmed — that half was already right. What was wrong is
that the *press* asked `isPlaying` and therefore stopped the song. Both now read
`transportAwaitingEngine`, and the press re-issues the start. Keeping the glyph and changing the
action preserves the documented law and closes the measured lie; the unconfirmedness is carried
by the muted readout (already there) plus the new warning dot, not by an honest-looking button
that does the opposite of its label.

`SkyBand.tsx:89` already mirrored `transportError` and still does; it keeps the one live region,
so the sentence is announced once rather than twice.

**Evidence** — `TransportPillHost.test.tsx` +5 tests, `src/store/__tests__/transportBlame.test.ts` 8 tests:

```
✓ a button showing Play never stops the song — it asks again
✓ agrees with Space, because both read the same predicate
✓ carries the reason on the pill itself, in ink and in words
✓ shows no fault marking while the transport is simply stopped
✓ names the unbound track instead of blaming the engine
✓ keeps the engine wording when every track IS bound
```

The dot's paint, in the browser, both themes (`.scratch/ux-1b/pill-fault.log`):

```
light  with fault ::before: content:"" bg:oklch(0.497 0.15 80) 8x8 top:-1px right:-1px
dark   with fault ::before: content:"" bg:oklch(0.78 0.15 80)  8x8 top:-1px right:-1px
       (both equal --warning-ink for the theme; absent without the flag)
```

**Could NOT verify** — the fault state end-to-end in the browser. The browser tier now genuinely
acknowledges transport (UX-1A's wasm rebuild landed in-tree), so the 1.5s timeout no longer
reproduces by pressing Play on an unbound song — which is the point of that lane, and it means
the dot was verified by setting `data-transport-fault` on the host directly and by unit tests on
the store→attribute path, rather than by provoking a real timeout.

**Risks** — `retryTransport` re-publishes the whole preview. On a genuinely dead engine a
performer can press Play repeatedly and each press is a fresh `startArrangementPreview`; it is
idempotent from the store's side but it is not free. There is also no longer any gesture that
*stops* a transport wedged in the unconfirmed state — Return-to-start still seeks, and a
confirmed frame clears it, but "cancel this attempt" is not a verb. I judged a Play button that
plays to be worth that.

### Addendum — the stale-frame latch

`receiveTransportFrame` latched `isPlaying: false` on **any** `motion === 0` frame, including one
describing the instant before the engine drained our Play; the next guard
(`!pending && !isPlaying`) then swallowed every later frame, freezing the playhead permanently.

`src/store/arrangementStore.ts:41-54` records `playCommandSample` (the sample the outstanding
Play asked to start from, `-1` when none); `:914` drops a `motion === 0` frame at or before it,
**first**, before every other guard, because the latch it trips is unrecoverable. It is cleared
by `stop()`, `haltAtEnd()`, a failed `play()` and `setArrangement`, and re-aimed by `seek()`, so
a deliberate stop is never gated. Pinned by three tests in `transportBlame.test.ts`:

```
✓ never stops a transport that was just told to play      ([Play] -> [stale motion:0] -> [motion:1])
✓ still stops on a frame that POST-dates the command
✓ does not gate the answer to a deliberate Stop
```

The frame carries no generation field on the wire (`packages/oj-protocol-ts/src/index.ts:414`),
so the comparison is against the recorded start **sample**, which is the only monotone thing both
sides share. If the engine ever emits a stale `motion: 0` at a sample *greater* than the start
sample, this does not catch it; a generation on `EngineFrame::Transport` would, and is the real
fix if that case ever appears.

---

## 5. HA-04 / HA-05 — the empty canvas

**What changed**

| file:line | change |
|---|---|
| `src/components/Shell/HintBubble.tsx:15-33` | gated on `nodes.size > 0`; the verb is now *"Press a key — nothing here can break."* |
| `src/components/Canvas/NodeCanvas.tsx:1735-1775` | ONE delimited zero-node block: the line and two buttons |
| `src/components/Canvas/NodeCanvas.css:210-280` | its type and its two buttons, reduced-motion included |
| `src/components/Shell/runAction.ts` (new) | press a keymap action from a button, through the live registry |

The block is fenced by a `UX-1B / HA-05` comment top and bottom and touches nothing else in
`NodeCanvas.tsx` (lane UX-1C was editing the same file concurrently; my edit is one insertion
plus one import). The "Open the command bar" button runs the registered `commandBar.toggle`
handler rather than synthesising a `Ctrl+K` keystroke, so a rebound key can never make the
advertised twin wrong.

**Evidence** — `.scratch/ux-1b/states.log`, four passes (light/dark × reduced-motion on/off):

```
empty canvas: {"nodes":0,
               "line":"An empty canvas. Add a node — right-click, or Ctrl+K.",
               "buttons":["Add a node","Open the command bar"],
               "hint":null}
"Add a node" opens the add menu: true          (all four passes)
"Open the command bar" opens the palette: true (both themes, re-verified in palette.log:
                                                class "command-bar-overlay", input present)
hint WITH a rig: "Press a key — nothing here can break. …"
```

Screenshots: `state-empty-canvas-{light,dark}.png`, `state-empty-canvas-menu-*.png`,
`state-palette-*.png`. Plus `firstRunHonesty.test.tsx` — the hint says nothing on an empty
canvas and no longer contains "already making sound".

**Risks** — the block reads `nodes` (the current *level*'s nodes), so entering an empty container
node also shows it. That is arguably correct — that surface is also an empty canvas — but it is a
behaviour I chose rather than one the brief specified.

---

## 6. HA-06 — one latency claim

**What changed** — `src/store/engineHealthStore.ts:110-146`: `latencyTierLabel(isNative,
measuredRoundTripMs?)` reads the measurement when there is one and falls back to the tier when
there is not; `src/components/EngineHealthDot/EngineHealthDot.tsx:30-40` passes
`audioMetrics.estimatedRoundTrip`; `src/components/Shell/LatencyChip.tsx:118-126` — the chip's
number carries the words **"round trip"**.

**Evidence** — the two strings, captured together, from the same status cluster:

```
healthTooltip: "… Latency: browser engine — 132 ms round trip, measured on this machine
                (the tier is an honest 15–25 ms)."
latencyChip:   "132 ms round trip"
```

`firstRunHonesty.test.tsx` pins that the browser tier never claims sub-5 ms, measured or not, and
that an unmeasured tier still reads 15–25.

**Risks** — the sentence is longer than it was, in a `title`. It stays one sentence and one
number, which was the finding.

---

## 7. HA-16 / HA-27 — copy

`src/components/Nodes/InstrumentNode.tsx:531-541` — *"Playing. Note, octave and offset appear
when a Keyboard node's row bundle arrives."* → *"Connected — play the keys. Per-row tuning
appears when a Keyboard's rows arrive as a group."* The idle branch (`!anyNoteInput`) was already
honest and is unchanged.

**`InstrumentVisualNode.tsx:174` needed no change.** The brief cites it as carrying the same
string; it does not. Its line reads *"No rows yet — connect a keyboard row to the instrument."* —
no false "Playing", no "row bundle". `grep -rn "row bundle"` finds exactly one offender, in
`InstrumentNode.tsx`. I left it alone rather than churn correct copy.

`src/components/Shell/Topbar.tsx:64-78, 109-113` — the offline chip carries *"Offline —
everything still works"* for the first ten seconds of the session's first offline episode, then
shrinks to *"Offline"*. A ref keeps it to one episode; the timer makes "then shrinks" true within
that episode rather than only on the next one. Pinned by `firstRunHonesty.test.tsx`.

**Could NOT verify** — the offline chip in a real browser; it is state-driven off
`navigator.onLine` and was exercised in jsdom with fake timers only.

---

## Gates

```
bunx tsc --noEmit -p tsconfig.app.json     clean (exit 0)
bun run lint                               clean ($ eslint . — no output)
bun run test:run                           249 files / 3184 tests passed  (11:23 run)
bun run build                              ✓ built in 49.06s
                                           dist/assets/index-CjaTDYwh.js  790.67 kB │ gzip: 171.50 kB
                                           PWA precache 87 entries (6673.83 KiB)
```

**On the suite's flakiness.** The 11:23 full run was 249/249 green. Two later runs, with three
Chromium lanes and another builder's `tsc` on the box, failed a *different* set each time —
`voiceSynth`, `tokenLiteralGate`, `CommandBar`, `AiPanel`, `PianoRoll`, `KeybindingsPanel`,
`libraryNodeData` — all timeouts, none of them files this lane touched. Re-run together in
isolation:

```
bunx vitest run src/engine/__tests__/libraryNodeData.test.ts   src/audio/__tests__/voiceSynth.test.ts   src/components/Arrangement/__tests__/tokenLiteralGate.test.ts   src/components/CommandBar/__tests__/AiPanel.test.tsx   src/components/CommandBar/__tests__/CommandBar.test.tsx   src/components/PianoRoll/__tests__/PianoRoll.test.tsx   src/components/Settings/__tests__/KeybindingsPanel.test.tsx
→ Test Files  7 passed (7)
```

Every test this lane wrote or changed passes in isolation and in the full run:
`cleanBootRestore` (9), `bindTrack` (10), `unboundTrack` (5), `newProject` (8),
`firstRunHonesty` (6), `transportBlame` (8), `TransportPillHost` (26), `typeFloor` (345),
`agentToolsDoc` (4).

The FH-1 re-run, verbatim tasks 4–6, headless Chromium under **node**, against
`bun dev --config .scratch/ux-1b/vite.lane.config.ts --port 5250 --strictPort`
(a lane-local config that additionally ignores `.scratch/**` — another lane's Chromium profile
lives there and Vite dies with `EBUSY` watching it; nothing tracked changed for it):

```
task 4 clip drawn      : PASS
task 4 track bound     : PASS
task 4 notes kept      : PASS
task 5 Ctrl+S answers  : PASS
task 6 song survives   : PASS
task 6 no undo cost    : PASS
console (errors/warnings): none
```

Artifacts: `.scratch/ux-1b/` — `fh1-tasks456.{mjs,log}`, `states.{mjs,log}`,
`pill-fault.{mjs,log}`, `palette.mjs`, and 20 screenshots (`01-…12-…`, `state-*`).

---

## Decisions I made that were not in the brief

1. **The pill keeps the Play glyph while unconfirmed; the *press* changed.** The brief said the
   label and the action must agree and left the pending glyph to me. DESIGN.md §944 and
   `docs/shell.md` both make "a transport glyph that waits for the engine" a law, and three tests
   pinned it, so I changed the action (`retryTransport`) rather than the glyph. The label-action
   agreement is enforced by one exported predicate that the pill *and* `transportStore` read.
2. **`transportStore.ts` was edited** (5 lines). It is neither owned nor forbidden by the brief.
   Putting the decision anywhere else would have let Space and the pill disagree, which is the
   defect one level up from HA-03.
3. **`EngineHealthDot.tsx` was edited** (2 lines) to pass the measurement into
   `latencyTierLabel`. Same reasoning: the label is in an owned file, its only consumer is not.
4. **`src/components/Plugins/browserModel.ts` gained `isBindableTrackVoice`,** and `pick` now
   lists only bindable instruments. Without it the picker offered Keyboards and `-visual` mirrors
   — nodes that are flattened away by lowering — so "Use" would have put the track straight back
   into `conduct`'s `skipped` list under a friendly name.
5. **`builtInItems()` takes a filter that runs BEFORE the de-duplication by display name.** Two
   definitions are called "Instrument" (the structural mirror, declared first, and the real one).
   Filtering afterwards silently removed the bindable one from the pick list; the browser run
   caught it.
6. **Mute, Solo and Automation are hidden on an unbound track.** All three act on a voice that
   does not exist, and hiding them is also what gives the state sentence room in a 200px header.
   Arm survives, because the empty state's "Record something" arms a track before it has an
   instrument.
7. **The chip reads "No instrument yet", not "No instrument yet — choose one".** The full
   sentence is the button's `aria-label` and the chip's `title`; the visible text is what fits at
   the app's own 13px type floor (`typeFloor.test.ts` rejects sub-13px non-mono text, and it
   caught my first attempt). The affordance — the chevron — is beside it.
8. **A bound track's chip shows the node's display name** (`Keys`) when the voice carries no
   `instrumentId`, instead of the raw ref. Without this, binding replaced "track-1" with
   "track-1-voice" — an internal string where a player expects a name.
9. **The empty canvas's second button says "Open the command bar", not "⌘K".** The topbar `⌘K`
   affordance is UX-1D's (U13); this one is a sentence a first-timer can read, and the line above
   it already names the key.
10. **`runAction()` (`Shell/runAction.ts`) is a new primitive** — run a keymap action from a
    button, through the live registry. UX-1D will need the same thing for the topbar `⌘K` chip.
11. **`Save Project` renders unconditionally in the File menu**, and `Export Workflow…` lost its
    false `Ctrl+S` keycap. The brief covered the shortcut, not the menu; FH-1's F12 was as much
    about the menu having no Save in it at all.
12. **`markLoadedSnapshot()` was added to `recover.ts`** so the clean-boot restore still pins its
    snapshot to the marker. Without it the breaker would record a crash against `null` and hand
    the same poison back on every boot.
13. **The three ghost tracks became blank lanes** rather than real ones (F9) — reasoning in §3.
14. **`docs/agent-tools.md` and `src/ai/tools.ts` were touched** to name the three new verbs; the
    doc embeds the catalogue verbatim and a drift test fails otherwise.

---

# Fix round — the gate's 16 findings

Second pass, 2026-09-02, against `UX-1B-REVIEW.md` (**SHIP-AFTER-FIXES**, 7 × S2 / 9 × S3).
All 16 are addressed: 15 fixed, 1 (G-15) handed to UX-1C as the gate itself directs. The
gate's own scripts in `.scratch/ux-1b-gate/` were re-run as the red baseline; my additions
are `.scratch/ux-1b/fix-round.mjs` (+`.log`, 4 screenshots) and `fix-round2.mjs` (+`.log`,
3 screenshots), the latter driving the branches past the folder picker with the gate's
OPFS-backed `showDirectoryPicker`.

## Per finding

| id | fixed where | evidence |
|---|---|---|
| **G-01** | `packages/oj-ui/…/TransportPill.tsx` (new `faultReason` prop: the play button's own `title` + `aria-describedby`) + `TransportPillHost.tsx` | Real timeout, live: `btnTitle: "Stop (space) — The audio engine did not acknowledge…"`, `btnDescribedBy` the same sentence, `groupTitle: null`. The reason is on the button that wears the dot. |
| **G-02** | `arrangementStore.ts` — `transportTimeoutMessage(kind)`, `armPendingTransportTimeout(generation, kind)`, `transportAwaitedCommand` on the store | The gate's own `g9.mjs`, unchanged: press Home on an unbound song with frames dropped → *"The audio engine did not acknowledge the transport command."* (was the track blame). 5 unit tests, one per command. |
| **G-03** | `arrangementStore.ts` (`transportAwaitingEngine` narrowed to an unconfirmed START) + `TransportPillHost.tsx` (Escape) | The gate's own `g8.mjs`: after a seek timeout on a rolling song the pill now reads **Stop** (was Play); pressing it sends the stop and the pill reads stopped. `fix-round.log`: 4/4 PASS incl. the outbound-command tap. |
| **G-04** | `arrangementStore.ts` — `playCommandSample` set on a record start, `retryTransport` early-returns while recording, and the predicate excludes a record | An unconfirmed record start keeps the **Stop** glyph, which finishes the take instead of orphaning it. 2 unit tests. |
| **G-05** | `arrangementStore.ts` — `playCommandSample = -1` on the first frame that gets past the guards | The three-frame replay, **both ways**: a stale `motion:0` before the ack is dropped; a genuine `motion:0` at the same sample after the ack stops the transport. 2 unit tests. |
| **G-06** | `AppMenuBar.tsx` — `setArrangement(null)` + `clearEmergencyBackup()` in the `'new'` branch; `handleNew`'s confirm says what it does not touch | Live, past a real picker (`fix-round2.log`): before `{canvasNodes:39, clips:1, backup:true}` → after `{canvasNodes:0, clips:0, emptyPage:true, backup:false, project:"Untitled song"}`. And Ctrl+S-without-a-project keeps both: `{canvasNodes:39, clips:1}` + toast *"Project saved"*. |
| **G-07** | `newProjectDialog.ts` (the invoker is captured at the CALL) + `AppMenuBar.tsx` (restore on UNMOUNT — `useConfirmFocus` only fires on a real open→close while mounted, and this dialog is removed outright) | Live: focus from the transport pill → `Project name` → **back to the transport pill** (was `<body>`). 2 unit tests incl. the fallback. |
| **G-08** | `TrackLaneView.tsx` — a `shell` lane renders stripe + header ground + lane ground only | Live: the three lanes behind the empty page report `{lanes:3, buttons:0, chips:0, swatches:0}`. 2 unit tests. |
| **G-09** | `docs/timeline.md` | Quotes the shipped *"No instrument yet"* and names the accessible name and title that carry the rest. |
| **G-10** | `docs/shell.md` | Rewritten to what ships: the button's title, the button's `aria-describedby`, who announces where, which command is blamed, and the Esc escape. The glyph table gains the two rows that were missing. |
| **G-11** | `TransportPillHost.tsx` | The pill's region is `role="status" aria-live="polite"`, empty at rest, and carries the sentence **only where the sky band cannot** — live: on the canvas the pill speaks; on the song it is `""` and the sky band speaks. Announced once. |
| **G-12** | `Shell/studioPresence.ts` (new) + `Topbar.tsx` + `docs/timeline.md` | Live, two tabs: chip **"2nd tab open"** appears; after the second tab closes it goes away again. 5 unit tests. Documented as a named limitation with leader election as the fix. |
| **G-13** | `App.tsx` — an emptied document clears the backup instead of leaving a ghost of itself | Unit test: a cleared document does not resurrect itself on the next clean boot. |
| **G-14** | `AppMenuBar.tsx` — the "no project in that folder" confirm goes straight into `runNewProject` | Live: `window.__ojPickerCalls === 1` for one New Project intent. |
| **G-15** | not mine — flagged to UX-1C as the gate directs | `Topbar.tsx`'s diff carries UX-1C's `describeHistoryEntry` work; *"Undo compound"* is theirs to answer. |
| **G-16** | `TrackLaneView.tsx` — `nodeDisplayName(type, fallback)` | The non-null assertion whose `TypeError` was the control flow is gone; the intent is a named function with an explicit fallback. |

## The two decisions the coordinator left open, as landed

**G-03 — Stop is a panic path.** Narrowing `transportAwaitingEngine` to an unconfirmed
*start* is what makes the coordinator's pin true by construction: a seek or stop timeout on
a rolling song never enters the retry state at all, so the glyph stays **Stop** and the
ordinary gesture (the button and its key) still stops the song — measured, with the outbound
command tapped at the worklet port. For the one state that does keep a Play glyph (a start
the engine never acknowledged), **Esc** calls `stop()` unconditionally. It is routed through
the keymap rather than a bare window listener, so an open modal still wins, and it returns
`false` outside that state so Escape keeps doing what it does everywhere else. The button's
own tooltip names it — *"…Press Esc to stop."* — because a gesture nothing on screen
mentions is a gesture only its author knows.

**G-04 — the record orphan.** I took the safer sibling of *"clears `isRecording` and says
so"*: a record start never enters the retry state, so the pill keeps showing **Stop**, and
Stop on a recording is `finishRecording()`. Retrying a record would have to re-issue the
preview with the record flag while the MIDI journal and the bindings already point at the
running session; ending the take is what a performer means by that press, and it cannot
double-write the journal. `retryTransport` also early-returns on `isRecording` as belt and
braces, and `startRecording` now records `playCommandSample` so the stale-frame guard covers
the one command a performer cannot afford to have silently orphaned.

## One thing the gate did not raise, fixed alongside

Re-running `g8.mjs` showed a **stale warning dot outliving the thing it warned about**:
after a stop whose acknowledgement was dropped, the returning frames were discarded by
`if (!pending && !state.isPlaying) return;` and the error never cleared. That guard now has
one narrow clause — a `motion: 0` frame while we hold an error and are not playing is the
answer we never got, so it clears the error and returns. It cannot re-open the latch G-05 is
about: it changes no position and sets no motion.

## Gates, after the fixes

```
bunx tsc --noEmit -p tsconfig.app.json     exit 0
bun run lint                               exit 0
bun run test:run                           250/252 files, exit 1
bun run build                              exit 0
```

The two reds are **not this lane's**, and they are the same gate that caught mine:
`typeFloor.test.ts` now fails on `src/components/AppErrorBoundary.css` (a new `11px`) and
`src/components/Shell/StepGrid.css` (a new `--text-xs`) — both added by UX-1E in this shared
tree; `git diff` on those files shows the offending lines are theirs. A third red in an
earlier run, `AiPanel.test.tsx` ("Escape declines the YOLO gate"), is also UX-1E's in-flight
U14 work. My own surface — `persistence/recovery/**`, `bindTrack`, `unboundTrack`,
`Shell/**`, `transportBlame`, plus `typeFloor`'s checks on `Topbar.css` and
`ArrangementSurface.css` — is **21/22 files green**, the one red being that shared
`typeFloor` file.

Tests added this round: `transportBlame` 8 → 16, `TransportPillHost` 26 → 29, `newProject`
8 → 12, `unboundTrack` 5 → 7, `cleanBootRestore` 9 → 10, `studioPresence` 5 (new).

The gate's FH-1 scripts were re-run unchanged and are still green: `g1-fh1.mjs`
(`PASS U6.unbound-chip-text / unbound-acc-name / chip-typefloor 13px / chip-not-clipped /
T4.notes-drawn`), `g2b.mjs` (`PASS U6.one-history-entry 1→2 / node-added / ref-bound /
undo-unbinds / redo-rebinds`), `g5b.mjs` (risks a, b, d, f all still hold).

## Still not verifiable here

- **G-04 end to end.** The same limit the gate hit: driving a real armed recording through a
  dropped acknowledgement headlessly. Unit-tested at the store, code-read at the pill.
- **Whether a bound track sounds.** No ears in this harness; a taste-tier pass with audio
  playing is still owed on U6.
- **The native tier.** Everything above is `ojcore-wasm` in Chromium.
- **G-01's screen-reader consequence**, as the gate said: the attributes are measured on the
  right element, not read with NVDA/JAWS.

## Decisions in this round that were not in the brief or the review

1. **`packages/oj-ui/.../TransportPill.tsx` was edited** — an additive `faultReason` prop and
   its hidden description span. `packages/**` was in the lane's do-not-touch list; the
   coordinator's G-01 ruling requires the reason on the button, and the button lives there.
   The prop is opt-in and every existing call site is unchanged.
2. **The record start keeps the Stop glyph** rather than retrying (G-04) — reasoning above.
3. **Escape is scoped to the wedged state only.** "Always sends the stop command regardless"
   is satisfied jointly: Stop/Space always stop wherever the glyph says Stop (which the G-03
   narrowing restores everywhere it was lost), and Esc covers the one state where the glyph
   says Play. An unconditional global Escape-stops would take Escape away from every other
   surface that wants it.
4. **`studioPresence` is a heartbeat, not hello/goodbye.** The first version was inside the
   40-line budget but wrong: `page.close()` never delivers a goodbye, and the browser run
   caught the chip claiming a tab that was gone. Liveness is counted against our own beat
   rather than a wall clock, so a sleeping or throttled tab cannot answer it wrong. 52 lines
   with its docstring, ~30 of code.
5. **New Canvas still does not clear the song** — its confirm body now says so. The review
   listed it under G-06; the coordinator's instruction named New Project only, and a
   canvas-named command silently deleting a song is the same class of surprise G-06 is about.
6. **A stale stop-error now heals when the engine speaks again** — not a gate finding, found
   while re-running `g8.mjs`.
