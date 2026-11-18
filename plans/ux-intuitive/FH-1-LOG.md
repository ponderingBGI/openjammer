# FH-1 — naive-user usability log

**Persona:** bedroom producer, laptop + trackpad, a little Ableton and GarageBand, never seen
OpenJammer, has not read a word of its docs or code.
**Build under test:** frozen production build (`bun run build` → `vite preview`, port 5240),
fresh browser profile, 1440×900, Chromium with autoplay allowed.
**Screenshots:** all paths below are under
`C:\Users\olimt\.t3\worktrees\openjammer\t3code-2faff191\.scratch\fh1\`.

---

## First impression (before touching anything)

Screenshot: `.scratch\fh1\00-first-launch.png`

A calm, almost paper-white app with a wordmark, a menu bar (File / Edit / View), a Canvas /
Arrangement toggle, and a little pill floating at the top with a record-looking dot and "120 BPM".
Front and centre: a card asking *"Made music with a computer before?"* with three answers and a
"Skip, take me in". It doesn't look like a DAW — no mixer, no track list, no browser sidebar. It
looks like a design tool or a whiteboard app that happens to have a tempo. My guess was: some kind
of modular/node music sketchpad, quieter and more opinionated than Ableton, probably aimed at
noodling rather than finishing a track. The tone of the copy ("We'll keep it simple and label
everything", "Years of it — dense layout, real numbers, no hand-holding") made me trust it
immediately. I picked "I've dabbled".

**Time to first sound: 46 seconds** (from the app appearing on screen to the level meter moving).
About 22 s of that was the three onboarding cards; the rest was me looking at the rig it built and
pressing a key.

---

## Tasks

### Task 1 — hear any sound at all · **37 s · DONE**

1. Card 1: picked **"I've dabbled"**. (`01-onboarding-step1.png`)
2. Card 2: *"What do you want to make right now?"* — picked **"Jam some keys — a warm electric
   piano with delay on it"**. Copy promised "the rig behind this card gets wired for it — and
   starts playing". (`02-onboarding-step2.png`)
3. Card 3: theme. Picked **Light**. (`03-onboarding-step3.png`)
4. The onboarding dissolved into a finished patch: **Keys → Electric Piano 1 → Effect (Delay) →
   Speaker**, already cabled, with the header reading "Sound live · 148 ms".
   (`04-after-onboarding.png`)
5. Pressed **A** on my keyboard. The A key lit orange, the Speaker node's meter jumped from −∞ dB
   to −15.3 dB and decayed, and the little transport pill's meter moved too.
   (`05-key-a-held.png`)

I did not have to build anything, connect anything, or find a "start audio" button. This was the
best moment in the session.

### Task 2 — play a chord with the computer keyboard · **1 s · DONE (then immediately spoiled)**

1. The Keys node draws my actual QWERTY layout with the note name on every key (A = C4, G = E4,
   K = G4), so I didn't have to guess. (`06-before-chord.png`)
2. Held **A + G + K**. All three keys lit, meter hit −14.8 dB. Chord: done, in about a second.
3. …and at the same instant a warning card slid in bottom-left: **"Effect is sending noise we can't
   play. We're replacing those blocks with silence, so you may hear gaps. It's still in the
   chain."**, the header pill flipped to **"Sound degraded"**, and the meter turned red.
   (`07-chord-held.png`)
4. I clicked **Details** to find out what I'd broken, and landed in a **DevLog** with 82 red rows of
   `wasm NodeFault: NonFinite (node 1) {"node":1,"fault":"NonFinite"}`. (`09-after-details.png`)
5. Escaped out. Sound still worked; the warning card stayed on screen for the rest of the session
   and I never found a way to dismiss it. (`10-after-devlog-closed.png`)

Task itself: trivially easy. But playing three notes on the rig the app built for me is what set
the fault off, so I spent the next minute assuming I'd done something wrong.

### Task 3 — put a reverb on the sound · **1 m 47 s · DONE**

1. Double-clicked empty canvas (my Ableton reflex for "add a thing"). Nothing happened.
   (`12-after-dblclick.png`)
2. Right-clicked. Got an **"Add node menu"**: Input / Instruments / Routing / Effects / Utility /
   Output. (`13-after-rightclick.png`)
3. Effects → submenu offered only **"Add Effect", "Add Pan", "Add Width"**. No "Reverb" anywhere in
   the menu. Took "Add Effect" as a guess. (`15-effects-submenu.png`)
4. A node appeared *on top of* my Electric Piano, covering its title, defaulting to **Distortion**,
   and connected to nothing. (`16-after-add-effect.png`)
5. Clicked the "Distortion" dropdown — and there was **Reverb**, along with Filter and Delay.
   Picked it. (`17-effect-type-list.png`, `18-reverb-selected.png`)
6. Dragged the node into free space, then dragged a cable from the Delay's **OUT** dot up to the
   Reverb's **IN**. The old Delay→Speaker cable silently disappeared at that moment (my speaker was
   now unplugged, which I only noticed from the picture). (`22-after-wire1.png`)
7. Dragged Reverb **OUT** → Speaker **IN**, played the chord again, meter moved. Reverb is in the
   chain. (`24-reverb-chord.png`)

### Task 4 — make a short loop of a few notes that repeats · **2 m 31 s · BLOCKED** (retried later, still blocked)

1. Clicked the **Arrangement** tab. A timeline with Track 1/2/3 (chords / bass / lead) behind an
   empty-state card: *"An empty page."* with **Start from 'Paper Sketch' / 'First Light' / Record
   something / Draw a clip / Add an empty track**. (`26-arrangement.png`)
2. Clicked **"Draw a clip"**. It did not draw a clip — it deleted the three ghost tracks, left me
   one real Track 1, and armed a draw tool. (`27-after-draw-clip.png`)
3. Dragged on the lane → a 4-bar **"MIDI clip"** appeared. It was empty and nothing told me how to
   put notes in it. (`28-clip-drawn.png`)
4. Double-clicked the clip → a piano roll opened *inline inside the lane*, about 6 px per semitone,
   with the hint "press B, then draw". (`29-after-dblclick-clip.png`)
5. Drew three notes by dragging. They landed. Accessibility label confirmed "Track 1 piano roll,
   3 notes". (`30-notes-drawn.png`)
6. Clicked **Loop** (it lit up), then **Play**. Nothing. Playhead sat at 1.1 for ten seconds, the
   play button never became a pause button, the meter stayed dead. (`33-looping.png`)
7. Retried: clicked in the lane and pressed **Space**; clicked **Play** again; clicked **"Bypass
   it"** on the plugin warning to clear the fault and pressed Play once more. Playhead never left
   1.1. A small chip in the toolbar said **"The audio engine did not acknowledge the transport
   command. The last confirmed position was preserved."** (`37-play-after-bypass.png`)

I never heard my loop. I have a clip with three notes in it and a Loop button that is on, and no way
to make it play.

**Retry after the reload (clean engine, "Sound ready", no fault):** rebuilt clip + 3 notes + Loop +
Play in 15 s. Identical result — playhead frozen at 1.1, same "did not acknowledge the transport
command" chip. (`54-retry-playing.png`) So it is not a consequence of the earlier fault.

### Task 5 — save your work · **1 m 06 s · BLOCKED (no save exists that I could find)**

1. **File** menu: New Project… / Open Project Folder… / Recent Projects / New Canvas / Import
   Workflow… / Export Workflow…. **No Save, no Save As.** (`39-file-menu.png`)
2. **Ctrl+S**: nothing. No dialog, no toast, no "saved" tick anywhere. (`40-after-ctrl-s.png`)
3. **Edit** menu: Undo / Redo / Delete Selected. **View** menu: zoom, Ghost Mode, Pause loopers,
   Help. Nothing about saving. (`41-edit-menu.png`, `42-view-menu.png`)
4. Hovered and clicked the **"Untitled song"** title hoping for a rename/save affordance — it's
   plain text. (`44-click-title.png`)
5. **Settings** (gear): Appearance / Audio / Keybindings / Updates / About. No storage, no
   projects, no autosave switch, no "last saved" line. (`45-settings.png`)

I concluded it must autosave and moved on, which is exactly the wrong conclusion (see Task 6).

### Task 6 — close the tab, reopen, is my work still there? · **17 s · HALF DONE (song lost)**

1. Screenshotted both surfaces first so I'd know what to look for. (`46-before-close-arrangement.png`,
   `47-before-close-canvas.png`)
2. Closed the tab, opened a new one at the same address.
3. **Canvas: fully restored.** Keys → Electric Piano → Delay → Reverb → Speaker, exactly as I left
   it, and it did not re-run the onboarding. Header said "Sound ready" — the fault had cleared.
   (`49-reopened-canvas.png`)
4. **Arrangement: completely empty.** Back to "An empty page." with the three ghost tracks. My
   Track 1, my MIDI clip and my three notes were gone. Undo was greyed out, so I couldn't even get
   them back. (`50-reopened-arrangement.png`)

The half that persisted persisted perfectly. The half I actually thought of as "my song" was
deleted without a word.

### Task 7 (bonus) — dark theme · **2 s · DONE**

The moon icon in the header is labelled "Switch to the dark theme". One click, whole app went dark,
icon became a sun. (`51-before-dark.png`, `52-dark.png`) It's also offered in onboarding card 3 and
again in Settings → Appearance. Impossible to miss.

---

## Friction

### F1 — Playing a three-note chord on the rig the app itself built put the engine into a fault state
- **Expected:** a chord on a stock electric-piano-into-delay patch is the most ordinary thing I can do.
- **Happened:** "Effect is sending noise we can't play", header flipped to "Sound degraded", the
  level meter turned red, and it never recovered on its own.
- **Seconds lost:** ~50 (investigating something I hadn't caused).
- **Recovered?** Sort of — sound kept working, and clicking "Bypass it" cleared the card. But I
  spent the rest of the session believing the app was broken and that it might be my fault.
- **Screenshot:** `.scratch\fh1\07-chord-held.png`
- **Severity: S2** (formed a wrong mental model of my own competence and of the app's stability;
  arguably S1 for the underlying engine bug).
- **Would have made it obvious:** don't ship a default patch whose delay goes non-finite on a triad —
  and if a built-in node faults, say so in a way that clearly does not blame the user
  ("The delay in your starter patch overloaded — we've turned it down for you").

### F2 — "Details" on a friendly warning drops you into a raw developer log
- **Expected:** a plain-language explanation of what "noise we can't play" means and what to do.
- **Happened:** a **DevLog** panel with 82 rows of `wasm NodeFault: NonFinite (node 1)
  {"node":1,"fault":"NonFinite"}`, filter chips for Trace/Debug/Warn/Error, a Copy button and an
  "Ask AI to fix this" button.
- **Seconds lost:** ~20.
- **Recovered?** Yes, Escape.
- **Screenshot:** `.scratch\fh1\09-after-details.png`
- **Severity: S3** (and S2 for tone — it made a cosmetic-sounding warning feel catastrophic).
- **Would have made it obvious:** "Details" should expand one human sentence; put the raw log behind
  a second, clearly-technical door.

### F3 — The plugin warning card has no dismiss
- **Expected:** an × on a toast.
- **Happened:** the card sat in the bottom-left corner over the canvas for ~5 minutes across every
  surface. The only way out was to press "Bypass it", i.e. to change my patch in order to close a
  notification.
- **Seconds lost:** ~10, plus permanent occlusion of that corner.
- **Recovered?** Only by accepting the offered fix.
- **Screenshot:** `.scratch\fh1\26-arrangement.png` (still there, over the timeline)
- **Severity: S3.**
- **Would have made it obvious:** a dismiss ×, with the state still readable from the "Sound
  degraded" pill in the header.

### F4 — Double-clicking empty canvas does nothing
- **Expected:** double-click on empty space adds a node (Ableton, Figma, every node editor I've used).
- **Happened:** nothing at all — not even a hint that right-click is the way.
- **Seconds lost:** ~15.
- **Recovered?** Yes, right-click.
- **Screenshot:** `.scratch\fh1\12-after-dblclick.png`
- **Severity: S3.**
- **Would have made it obvious:** open the same add-node menu on double-click, or show a faint
  "right-click to add" watermark on the empty canvas.

### F5 — There is no "Reverb" in the Add-node menu; effects are hidden one level down inside a generic "Effect" node
- **Expected:** to search or browse for "Reverb" by name, like an audio-effects list in a DAW.
- **Happened:** Effects → "Add Effect / Add Pan / Add Width". I had to add a generic Effect node that
  defaults to **Distortion**, then discover that its title is a dropdown containing Distortion /
  Filter / **Reverb** / Delay.
- **Seconds lost:** ~35.
- **Recovered?** Yes, by clicking the "Distortion" label on a hunch.
- **Screenshot:** `.scratch\fh1\15-effects-submenu.png`
- **Severity: S2** (I briefly believed the app had no reverb).
- **Would have made it obvious:** list the four effect types directly in the menu ("Add Reverb…"),
  or give the menu a search field.

### F6 — A newly added node lands on top of an existing node and is connected to nothing
- **Expected:** it appears where I right-clicked, in clear space, ideally already spliced into the
  chain I was pointing at.
- **Happened:** the new Effect node overlapped and hid the "Electric Piano 1" title bar, and had no
  cables, so it did nothing until I wired it by hand.
- **Seconds lost:** ~25 (moving it, then two cable drags).
- **Recovered?** Yes, dragged it away and wired it.
- **Screenshot:** `.scratch\fh1\16-after-add-effect.png`
- **Severity: S3.**
- **Would have made it obvious:** nudge the spawn point to free space, and — since I invoked the
  menu from the canvas — offer "insert after Delay" when a chain is selected.

### F7 — Connecting a node's output somewhere new silently removes its previous cable
- **Expected:** dragging Delay OUT → Reverb IN adds a connection; the Delay→Speaker cable stays
  (or the app warns me).
- **Happened:** the Delay→Speaker cable vanished, leaving my Speaker with no input — momentarily a
  silent app — with no message.
- **Seconds lost:** ~10 (it happened to be what I wanted; if it hadn't been, I'd have been hunting
  for silence).
- **Recovered?** By luck; my next action re-fed the speaker.
- **Screenshot:** `.scratch\fh1\22-after-wire1.png`
- **Severity: S2** (I still don't know whether outputs can fan out).
- **Would have made it obvious:** animate/flash the cable being replaced, or leave the old one and
  let outputs fan out.

### F8 — "Draw a clip" does not draw a clip
- **Expected:** a button called "Draw a clip" on an empty-state card creates a clip.
- **Happened:** it selected the draw tool and cleared the three placeholder tracks. I had to work out
  on my own that I now needed to drag on a lane.
- **Seconds lost:** ~20.
- **Recovered?** Yes, by dragging.
- **Screenshot:** `.scratch\fh1\27-after-draw-clip.png`
- **Severity: S3.**
- **Would have made it obvious:** either make it create a 2-bar clip at bar 1, or call it "Draw
  clips" / "Get the pencil".

### F9 — The empty Arrangement shows three named tracks that are not real
- **Expected:** "Track 1 chords / Track 2 bass / Track 3 lead" behind the card are my tracks.
- **Happened:** the first real action deleted them and left one generic "Track 1 / track-1".
- **Seconds lost:** ~5, but it broke my model of what I was looking at.
- **Recovered?** Yes.
- **Screenshot:** `.scratch\fh1\26-arrangement.png` → `27-after-draw-clip.png`
- **Severity: S2.**
- **Would have made it obvious:** draw the ghost tracks as obviously ghosted/dashed, or don't show
  them at all.

### F10 — The inline piano roll is ~6 px per semitone
- **Expected:** a piano roll I can aim at with a trackpad.
- **Happened:** 25 pitch rows crammed into ~160 px inside the track lane, with a sliver of keyboard
  on the left too small to read. I hit the notes I wanted by luck, not by aim, and I can't tell from
  the picture which pitches I actually drew.
- **Seconds lost:** ~25.
- **Recovered?** Partly — 3 notes exist; I don't know if they're the 3 I meant.
- **Screenshot:** `.scratch\fh1\30-notes-drawn.png`
- **Severity: S3.**
- **Would have made it obvious:** open the clip in a big editor (double-click = full-height roll), or
  auto-grow the lane when the roll opens.

### F11 — Play does nothing. The playhead never moves and the app blames its own engine
- **Expected:** press Play (or Space) → playhead moves, my three notes sound, Loop repeats them.
- **Happened:** playhead frozen at 1.1 forever, Play never turned into Pause, no sound, and a
  toolbar chip reading **"The audio engine did not acknowledge the transport command. The last
  confirmed position was preserved."** Tried Play ×3, Space, and clearing the plugin fault first.
  Reproduced identically on a clean reload with a fresh clip.
- **Seconds lost:** ~150, task abandoned.
- **Recovered?** No.
- **Screenshot:** `.scratch\fh1\33-looping.png`, `.scratch\fh1\37-play-after-bypass.png`,
  `.scratch\fh1\54-retry-playing.png`
- **Severity: S1 — blocked.**
- **Would have made it obvious:** if the track has no instrument bound to it, say *that*, on the
  track, before I press Play — "Track 1 has no instrument. Pick one ⌄". (*Investigator note, not
  something the persona could see: the browser console logged `[song] timeline preview skipped
  tracks with unresolved refs (the rest plays) {detail: track-1}` — the real cause appears to be an
  unbound track ref, but the only thing the UI showed me was a message accusing the audio engine.*)

### F12 — There is no way to save
- **Expected:** File → Save, or Ctrl+S, or at minimum a visible "saved / all changes stored"
  indicator.
- **Happened:** File offers New Project / Open Project Folder / Recent Projects / Import Workflow /
  Export Workflow. Ctrl+S does nothing at all — not even a "there's no need, it autosaves" toast.
  Nothing in Edit, View, Settings or the title.
- **Seconds lost:** ~66, task abandoned.
- **Recovered?** No. I guessed autosave.
- **Screenshot:** `.scratch\fh1\39-file-menu.png`, `.scratch\fh1\40-after-ctrl-s.png`
- **Severity: S1 — blocked.**
- **Would have made it obvious:** a single always-visible line next to "Untitled song" — "saved
  just now" / "not saved" — and make Ctrl+S do *something*, even if that something is a toast
  saying your work is kept automatically.

### F13 — The Arrangement is not persisted; my song was silently deleted by closing the tab
- **Expected:** having found no Save, I assumed (as the app's silence invited me to) that everything
  was kept. The canvas *was*.
- **Happened:** the canvas came back perfectly; the timeline came back as "An empty page." Track,
  clip and notes gone. Undo greyed out, so unrecoverable.
- **Seconds lost:** all of Task 4's work.
- **Recovered?** No.
- **Screenshot:** `.scratch\fh1\46-before-close-arrangement.png` vs
  `.scratch\fh1\50-reopened-arrangement.png`
- **Severity: S1 — blocked / data loss.**
- **Would have made it obvious:** persist the song with the canvas; failing that, a "you have unsaved
  song changes" prompt on tab close.

### F14 — The level meter turns red while the engine is degraded
- **Expected:** red on a level meter means I'm clipping — too loud.
- **Happened:** it went red at −14.8 dB, which is nowhere near clipping. It was signalling the plugin
  fault, not level. I turned my mental "am I too loud?" alarm on for no reason.
- **Seconds lost:** ~10.
- **Recovered?** Yes, once I connected it to the "Sound degraded" pill.
- **Screenshot:** `.scratch\fh1\07-chord-held.png`
- **Severity: S2.**
- **Would have made it obvious:** keep red for clipping; use the amber of the warning card for
  "degraded", or grey the meter out.

### F15 — Instrument node explains itself in engine jargon
- **Expected:** the Electric Piano node to say something about the sound.
- **Happened:** *"Playing. Note, octave and offset appear when a Keyboard node's row bundle
  arrives."* I don't know what a row bundle is and I never will.
- **Seconds lost:** ~5.
- **Recovered?** Ignored it.
- **Screenshot:** `.scratch\fh1\04-after-onboarding.png`
- **Severity: S4.**
- **Would have made it obvious:** "Playing — press a key" is the whole message.

### F16 — Toolbar warning chips truncate to "1…" and "T…"
- **Expected:** to be able to read a warning in the toolbar.
- **Happened:** two amber chips reading `⚠ 1…` and `⚠ T…`. Hovering them showed no tooltip; the only
  way I got the text was that one of them briefly rendered longer ("1 plugin ben…").
- **Seconds lost:** ~20.
- **Recovered?** Partly.
- **Screenshot:** `.scratch\fh1\33-looping.png`
- **Severity: S3.**
- **Would have made it obvious:** a tooltip on hover, or a single "2 issues" chip that opens a list.

---

## Three delights

1. **Onboarding builds you a working instrument, not a tour.** Three cards and ~20 seconds later I
   had Keys → Electric Piano → Delay → Speaker already cabled and already live. No "start audio"
   button, no empty canvas staring at me, no MIDI setup. That is genuinely better than GarageBand's
   template picker, which gives you a track but not a sound.
2. **The Keys node is a picture of my own keyboard with the notes written on it.** A = C4, G = E4,
   K = G4, three rows, SPACE = hold pedal. I played a chord one second after deciding to, with zero
   instruction, and the keys lit up as I held them. Nothing else I've used makes "which key is which
   note" a non-question.
3. **The honesty of the status pill.** Hovering it reads *"Sound ready. Audio engine is calm and
   ready — nothing to report. Latency: browser engine — an honest 15–25 ms."* An app that
   volunteers its own latency, and calls it "an honest 15–25 ms" rather than hiding it, made me
   trust the rest of what it told me. (Which is also why F11's "the audio engine did not
   acknowledge the transport command" stung — it spent that trust.)

---

## Time to first sound

**46 seconds.**

---

## What I could not assess

- **The actual sound.** I have no ears in this harness. Everything I call "sound" is inferred from
  the Speaker node's dB readout, the two level meters, the key highlights and the "Sound live /
  degraded" pill. The app is genuinely good about this: the meters are legible and the dB number is
  a real number, so "is it making sound" was never ambiguous *visually*. What I cannot say is whether
  the electric piano sounds good, whether the reverb is audible at 30% mix, whether the reported
  fault produced audible gaps, or whether there is latency I would have felt in my fingers.
- **Whether the reverb is actually processing.** I saw signal reach the Speaker through it. I could
  not hear a tail.
- **Which three pitches I drew.** The inline roll is too small to read back (F10).
- **Anything requiring a native file dialog.** I deliberately did not open "Open Project Folder…",
  so I cannot say whether project save/load exists behind it — only that nothing in the UI told me
  it was where saving lives.
- **Audio device / hardware paths.** Default output only, headless machine, no MIDI controller.

---

## With the docs in hand

*(Written after every task above was finished; `PRODUCT.md` and `DESIGN.md` read only at this point.
Nothing above has been softened or edited — where the docs proved me wrong, I say so here instead.)*

### Where I was wrong, and the product is right

- **F14 (red meter).** I called this a false alarm. It isn't. `DESIGN.md` §The Shell is explicit:
  "the meter is six `--accent-success` bars that turn `--accent-danger` **and latch on clip**." The
  meter was telling me the literal truth — my chord clipped, and the latch is deliberate so you
  can't miss it after the fact. The residual gap is narrow but real: the latched red sits directly
  next to a number reading **−14.8 dB**, so the two halves of the same widget appear to contradict
  each other. A tiny "CLIP" tag, or resetting the latch on click, would have taught me the rule in
  one glance instead of leaving me with a wrong theory for five minutes.
- **F11, half of it.** "Do be honest about state — **a transport glyph that waits for the engine**"
  is a stated Do. So a Play button that refuses to pretend is intended behaviour, and I should not
  have read the frozen glyph as a dead button. That half is right.

### Intended by the product — my friction is with the execution, not the idea

- **The onboarding (my delight #1).** "A novice is making sound in seconds" is Design Principle 2,
  and `DESIGN.md` specifies first run as "three questions over the **real studio**, blurred 5px and
  non-interactive — a sneak peek, not a picture." That is exactly what it felt like. Shipped intent,
  landed.
- **F1 / F3 (the persistent, non-dismissable fault card).** This is The Live Performance Rule
  executed in order: preserve the last good sound, report without stealing focus, let the performer
  choose when to recover. My sound never stopped and nothing modal grabbed me. I now read the card
  as a *report*, not a toast — which is why it has no ×. The genuine gap inside that intent is that
  the starter patch the app built for me goes non-finite on a plain three-note chord; the reporting
  worked, the thing being reported shouldn't exist.
- **F2 (DevLog behind "Details").** The same rule says "collect diagnostics **quietly, for after the
  show**". The DevLog is that artefact. The gap is only the routing: on a user's first five minutes,
  "Details" hands them the after-the-show forensics with no human sentence in between.
- **F5 (no "Reverb" in the Add menu).** Design Principle 3 — "when in doubt, it is a plugin" — plus
  a core that "ships small". A generic Effect node whose type is a parameter is that belief made
  visible. The fix is presentation (name the four types in the menu, or give the menu search), not
  architecture.
- **F10 (tiny inline piano roll).** "The arrangement and piano roll are **one document surface**" is
  the stated timeline model, and editing in place rather than in a modal is the right instinct for
  "the performer's focus is sacred". At the default lane height it is ~6 px per semitone, which
  defeats the intent on a trackpad. Execution gap inside a good idea.
- **Port colour.** Every cable I dragged was teal and every audio port was teal. The legend held
  exactly as `DESIGN.md` promises — I learned it without being told, which is the point.

### Genuine gaps the docs do not excuse

- **F11 (the transport never starts) — S1.** The honest-waiting glyph is intent; an engine that
  never acknowledges is not. `PRODUCT.md`'s job-to-be-done is "make music by patching a graph, and
  keep it alive **and editable while it plays**", and decision-framework question 4 is "is it honest
  about its own state?" A chip reading "the audio engine did not acknowledge the transport command"
  when the actual cause is an unbound track ref is honest about the *symptom* and silent about the
  *cause*. The track header already has a "Choose instrument for Track 1 ⌄" control; nothing pointed
  me at it, before or after.
- **F12 + F13 (no save, and the song is not persisted) — S1.** Neither document proposes that the
  canvas is durable while the arrangement is disposable. It runs straight into the anti-reference
  **"A wall — no dead end, no moment where the interface says you can't go further than this"**, and
  into "Do be honest about state": an app with no save affordance and no saved-state indicator is
  making a promise it does not keep. Losing a clip to a tab close is the session-scale version of
  the dropout the whole project is organised against.
- **Ctrl+K was never discoverable from the screen.** `PRODUCT.md` calls Ctrl+K-reachable everything
  "first-class and non-negotiable", and the whole product summary names "a Ctrl+K command bar". In
  ~9 minutes across both surfaces, three menus, Settings and the help button, **nothing on screen
  ever said the words Ctrl+K.** I found `Tab`, `space`, `alt+T` and a `?` button. The single most
  load-bearing affordance in the product is invisible to a first-time user.
- **F8 / F9 (the empty-state card).** "Draw a clip" arms a tool instead of drawing a clip, and the
  three named ghost tracks (chords / bass / lead) are deleted by the first real action. `DESIGN.md`
  retired the sketchbook precisely because charm that costs a beat of "wait, what happened" is not
  worth it; this card costs that beat twice.
- **F4 / F6 / F7 (canvas affordances).** No double-click to add, a new node spawning on top of an
  existing one, and an output cable being silently replaced rather than fanning out. These are
  ordinary polish gaps against Design Principle 4 ("a node that resizes under the cursor mid-set
  says nobody was paying attention") and Principle 5 ("cables carry signal" — a cable that vanishes
  without a word breaks the model it teaches).
- **F15 ("row bundle").** `PRODUCT.md`: "The voice is a maker's, not a SaaS dashboard's: plain,
  specific, encouraging, never breezy or **jargon-heavy**." This is a developer string that escaped
  the voice, sitting on the most-looked-at node in the starter patch.
- **F16 (chips truncated to "1…" and "T…").** `DESIGN.md` specifies the Chip at 13px/600 with a
  count slot; it does not sanction a chip that clips its own message to one character with no
  tooltip. On a dim stage that is an unreadable warning.
