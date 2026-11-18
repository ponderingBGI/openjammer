# FH-2 — laptop performer, keyboard-first, dark stage

**Persona.** I play live sets with Ableton and a 25-key controller. House lights down, hands on
the keys, trackpad is a last resort because reaching for it means looking down. Never seen
OpenJammer. Session run on a frozen `bun run build` + `vite preview` snapshot at
`http://localhost:5258`, dark theme, 1440×900, screenshots in `.scratch/fh2/`.

I cannot hear. Everything below about sound is read off the **meters** (Speaker `dB` readout,
master level meter in the transport pill), the transport state, and any live text. Where that
is not enough I say so.

---

## First impression

The onboarding is the best thing in the app and it nearly sold me. Three cards, each option
badged with a number, so I answered all three questions — *Years of it* / *Build a beat* /
*Dark* — without my hands leaving the home row. "Your rig starts playing the moment you pick"
is exactly the promise a performer wants. Then the curtain went up on a genuinely beautiful
dark canvas: a Keys node with the actual QWERTY letters printed on the pads, Synth Drum →
Effect → Width → Speaker wired left to right in teal, an 8-step HAT/SNR/KICK grid at the
bottom, and a big orange transport pill floating at the top. It looks like an instrument, not
a dashboard. I believed it.

Then I pressed Space and nothing happened. Then I pressed it again. The Beat rig card said
**playing** in green; the transport button said **Play**; the playhead sat on 1.1; the speaker
said **−∞ dB**. Four indicators, three of them lying, and the one telling the truth was the
smallest one on screen. That tension — a gorgeous, confident surface over a state model that
does not actually know whether sound is leaving the building — is the story of the whole
session. By the end I had the loop running with the playhead cycling, "Sound live · audio
engine is up and making sound" in the header, Audio Health reporting every row green, and
**six seconds of −∞ dB**. On stage that is the nightmare: the software is smiling at me and
the room is silent.

---

## Per task

### Task 1 — get a loop playing
**~4 min · done, but needed the pointer · keyboard failed**

1. Onboarding: `3` (Years of it), `2` (Build a beat), `2` (Dark). ~25 s, keyboard only.
2. Landed on the canvas. Beat rig card reads green **playing**; transport reads **Play**;
   playhead **1.1**; speaker **−∞ dB**. (`04-after-onboarding-dark.png`)
3. Pressed **Space**. Nothing. Pressed it again. Nothing. No error, no flash, no toast.
4. Pressed **?** for help — nothing. Pressed **Ctrl+K** — nothing (this one was my harness's
   window focus; once the window truly had focus Ctrl+K worked fine).
5. With confirmed focus, pressed **Space** twice more. Still nothing: still "Play", still 1.1.
   (`11-after-space-focused.png`)
6. Gave up, reached for the trackpad, clicked the orange play triangle. It went. Playhead ran,
   button became **Stop**, and a tiny orange dot that had been sitting on the corner of the play
   button vanished. (`13-after-click-play.png`)
7. Sampled the meters for 3 s: Speaker **−∞ dB**, master meter `aria-valuenow=0`, flat.

The first Play has to be a pointer click. Space only becomes live *after* that. Nothing on
screen said so.

### Task 2 — swap the sounding instrument without stopping
**~4 min · done · needed the pointer to open the picker**

1. `Ctrl+K`, typed `instrument` → offers to *add* Keys/Sampler/Strings/Winds, nothing about
   swapping. Typed `piano` → top hit "Quantize selected notes". Typed `swap` → "Export song…".
   Typed `synth drum` → nothing. Palette is an add-a-node menu, not a command palette.
2. Pressed `Tab` to go hunting for the node — `Tab` **flipped the entire editing surface** to
   Arrangement. Startling, but it turned out to be where I needed to be, and the loop kept
   running through the switch.
3. Tabbed 26 times to reach **"Choose instrument for Kit"**. Pressed `Enter`. Nothing. Focused
   it explicitly, pressed `Enter` again. Nothing. (`20-t2-after-enter.png`)
