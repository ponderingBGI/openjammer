# Product

## Register

product

## Users

Musicians who perform **live** — and the overlap the project is built for: "musicians who
code and coders who make music." A bedroom producer patching a quick loop, a laptop
performer on a dark stage with no second take, a sound designer wiring a generative rig,
a developer authoring a new DSP node. They arrive with a mental model from the
instruments they already love — a modular synth's signal flow, a guitar pedalboard's
chain, ComfyUI's nodes and cables — and they want to *play*, not configure.

Their context is unforgiving: a finger moves and a sound must arrive inside the window
of human perception, sometimes in front of an audience, sometimes offline with no Wi-Fi
to lean on. The job to be done is **make music by patching a graph, and keep it alive
and editable while it plays** — start in seconds, go as deep as the idea demands, never
hit a ceiling.

## Product Purpose

OpenJammer is a node-driven instrument for live music: a minimal, real-time-safe Rust
core (`ojcore`) that compiles to a native desktop app (lowest latency, plugin hosting)
and a zero-install browser PWA, driven by one React control plane with a Ctrl+K command
bar and a Pi AI agent.

It exists because an instrument is judged by how it *feels*, and most software is not
built to protect feel. Success looks like a performer who, mid-set, forgets they are
using software — the latency disappears, nothing glitches, and editing the patch never
drops a sample. And it looks like a novice who opens it and is making sound in seconds,
then discovers — months later — that there was never a wall: they can drop *into* a node
and rewire its insides, author a new one, or reskin the whole instrument, and it still
feels like the same trustworthy thing.

### The guiding star

**Build the set on the canvas. Bind it to your hands. Play without looking.** The node
canvas is the primary interface — the place the player spends most of their time, and the
thing that makes OpenJammer feel like you can build anything. Each node is a simple,
intuitive block; the set is what you make by putting them together, as simple or as deep
as the idea demands, with your own plugins, instruments, samples and loops. Before a show
the set is crafted with care; on stage it is played from hardware: any control and any
verb binds to a MIDI knob, pad or button in one gesture, the way Ableton's Ctrl+M does, so
the performer never has to look at a monitor again. That holds for a band routed live
through one machine with a chain per instrument, for a solo act with loops and samples,
and for recording — Record is on a pad, and you are just in the moment. Every design
decision below serves this. Where two options compete, the one that keeps eyes off the
screen and hands on the music wins.

## Brand Personality

**A real instrument.** Three words, unchanged: crafted, immediate, deep.

The aesthetic is a well-made piece of hardware you would be happy to put on a table
in front of a room: a calm warm-neutral ground, hairline edges, soft layered depth, and
saturated colour spent *only* on signal, state and selection. Nothing is decorative —
every surface is either something you play or something that tells you the truth about
what is playing. It is deliberately not pro-audio chrome and deliberately not a
dashboard; it is an object with weight. Buttons compress, knobs resist, keys spring
back, and the only things that glow are the things carrying live audio — cables and
meters. The warmth that used to live in a handwritten line now lives in **motion,
physics, and sound-reactive light**, which is where a performer actually feels it.

The voice is a maker's, not a SaaS dashboard's: plain, specific, encouraging, never
breezy or jargon-heavy. The feeling to evoke is **quiet confidence and play** — a calm,
legible instrument that invites a beginner to mess around and rewards an expert who goes
spelunking. Joy is never decoration here; on a live instrument every flourish must also
be clear, and anything that costs the performer a beat of "wait, what is happening" is
cut, however pretty.

The full visual system — tokens, components, named rules, accessibility floors — is
[DESIGN.md](DESIGN.md).

## Anti-references

OpenJammer is an **instrument, not a dashboard.** It should explicitly NOT look or feel
like:

- **A generic SaaS dashboard** — flat corporate cards, hero-metric tiles, cool-grey
  chrome. Calm is not the same as corporate: our ground is warm and our signal is loud.
- **Sterile pro-DAW chrome** — the dense, joyless grey of Ableton / Logic / Pro Tools,
  engineer-first and intimidating on stage.
- **A toy** — cute, gamified, unserious. This must read as *crafted and trustworthy*,
  something you'd stake a performance on, not a kids' app.
- **A sci-fi / AI-tool cliché** — glowing gradients, glassmorphism, neon-on-black as the
  baseline. Glow is reserved for live signal; anything else that glows is a bug.
- **The cream sketchbook we retired.** The hand-drawn "Living Sketchbook" — Caveat in
  functional UI, 2px ink outlines, hard blur-free offset shadows, cream paper — was a
  real identity and it is now a deliberate **non-goal**. It made a beginner smile and it
  made an expert squint: a display face on exact values, 14px floors to keep a script
  legible, and outlines heavy enough to shout over the patch. Charm is not worth a
  misread number on stage. Do not reintroduce any of it, including "just for empty
  states."
- **A wall.** No dead end, no "pro version," no moment where the interface says *you
  can't go further than this.* If a beginner can be overwhelmed by depth shown too early,
  that is also a failure — the depth must be *there* but not *in the way*.

