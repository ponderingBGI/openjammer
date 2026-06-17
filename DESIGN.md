---
name: OpenJammer
description: A node-driven instrument for live music — a living sketchbook that makes sound.
colors:
  ink: "#1A1A1A"
  paper: "#F5F0E8"
  paper-panel: "#EDE8E0"
  node-white: "#FFFFFF"
  surface-sand: "#E8E3DA"
  ink-soft: "#4A4A4A"
  ink-muted: "#8A8A8A"
  border-subtle: "#D4CFC6"
  walnut: "#6B5B4F"
  pine: "#4A7C59"
  ochre: "#C68B3F"
  clay: "#A65353"
  audio-blue: "#4A90C2"
  audio-blue-in: "#7EB3D8"
  audio-blue-out: "#2C5F88"
  control-grey: "#808080"
  universal-violet: "#9B59B6"
typography:
  display:
    fontFamily: "Caveat, 'Comic Sans MS', cursive"
    fontSize: "36px"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "normal"
  title:
    fontFamily: "Caveat, 'Comic Sans MS', cursive"
    fontSize: "22px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "normal"
  body:
    fontFamily: "Caveat, 'Comic Sans MS', cursive"
    fontSize: "18px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  work:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  mono:
    fontFamily: "'JetBrains Mono', 'Fira Code', monospace"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: "normal"
rounded:
  sm: "6px"
  md: "10px"
  lg: "14px"
  xl: "20px"
  pill: "50px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
components:
  node:
    backgroundColor: "{colors.node-white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.node-white}"
    rounded: "{rounded.md}"
    padding: "4px 8px"
  button-primary-hover:
    backgroundColor: "{colors.walnut}"
    textColor: "{colors.node-white}"
  button-node:
    backgroundColor: "{colors.node-white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "4px 8px"
  input-field:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "4px 8px"
  port-audio:
    backgroundColor: "{colors.audio-blue}"
    rounded: "{rounded.pill}"
    size: "16px"
  port-control:
    backgroundColor: "{colors.control-grey}"
    rounded: "{rounded.pill}"
    size: "16px"
---

# Design System: OpenJammer

## 1. Overview

**Creative North Star: "The Living Sketchbook"**

OpenJammer looks like a sketchbook that makes sound. The canvas is warm paper printed
with a faint dot grid; nodes are hand-drawn boxes in Caveat's friendly line, bordered in
ink and lifted off the page by hard, blur-free shadows like stickers pressed onto a
notebook. It is deliberately *not* a piece of pro-audio equipment. Where Ableton and Logic
say "console," OpenJammer says "the back of a napkin where the idea actually happened" —
and then it plays that idea back without dropping a sample.

The system is **crafted, immediate, and deep**. Crafted: every node reads as drawn by a
hand that cared. Immediate: a beginner is making sound in seconds, the controls are big
and obvious, and the press of a button feels physical. Deep: there is no ceiling — the
same warm, drawn surface that welcomes a novice lets an expert drop *inside* a node and
rewire its guts. The aesthetic carries the product's two beliefs (see
[PRODUCT.md](PRODUCT.md)): perception is the medium, and a minimal core is made infinite
by everyone — including the look, which is pure CSS variables anyone can reskin.

Four disciplines hold it together. **Less, but better:** a node is read at a glance,
mid-performance, in peripheral vision — remove until only what the hand needs while
playing remains, and hide the rest until it is asked for. **Instant by default:** a felt
delay between gesture and sound is a design failure before it is a technical one; the UI
renders from what it already knows and applies graph edits optimistically. **Honest
interfaces:** show what is real, pending, and uncertain — metering that doesn't lie, the
honest `~15–25ms` browser tier never dressed up as sub-5ms. **Coherence over
consistency:** the hand-drawn language is a shared grammar, not a template stamped on every
node — force the same care everywhere, leave room for what each node needs.

