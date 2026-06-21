# The Rust / TypeScript Boundary

This document answers one question, once, so it stops being re-litigated on every PR:
**what belongs in Rust, what belongs in TypeScript, and why.** It is not a checklist —
it is an argument. By the end you should be able to place any new piece of code yourself
and explain the placement to someone else.

It assumes the two beliefs in [agents.md](../agents.md): *perception is the medium*, and
*a minimal core made infinite by everyone*. Every rule below is derived from one of them.

---

## TL;DR

> **TypeScript shapes the instrument; Rust *is* the instrument.**

The line between the *instrument-as-edited* (the canvas, the visual graph, the manifest
registry, the act of translating "what the user drew" into a contract) and the
*instrument-as-sounding* (the deadline-bound kernel that turns a graph into audio) is the
boundary. Rust owns the sounding; TypeScript owns the shaping; the two meet at one tiny,
deliberately UI-free contract (`ojproto`).

The decision rule: a piece of logic belongs in the **Rust real-time core** only if it
passes **all three gates** — *deadline-bound*, *universal-and-not-already-single-sourced*,
and *expressible over the wire IR without UI shapes*. Fail any one → it stays in
TypeScript. This is why `resolveKeyboardNotes` and `emitOjGraph`, despite feeling
"performance-critical," correctly stay in TypeScript — and why that is right, not a
compromise.

---

## 1. The wrong question

The tempting test is *"is this performance-critical or reliability-critical? → then Rust."*
It is wrong on both axes.

- **"Reliability-critical" over-includes everything.** On a live instrument a wrong note
  is as bad as a dropout. By that test the *entire app* is reliability-critical, and the
  "minimal core" belief collapses into "rewrite it all in Rust."
- **"Performance-critical" conflates *frequency* with *thread*.** The audio thread is
  sacred not because it runs often but because it runs **under a hard deadline with no
  allocation, lock, or blocking**. That is a binary property of *one thread*, and it is
  the only kind of "performance" the core exists to defend. A function that runs hundreds
  of times a second on the *main* thread is not on that thread and does not share its
  constraint.

So "should this be in Rust?" is the wrong first question. The right one starts with a
distinction the intuition collapses:

> **"Rust" and "the core" are different decisions.** The repo already proves it: `ojproto`
> is Rust but a *contract*, not DSP; `ojcore-native` is Rust but *host glue*, not the
> kernel. Being written in Rust does not make code part of the real-time core, and not
> being in the core does not mean it must be TypeScript.

Language follows from **tier**. There are four.

---

## 2. Four tiers — language follows tier