## Design Principles

The two beliefs the whole project rests on — *perception is the medium* and *a minimal
core made infinite by everyone* — are stated in full in the working covenant
([agents.md](agents.md)). Here is how they, and the
craft underneath them, become design decisions:

1. **Perception is the medium.** Felt latency and a glitch-free signal are the bar, not a
   metric on a spec sheet. The interface exists to protect the moment between a finger
   moving and a sound arriving; editing never costs a sample.
2. **Shallow to start, infinitely deep.** Progressive disclosure with no ceiling. A novice
   is making sound in seconds and is never overwhelmed; the expert presses to go *inside* a
   node and rewire its guts, authors new ones, and is never limited. Use a node as-is, or
   open it up — same instrument, more depth.
3. **Minimal core, made yours.** The instrument ships small and perfect, then the community
   and every user extend it — nodes, effects, AI-authored DSP, themes — until it is *their*
   instrument. When in doubt, it is a plugin. The node system and plugin boundary are also
   how the project **evolves in public**: anyone can ship a node and let real use, not
   opinion, decide whether it belongs. Even accessibility is extensible (build the theme
   you need with the Pi agent).
4. **Care is the work.** The quality of what ships is the quality of attention, made
   audible. A one-sample click, 5ms of needless jitter, a node that resizes under the
   cursor mid-set — each says nobody was paying attention. Detail is a promise to a pair of
   hands trusting you in front of a room. So the tool *disappears into the play*: consistent
   affordances, a node grammar the hand learns once, strangeness only where it has a purpose
   (weight and sound-reactive light are the purpose; gratuitous flourish is not).
5. **Match the musician's mental model.** Our users are patchers and players, not compiler
   engineers. The interface works the way they already think — cables carry signal, a node
   is a box that does one thing, the graph *is* the patch (modular synth / pedalboard /
   ComfyUI). They never need to know there is a topological sort underneath, and port color
   is the legend they learn in seconds.
6. **The performer's focus is sacred.** On stage attention is the scarcest thing in the
   room. Keyboard- and Ctrl+K-reachable everything, no modal interruptions mid-set, ghost
   mode to clear the chrome, nothing animating slowly enough to delay an action.
7. **Study the instruments first.** Before designing, become a student of the instruments
   people already love — Teenage Engineering, Buchla/Moog, Ableton's "you never wait,"
   Max/MSP and Pure Data, ComfyUI's node graph — and watch real players under pressure, in
   bad light, with cold hands, when the change has to happen *now*. Research before pixels.

### The Live Performance Rule

When something goes wrong *during a set*, a held but believable sound is almost always
better than an honest stutter. When adding any reliability or recovery behavior, prefer,
in order: (1) **preserve the last good sound** — a held note over a glitch; (2) **report
the problem without stealing focus** — a quiet signal, never a modal that hijacks the
moment; (3) **collect diagnostics** quietly, for after the show; (4) **let the performer
choose when to recover.** Only automate visible recovery when the instrument is already
silent. The audience hears the result, not the intention — protect the result.

### The decision framework

Before any design change to the instrument ships, ask:

1. Did I study how the great instruments solved this before I designed it?
2. Does every element on this node earn its place?
3. Does this feel instant under the hand — zero felt delay between gesture and sound?
4. Is it honest about its own state (latency, failure, uncertainty)?
5. Can it be played on a dim stage, on a plain laptop, offline, by cold hands?
6. Would I be proud to put this in the hands of a musician I respect, in front of a room?

## Accessibility & Inclusion

The core guarantees the things a performer cannot build for themselves in the moment:

- **Keyboard- and Ctrl+K-reachable everything.** The instrument is fully drivable without
  the mouse — hands stay near the music, not hunting through menus. This is first-class
  and non-negotiable. There is exactly **one focus ring** (`--focus-ring`) so a
  keyboard-only player never has to learn a second visual language.
- **Reduced motion is honored.** One blanket `prefers-reduced-motion` rule covers the
  whole app; the only exemptions are the cable and the meter, because those are
  *instruments reading out live signal*, not decoration. No meaning is ever carried by
  motion alone.
- **Legible floors, enforced in CI.** Both shipped themes (Light and Dark) are asserted
  against the WCAG bars by a real test over the token files — body text ≥4.5:1, non-text
  boundaries ≥3:1 — so the out-of-box instrument reads in a real room, including low
  light and on a projector. UI text never goes below 13px, and exact values are always
  monospace. The measured table and the exact floors live in
  [DESIGN.md](DESIGN.md#accessibility-floors).

Beyond that baseline, accessibility is **extensible by design**, the same belief as the
rest of the instrument: the theme system is pure CSS variables, so any user (with the Pi
AI agent's help, no forking) can build the exact contrast, scale, or palette they need —
a high-contrast theme, a larger-type theme, a color-blind-safe port scheme. The core
stays minimal; the edges make it fit anyone.
