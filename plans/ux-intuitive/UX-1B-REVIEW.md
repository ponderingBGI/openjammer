# UX-1B — adversarial gate

Reviewed 2026-09-02 from this worktree. Every claim in `UX-1B-REPORT.md` was treated as
unverified; nothing in the lane's `.scratch/ux-1b/` was reused. My own scripts, dev server
and screenshots live in `.scratch/ux-1b-gate/` (`g1`–`g9`, `p0`–`p3`, `lib.mjs`,
`vite.gate.config.ts`), Playwright under **node**, dev server on **5250 only**, killed at
the end. No product file was edited and no git state was changed.

## Verdict: **SHIP-AFTER-FIXES** — 16 findings (7 × S2, 9 × S3, 0 × S1)

U3, U4, U6, HA-04/05, HA-06 and HA-16/27 are real, honestly built and better than the
report claims — I verified in a live browser several things the lane listed as *could NOT
verify* (the folder-picker branches, the fail-closed overwrite, the offline chip, a real
transport timeout). The fixes needed are concentrated in U7, which is the one item where
the shipped behaviour does not match either the report or `docs/shell.md`: the reason never
reaches the button that carries the warning dot (G-01), the timeout blames an unbound track
for commands that were not a play (G-02), and a seek that goes unacknowledged on a *rolling*
song turns the pill into a Play button that restarts the song and can never stop it (G-03).
Plus one coherence hole U3 opened: New Project clears the canvas and leaves the song (G-06).

---

## Findings