4. Trackpad. Clicked the little `⌄` chevron → a clean **Browser** sheet opened with the search
   field already focused. (`22-t2-swap-open.png`)
5. Typed `keys`, pressed `Enter` — nothing. `ArrowDown` — nothing. Tabbed 5 times to the
   **Use** button, `Enter` — swapped. Toast: *"This track plays Keys"*. Transport never
   stopped. (`26-t2-after-use.png`)

Swap achieved without stopping — that part is genuinely good. But there is no way to see
*which* instrument is currently loaded from inside the browser (no checkmark on the current
one), and see friction #9: the drum kit I was swapping away from is not in the list at all.

### Task 3 — delete something on purpose, get it back
**~3 min · done · delete needed the pointer, undo was keyboard**

1. Tabbed to the clip — focus ring landed on "Kit — bars 1 to 1, 12 notes" in one press.
2. `Delete`. Nothing happened. No toast, no shake, no "select something first".
3. `Enter` (to select?) then `Delete`. Nothing. `Backspace`. Nothing. (`32-t3-after-del2.png`)
4. Clicked the clip with the trackpad, then `Delete` → gone. Status: *"Removed clip"*, Undo
   button relabelled *"Undo Remove clip"*.
5. `Ctrl+Z` → clip back in ~1.1 s, transport never faltered, the instrument swap from task 2
   survived. (`36-t3-after-undo.png`)

Undo is the most trustworthy thing in the app. Focus is not selection, and the timeline never
told me that.

### Task 4 — mute a part, bring it back
**~3 min · done · pointer-only, and it cost me a metronome**

1. Pressed **`m`** first (Ableton reflex: M mutes the selected track). The Mute button stayed
   off — but I later discovered **`m` had switched the metronome on**, silently, no toast.
2. Focused "Mute Kit", `Enter` → `aria-pressed` still `false`. Pressed `Space` on it → still
   `false`, but Space fell through to the transport and **stopped my loop**.
3. Trackpad click on `M` → muted. Status: *"Set track mute"*, Undo relabelled.
4. Focused it again, `Enter` to unmute → nothing. Clicked → unmuted. (`48-t4-after-unmute.png`)
5. Pressed `m` again to get the metronome back off. Confirmed: `m` = metronome, globally.

Nothing about muting was visible except the M pill changing state — with the meters flat I had
no second source to confirm a part had actually gone quiet.

### Task 5 — stop cleanly, return to the top, start again
**~1 min · done · keyboard only**

1. `Space` → stopped. Playhead froze mid-bar. Primary button relabelled
   **"Return to where playback started"** (not "Play").
2. `Home` → playhead snapped to **1.1**, button became **Play**.
3. `Enter` → nothing (tried it, in case).
4. `Space` → playing from the top.

Three keys, works, and once I knew it, it was fast. The relabelling of the primary button into
a third state is the one hazard — the transport is a 3-state cycle (Play → Stop → Return),
which is not what Space means anywhere else I've played.

### Task 6 — is it telling me the truth?
**~4 min · done · answer: about half of it**

- **Is it playing?** Yes, clearly: Stop button, ticking bars.beats.ticks readout, a playhead
  line, and the step grid lighting one column at a time. Best-in-class.
- **What does Space do right now?** A grey `space` keycap chip sits in the transport pill —
  always, stopped or playing — and it never says *what* Space will do. Given the primary button
  cycles through three verbs, that chip tells me a key is armed but not what it fires.
- **Is the engine healthy?** `Ctrl+Shift+H` opens **Audio Health**, and it is excellent:
  engine running, round-trip latency, sample rate, output device, cross-origin isolation,
  build version, each with a green/amber/red dot. (`57-t6-audio-health.png`)
- **What latency am I on?** Told loudly and honestly: an amber **"132 ms round trip"** chip in
  the header, and in the panel *"132 ms round-trip is too much to play against — turn on Low
  latency in Settings → Audio, use wired headphones, prefer a USB interface."* This is the most
  honest latency reporting I have seen in a browser DAW. I would not gig on 132 ms, and the app
  agrees with me instead of hiding it.