This system explicitly rejects the **generic SaaS dashboard** (flat corporate cards,
cool-grey chrome, hero-metric tiles), **sterile pro-DAW chrome** (dense joyless grey),
the **toy** (cuteness that reads as unserious), and the **sci-fi / AI-tool cliché**
(glassmorphism, glowing gradients, neon-on-black as a baseline). The Cyberpunk theme
exists, but as a deliberate opt-in costume — never the resting posture.

**Key Characteristics:**
- Warm dot-grid paper canvas; nodes are hand-drawn ink boxes on white.
- Caveat (hand-drawn) is the *voice*; Inter does the dense work; JetBrains Mono means "exact."
- Hard, blur-free offset shadows — stickers on paper, never soft ambient glow.
- 2px ink borders and generously rounded corners (6–20px) on everything.
- Port color is meaning: audio is blue, control is grey, universal is violet.
- Three themes (Cream default, Cyberpunk, Midnight Blue) re-map the same token roles.

## 2. Colors

A warm, low-tech palette: paper and ink as the ground, earthy accents for state, and a
clear blue/grey split that turns the wiring itself into a legend.

### Primary
- **Ink** (#1A1A1A): The drawn line. Every node border, every hand-drawn stroke, the
  default text color, and — in the Cream theme — the primary action color itself. Ink is
  the pen the whole instrument is sketched with.
- **Paper** (#F5F0E8): The warm sketchbook ground. The canvas, the app background, and the
  fill of input fields. Not a generic cream-by-default; it is the page the instrument is
  drawn on, carried by the dot grid printed over it.

### Secondary
- **Walnut** (#6B5B4F): The warm secondary accent. Primary-button hover, secondary
  emphasis — a woody step away from pure ink that keeps the warmth.

### Tertiary (semantic state)
- **Pine** (#4A7C59): Success, "armed," active record/play states.
- **Ochre** (#C68B3F): Warning, caution, the honest-latency amber.
- **Clay** (#A65353): Danger, destructive actions, errors.

### Neutral
- **Node White** (#FFFFFF): The fill of a node — a fresh card laid on the paper.
- **Paper Panel** (#EDE8E0): Node headers, alternate canvas shade, panel grounds.
- **Surface Sand** (#E8E3DA): Tertiary surfaces, pressed/hover fills, progress tracks.
- **Ink Soft** (#4A4A4A): Secondary text, secondary sketch lines.
- **Ink Muted** (#8A8A8A): Muted text, node type labels, the faintest sketch lines.
- **Border Subtle** (#D4CFC6): Hairline dividers inside nodes and panels.

### Wiring (functional color — the legend)
- **Audio Blue** (#4A90C2, in #7EB3D8 / out #2C5F88): Everything that carries *sound*.
  Audio ports and audio cables. Brightens and glows when connected.
- **Control Grey** (#808080): Everything that carries *numbers and triggers* — control
  ports and control cables. Deliberately desaturated so sound reads as the signal that matters.
- **Universal Violet** (#9B59B6): Ports that adapt to whatever they connect to (rendered
  as a rainbow gradient until typed).

### Named Rules
**The Port-Color-Is-Meaning Rule.** Port and cable color is never decoration. Blue means
audio, grey means control, violet means universal — the type is the source of truth and the
color follows from it. A performer learns the whole wiring legend in seconds; do not spend
these colors on anything that isn't a port or a cable.

**The Signal-Not-Brand Rule.** Pine/ochre/clay report machine state (success/warning/danger)
and always travel with a label or icon. Ink and walnut are the brand. Never style a heading
or a surface in a state color.

## 3. Typography

**Display / Voice Font:** Caveat (with 'Comic Sans MS', cursive fallback)
**Work / Data Font:** Inter (with system-ui fallback)
**Exact / Mono Font:** JetBrains Mono (with Fira Code fallback)

**Character:** A hand-drawn script carries the instrument's voice — node titles, labels,
buttons, even body copy — so the whole surface feels sketched, not shipped. A neutral sans
(Inter) does the unglamorous dense work, and a monospace appears only where digits must be
read or typed exactly. Three faces, three jobs. Because Caveat runs small, the entire type
scale is bumped up (the smallest UI text is 14px, not 11px) so the hand-drawn line stays
effortlessly legible.

### Hierarchy
- **Display** (Caveat 700, 36px, lh 1.1): The largest sketch headings — section titles,
  big moments.
- **Title** (Caveat 600, 22px, lh 1.2): Node titles, panel headings. The most common large
  text on the canvas.
- **Body** (Caveat 400–600, 18px, lh 1.5): The default UI voice — labels, descriptions,
  menu items. Deliberately the hand-drawn face, deliberately large.
- **Work** (Inter 400–600, 16px): Dense settings panels, forms, data-heavy surfaces where
  Caveat would slow scanning.
- **Mono** (JetBrains Mono, 16px): Exact numeric values inside node inputs — anything meant
  to be read, typed, or compared digit by digit.

### Named Rules
**The Caveat-Is-the-Voice Rule.** The hand-drawn face is the identity; it is allowed in UI
labels and buttons here precisely because the sketchbook *is* the product. This breaks the
usual product-UI convention on purpose. It is earned, not gratuitous — but it is the only
display font allowed, and it never sets exact data.

**The Mono-Means-Exact Rule.** If a value is monospace, it can be copied, typed, or compared
character by character. Never use mono for emphasis or decoration.

## 4. Elevation

The system is flat paper with hard, blur-free shadows — the look of a sticker or a cutout
pressed onto a page, not soft ambient depth. Every shadow is an *offset of solid color with
zero blur radius*. This is the single most identity-defining detail after the hand-drawn
line: the instant a shadow gains a blur, it stops being a sketchbook and starts being a
2014 web app.

### Shadow Vocabulary
- **Node rest** (`box-shadow: 2px 3px 0 rgba(0,0,0,0.1)`): The default lift of a node off the paper.
- **Menu / lifted** (`box-shadow: 3px 4px 0 rgba(0,0,0,0.15)`): Context menus, dragging nodes, raised surfaces.
- **Sketch / button** (`box-shadow: 2px 2px 0 var(--sketch-black)`): Inked buttons and cards — a hard ink shadow in the line color itself.

### Named Rules
**The Hard-Shadow Rule.** Shadows never blur. `box-shadow` blur radius is always `0`. Depth
is an offset, not a glow. A blurred shadow anywhere in this system is a bug.

**The Press-Is-Physical Rule.** Interactive elements lift on hover (`translateY(-1px` to
`-2px)` with a larger offset shadow) and depress on click (`translateY(1px)` with a smaller
shadow). The shadow grows and shrinks with the motion so the control feels like a real
object being pressed.

**The No-Surprise Rule.** A control never moves, resizes, or reflows on hover or press —
feedback is color, border, opacity, and at most a 4px transform. Motion communicates a
state change (what connected, what disappeared, where a node went); it never entertains. On
a performance surface, a node that jumps is a node that gets mis-clicked.

## 5. Components

### The Node (signature component)
- **Shape:** A white card with a 2px ink border and a 14px radius (`--radius-lg`), lifted by
  the hard node-rest shadow.
- **Header:** A `paper-panel` strip with a Caveat title and a muted type label, a subtle
  bottom hairline (`--border-subtle`), and a `grab` cursor — the whole node is draggable from here.
- **Selected:** Border switches to the accent color plus a soft accent ring
  (`0 0 0 3px` color-mixed accent at 25%). **Dragging:** opacity 0.95 and the heavier lifted shadow.
- **Going deeper:** A node can be used as-is or opened (press `e`) to reveal and rewire its
  internal graph. The surface treatment stays identical at every depth — same paper, same
  ink — so depth never feels like a different app.

### Buttons
- **Shape:** 2px ink border, 10px radius (`--radius-md`), Caveat label.
- **Primary:** Ink fill, white text; hover shifts to walnut. **Node button (default):**
  white fill, ink text; hover fills with `surface-sand`.
- **Hover / Active:** Hover lifts (`translateY(-1px)`); active presses (`translateY(1px)`).
  Large buttons (e.g. the audio-activate CTA) also grow/shrink their hard shadow on the press.
- **Semantic variants:** success = pine, danger = clay, active = pine — all with white text.

### Inputs / Fields
- **Style:** `paper` (or canvas) fill, 2px ink border, 6px radius (`--radius-sm`).
- **Numeric inputs use JetBrains Mono** (the Mono-Means-Exact Rule); text inputs use Inter.
- **Focus:** Border color shifts to the accent; no glow, no blurred ring — consistent with
  the Hard-Shadow Rule. A global `:focus-visible` adds a 2px accent outline at 2px offset for
  keyboard users.

### Ports (signature component)
- **Style:** 16px circle, 2px ink border, filled by wiring color — audio-blue or control-grey.
  `crosshair` cursor. Hover scales to 1.25×.
- **Connected:** The fill brightens and gains an 8px colored glow (the one place a soft glow is
  allowed — it signals a live connection, which is meaning, not decoration).

### The Canvas (signature)
- **Dot-grid paper:** The root surface is `bg-canvas` printed with a radial-dot grid
  (`rgba(0,0,0,0.06)` 1px dots on a 24px grid) — graph paper for patching. It is the stage the
  whole sketchbook lives on.

## 6. Do's and Don'ts

### Do:
- **Do** keep shadows hard and blur-free (`2px 3px 0`, blur radius `0`). Depth is an offset.
- **Do** make controls feel physical: lift on hover, depress on click, shadow growing and shrinking.
- **Do** remove until only what the hand needs while playing remains; hide the rest until
  it's asked for (less, but better).
- **Do** make it feel instant — render from what you already know and apply graph edits
  optimistically. A felt delay between gesture and sound is a design failure.
- **Do** be honest about state — metering that doesn't lie, the honest `~15–25ms` browser
  tier never dressed up as sub-5ms, a failure never hidden behind a hopeful spinner.
- **Do** prefer a held, believable sound over a visible glitch when something fails mid-set,
  and report it without stealing the player's focus (the Live Performance Rule).
- **Do** use Caveat for the voice (titles, labels, buttons), Inter for dense data, and
  JetBrains Mono for exact numeric values only.
- **Do** color ports and cables strictly by type: audio = blue, control = grey, universal = violet.
- **Do** keep the depth there but out of the way — a beginner sees a simple node; the expert
  presses `e` to go inside. Progressive disclosure, no ceiling.
- **Do** keep every accent reskinnable: all color is CSS variables, so any user can build a
  high-contrast or color-blind-safe theme without forking.

### Don't:
- **Don't** build a **generic SaaS dashboard**: no flat corporate cards, no hero-metric tiles,
  no cool-grey chrome.
- **Don't** drift into **sterile pro-DAW chrome** — dense joyless grey, engineer-first density
  for its own sake.
- **Don't** make it a **toy**: hand-drawn must read as crafted and trustworthy, not cute.
- **Don't** reach for the **sci-fi / AI-tool cliché**: no glassmorphism, no glowing gradients,
  no neon-on-black as a default (Cyberpunk is an opt-in theme, not the baseline).
- **Don't** add a blurred `box-shadow` anywhere. If it has a blur radius, it's wrong.
- **Don't** let a control move, resize, or reflow on hover or press (the No-Surprise Rule):
  feedback is color, border, opacity, and at most a 4px transform.
- **Don't** use a state color (pine/ochre/clay) to style a heading, button, or surface — those
  report machine state only.
- **Don't** put a display font on exact data, or spend wiring colors (blue/grey/violet) on
  anything that isn't a port or a cable.
- **Don't** ever present a wall — no "pro" ceiling, no dead end. The instrument is infinitely deep.