| id | sev | file:line | what | exact fix |
|---|---|---|---|---|
| **G-01** | **S2** | `src/components/Shell/TransportPillHost.tsx:233-234` + `packages/oj-ui/src/components/TransportPill/TransportPill.tsx:427,443,449` | `title={transportError}` and `aria-describedby` are passed to `<TransportPill>`, which spreads `...rest` onto the **outer `role="group"` div** (`:443`). The play button keeps its own hardcoded `title={\`${transportName}${hint}\`}` (`:449`). Measured with a real timeout: `btnTitle:"Play (space)"`, `groupTitle:"Track 1 has no instrument yet…"`, `btnDescribedBy:null`. Hovering the button that wears the warning dot never shows the reason; a keyboard user landing on the button hears "Play, button" and nothing else. HA-03's proposal was *"the reason in its `title`"* and `docs/shell.md:208` states it as shipped. | Add an explicit prop to `TransportPill` (e.g. `faultReason?: string`) that composes the **play button's** own title — `` `${transportName}${hint ? ` (${hint})` : ''}${faultReason ? ` — ${faultReason}` : ''}` `` — and puts `aria-describedby` on the button, not the group. Keep the group spread for layout attrs only. |
| **G-02** | **S2** | `src/store/arrangementStore.ts:99-112`, called from `:793` (stop), `:802` (haltAtEnd), `:818` (seek), `:896` (record) | `armPendingTransportTimeout` uses `transportTimeoutMessage()` for **every** transport command, and that function consults `unboundTracks()` unconditionally. Reproduced (`g9.log`): one unbound track, no Play ever issued, press **Home** with frames dropped → the sky band and the pill say *"Track 1 has no instrument yet — choose one on the track and it will play."* Also seen on the `haltAtEnd` stop in `p3.mjs`. The blame is wrong and the promise ("it will play") answers a question the player did not ask. | `armPendingTransportTimeout(generation, kind: 'play' \| 'stop' \| 'seek')`; only call `unboundTracks()` when `kind === 'play'`, otherwise return the engine wording. |
| **G-03** | **S2** | `src/store/arrangementStore.ts:994` + `src/store/transportStore.ts:66` | `transportAwaitingEngine` = `isPlaying && (pending === 'play' \|\| transportError !== null)`. A **seek** timeout on a genuinely rolling song satisfies it. Reproduced (`g8.log`): Paper Sketch rolling → drop transport frames → `Home` → 1.5 s later the pill flips to **Play** with the fault dot; pressing it calls `retryTransport` → `startArrangementPreview` again (readout unchanged, song re-issued from origin); **Space** does the same; **Escape** does nothing. There is no gesture in the product that stops a transport wedged in this state, and no panic/all-sound-off exists (`grep` for `panic\|allNotesOff` finds none). On a stage, with the engine still making sound and its frames not arriving, the performer cannot stop the song. | Two parts. (a) Narrow the predicate to an unconfirmed **start**: record the command that armed the timeout and require it to be `'play'`. (b) Give the wedged state an escape that means stop — e.g. a second press within N seconds, or `Shift+Space`, or a "Stop anyway" action on the sky-band alert — calling `stop()` unconditionally. The report calls this "not a verb"; on a live instrument it has to be one. |
| **G-04** | **S2** | `src/store/arrangementStore.ts:896-899` (`startRecording`) | `startRecording` sets `transportPending:'play'` and arms the timeout but **never sets `playCommandSample`**, so the addendum's stale-frame guard does not protect a record start at all. Worse: when that timeout fires, `transportAwaitingEngine` is true, so the pill/Space call `retryTransport` → `play()`, which re-enters `startPreview(arr, origin, haltAtEnd)` **without** the record flag while `isRecording` stays `true`, `recordingBindings` and the MIDI journal stay pointed at the dead session. The performer is left in a phantom recording with no way out (`stop()` is unreachable — see G-03). | Set `playCommandSample = tickToSample(map, startTick)` in `startRecording`; and make `retryTransport` early-return (or re-issue the *record* preview) when `get().isRecording`. |
| **G-05** | **S2** | `src/store/arrangementStore.ts:54, 748, 917` | `playCommandSample` is armed by `play()` and cleared only by `stop`/`haltAtEnd`/failed `play`/`setArrangement`. It therefore stays armed for the **whole** of playback, not just the send→first-ack window the addendum is about. Consequence: after a play from bar 1 (`sample 0`), every subsequent `motion:0, sample:0` frame is dropped forever — an engine that genuinely stops or restarts at 0 cannot tell the UI, and the pill would show **Stop** over a dead transport, which `TransportPillHost.tsx:130` calls "the worst lie this component can tell". | Clear `playCommandSample = -1` inside `receiveTransportFrame` on the first frame that passes the guards. The guard only ever needs to cover the unacknowledged window. |
| **G-06** | **S2** | `src/components/Shell/AppMenuBar.tsx:313-316` (`runNewProject`, `'new'` branch); same hole at `:255-257`/`:267-269` (New Canvas) | `'new'` calls `clearGraph()` + `resetView()` and never touches the arrangement. Measured (`g7.log`): before New Project `{nodes:4, tracks:1, clips:1}` → after `{nodes:0, tracks:1, clips:1}`. This was pre-existing, but U3 makes it a coherence defect: the previous song is still loaded, follows the player into the brand-new project folder, is written there by the next `Ctrl+S`, and comes back on every clean boot. "New Project" that leaves the song is not a new project. | Add `useArrangementStore.getState().setArrangement(null)` beside `clearGraph()` in the `'new'` branch, and in `handleNew` ("New Canvas") — and say so in that confirm's body, which currently only counts nodes. |
| **G-07** | **S2** | `src/components/Shell/AppMenuBar.tsx:83, 582` | Escape closes the New Project dialog but focus lands on `<body>` — measured `{"tag":"BODY","cls":"","label":null}` after `Ctrl+S` → `Escape` (`g6-u4.log`). `restoreTo` resolves `.dropdown-trigger` inside `menusRef`, which is the right answer only when the File menu opened the dialog; `Ctrl+S`, the palette and Safe Mode all reach it without ever touching the menu bar, and `useConfirmFocus` evidently does not fall back. A keyboard-only player loses their place mid-set. | Capture `document.activeElement` in `requestNewProject` (or when the dialog mounts) and restore to it; fall back to the File trigger only when that element is gone. |
| **G-08** | S3 | `src/components/Arrangement/ArrangementSurface.tsx:59` + `src/components/Arrangement/TrackLaneView.tsx:91` | The report says the three ghost lanes are now "blank ruled lanes". They are not: `bound = shell \|\| trackIsBound(...)` forces `shell` lanes to render as *bound*, so each still draws **M / S / ● / A** plus an instrument chip whose name button is the empty string (`aria-label="Reorder "`, `"Mute "`, `"Arm  for MIDI recording"` — inert and `aria-hidden`, so not an a11y defect, but visible). Screenshot `.scratch/ux-1b-gate/arr-empty-light.png`: three lanes of unlabelled controls beside a blank pill. It reads as a failed render, not as ruled paper — a different wrong impression from FH-1 F9's, not no impression. | Short-circuit `shell` in `TrackLaneView`: stripe + header ground + lane ground only, no controls and no chip. |
| **G-09** | S3 | `docs/timeline.md:202` | The doc quotes the chip as *"No instrument yet — choose one ⌄"*. The shipped visible string is **"No instrument yet"** (decision 7 — the 13px type floor); the full sentence is the `aria-label` and `title`. | Quote the shipped string and add "the full sentence is its accessible name". |
| **G-10** | S3 | `docs/shell.md:208` | "the sentence in the pill's `title`" — as shipped it is the *group's* title (G-01). The doc asserts a behaviour that does not exist. | Fix with G-01, or state where the sentence actually is. |
| **G-11** | S3 | `src/components/Shell/TransportPillHost.tsx:273-277`; `src/components/Arrangement/SkyBand.tsx:25-37` | The one live region for the reason is `SkyBand`'s `role="status"` chip, which lives inside the arrangement surface — `inert` + `aria-hidden` whenever the canvas is active (`ArrangementSurface.tsx:269,327`). HA-03's complaint was precisely "the report lands on a surface the player is not looking at"; for a screen-reader user pressing Play on the canvas, that is still exactly true. The pill's hidden `<span>` is a description, not a live region, and it hangs off the group (G-01). | Either make the pill's reason span `role="status"` gated on the arrangement **not** being active, or move the single announcement to the always-mounted `LiveAnnouncer`. |
| **G-12** | S3 | recovery, cross-cutting (`useCrashRecovery.ts:62-100`) | Multi-tab, reproduced (`g5d.log`): tab A holds a 1-clip song, tab B a 3-clip song; close B, then A; reopen → the restored song has **1 clip**. B's song is gone with no word. U3 does not create this (localStorage was always last-writer-wins) but it promotes it from "my patch" to "the thing that answers *where is my song*", which is the exact escalation UX-INV Q3 risk 3 predicted. The lane declared it out of scope — correctly — but it is written down nowhere a player or a maintainer will read. | Record it in `docs/timeline.md` (or `docs/shell.md`) as a named limitation with `BroadcastChannel` leader election as the fix, and consider refusing the clean-boot restore when `marker.instanceId` indicates another live session. |
| **G-13** | S3 | `src/App.tsx:411-413` | The emergency flush early-returns when `nodes`, `edges` **and** `arrangement` are all empty, "don't clobber a good backup with empty". Before U3 that only affected the canvas, which `zustand/persist` owned anyway. Now it means a session the player deliberately emptied leaves the previous backup on disk and the next clean boot silently hands the deleted song back. | Write the empty snapshot (it *is* the document) or clear the backup when the document becomes empty. |
| **G-14** | S3 | `src/components/Shell/AppMenuBar.tsx:355-363` | `handleOpenProject`'s "that folder already has a project — make one instead?" confirm now resolves into `handleNewProject()` → `requestNewProject('new')`, so one intent costs two dialogs in a row (confirm, then the name dialog, then the picker). | Have that confirm call `runNewProject('new', folderName)` directly, or seed the dialog's name field from the folder. |
| **G-15** | S3 | `src/components/Shell/Topbar.tsx:63-64, 88-92, 123-135` | This file's diff also carries UX-1C's U12 undo/redo labels (`describeHistoryEntry`, `src/a11y/historyPhrase`) — the report claims only the offline chip here. Not a defect of this lane, but the orchestrator's pathspec commit will pick up both, and the labels are currently rendering *"Undo compound"* on a fresh clip draw (measured, `g2-bind.log`), which is UX-1C's to answer. | Split at commit time; flag "Undo compound" to UX-1C. |
| **G-16** | S3 | `src/components/Arrangement/TrackLaneView.tsx:78-80` | `getNodeDefinition(voiceNode!.type as NodeType)` uses a non-null assertion whose `TypeError` is the intended control flow for "there is no voice node", swallowed by the surrounding `catch`. Correct today; invisible intent, and it will silently change meaning if `getNodeDefinition` ever stops throwing. | `const voiceName = typeof instrument === 'string' ? instrument : voiceNode ? safeDefName(voiceNode.type) : track.ref;` |

