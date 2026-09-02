# FH-4 — usability log

**Persona:** developer who makes music on weekends. TypeScript + Rust daily, Max/MSP and VCV Rack
on Sundays. Never seen OpenJammer. Ran the frozen production build at `http://localhost:5248`
(bun build → `vite preview --port 5248`), Chromium 1440×900, fresh profile, first launch.
Session 07:55–08:06 UTC, 2026-09-02. No repo, no README, no docs until the end of the log.
Screenshots: `.scratch/fh4/NN-*.png`.

---

## First impression

Three setup cards, then it plays. That is the whole first impression and it is a strong one: I
answered "Years of it / Design a sound / Light" and the app wired a five-node rig — Keys → Pad 2
→ Filter → Pan → Width → Speaker — and started it, no "click here to begin". Coming from VCV
Rack I read the canvas instantly: dot grid, faceplate nodes, teal cables, ports labelled IN/OUT.
The header is honest in a way I have not seen in a music web app: a green "Sound live" pill, a
"116 ms" chip next to it, and a tooltip that literally says "browser engine — an honest
15–25 ms". I trusted the thing within ten seconds. The one thing that undercut it immediately:
the auto-built rig lands with the Effect node overlapping Pad 2, so my first act on a brand new
patch was to wonder whether something had gone wrong. And no affordance anywhere says "right
click to add a node" — I only knew because Max and VCV taught me. A person without that muscle
memory is looking at a beautiful patch they cannot extend.

---

## Task 1 — how do I write my own node?

**Time:** 07:56:42 → 07:58:42, ~2 min of directed search (plus ~20 s of palette probing after).
**Outcome: BLOCKED.** The app never tells you. Nothing opens.

Path:
1. File menu → New Project / Open Project Folder / New Canvas / Import+Export Workflow. Nothing.
   (`05-file-menu.png`)
2. Edit menu (undo/redo/delete), View menu (zoom, Ghost Mode, Pause loopers, Help). Nothing.
   (`06`, `07`)
3. Settings → tabs are Appearance / Audio / Keybindings / Updates / About. No "Plugins", no
   "Developer", no "Create node". About offers exactly two links: "View on GitHub" and
   "Releases". (`08`, `09-settings-about.png`)
4. Right-click the canvas → "Add node" with six families. Utility contains **"Add Empty Node"** —
   my best guess at "author your own". (`11`, `12`)
5. Added it. It is a node with In 1 / In 2 / Input / Out / Output and an "Open  E" button.
   Opening it pushes a breadcrumb `main > Empty Node` and shows two panels, **Inputs** and
   **Outputs**, each with "+ Add input / + Add output". (`13`, `14`)
6. So: "your own node" in-app means a **subpatch** — a Max `p` object / VCV-ish container you
   fill with existing nodes. Useful, and I'd use it. But it is not a custom DSP node and nothing
   on screen ever says the words "custom node", "DSP", "plugin SDK", "manifest" or "docs".
7. Ctrl+K searched for `custom`, `dsp`, `docs`, `write` — no authoring command exists
   (and the fuzzy matcher answered "custom" with **Add Subtract**). (`18`)

Verdict: as a Rust dev who came specifically to write a node, the app gave me a container, not a
door. The only pointer to anything written down is a bare GitHub repo link buried in
Settings → About.

## Task 2 — install or load a plugin

**Time:** 07:58:42 → 07:59:11, ~30 s. **Outcome: DONE (honest negative).**

Path:
1. Ctrl+K → typed `plugin` → "Plugins  Ctrl+Shift+P" was the top hit.
2. Ctrl+Shift+P opens a panel titled **"Browser"** with Search / All · Built-in · Installed /
   family chips, listing 28 built-ins. (`20`)
3. Footer, always visible: **"This build doesn't host plugins — built-ins only."** That is the
   answer and it is the right kind of honest — no fake "Scan VST3 folder" button that would
   never work. (`20`)
4. "Installed" tab → empty, and "Re-scan" → nothing observable happens. (`21`, `22`)

I got a clean, truthful "this tier cannot" in under a minute. Two rough edges below.

## Task 3 — get the AI agent to build keyboard → pluck → delay → speakers

**Time:** 07:59:11 → 07:59:58, ~45 s. **Outcome: BLOCKED by tier — but exemplary messaging.**