| Tier | Where | Language | What it admits |
|------|-------|----------|----------------|
| **1 — Real-time core** | `ojcore`, `ojcore-dsp`, `ojinstrument` | Rust, `no_std`, alloc-free | Only code that meets the audio deadline **and** behaves identically on every executor: the graph→sound kernel, DSP kernels, voice render, metering/transport/resilience that runs on or around `process_block`. |
| **2 — The contract** | `ojproto` (+ its hand-written mirror `packages/oj-protocol-ts`) | Rust, `no_std`, tiny | The single control-rate wire shape — `OjGraph`, `RtCommand`, `ParamPatch`, `EngineFrame`. The boundary object itself, deliberately free of audio buffers **and** UI concepts. |
| **3 — Host edges** | `ojcore-native`, `ojcore-wasm`, `src-tauri` | Rust, per-backend | Device/OS/browser plumbing (cpal vs AudioWorklet vs Tauri IPC). **Fallbacks are allowed here and only here** (code-value #4) — the hardware isn't ours. |
| **4 — Control plane / translation / presentation** | `src/**` | TypeScript | The visual graph model (`graphStore`), the manifest registry with its React UI bindings, **the translation membrane** (`emitOjGraph`, `resolveKeyboardNotes`), MIDI device handling, and the entire editor. |

Today `ojcore` is the one audio engine, driven by two Tier-3 executors — `ojcore-native`
(Tauri/cpal) and `ojcore-wasm` (browser AudioWorklet) — over the same Tier-2 contract.
(The legacy `webaudio` executor has been retired; there is one engine now, not a twin.)

The question everyone keeps asking is really about **one line: between Tiers 1–2 and
Tier 4.** The rest of this document is how to find it.

---

## 3. The decisive test — three gates

A piece of logic belongs on the **Rust core side** (Tier 1) **if and only if it passes all
three gates**:

1. **Deadline gate.** Does it run inside — or directly feed — `process_block`, with no
   allocation, lock, or blocking, such that its latency is *felt in the fingers*? The audio
   thread is sacred because of the deadline, not the call frequency.
2. **Universality gate.** Must its behavior be byte-identical across executors, **and is it
   not already single-sourced at a higher layer?** If one shared implementation already
   serves every executor (e.g. one TypeScript function both executors import), universality
   is *already satisfied* — moving it to Rust buys nothing on this axis.
3. **IR-expressibility gate.** Can it operate purely on `ojproto` types (`OjGraph`,
   `RtCommand`, `NodeIdx`) **without** reaching for UI-world shapes — visual ports,
   `node.data.rows`, `keyGains`, `rowOctaves`, manifest `ui:` / `ParamDecl`? Or would
   feeding it force the wire contract to grow a UI-shaped field?

**Fail any gate → it stays in TypeScript (Tier 4).**

### The decision tree

```
New piece of logic L:

Q1. Does L run on the audio thread, or is its latency felt in the fingers?
    ├─ YES → Is its behavior universal across executors?
    │        ├─ YES → Tier 1: ojcore / ojcore-dsp / ojinstrument
    │        └─ NO  → Tier 3: per-backend host (ojcore-native / ojcore-wasm). Never ojcore.
    └─ NO → continue.

Q2. Does L cross the UI↔engine seam as data? Is its SHAPE already a control-rate
    contract value (no audio buffers, no UI shapes)?
    ├─ YES → Tier 2: it rides ojproto. Extend the contract; never fork a parallel one.
    └─ NO (it carries UI data) → the thing that REDUCES that UI data to a contract
                                  value is the translation membrane → Q3.

Q3. Does L consume UI-world data to PRODUCE a contract value, and is it already
    single-sourced in TS for both executors?
    └─ YES → Tier 4: STAYS TypeScript.        ← emitOjGraph, resolveKeyboardNotes

Q4. Is L DOM/React, fluid interaction state, browser-API-coupled, or fast-iterating UX?
    └─ Tier 4: STAYS TypeScript, unconditionally.
```

There is, in principle, a **fifth tier**: a *non-core* Rust crate (`std`, allocates, never
on the audio thread) for pure control-plane logic that wants Rust's testing but isn't
real-time. It is real, but it is built **only** when a named trigger fires (§8). Nothing in
the codebase clears that bar today, so we do not pre-build it. Keeping it hypothetical is
itself an application of code-value #8 (*every production line is used*).

---

## 4. Why this is the *correct* boundary

Each gate is derived from a belief, not asserted.

### From Belief 1 — *Perception is the medium*

What a performer perceives is defended **on the audio thread**, and that defense must be
**mechanical**, not aspirational:

- `assert_no_alloc` in CI proves the hot path never allocates.
- A compile-time guard, `const _: () = assert!(core::mem::size_of::<RtCommand>() <= 16);`
  ([`crates/ojproto/src/lib.rs`](../crates/ojproto/src/lib.rs)), makes it a *build error* to
  smuggle a heap field or audio buffer across the RT seam.
- The compiler proves the schedule is acyclic before a sample is rendered.

None of these guarantees is expressible in TypeScript. **That is why Tier 1 is Rust, and
non-negotiable.**

But notice what the deadline gate *excludes*. The latency a player feels when they strike a
key is *buffer size + the one boundary hop* — **not** the note arithmetic.
`resolveKeyboardNotes` is a handful of `Map` lookups and integer math on the **main**
thread, already sitting *behind* a `JSON.stringify` + `postMessage`/IPC hop before anything
reaches the engine. Moving it to Rust would spend effort where no felt latency lives — and
on the wasm tier it would **add a boundary crossing to a path that currently has none**
(today TS resolves the note and crosses the seam with the minimal `NoteOn`; routing-in-Rust
would cross with the *maximal*, UI-shaped data instead). Belief 1 therefore argues *against*
porting the membrane.

### From Belief 2 — *A minimal core, made infinite by everyone*

`ojcore` earns the right to be small by being perfect; everything else is plugin/edge
territory. The wire contract is the embodiment of that smallness: `ojproto` is *control-rate
only, no audio buffers*, and its `universal` ports are "resolved to `Audio`/`Control` at
emit time and never reach the IR unresolved." In other words, **the contract is defined as
the place where UI concepts have already been stripped away.**

The translation membrane — `emitOjGraph` and `resolveKeyboardNotes` — is precisely *the
function that does the stripping.* It reads everything the editor knows (visual ports,
structural passthroughs, per-row octave/spread/`keyGains`, manifest `ParamDecl`) and hands
the engine only the flat `OjGraph` and the ≤16-byte `RtCommand`.

You cannot move the stripper to the other side of the line it enforces without dragging the
UI shapes across with it. To resolve a keypress *in Rust*, the engine would need the
keyboard's per-row config; to emit *in Rust*, it would need `node.data` and the manifest —
so the wire contract would have to **grow exactly the UI-shaped fields it was designed to
exclude**, and would then churn (a `SCHEMA_VERSION` bump, a coordinated Rust+TS+mirror
change) every time the *keyboard UI* gains a knob. The contract — the one thing meant to be
stable and tiny — would be driven by UX experiments. Belief 2 therefore also argues
*against* porting, and explains why TypeScript is the **right** home for the membrane, not
merely a tolerated one.

---

## 5. Where TypeScript genuinely wins

TypeScript is the *correct* tool — not a concession — for everything in Tier 4:

1. **The visual graph model** (`src/store/graphStore.ts`). It is *richer than the IR by
   design*: hierarchy, bundles, structural passthroughs, `universal` ports. The IR is its
   **projection**. Owning the source in TypeScript is exactly what lets the IR stay flat.
2. **The manifest registry.** It *joins* a node type to its engine `PrimitiveKind` **and**
   carries the React UI bindings. Splitting the data half into Rust would fork an SSOT —
   the precise thing code-value #2 forbids ("extend these; never fork a parallel version").
3. **Fluid interaction & UX iteration** — optimistic edits, drag, Ctrl+Z, hover, the
   signal-flash visualization. Sub-frame, throwaway, taste-driven. And the iteration tax is
   real and asymmetric: editing `src/**` is Vite HMR in place (canvas/AudioContext
   preserved); editing `crates/**` *recompiles and restarts the native window*
   ([ARCHITECTURE.md](./ARCHITECTURE.md)). The most-experimental code should live where the
   loop is tightest.
4. **Browser-API-coupled code** — Web MIDI, `AudioContext`, the offline Service Worker,
   device enumeration. This is the platform TypeScript already speaks.

The deeper reason all four belong together: they are the language of *the thing being
edited*. Rust is the language of *the thing being played*. The membrane is the seam between
them — and it sits on the editing side because everything it reads is editing-world data.

---

## 6. The current map (quick reference)

| Subsystem | File(s) | Tier | Why |
|-----------|---------|------|-----|
| DSP kernels (biquad, osc, Karplus, delay, smoother) | `crates/ojcore-dsp` | **1 — Rust core** | Deadline-bound + universal. |
| Compiler & scheduler (`compile`, `process_block`) | `crates/ojcore` | **1 — Rust core** | Deadline-bound; invariants proven mechanically. |
| Instruments / voice render | `crates/ojinstrument` | **1 — Rust core** | This *is* the audio thread. |
| Resilience, metering, transport, command/program rings | `crates/ojcore` | **1 — Rust core** | Runs on or around the RT path. |
| Wire contract & IR | `crates/ojproto` (+ `packages/oj-protocol-ts`) | **2 — contract** | The boundary object; audio- and UI-free; mirror kept honest by `wire_shapes.rs`. |
| Device/host backends | `ojcore-native`, `ojcore-wasm`, `src-tauri` | **3 — Rust edge** | Per-backend; fallbacks allowed here only. |
| **`emitOjGraph`** (visual graph → flat IR) | `src/audio/ojgraph/emit.ts` | **4 — TS** | Fails Q1 (main thread, ~1–10 Hz). Fails Q3: reads `node.data`, manifest `ParamDecl`, resolves `universal` ports, flattens structural nodes. Already single-source for both executors. |
| **`resolveKeyboardNotes`** (keypress → `NoteOn`) | `src/audio/ojgraph/noteRouting.ts` | **4 — TS** | Fails Q1 (main thread, ~10–20 Hz). Fails Q3 hardest — consumes `rowOctaves`, `rows`, `spread`, `baseOffset`, `keyGains`, none of which exist in the IR. Already single-source. |
| `paramsFromData`, `portSync`, `toMidi` | `src/audio/ojgraph/`, `src/utils/` | **4 — TS** | Sub-steps of the membrane / pure visual-graph upkeep; all read UI-world data. |
| MIDI device parsing | `src/midi/**` | **4 — TS** (browser) | Coupled to the Web MIDI API. (A native host may parse MIDI at its own Tier-3 edge — that is *not* a reason to move the browser path.) |
| Visual graph store, undo/redo | `src/store/graphStore.ts` | **4 — TS** | The visual SSOT; React, optimistic edits, Ctrl+Z. |
| React canvas, node UI, theming | `src/components/**`, `packages/oj-tokens`, `src/styles/**` | **4 — TS** | DOM, `requestAnimationFrame`, fluid state, CSS-variable themes. |

---

## 7. Weighing the three motivations

People reach for "move it to Rust" for one of three reasons. Held against the gates:

- **Latency / perception.** The boundary is *already optimal*. The RT path is Rust where
  latency lives; the membrane is off-thread. Moving it reduces no felt latency and would
  *add* a wasm crossing. → **no moves.**
- **Killing duplication.** There is *almost none* today — the membrane is single-sourced in
  TypeScript and shared by both executors (`noteRouting.ts` is documented as "shared by the
  ojcore executors"). → **nothing to consolidate.**
- **Test confidence / future-executor parity.** The *only* motivation that could ever
  justify moving the membrane — and even then into the hypothetical Tier-5 *non-core* Rust
  crate, never into `ojcore`. But TypeScript already has comprehensive coverage
  (`emit.test.ts`, `noteRouting.test.ts`, `wasmParity.test.ts`), and parity across today's
  executors is already guaranteed by single-sourcing. The marginal gain — proptest/fuzz over
  the *front half* of the pipeline, and compile-time parity for *hypothetical future*
  executors — is real but speculative, and is bought with contract growth plus a
  cross-language iteration tax on the most-iterated code. → **not now.**

**Verdict:** the boundary stays where it is. `resolveKeyboardNotes` and `emitOjGraph` stay
in TypeScript — because that is *right*, not because it is convenient.

---

## 8. When this changes

This doctrine is durable, not frozen. A "stays TypeScript" verdict flips **only** when a
named condition fires:

- **A third executor appears that cannot *import* the TypeScript implementation** — a
  headless render server, an embedded/hardware port, a collab peer that resolves notes
  server-side. The instant lowering or note-routing must be *reimplemented* rather than
  *imported*, the "already single-sourced" premise in gate 2 breaks. Then, and only then,
  move that logic into a shared non-core Rust crate (the `ojscene` shape) — behind a
  golden-equivalence test, one executor at a time, extending the existing parity-gate
  discipline (`crates/ojproto/tests/wire_shapes.rs` ↔ `packages/oj-protocol-ts`).
- **Untrusted scene input** — imported `.oj` files or shared community workflows — needs
  crash-hardening that fuzzing serves better than unit tests. Then put the
  *import → lowering* path behind a Rust fuzz target.
- **A measured profile** shows lowering or routing actually on a felt-latency path. (It is
  not today; do not assume — measure, e.g. with the existing CodSpeed benches.)

Until one of those fires, extending the core, the contract, or the membrane follows the
three gates above. When in doubt, the answer mirrors agents.md: it stays on the side that
owns UI shapes — TypeScript.

---

*Related: [agents.md](../agents.md) (the two beliefs + code values this is derived from) ·
[ARCHITECTURE.md](./ARCHITECTURE.md) (the crate map + the CI gates that enforce Tier 1) ·
[PRODUCT.md](../PRODUCT.md) (why the medium is unforgiving).*