---

## Claims verified, with evidence

### U3 — the song survives a clean close

The lane's *"could NOT verify a literal tab close"* caveat holds; I used the same
navigation-away (`about:blank`), which fires `pagehide`, on a persistent profile, and
confirmed the **clean** branch was taken (`marker.crashes: []`, log line
`[recovery] reopened the song from the last backup`, no "unclean shutdown" line).

The UX-INV Q3 risk list, one by one (`g5b.log`, `g5c.log`, `g5d.log`):

| risk | result |
|---|---|
| **(a) graph/song skew inside the 2 s debounce** | **HOLDS.** Added a Delay node to the canvas, then a second clip to the song, left 250 ms later — the on-disk backup still read `{clips:1, nodes:16}` at that instant. Reopened: `liveClips 2`, `canvasNodes 5`, backup `{clips:2}`. The forced flush before the marker is doing the work; the ordering is a call sequence in `emergencyFlush.ts` + `useCrashRecovery.ts:194-197`, and the lane's own ordering test asserts the marker is still `open:true` inside the flush callback (I read it — it does assert that). |
| **(b) undo pollution** | **HOLDS.** After the clean-boot restore, `__openjammerE2E.history()` = `{cursor:0, entries:0, scopes:[]}`. First `Ctrl+Z` changed nothing: tracks 1→1, clips 1→1, canvas nodes 4→4. |
| **(c) multi-tab** | **REAL, UNFIXED, UNDOCUMENTED.** See G-12 — last writer wins, and the loser's song is destroyed. |
| **(d) quarantine** | **HOLDS.** Seeded `openjammer-recovery-quarantine` with the live snapshot's id at `document_start`; the clean boot restored nothing and opened on *"An empty page."* with the backup untouched. |
| **(e) crash path unchanged** | **HOLDS.** A context killed without `pagehide` reopened via the restore path: `[recovery] restored work after an unclean shutdown {mode: restore}`, toast *"Recovered your work / OpenJammer closed unexpectedly last time"*, tracks and clips back. |
| **(f) arrangement ↔ graph id skew** | **BENIGN, and U6 is why.** Note first that `track.ref` names a node in `arr.graph`, which travels *inside* the backup — the canvas graph is a separate half, so the two cannot drift on a round trip (both come out of one `collectSaveData()` at flush time). I forced a dangling ref anyway by rewriting the backup at `document_start`: the song restored intact (1 track, 2 clips) and the lane header read **"No instrument yet"**, which is exactly the honest state U6 built. |