Path:
1. The keyboard-help panel had told me `Ctrl+K  Ask the AI`, so I opened Ctrl+K and typed the
   sentence verbatim: *"a keyboard playing a pluck through a delay into the speakers"*.
2. Result: **"No command for that — Try a node name — Speaker, Looper, Effect."** So Ctrl+K is a
   command palette, not an agent prompt, despite what the help said. (`24`)
3. Footer of the palette (small, grey, easy to miss): *"The agent runs in the desktop app."*
4. Palette has an AI group with one entry, "Configure AI provider". Ran it. It opens **"Ask the
   agent"**: *"AI requires the desktop app. The agent runs locally in the OpenJammer desktop app,
   which drives Pi with your own provider key — nothing about your session leaves your machine.
   The browser tier has no place to run it."* + [Get the desktop app] [Back to search]. (`26`)
5. "Get the desktop app" opens `/download`: Windows/macOS/Linux installers, "under 5 ms
   MIDI-to-audio (native desktop)" vs "~15–25 ms" in the browser. (`28`)

**Exactly what it asked for, and how clear:** the desktop app, plus *your own provider key*. No
sign-up, no OpenJammer account, no key field dangled at me that would then fail. It states where
the agent runs, what drives it (Pi), and that nothing leaves the machine. This is the clearest
"you can't do this here" I have hit in any app this year. I could not observe live graph edits or
undo of agent edits — not assessable on this tier.

## Task 4 — Ctrl+K: add a node, connect it, toggle the theme

**Time:** 07:59:58 → 08:01:16, ~1 min 20 s. **Outcome: DONE (2 of 3 via Ctrl+K).**

**When/how I learned Ctrl+K exists:** 07:58, ~2.5 minutes in, from the floating **"?"** button in
the bottom-right corner → keyboard-help panel, last line: `Ctrl+K  Ask the AI` (`16`). Nothing
before that mentioned it — not the onboarding, not any menu, not a first-run hint. And the one
line that does mention it describes it as the AI, which is wrong on this tier.

Path:
1. Ctrl+K → `Effect` → Enter. An Effect (Distortion) node appears — **stacked exactly on top of
   the existing Effect node**; for a second I thought nothing had happened. (`31`)
2. Dragged it by its title bar into free space; drag is smooth and it stays selected. (`32`)
3. Dragged a cable from Pad 2's OUT port to the new Effect's IN port: worked first try, teal
   audio cable, fan-out from an already-connected output accepted without complaint. (`35`)
4. Theme: searched the palette for `theme` and `dark` — **no theme command exists**. `theme`
   returns "Open Settings" (right answer by accident), `dark` returns "Add Keyboard". (`36`)
5. Fell back to the moon icon in the header. Instant, clean dark theme, cables and meters still
   legible. (`38`)

## Task 5 — latency / engine state / which tier am I on

**Time:** 08:01:16 → 08:01:41, ~25 s. **Outcome: DONE — the best part of the app.**

Path:
1. Header, always visible: green **"Sound live"** pill; its tooltip reads *"Audio engine is up and
   making sound — audio engine initialized. Latency: browser engine — an honest 15–25 ms."*
2. Next to it a **"116 ms"** chip. Clicked it → warning card: *"High audio latency — Audio latency
   is 116 ms – too high for live playing"* with [Fix now] [Ask AI] [Dismiss]. (`40`)
3. Ctrl+Shift+H → **Audio health**: "Running, but the delay is audible", "116 ms round-trip is too
   much to play against", then a diagnostics list — engine running / round-trip **116 ms (bad)** /
   48000 Hz / system default device / **cross-origin isolation on (low-latency path)** / version.
   Footer: [Open Settings] [Ask AI to fix]. (`42`)
4. Settings → Audio repeats it as a status strip: `116 ms · Too much delay for live playing ·
   **Browser** · 48.0 kHz`, then a "How to go faster" list (low-latency toggle, wired not
   Bluetooth, close other audio apps, USB interface). (`09-settings-audio.png`)

Honest and understandable: it names the tier ("Browser"), gives a measured number not a marketing
one, grades it ("bad", "too high for live playing"), and tells me what to do. The word "honest" in
the tooltip is doing a lot of work though — see friction 5.

## Task 6 — keyboard shortcuts reference, and do three of them work

**Time:** 08:01:41 → ~08:05. **Outcome: DONE — 3 of 4 verified, 1 documented shortcut is dead.**