- **Is sound actually coming out?** *It cannot tell me.* The header pill reads "Sound live —
  audio engine is up and making sound" whenever the engine object exists. Audio Health has no
  row for signal. The only truthful instrument is the Speaker node's `dB` readout, which is
  ~11 px of grey text at the far right of the canvas.

### Task 7 — provoke it
**~6 min (over the 4-min box; I kept going because it kept being interesting) · done**

- **26 keys held at once.** All 26 pads lit orange, transport kept ticking, no error, no
  console output, released cleanly. Rock solid. (`60-t7-all-keys-down.png`)
- **40 rapid `Space` presses.** Ended in a coherent playing state. No stuck transport, no
  double-start. Rock solid.
- **14 nodes spawned in a burst via Ctrl+K while playing.** Audio kept running. But every new
  node landed on the same screen position, stacking into a wall that **covered the transport
  pill and the top bar** (`66-t7-playhead-check.png`). `Ctrl+Z` ×14 removed exactly the 14
  nodes and stopped precisely at the previous action. Undo is excellent.
- **What broke was not what I attacked.** The loop went silent on an ordinary
  stop → return-to-top → play. See friction #1.

### Task 8 — task 5 again, keyboard only, eyes on the stage
**3.1 s · done · keyboard only**

`Space` → `Home` → `Space`. Under four seconds, no pointer, no hunting. That is stage-grade,
and it is the one moment in this session I would trust in front of an audience —
**except that the loop came back silent** (−∞ dB for 6 s while the playhead cycled), and I
could not recover it by re-cycling the transport, by clicking Play with the pointer, or by
re-swapping the instrument. Audio Health, opened while silent, still reported everything
running and green.

---

## Friction

**1. The loop keeps running and stops making sound, and nothing on screen admits it.** · S1
*Expected:* stop → top → play brings back the same loop I just heard. *Happened:* after
`Space`/`Home`/`Space` the playhead cycles bar 1 forever at **−∞ dB**. Header says "Sound live
— up and making sound", Audio Health says engine running, track is not muted or soloed out,
Beat rig card says *playing*. Tried: re-cycling the transport (keyboard and pointer), stopping
and starting again, swapping the instrument to Strings — all still silent. · **~4 min lost,
never recovered** · `77-t8-playing.png`, `78-t8-silence-after-restart.png`,
`82-health-while-silent.png` · *What would make it obvious:* the transport pill's master meter
must be the loudest truth on screen — if the transport is rolling and the master has been at
−∞ for more than a bar, say so where I am already looking ("rolling · no output").

**2. The rig you are handed at onboarding shows no output at all.** · S1
*Expected:* "Build a beat — a kit and an 8-step groove, already looping" plus "your rig starts
playing the moment you pick" means I hear a beat. *Happened:* for the first ~15 minutes, with
the stock **Synth Drum** loaded and the transport confirmed rolling, Speaker read **−∞ dB** and
the master meter `aria-valuenow` never left 0 — including with 26 notes held down. Meter
movement (−8 to −26 dB, dancing) only ever appeared *after* I had swapped the instrument to
Keys, which proves the meters work. · **the whole first act of the session** · `13`, `14`,
`60-t7-all-keys-down.png` vs `66-t7-playhead-check.png` · *Caveat:* headless Chromium, so I
cannot fully exclude an environment artifact — but the meters demonstrably work in the same
process, so the drum rig is the suspect. · *What would make it obvious:* the onboarding
promises sound; it should not hand over until it has seen signal, and should say "no output
from Synth Drum" if it hasn't.

**3. Space does nothing until you have clicked Play once with a pointer.** · S1
*Expected:* first key I try on a music app is Space, and the transport pill literally shows a
`space` keycap. *Happened:* four presses, zero response, zero explanation; the only visible
clue was an unlabelled orange dot on the corner of the play button, and a warning
("the audio engine did not acknowledge the transport command") that exists only in the
accessibility layer and is not painted on screen. · **~2.5 min lost, recovered by pointer** ·
`06-after-space.png`, `11-after-space-focused.png` · *What would make it obvious:* if Space is
inert because the engine needs a gesture, say it where the keycap is — "press Play once to
arm" — instead of showing a keycap that does nothing.