Also verified: the restore is **silent** (no toast), the backup is **kept** on disk after a
clean restore, and `marker.loadedSnapshotId` is pinned (`"emergency:1788343998997"`).

### U4 — Ctrl+S and New Project

I stubbed `showDirectoryPicker` with a **real OPFS directory handle**, so every branch past
the picker ran for real — the part the lane could only code-read (`g6-u4.log`):

- File menu, **no project**: `["New Project...Ctrl+Shift+N", "Open Project Folder...Ctrl+Shift+O", "Save ProjectCtrl+S", "Recent Projects", "New Canvas", "Import Workflow...", "Export Workflow..."]`. Save is there; `Export Workflow…` no longer claims `Ctrl+S`.
- `Ctrl+S` with no project raises `role="dialog"` *"Save this song to a folder"*, focus on the **Project name** field, canvas unchanged (4 nodes → 4 nodes). Copy is the honest browser-tier story, verbatim as reported.
- **Ctrl+S does not wipe the canvas even when it goes through**: dialog → *Choose a folder…* → `{nodes:4, project:"Untitled song", toasts:["Project saved"]}`, and the folder really contains `["project.openjammer", "project.openjammer.bak", "presets", "library", "README.txt"]`.
- **New Project does clear the canvas**: 4 nodes → 0. (But not the song — G-06.)
- **Fail-closed overwrite, end to end**: a folder pre-seeded with `project.openjammer` containing `{"name":"someone elses song"}` → *Choose a folder…* → `role="alertdialog"` *"That folder already has a project"*, focus on **Cancel** → **Escape** → the file still reads `{"name":"someone elses song"}`, and the canvas is untouched. The store's own unit test (`newProject.test.tsx:99`) additionally proves the no-callback case rejects.
- Palette → "New Project" raises the `"New project"` dialog. Safe Mode's *"Open a different project"* calls the same function; `SafeModeScreen` is an overlay over a mounted `AppMenuBar` (`App.tsx:583`), so the dialog has a renderer. Note the brief said "Safe Mode **Start Fresh**" — that button is `api.startFresh` and was never the broken path; the dead `openjammer:new-project` dispatch lived in *"Open a different project"*, which is what the lane fixed.
- **No native dialogs left anywhere under `src/`.** `grep -rnE "(^|[^a-zA-Z_.])(confirm|alert|prompt)\("` over `src/**/*.{ts,tsx}` returns only prose in comments, test assertions, and `usePWA.ts`'s `BeforeInstallPromptEvent.prompt()` (a browser API method, not a native dialog). `openjammer:new-project` survives only in comments explaining its removal.

