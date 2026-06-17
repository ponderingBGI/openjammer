# Working in OpenJammer

You are not editing a web app. You are extending an instrument that people play live,
in front of an audience, with no second take. Everything below follows from that one
fact. This file is the whole covenant — the beliefs, the code values, and the playbook.
It is loaded every session; read it before you change anything.

## The two beliefs

They are not decoration. They decide what good work looks like here.

1. **Perception is the medium.** A musician feels latency in their fingers and hears a
   glitch before they read a spec. So the audio path blocks for nothing, editing never
   drops a sample, and `<5ms` MIDI→audio (native) is not a number — it is the threshold
   below which the software disappears and only the music is left. The browser tier is
   honestly `~15–25ms`, and we say so; we never market it as sub-5ms. When something
   breaks mid-set, **a held note beats a glitch**: preserve the last good sound, report
   without stealing focus, let the performer choose when to recover.

2. **A minimal core, made infinite by everyone.** `ojcore` is deliberately tiny and does
   one thing perfectly without ever blocking: turn a graph into sound. *Everything else* —
   every instrument, effect, AI-authored DSP node, hosted VST3/AU/CLAP — is community and
   user territory behind one contract: a `PluginManifest` + one CLAP-shaped `DspInstance`
   trait. Built-in DSP and a synth written this morning are the same shape to the engine.
   The core earns the right to be small by being perfect; the community earns the right to
   make OpenJammer anything. **When in doubt, it is a plugin. Every user makes it their own.**

For *who* plays this and *why*, and for the design philosophy, see
[PRODUCT.md](../../PRODUCT.md) (strategy, users, the instrument-not-a-dashboard line) and
[DESIGN.md](../../DESIGN.md) (the visual system — "The Living Sketchbook"). Read those
before any UI change. The bar is high because the medium is unforgiving. That is the point.

## The code values

One boundary governs all of them — it is what makes "minimal core, infinite edges" real
instead of a slogan:

> **Only what must be real-time-safe and universal lives in the core. Anything that can
> be a plugin, stays a plugin.**

When you are about to add code, the first question is always *which side of this line*,
and the default answer is the plugin side. Then:

1. **Keep the core lean.** Remove duplication; every line in `ojcore` earns its place. A
   core small enough to hold in your head is the whole reason it can be trusted.
2. **Strong, reusable pillars.** The DSP kernels live once in `ojcore-dsp`; the wire
   contract lives once in `ojproto` (`OjGraph`, `RtCommand`, `ParamPatch`, `EngineFrame`);
   the plugin contract is one `DspInstance` trait. **Extend these; never fork a parallel version.**
3. **One simple path first.** One wire contract, one executor selected by `OJ_EXECUTOR`
   (`webaudio` / `ojcore-native` / `ojcore-wasm`). Complexity on a real-time path needs
   explicit justification — every branch runs while audio is flowing.
4. **Fallbacks are exceptional.** None inside `ojcore`. Fallbacks live only at the edges we
   don't own — a host audio backend that may not exist, an interface that may be unplugged,
   an external plugin that may misbehave.
5. **Docs are part of the feature.** A node or plugin others cannot safely author is not
   finished. The agent is an **untrusted generator, never a trusted runner**: it emits the
   same reversible graph verbs a user drives by hand, applied live to the canvas and undone
   with plain **Ctrl+Z** — no Approve/Reject gate; reversibility plus the OS/Pi sandbox is
   the boundary ([docs/agent-tools.md](../../docs/agent-tools.md)).
6. **Reliability before novelty.** The audio thread never allocates, locks, or blocks —
   enforced mechanically (`assert_no_alloc` in CI, the compile-time `RtCommand` size guard,
   the acyclic-schedule invariant the compiler proves). A dropout is a bug, not a trade-off.
7. **Migrate fully, remove legacy paths.** The `ojcore` rewrite *is* this value in motion:
   the legacy `webaudio` executor is a migration target, not a permanent twin. After a
   migration, keep no legacy path, shim, or obsolete format.
8. **Every production line is used.** No dormant DSP, no half-wired node shipped "just in
   case." If it isn't needed for real behavior now, remove it.