**4. Enter does not activate the timeline's buttons.** · S1 (for keyboard-first)
*Expected:* focus a `<button>`, press Enter, it fires. *Happened:* "Choose instrument for Kit"
(⌄), "Mute Kit", the Browser's result rows — all confirmed focused, all ignore Enter and Space,
all work on a pointer click. Every one of them made me reach for the trackpad. · **~3 min
across tasks 2 and 4, recovered with pointer** · `20-t2-after-enter.png`,
`47-t4-before-unmute-enter.png` · *What would make it obvious:* these look like buttons and
take focus, so they must fire on Enter/Space — if the handler is on pointerdown, it is invisible
to me until I fail.

**5. `M` toggles the metronome, not track mute.** · S2
*Expected:* in every DAW I have used, M mutes the selected track. *Happened:* M switched the
click on, silently, with no toast and no announcement; I only found it three actions later when
I noticed `Metronome [pressed]`. On stage that is a click track suddenly in the house PA and I
would not know which key did it. · **~40 s, recovered by pressing M again** ·
`43-t4-transport-now.png`, `49-metronome-m-key.png` · *What would make it obvious:* toast every
transport-scope toggle ("Metronome on"), and either give track mute the M it expects or teach
me the difference the first time I press it.

**6. Focus is not selection in the timeline; Delete fails silently.** · S2
*Expected:* the clip has a focus ring, so Delete deletes it. *Happened:* Delete, Enter+Delete
and Backspace all did nothing at all — no error, no hint. Only a pointer click made the clip
"selected" enough to delete. · **~1.5 min, recovered with pointer** · `30`, `32`, `34` ·
*What would make it obvious:* focusing a clip should select it, or Delete on a focused-but-
unselected clip should say "press Enter to select this clip first".

**7. The primary transport button is a 3-state cycle, and Space drives it.** · S2
*Expected:* Space = start/stop, as in Ableton, Logic, Live, everything. *Happened:* Play →
Stop → **"Return to where playback started"** → Play. So the second Space after a stop does
*not* start me again; it moves the playhead. Meanwhile there is a *separate* "Return to start"
button next to it. Two different "returns", one keystroke that hits one of them by surprise. ·
**~1 min of confusion** · `43-t4-transport-now.png`, `45-t4-after-space-restart.png` ·
*What would make it obvious:* label the `space` chip with the verb it will perform right now
("space · stop", "space · play"), the way the Undo button already labels its action.

**8. New nodes stack on one spot and bury the transport.** · S2
*Expected:* things I add land somewhere I can see, near what I selected. *Happened:* 14 adds in
a row all spawned at the same viewport position, overlapping each other and covering the
transport pill and the header — the exact strip I need to read to know whether I am playing. ·
**~30 s** · `66-t7-playhead-check.png` · *What would make it obvious:* cascade or place near
the selection, and never let a node occlude the transport.

**9. You cannot get the drum kit back from the instrument browser.** · S2
*Expected:* the browser lists the instruments the app ships, including the one currently
loaded. *Happened:* five entries — Strings, Keys, Winds, Instrument, Sampler. The `gm-synth-
drum` that "Build a beat" installed is not among them, searching `drum` returns nothing, and
the current instrument is not marked. Once I swapped, only Ctrl+Z could take me back. ·
**~1 min** · `71-browser-all.png` · *What would make it obvious:* mark the loaded instrument as
current, and never offer a swap you cannot reverse from the same sheet.

**10. Clearing the browser's family filters returns *zero* results.** · S2
*Expected:* no filter = show everything. *Happened:* with "Keys" and "Synth" both off the list
is empty and the empty state advises *"clear the family and source filters"* — precisely what I
had just done. · **~40 s** · `72-browser-nofilter.png` · *What would make it obvious:* an empty
filter set should mean "all", and the empty state should not recommend the action that caused
it.