### U6 — a fresh track is unbound and says so

Measured on the live chip (`g1-fh1.log`, `g2b.log`):

```
visibleText  "No instrument yet"          fontSize 13px   name 134px inside a 149px chip (not clipped)
accName      "No instrument yet on Track 1 — choose one"
title        "This track has no instrument yet, so it makes no sound. Choose one and it plays."
controls     ["Arm Track 1 for MIDI recording", <chip name>, "Choose instrument for Track 1"]   ← M/S/A hidden
```

The visible string is legible and honest at the type floor; the missing half of the
sentence is carried by the accessible name and the tooltip, and the chevron is the
affordance. I accept decision 7.

Binding, through the chevron → picker → **Use** on "Keys, OpenJammer":

```
history   {entries:1} -> {entries:2}                      ONE entry
arr.graph {nodes:[]}  -> {nodes:[{ref:"out",type:"speaker"},{ref:"track-1-voice",type:"keys"}],
                          connections:[{from:"track-1-voice",to:"out"}]}
track.ref "track-1"   -> "track-1-voice"
chip      "No instrument yet" -> "Keys" (title "Keys · MIDI"), M/S/A reappear
Ctrl+Z        -> graph deep-equals the pre-bind graph, ref back to "track-1", chip back to "No instrument yet"
Ctrl+Shift+Z  -> graph and ref deep-equal the post-bind state
```

The picker in `pick` context offers exactly `["Strings","Keys","Winds","Instrument","Sampler"]`
— the `isBindableTrackVoice` + before-dedupe ordering (decisions 4 and 5) is doing real work;
"Instrument" is present, which is the bug decision 5 describes.

### U7 — the pill, under a **real** timeout

I blocked the worklet's transport frames on the main thread by wrapping the
`MessagePort.prototype.onmessage` setter and dropping `{type:'transport'}` messages — a real
1.5 s timeout, not a forced attribute (`g3b-light.log`, `g3b-dark.log`, `p3.log`):

```
fault appears at ~1.2s after the press
dot ::before  content:""  8x8  top:-1px right:-1px
              light  bg oklch(0.497 0.15 80)      dark  bg oklch(0.78 0.15 80)   (= --warning-ink)
glyph         Play (viewBox 0 0 14 16), readout muted and frozen at 1.1
unbound song  "Track 1 has no instrument yet — choose one on the track and it will play."
bound song    "The audio engine did not acknowledge the transport command. …"
sky band      the same sentence, once, role="status"
press         fault -> null, readout unchanged, then fault returns  → it RETRIED, it did not stop
```

So: the dot paints in both themes, the blame is correct **for a play**, and a button showing
Play never stops the song. What is not true is *"the sentence in the pill's `title`"* — G-01.

**The addendum** (`g3c.log`), the exact sequence asked for — `[Play sent]` →
`[stale motion:0 sample:0 frame]` → `[motion:1 frames]`, the stale frame forged in the
message path:

```
FORGE stale motion:0 sample:0 (real was m=1 s=384)
m=1 s=896 … m=1 s=4992 …
0.0s..1.6s   label=Stop  fault=null  playhead 1.1.404 -> 1.4.760   (then halts at the clip's end)
```

The stale frame is dropped, the playhead keeps moving, **the pill never flickers**. Verified.

### HA-04 / HA-05 — the empty canvas

Four passes, light/dark × `prefers-reduced-motion` on/off (`g4-states.log`, screenshots
`g4-empty-{light,dark}-rm{0,1}.png`, `g4-empty-menu-*`, `g4-empty-palette-*`):

```
{"nodes":0,"line":"An empty canvas. Add a node — right-click, or Ctrl+K.",
 "buttons":["Add a node","Open the command bar"],"hint":null,"pointerEvents":"none",
 "animation":"node-canvas-empty-in" | "none" under reduce}
"Add a node"          -> context menu opens        (all four passes)
"Open the command bar"-> palette opens             (all four passes)
Ctrl+Z (nodes back)   -> block gone, 4 nodes
hint WITH a rig       -> "Press a key — nothing here can break. …"  (never on an empty canvas)
```