Path:
1. Two references exist: the "?" panel (12 essentials) and **Settings → Keybindings** — *"Every
   shortcut in OpenJammer, grouped by the surface it plays on"*, **169 shown**, filterable by
   surface (Global / Canvas / Arrangement / Piano roll), searchable, and **every binding is
   click-to-rebind** with a Reset All. This is a real reference, not a cheat sheet. (`44`)
2. **Ctrl+D — Duplicate Nodes: WORKS.** Selected the Distortion node, Ctrl+D, a second one
   appeared offset. (`46`)
3. **Tab — Toggle Arrangement: WORKS.** Switched to the timeline; empty state reads "An empty
   page. Start a sketch, or ask the agent to dream one up. Ctrl+Z undoes anything." Tab again
   returned to the canvas. (`54`)
4. **Ctrl+Z — Undo: WORKS, and granularly.** First press removed the duplicate node, second press
   removed the cable I had drawn. (`56`, `57`)
5. **W — Toggle Ghost Mode: DOES NOT WORK.** Clicked empty canvas, pressed `w` — nothing. Pressed
   it again, and Shift+W — nothing. Toggled Ghost Mode from the View menu instead and the effect
   is dramatic and obvious (everything dims to near-black, only the live signal cables stay
   teal), so this is not "a subtle change I missed": the key is simply not firing while a Keys
   node owns the QWERTY row (`w` = C#5). (`48` vs `50`, `51`)

---

## Friction

**1 — The app never explains how to author a node. (S1 for my goal)**
*Expected:* a Help entry, a "Create node…" command, or a docs link — anything that opens.
*Happened:* File/Edit/View, all five Settings tabs, the right-click menu and the full Ctrl+K
command list contain no authoring affordance and no documentation link except a bare "View on
GitHub" repo URL in Settings → About. "Add Empty Node" gives a subpatch container, which is a
different thing and is never labelled as related.
*Seconds lost:* ~120 · *Recovered?* No · `05`–`14`, `18` · **S1**
*What would have made it obvious:* one item in the View/Help menu — "Creating nodes →" — opening
the node-authoring doc, and a line inside the opened Empty Node saying "this is a subpatch; to
write DSP in code, see Creating nodes".

**2 — "Ctrl+K Ask the AI" is false on the browser tier. (S2)**
*Expected:* after the help panel said `Ctrl+K  Ask the AI`, typing a sentence would reach an
agent, or at least tell me it can't right there.
*Happened:* the palette answered "No command for that — Try a node name". I had to notice a 10px
grey footer, then guess that "Configure AI provider" was the way to the real explanation.
*Seconds lost:* ~40 · *Recovered?* Yes · `16`, `24`, `26` · **S2**
*What would have made it obvious:* when the query looks like a sentence and no command matches,
show the "AI requires the desktop app" card *in place of* the "No command for that" state — and
label the help line `Ctrl+K  Command bar` on this tier.

**3 — Nodes spawn on top of each other. (S3)**
*Expected:* a new node lands in free space, or where I right-clicked.
*Happened:* both the onboarding rig (Effect overlapping Pad 2) and my Ctrl+K "Add Effect" (new
Effect exactly over the old one) produced stacks. On a fresh canvas the very first thing I saw
was two overlapping faceplates.
*Seconds lost:* ~25 · *Recovered?* Yes, by dragging · `04`, `31`, `32` · **S3**
*What would have made it obvious:* spawn at the last cursor position with simple collision
avoidance, and flash the new node's outline for a beat.

**4 — Documented shortcut `W` (Ghost Mode) never fires. (S2)**
*Expected:* the "?" panel, the View menu and the 169-entry Keybindings reference all say `W`
toggles Ghost Mode, so `W` toggles Ghost Mode.
*Happened:* nothing, in either direction, with the canvas focused and no node selected. The menu
item works. My theory is the Keys node's QWERTY mapping (`W` = C#5) eats it, which means the
documented binding is a lie whenever a keyboard node exists — i.e. almost always.
*Seconds lost:* ~60 · *Recovered?* Yes, via the menu · `48`, `50`, `51` · **S2**
*What would have made it obvious:* either don't publish `W` while a keyboard node holds the row,
or grey it out in the reference with "held by Keys", or move it to `Alt+W`.

**5 — The latency tooltip promises 15–25 ms while the app measures 116 ms. (S3)**
*Expected:* one number, or one story.
*Happened:* the "Sound live" tooltip states "browser engine — an honest 15–25 ms" as a fact,
while the chip 20px away says 116 ms and Audio health grades it "(bad) — too much to play
against". The static claim reads as marketing sitting next to the measurement that contradicts
it, which slightly damages the credibility of an otherwise outstanding honesty story.
*Seconds lost:* ~20 · *Recovered?* Yes · `40`, `42` · **S3**
*What would have made it obvious:* make the tooltip say "browser engine — typically 15–25 ms;
**measured 116 ms on this machine**".

**6 — The Plugins panel's empty state answers a question I didn't ask. (S3)**
*Expected:* on the "Installed" tab of a build that cannot host plugins: "This build doesn't host
plugins" as the empty state.
*Happened:* "**Nothing matches that** — Try fewer letters, or clear the family and source
filters", with an empty search box and no filters set. For a moment I believed I had a stale
filter and started hunting for it. The truthful line is present, but relegated to the footer.
*Seconds lost:* ~20 · *Recovered?* Yes · `21` · **S3**

**7 — "Re-scan" gives no feedback whatsoever. (S3)**
*Expected:* a spinner, a toast, "scanned 0 folders", something.
*Happened:* clicking Re-scan changes nothing on screen. On a build that can't host plugins the
button arguably shouldn't be there at all; if it is, it must say what it did.
*Seconds lost:* ~15 · *Recovered?* Yes · `22` · **S3**

**8 — Ctrl+K's fuzzy matcher is too permissive to trust. (S3)**
*Expected:* no match, or a near match.
*Happened:* `custom` → "Add Subtract". `write` → "Add Winds". `dsp` → "Add Speaker", "Add
Sampler", "Quantize selected notes" and nine more. `dark` → "Add Keyboard". Because it always
returns *something*, a confident-looking wrong answer hides the fact that the feature I asked for
doesn't exist — which is exactly what happened to me in task 1.
*Seconds lost:* ~30 · *Recovered?* Partially · `18`, `36` · **S3**

**9 — No theme command in the command palette. (S3)**
*Expected:* a palette that shows "Open Settings", "Toggle Help", "Toggle DevLog", "Audio health",
"Plugins" and "New Project" also toggles the theme.
*Happened:* `theme` and `dark` return no theme command. The header moon icon is the only way (plus
Settings → Appearance). Small, but it's the single most-used toggle in a dark room.
*Seconds lost:* ~20 · *Recovered?* Yes · `36`, `38` · **S3**

**10 — Nothing ever teaches right-click, and Ctrl+K hides behind a "?" bubble. (S2)**
*Expected:* after a 3-step onboarding that builds a rig for me, one line telling me how to add to
it.
*Happened:* the two ways to add a node — right-click and Ctrl+K — are documented only inside the
keyboard-help panel, which is reachable only via an unlabelled "?" circle in the far bottom-right
corner or View → Help. I found them because Max/MSP and VCV Rack trained me to right-click empty
space. A Logic or Ableton user would not.
*Seconds lost:* 0 for me, likely minutes for anyone else · *Recovered?* n/a · `04`, `11`, `16` ·
**S2**
*Checked afterwards, to be fair to the app:* I had chosen the "Years of it" density, so I went
back and switched Settings → Appearance → Density to **"First time"**. It adds a coach line at
the bottom of the canvas — *"This rig is already making sound — drag a node, turn a knob, press
the keys. Nothing can break."* — which is lovely, but still never says **right-click** or
**Ctrl+K**. The friction survives at the friendliest setting. (`61`)

**11 — The Arrangement empty state invites me to use an agent I can't have. (S4)**
*Expected:* tier-aware copy.
*Happened:* "Start a sketch, or **ask the agent to dream one up**" on a tier whose own AI dialog
says the agent cannot run here.
*Seconds lost:* ~10 · *Recovered?* Yes · `54` · **S4**

**12 — Inside a subpatch, the "?" help button silently becomes "!". (S4)**
*Expected:* the help button stays the help button.
*Happened:* after opening the Empty Node, the bottom-right circle renders `!` with a warning-ish
ring while its accessible name is still "Show keyboard help". I read it as "something is wrong"
and went looking for a problem that didn't exist.
*Seconds lost:* ~15 · *Recovered?* Yes · `14` · **S4**

---

## Three delights

1. **The onboarding ends in sound, not in a blank page.** Three cards, and a working five-node
   rig is already running with the theme I picked. It even tells me the truth about what it did:
   Settings → Appearance says "Redo setup… Your current patch is left exactly as it is; the new
   rig lands beside it and Ctrl+Z removes it." Every product does onboarding; almost none of them
   hand you a *reversible* one.
2. **The honesty stack around latency.** A measured number in the header, a click that explains
   it in plain words, Ctrl+Shift+H for the diagnostics a developer actually wants (round-trip,
   sample rate, cross-origin isolation state), a "How to go faster" list in Settings, and a
   download page that says 15–25 ms browser / under 5 ms native. Nobody is being sold anything.
3. **Ghost Mode.** Toggling it dims the entire instrument to charcoal and leaves only the live
   signal path glowing teal. It is the single fastest "what is actually connected here" answer
   I've seen on a patching canvas — better than VCV's cable-tension trick. It deserves to be
   discoverable (see friction 4).

Honourable mention: the Keybindings tab. 169 shortcuts, grouped by surface, every one rebindable
in place. That is a rare amount of respect for the user's hands.

## What I could not assess

- **Anything about the AI agent's behaviour**: live graph edits, whether they land optimistically,
  whether Ctrl+Z reverses them, whether there is an approve/reject gate. The browser tier has no
  agent, so tasks 3's real content is untested.
- **VST3/CLAP hosting**, for the same reason — I confirmed only that this build says it can't.
- **Sound quality, latency-by-feel, clicks/dropouts.** Headless Chromium: I verified sound *flows*
  (key lights up, master meter moves, Speaker reads −8.4 dB) but I never heard a note.
- **The known engine bug** — I *did* hit its tail end, at 08:07, right after switching density.
  The header pill turned amber: **"Sound degraded — Something went wrong but your last good sound
  is still playing — engine reported a fault."** No modal, no toast, no focus stolen, the patch
  kept running and the latency chip quietly withdrew. As a bug it is real; as a *failure
  behaviour* it is the single most reassuring thing the app did all session, so I am logging it
  here rather than as friction. I could not judge whether sound actually survived (headless).
  (`61`)
- **Native tier** — no desktop app, so "under 5 ms", MIDI, and the agent are all unverified.
- **Collaborate, Recorder, Library, Sampler, MIDI, Song, the piano roll and most of the
  Arrangement** — out of scope for these six tasks.

---

## With the docs in hand

*Read after the log above was finalised: `PRODUCT.md`, `DESIGN.md`, `docs/agent-tools.md`,
`docs/creating-nodes.md`.*

### Intended, and I was wrong to complain

- **Friction 6/7 (the plugin panel) is the product working.** PRODUCT's honesty discipline and
  DESIGN's *"a failure that never hides behind a hopeful spinner"* are exactly what the footer
  line does. "Don't ever present a wall" is satisfied by the download page being one click away.
  My complaints about the empty-state copy and the silent Re-scan stand, but the *tier* answer is
  intended and well executed. Downgrade the substance; keep the two copy bugs.
- **Friction 5 (15–25 ms vs 116 ms) is half-intended.** DESIGN literally says *"the honest
  ~15–25ms browser tier never dressed up as sub-5ms"* — the phrase is a deliberate anti-marketing
  commitment, not filler. What is *not* intended is putting a tier claim and a contradicting
  device measurement 20px apart with no relationship between them. The fix is one sentence, not a
  retreat.
- **Task 3's dead end is intended and correctly built.** `docs/agent-tools.md` §"Auth resolves
  only WHO PAYS" describes exactly the AuthChooser I hit, and the desktop-only constraint is
  structural (Pi is a local subprocess). The dialog I praised is doing the designed job.
- **Friction 3 (overlap) and 8 (fuzzy matching)** are not addressed by any doc — they are plain
  gaps, but small ones.

### Gaps — the docs promise something the UI does not deliver

1. **Task 1 is the real gap, and it is bigger than I thought.** PRODUCT principle 2 promises a
   novice who *"discovers — months later — that there was never a wall: they can drop into a node
   and rewire its insides, **author a new one**, or reskin the whole instrument."* That is a
   headline promise. But `docs/creating-nodes.md` is a **contributor** document — its Quick Start
   Checklist is "add to the `NodeType` union in `src/engine/types.ts`", "add to `nodeDefinitions`
   in `src/engine/registry.ts`", "create `src/components/Nodes/[Name]Node.tsx`". That is cloning
   the repo, not using the instrument. The genuinely in-app authoring path is
   `author_code_node` (Faust source → validated `.wasm` + manifest) — which lives *only* inside
   the AI agent, is desktop-only, and whose wasm RT execution host is itself listed as
   founder-gated. So on the browser tier the promise "author a new one" resolves to: a subpatch
   container, or a GitHub link. The app never says which of those it means, and never links the
   guide it does have. **This is the one S1 and the docs confirm it rather than excuse it.**
2. **`Tab` is double-booked between the docs and the build.** `agent-tools.md` says the
   AuthChooser appears at *"Ctrl+K → 'Configure AI provider', or **the first Tab** when nothing is
   configured."* In this build `Tab` is bound to **Toggle Arrangement** and goes to the timeline —
   I used it as a shortcut test and it never offered me the agent. Whichever is right, the two
   disagree, and the shortcuts reference lists only the Arrangement binding.
3. **Ghost Mode's broken `W` matters more than I logged it.** The dim-everything-but-the-signal
   mode is described in the migration notes as **AI ghost mode** — it exists so you can watch what
   the agent is doing to your graph. Its keyboard entry point being swallowed by the Keys node
   means the feature designed to make agent edits legible is menu-only.
4. **Discoverability is not a documented concern anywhere.** PRODUCT guarantees "Keyboard- and
   Ctrl+K-reachable everything" — *reachability*, which is delivered (169 bindings, all
   rebindable). Nothing in PRODUCT or DESIGN takes responsibility for *teaching* the two ways to
   add a node. Principle 6 says "the performer's focus is sacred" and DESIGN's first-run is
   deliberately three questions and out. That is a coherent choice, but it leaves friction 10
   unowned: the instrument's front door is a right-click nobody mentions.