9. **Design for instant.** Render from what you already know, preload what's next, apply
   graph edits optimistically so the player watches the change land while the engine catches
   up. The audio path blocks for nothing.

Full crate map and the CI commands that enforce all of this:
[docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md).

---

## The playbook

These are not style preferences; they keep the codebase lean enough to trust under a
performer's hands.

### Package manager: Bun only

**Always use `bun`, never `npm`, `yarn`, `pnpm`, or `npx`** — one toolchain, one
lockfile, no parallel paths (code-value #1).

```bash
bun install            # install dependencies
bun dev                # run the dev server
bun run build          # build for production
bun add <package>      # add a dependency
bun add -d <package>   # add a dev dependency
```

Do not introduce `npm`/`yarn`/`pnpm` commands anywhere in the codebase or the docs.

### Code standards

- **File structure:** components in `/src/components/`; nodes in `/src/nodes/`, one file
  per node type; audio engine in `/src/audio/`; state in `/src/state/`; theming in
  `/src/themes/`.
- **Naming:** components `PascalCase` (`KeyboardNode.tsx`); utilities `camelCase`
  (`audioUtils.ts`); constants `SCREAMING_SNAKE_CASE`.
- **Commits:** conventional — `feat:`, `fix:`, `docs:`, `refactor:`, `style:`, `test:`,
  `perf:`. Atomic and focused — one reversible idea each.

### Port types and colors

Port color tells the eye what travels down a cable — the player learns it in seconds. The
type is the source of truth; the color follows from it.

- `type: 'audio'` → **blue** (music / sound)
- `type: 'technical'` → **grey** (numbers / triggers)

Examples: keyboard outputs are `technical` (they send numbers, not sound); instrument
inputs are `technical` (they receive triggers); instrument outputs are `audio` (they make
sound); effects are `audio` (they process sound).

### Extend, don't fork (the plugin boundary)

Everything beyond the core is a plugin. Before adding a capability, decide which side of
the boundary it belongs on (the code-values spine above). Design with these open edges in
mind:

- **MIDI:** node inputs are abstracted to accept MIDI events.
- **Custom nodes:** a plugin architecture for community nodes — one manifest, one
  `DspInstance`, the same shape as built-ins.
- **Themes:** all colors are CSS variables, stored in theme JSON, so the community can
  reskin the instrument without forking it.

### Performance is correctness here

A dropout is not a slow frame — it is a lie told to the performer's hands (code-value #6).
Treat the audio path as sacred:

- Create and destroy Web Audio nodes carefully; leaks on an instrument are bugs.
- Use `requestAnimationFrame` for *visual* updates — never for audio timing.
- Audio timing must use `AudioContext.currentTime`. The audio path blocks for nothing.

### Offline support

A stage cannot count on Wi-Fi:

- A Service Worker caches every asset for offline use.
- Core functionality requires no external API calls.

### Testing locally

```bash
bun dev
```

Opens at `http://localhost:5173` (or similar). **Test with audio actually playing** —
a change that compiles but clicks, drops, or adds latency has failed the only test that
matters. Use headphones to avoid feedback loops when testing microphone input.

### The contributing checklist

Before you open a pull request:

- [ ] Used `bun` for all package operations
- [ ] Followed the existing structure and naming
- [ ] **Tested with audio actually playing** — no clicks, no dropouts, no added latency
- [ ] Verified nodes connect and disconnect cleanly, and undo/redo works
- [ ] Updated the README if you added a new node type
- [ ] No console errors or warnings
- [ ] Can name which belief or value your change honors — perception you can feel, or a
      core kept minimal so the community can make it their own

If you are the Ctrl+K agent: you are an **untrusted generator, never a trusted runner**.
You only ever emit the same reversible graph verbs a user drives by hand; they apply live
to the canvas and the player undoes anything with plain Ctrl+Z (no Approve/Reject gate).
The conversation is persistent and session-aware — it auto-reattaches to the last Pi
session; `/new` starts a fresh one and `/resume` moves between them. Ground every plan in
what is already on the canvas before you add anything.