The block in `NodeCanvas.tsx:1737-1775` is fenced by a `UX-1B / HA-05` comment, sits outside
the transformed canvas, and is the file's only `nodes.size === 0` branch — I diffed the rest
of that file's changes and they are UX-1C's keyboard-connect work, untouched by this
insertion. `pointer-events:none` on the wrapper (with `auto` on the actions) means a marquee
started across the copy still belongs to the canvas. Good.

### HA-06 / HA-16 / HA-27

```
healthTooltip  "Sound live. … Latency: browser engine — 132 ms round trip, measured on this
                machine (the tier is an honest 15–25 ms)."
latencyChip    "132 ms round trip"            ← same number, same cluster, 8px apart
instrument     "Connected — play the keys. Per-row tuning appears when a Keyboard’s rows arrive as a group."
```

`grep -rn "sub-5"` over `src`, `packages`, `docs` finds it only in code comments and in the
**native** tier string, never in browser-tier copy. `InstrumentVisualNode.tsx:174` genuinely
did not carry the offending string — the report is right to have left it alone. HA-27,
live in a real browser (which the lane could not do): chip reads
`"Offline — everything still works"` at t=0, `"Offline"` at t=10.5 s, and `"Offline"` on a
second offline episode in the same session.

### Gates

```
bunx tsc --noEmit -p tsconfig.app.json    exit 0
bun run lint                              exit 0 ($ eslint . — no output)
bun run test:run                          247/249 files, 3188/3190 tests   exit 1
bun run build                             exit 0 (dist built, PWA precache generated)
```

The two reds are **not this lane's**: `src/components/CommandBar/__tests__/AiPanel.test.tsx`
("Tab from search sends the typed prompt to AI") and
`src/components/PianoRoll/__tests__/PianoRoll.test.tsx` ("keeps 60 velocity-wheel notches…"),
both 5000 ms timeouts under a loaded box. Re-run together in isolation: **38/38 passed in
8.8 s**. Same flake class the lane reported. Every test this lane wrote passed in the full
run.

FH-1 tasks 4–6 were re-run from the log's steps in my own scripts (`g1-fh1.mjs`, `g2b.mjs`,
`g5b.mjs`), not the lane's: draw a clip → PASS; chip honest before binding → PASS; bind →
PASS (one undo entry, exact inverse); notes drawn and kept → PASS (`"Track 1 piano roll, 1
notes"`); `Ctrl+S` answers → PASS (dialog, then a real save); song survives a close/reopen →
PASS; no undo cost → PASS. Zero console errors or warnings across every run.

---

## Not verifiable here

- **Whether a bound track actually sounds.** No ears in this harness. The playhead advancing
  over a two-node song graph (`keys → speaker`) is the strongest available evidence and it is
  present, but a taste-tier judgment with audio playing is still owed on U6.
- **The native tier.** Everything above is `ojcore-wasm` in Chromium.
- **A literal OS tab close.** Same caveat as the lane's; navigation-away fires the same
  `pagehide` and the marker proves which branch ran.
- **The record-start hazard (G-04) end to end.** Code-read plus the reachability argument;
  driving a real armed recording headlessly was out of budget.
- **G-01's screen-reader consequence** is inferred from where the attributes land (measured)
  plus known `role="group"` description support; not measured with NVDA/JAWS.

---

## Ruling on the pill decision

Keeping the **Play** glyph and changing the **press** is the right call, and I would not
reverse it. `DESIGN.md` and `docs/shell.md` both make "the glyph waits for the engine" a law
precisely because a Stop square over a frozen playhead is the worse lie, and three tests
pinned that law; moving the fix to the action, behind one exported predicate that the pill
*and* `transportStore` read, is the only version of this that cannot drift — a label and its
action with two owners is the defect one level above HA-03, and the lane closed it at the
right altitude. Where the decision is under-finished is its blast radius. `transportAwaitingEngine`
is defined by *"an error is set and we think we are playing"* rather than *"the start we sent
is unconfirmed"*, so it swallows a seek timeout on a genuinely rolling song (G-03) and a
record start (G-04) — states where "ask again" is not what the performer means, and where
the retry re-issues the whole preview instead of stopping it. The report is candid that
"cancel this attempt" is not a verb and judges a Play button that plays to be worth that; I
judge the opposite for a live instrument. A performer who cannot stop a sounding song is in
a worse place than one whose button says the wrong word — "a held note beats a glitch" is
about preserving the *last good sound*, not about removing the gesture that ends it. Land
the decision as it stands, narrow the predicate to the unconfirmed start, and give the
wedged state exactly one escape that means **stop**.