### Was "untrusted generator, reversible with Ctrl+Z, no approve gate" perceivable from the UI?

**No — and only partly for tier reasons.**

`agents-tools.md` states it as the project's central safety claim: *"The agent is an UNTRUSTED
GENERATOR, never a trusted runner… There is no Approve/Reject gate: every edit is recorded in the
graph's undo history, so the player reverts anything with plain Ctrl+Z (each edit its own step).
The worst an agent can do is the worst a user clicking around the canvas can do."*

What the browser tier actually let me perceive:

- **The reversibility half is voiced, twice, unprompted, in exactly the right register.** The
  Arrangement empty state: *"Start a sketch, or ask the agent to dream one up. **Ctrl+Z undoes
  anything.**"* And Settings → Appearance, about re-running onboarding: *"Your current patch is
  left exactly as it is; the new rig lands beside it and **Ctrl+Z removes it**."* Someone has
  clearly decided that "Ctrl+Z is the safety net" is a sentence this product says out loud, and
  I believed it — my own Ctrl+Z presses undid a duplicate and then a cable, one step each,
  proving the grammar the agent would ride on. That is genuinely good.
- **The "untrusted generator / no approve gate" half was invisible.** I never saw a chat, a verb
  log, an agent edit, or any statement about what the agent is *allowed* to do. Nothing told me
  the agent emits the same verbs I drive by hand, nothing told me there is deliberately no
  Approve/Reject step, and nothing told me the blast radius is bounded by my own undo history.
- **The one place the app does discuss agent trust, it uses a different axis entirely.** The "AI
  requires the desktop app" card explains *privacy* — "your own provider key… nothing about your
  session leaves your machine". Excellent copy, but it answers "who sees my data", not "what can
  this thing do to my patch". A cautious user's actual fear — *will it wreck the rig I'm about to
  play?* — is never addressed on this tier, even though the project has the best possible answer
  and it fits in one line.

**The concrete fix:** put the answer on the card I already read. Under the privacy sentence, add:
*"It only makes the same edits you can make by hand, live on the canvas — no approve step, and
Ctrl+Z undoes any of them, one at a time."* That single sentence would have made the whole story
perceivable at the exact moment I was deciding whether I wanted this thing near my patch — and it
costs nothing to show on a tier that cannot run the agent.