**11. The plugin search box keeps the last query and does not select it on open.** · S3
*Expected:* reopen the picker, start typing, search fresh. *Happened:* my new text appended to
the old — the field read `keysdrum` and told me nothing matched. · **~30 s** ·
`70-browser-drum.png` · *What would make it obvious:* select-all on focus, or clear on open.

**12. The live status region goes stale and never announces the transport.** · S3
*Expected:* eyes off the screen, the app narrates what changed. *Happened:* through an entire
stop → return → play cycle the `role=status` region still read "Undo Add Effect" from several
minutes earlier. Nothing about play, stop, position, or the loop going silent. · **not
recovered** · `74`–`77` · *What would make it obvious:* announce transport transitions; that is
the one thing a performer with their eyes on the room needs spoken.

**13. `?` does not open keyboard help.** · S3
*Expected:* the floating `?` button bottom-right implies a `?` shortcut. *Happened:* nothing;
the palette does list "Toggle Help", so it exists — just not on the obvious key. · **~20 s** ·
`07-keyboard-help.png` · *What would make it obvious:* bind `?`, and put the binding on the
button's tooltip.

**14. The command palette does not know the words a musician uses.** · S3
*Expected:* type what I want. *Happened:* `piano` → "Quantize selected notes"; `swap` →
"Export song…"; `synth drum` → nothing; `instrument` → only *add* commands. The palette is an
insert menu wearing a command palette's clothes. · **~1 min** · `16-t2-palette-instrument.png` ·
*What would make it obvious:* index instrument names and per-track verbs ("change instrument on
Kit"), and return nothing rather than a confidently wrong fuzzy match.

**15. Every modal blurs the whole stage, transport included.** · S4
*Expected:* I can keep one eye on the playhead while I browse a sound. *Happened:* the Browser
and Audio Health sheets blur and dim the entire app, so mid-set I lose the position readout and
the meter. · **cosmetic but real** · `22-t2-swap-open.png` · *What would make it obvious:* keep
the transport pill above the scrim.

**16. `Tab` throws away the surface you are looking at.** · S4 (near-miss S2)
*Expected:* Tab moves focus. *Happened:* Tab swaps Canvas ↔ Arrangement — my whole view changed
on the first press. It is well signposted once you are there ("Beat rig · `Tab` · canvas"), the
loop survives it, and I came to like it — but it means Tab can never be used to walk controls,
and my first reflex press was a jump-scare. · **~20 s** · `17-t2-tab-walk.png` ·
*What would make it obvious:* it already is, on the destination — put the same `Tab ⇄`
signpost on the tablist itself.

---

## Moments I was afraid to press something

- **Space, the very first time.** The Keys node has a giant `HOLD SPACE` sustain pedal printed
  on it *and* the transport pill shows a `space` keycap. Two owners, one key, and I had no idea
  which would answer. On a dark stage that is a coin flip with a PA attached.
- **Space again after it did nothing four times.** Silence after a keypress on an instrument
  means either "nothing happened" or "something happened that I cannot hear yet". I stopped
  pressing because I did not want to find out it had queued four of them.
- **The second `Space` after a stop.** Once I learned the primary button relabels itself to
  "Return to where playback started", I had to look at the button before every Space press —
  which defeats the point of a keyboard shortcut.
- **`Delete` on a clip that would not delete.** Pressing a destructive key twice with no
  feedback is the worst feeling in this list; I had no way to know whether it had queued or
  ignored.
- **`m`.** I pressed it on Ableton reflex and something invisible changed. For the rest of the
  session I avoided bare letter keys entirely — which on this app means avoiding the whole
  Keys node.
- **Adding a node while the loop ran.** The palette is a live, unguarded edit to the graph that
  is currently making sound. Nothing told me whether an add could interrupt the audio, so the
  14-node burst was genuinely a dare.
- **Reloading.** When the loop went silent and would not come back, the only move I had left
  was refresh — and I would not do that in front of a room.

## Three delights

1. **The onboarding is number-keyed all the way through.** Three questions, `3` `2` `2`, done,
   and the last one is theme so I never got flashbanged. It is the only fully keyboard-native
   path in the app and it is a joy.
2. **Undo names what it will undo, and it is exact.** "Undo Remove clip", "Undo Set track
   mute", "Undo Install Beat rig", "Undo Edit timeline" — I always knew what Ctrl+Z would cost
   me. Fourteen spammed nodes came back off in fourteen presses and it stopped *precisely* at
   the previous real action. This is the one thing I would trust blind.
3. **Audio Health is honest about latency in a way almost nothing is.** A red row saying
   *"132 ms round-trip is too much to play against"* with three concrete fixes, plus the amber
   chip permanently in the header. It told me the truth about the thing that would have ruined
   my set, without me asking. Runner-up: the transport pill's bars.beats.ticks readout and the
   step grid's marching column — when it is playing, you can see it playing from across a room.

## What I could not assess

- **Anything about how it sounds.** No hearing; I read `dB` text and meters only. Timbre,
  glitches, clicks on instrument swap, whether the metronome is loud — all unknown.
- **Whether friction #2 (the silent stock beat) is the app or headless Chromium.** The meters
  demonstrably work in the same session, which points at the app, but I cannot prove it.
- **Real MIDI.** No controller attached; I never touched the MIDI node, and MIDI→audio latency
  (the number the product actually lives on) is untested.
- **Native / `ojcore-native`.** This was the browser build; the header itself says "browser
  engine". The <5 ms claim is not testable from here.
- **Recording.** The Record button was disabled the whole session and I never learned why.
- **The AI / Ctrl+K agent side**, Collaborate, Settings, the piano roll, automation lanes,
  the Mix view, and Export (disabled).
- **Whether the loop-silence bug survives a reload** — I refused to reload.

---

## With the docs in hand

*(read only after the above was written: `PRODUCT.md`, `DESIGN.md`, `docs/shell.md`,
`docs/timeline.md`)*

### What the docs intend

The intent is not vague and it is not wrong. `PRODUCT.md` names *my exact persona* — "a laptop
performer on a dark stage with no second take" — and makes two promises I tested directly:
**"Keyboard- and Ctrl+K-reachable everything... This is first-class and non-negotiable"**, and
**"Honest interfaces: metering that doesn't lie... a transport glyph that waits for the engine
before it claims to be rolling."** The Live Performance Rule ranks the failure behaviours in
order: preserve the last good sound, report without stealing focus, collect diagnostics
quietly, let the performer choose when to recover.

`docs/shell.md` goes further than I expected. There is a **state table** for the transport
glyph — pending / play-error / seek-error / recording / playing / seeking — with the line
*"a **Stop** glyph over a frozen playhead is the worst lie it can tell."* There is a whole
essay on `Tab` arbitration, on `chromeFocus.ts` discriminating a keyboard-synthesised click
from a pointer one via `event.detail !== 0`, on why the latency banner became a chip
(*"a warning must be seen without stealing the moment"*), and on why the meter is published on
a **dB scale** (−60…0 dBFS) because *"a comfortably loud held note is about 0.02 RMS, which on
a linear bar is indistinguishable from silence."* `docs/timeline.md` documents the three-state
transport in full, with one predicate (`stopReturnsToOrigin()`) shared by all four callers
*"so the key and the button can never disagree about what the next press does."*

Almost everything I hit is a place where this thinking exists and stops one step short of the
stage.

### Intended vs. what I got

**1. The transport is honest about the *transport*. Nothing is honest about the *sound*.**
shell.md's glyph table is entirely about whether the engine acknowledged a transport command.
It did — so the pill correctly showed Stop, correctly ticked the readout, and was correctly
"not lying" by its own definition, while the master meter sat at −∞ for six seconds and the
room was empty. The doc's own worst case is *"a Stop glyph over a frozen playhead."* My case is
worse and is not modelled: **a Stop glyph over a *moving* playhead and a dead master.** The
irony is that `Shell/masterSignal.ts` was engineered specifically so the meter could be
believed — it is the only component in the app that told me the truth all session, and nothing
else in the app reads it. Frictions #1 and #2 stand at S1, unsoftened. "Metering that doesn't
lie" was delivered; *listening to the meter* was not.

**2. The silent-track story is built on binding, not on signal.** timeline.md has a careful
design for unbound tracks: `conduct` puts them in `skipped`, the header chip reads *"No
instrument yet"* in warning ink, and `trackIsBound`/`unboundTracks` is the one predicate the
lane header and the transport error share *"so they can never disagree about which tracks are
silent."* My track was **bound** — the chip read `gm-synth-drum`, then `Keys`, then `Strings` —
and it was silent every time. Bound-but-silent has no predicate, no chip, no warning ink and no
transport message. That is the whole of friction #2's severity.

**3. My worst 2.5 minutes were the documented failure path, working exactly as written, and I
could not see any of it.** shell.md describes precisely what happened to me: a play command the
engine never acknowledged, `isPlaying` left TRUE, a `transportError`, the glyph held at **Play**
so the next press means *ask again*, a `--warning-ink` dot on the button, the sentence appended
to the button's **own `title`** and `aria-describedby`, and **Esc** as the always-available way
out, *"named in the button's tooltip, because a gesture nothing on screen mentions is a gesture
only its author knows."* Every one of those shipped. And on a dark stage with my hands on the
keys, the entire report was a **6px dot** and a **hover tooltip** — the two channels a
keyboard-first player never opens. The doc's own sentence indicts the result: naming the escape
hatch inside a tooltip *is* a gesture only its author knows, because a keyboard player has no
hover. Friction #3 stays S1.

**4. "Keyboard-reachable everything" is real on the canvas and absent in the arrangement.**
shell.md documents a serious keyboard build-out for ports — roving tab stops per card, arrows
across sockets, *"`Enter` arms, `Enter` lands, `Escape` drops"*, an explicit fix for a measured
"0 of 84 ports tabbable" session. I never got to try it, because the controls I actually needed
— `arrangement-instrument-chip__swap`, `Mute Kit`, `Solo`, the Browser's result rows — are
outside that work and ignore Enter entirely. timeline.md even describes the instrument chip in
pointer terms only ("**Clicking** either half opens the Plugins browser"). So the
non-negotiable is honoured on one surface and not the other, and the arrangement is where a
performer changes a sound mid-set. Friction #4 stays S1.

**5. The three-state transport is deliberate, well-argued, and under-advertised by one word.**
timeline.md: *"stop-stop rewinds and a further press plays from the origin it just returned to,
and there is no 'return on stop' preference to find."* Having read that, I like it more than I
did live — and my complaint narrows precisely. shell.md already holds the principle that fixes
it: *"An advertised key that does nothing is worse than no hint, so the keycap hides."* The
same logic says an advertised key whose **verb changes** should show the verb. The `space`
keycap is inert text; the Undo button beside it already writes its action into its own label
("Undo Remove clip"). Friction #7 drops from S2 to **S3**, one word away from solved:
`space · stop` / `space · play` / `space · return`.

**6. `M` = metronome was weighed against the spec, not against the persona.** timeline.md lists
it as a *"documented deviation"* from interaction spec §4.2 (which wanted M for the mixer). The
comparison never made is against the muscle memory of the user PRODUCT.md puts first. In every
DAW that laptop performer has ever opened, M mutes. Here it puts a click in the PA, silently.
Friction #5 stays S2, and the cheap half of the fix — announce every transport-scope toggle —
costs nothing.

**7. Focus-is-not-selection is a hole *between* two well-specified systems.** timeline.md's
editing context *"owns grid, snap, tools, selection... whether invoked by mouse, keyboard, or
agent"*, and the BC contracts pin selection/delete/clipboard behaviour hard. But DOM focus on a
clip is not a door into that selection model, so `Delete` on a focused clip is a silent no-op
that no contract has to account for. Friction #6 stays S2.

**8. `Tab` is working as designed and the design already absorbed my complaint.** shell.md
records that the old rule *"used to match every DESCENDANT of a surface root"* and was measured
false, and that the arbiter now distinguishes focus **parked** on the stage floor from focus
**in transit** across it. What I hit was the fixed behaviour, and the topbar does wear the
`Tab` keycap. Friction #16 downgrades to **accepted cost**, not a defect.

**9. The instrument browser's 5 entries are documented; the reason is invisible and the empty
state is a real bug.** timeline.md explains `pick` *"lists only what can actually be a voice —
built-in instrument node types, since keyboards and `-visual` mirrors are flattened away."*
That is why searching `drum` finds nothing: **`gm-synth-drum` is a catalogue voice living
inside the generic `Instrument` node type**, and the browser lists types, not voices. Nothing
in the sheet says so, and there is no "currently loaded" marker, so from the outside it reads
as "the app deleted my drum kit." Friction #9 stays S2 with a clearer cause. Friction #10
(clearing both family filters returns **zero**, while the empty state advises exactly that) is
undocumented anywhere and remains a plain bug.

**10. Two Live-Performance-Rule violations that the same codebase already knows how to fix.**
The rule says *"report the problem without stealing focus — a quiet signal, never a modal that
hijacks the moment,"* and PRODUCT adds *"no modal interruptions mid-set."* shell.md then shows
the exact playbook being applied once: the latency banner *"collided with the arrangement's
transport row and covered the canvas"* and became a chip with a popover. But the **Browser**
and **Audio Health** are still full-scrim modals that blur the transport pill — the component
shell.md calls *"the one place a performer looks to ask is it running"* — and spawned canvas
nodes pile up over that same pill even though DESIGN.md says the ruled surfaces reserve
`--oj-surface-top` *"so it never covers a bar"* (the reservation covers surfaces, not
free-positioned nodes). Frictions #8 and #15 stand, with a fix already proven in-house.

**11. The live region is scoped to faults, not to transitions.** shell.md gives the pill a
`polite` `role="status"` that *"speaks exactly when the arrangement cannot"* — for transport
**errors**. Nothing anywhere asks it to announce play, stop, position or a track going silent,
which is why mine still read "Undo Add Effect" through an entire stop→return→play. For a
performer with their eyes on the room this is the single highest-leverage line of copy in the
app. Friction #12 stays S3 only because it is cheap, not because it is minor.

**12. Ctrl+K is called non-negotiable and is currently an insert menu.** PRODUCT lists
"Ctrl+K-reachable everything" beside keyboard reachability as first-class. What shipped indexes
node types plus about a dozen app commands, so `piano` returns "Quantize selected notes" and
there is no verb for the most common mid-set action there is — change the sound on a track.
Friction #14 stays S3 but is the one that most directly contradicts a stated non-negotiable.

### What the docs made me *more* impressed by

- The **meter's dB scale** and the reasoning behind it. Someone thought about what a held note
  actually reads as, and picked the scale that makes the meter believable. That care is why my
  #1 and #2 are provable at all.
- The **latency chip's** whole history — banner → chip → popover, with "a warning must be seen
  without stealing the moment" as the reason. It is the best-executed idea in the product and I
  found it without being told.
- **One history for graph and timeline.** shell.md's "the Song is installed INSIDE the rig's
  gesture" and timeline.md's `applyVerb`-returns-its-inverse contract are exactly what I felt
  when 14 spammed nodes came off in 14 presses and stopped dead on the previous real action.
  It is the only subsystem I would trust on stage tonight.

### The one-line version

The instrument is honest about *itself* — engine up, latency bad, command unacknowledged — with
more rigour than anything else I have played. It is not yet honest about the only thing the
audience can hear. Every mechanism needed to close that is already in the codebase: a meter
built to be believed, a `polite` status region, a warning-ink vocabulary, and a chip pattern
that reports without stealing the moment. Nothing currently connects them to the question
*"is sound leaving the building right now?"* — and for a laptop performer on a dark stage, that
is the only question.

