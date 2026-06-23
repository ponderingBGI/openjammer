# The Channel Model & the Stereo Widening

This document is the design spec for OpenJammer's audio **channel model** and the **stereo
(`n_channels`) widening** — the deepest single change the "grows into a studio" trajectory forces
on the kernel. It is written *before* the migration (the same doc-first discipline as
[STABILITY.md](./STABILITY.md) and [BOUNDARY.md](./BOUNDARY.md) §9) so the change lands additively,
byte-identically for existing graphs, and right the first time.

It is grounded in the engine as it stands today (`crates/ojcore/src/compile.rs`, `exec.rs`,
`dsp.rs`) — read those alongside this.

---

## 1. What the engine does today (traced, not assumed)

The kernel is **mono**, but *less* mono than it looks — the per-node path is already multi-buffer:

- **Each output PORT is one mono buffer.** `compile.rs` pre-sizes `out_bufs[node][port]` =
  `block_size` floats, one per declared output port (`compile.rs:294-299`). A node with `n_out = 2`
  already gets two independent output buffers.
- **`ProcessCtx` hands one slice *per port*.** `exec.rs::render_node` points `outs[i]` at
  `out_bufs[node][port]` and passes `ctx.outputs = &mut outs[..n_out]` (`exec.rs:578-601`). So a node
  *today* can read/write multiple channels — they are just modeled as separate **ports**, and
  `ProcessCtx`'s doc already calls each slice "one per channel."
- **Routing is per-(node, port).** An `IrEdge` connects `from_port → to_port`; the mix step sums all
  sources of an input port into `in_scratch[port]` (`exec.rs::mix_input`).
- **The wire IR counts ONLY audio ports.** `emit.ts::portCounts` sizes `n_in`/`n_out` to the manifest's
  *audio* port counts (with per-kind floors); control ports are addressed by param/command, never by
  routed buffers, and never enter `n_in`/`n_out`. So **every IR port is an audio port** — which means the
  compiler can expand output lanes as `n_out × out_channels` with **no audio-vs-control ordering
  ambiguity**, and `out_bufs[node]` simply grows from `n_out` rows to `n_out × out_channels` lane rows
  (identical when `out_channels == 1`).

So the engine is, structurally, **N independent mono channels routed per port.** The mono-ness lives
at exactly **three boundaries**:

1. **The device output.** `process_block(out: &mut [f32], …)` writes ONE mono buffer
   (`exec.rs:406`). The host (cpal / AudioWorklet) hands one mono buffer in.
2. **The master sink.** `process_block` emits only `routing[master].inputs[0]` — input **port 0** of
   the single `SpeakerOut`/`GraphOut` (`exec.rs:479-495`). Even a multi-port master would still only
   sound its first port.
3. **The asset path.** `AssetPcm` downmixes every sample/IR to mono at compile time
   (`compile.rs:34-78`).

That is the whole mono footprint. The rest of the engine never assumed one channel.

---

## 2. The decision — a port carries `n_channels` (one stereo cable), not one channel per port

Two models could express stereo:

- **(A) Multi-port** — L and R are *separate ports*; a stereo cable is *two* connections. This is the
  modular-synth convention (VCV Rack, Max, Pd) and is essentially what the engine does today.
- **(B) Multi-channel-per-port** — a *single* port (one cable) carries `n_channels`; a stereo cable is
  *one* connection.

**OpenJammer adopts (B).** Rationale, weighed for the long term:

- It serves the **"grows into a studio"** north star: a stereo studio thinks in stereo signal flow, not
  paired mono wires. Wiring every stereo effect as L+R (model A) is exactly the friction a producer
  resents.
- It keeps the canvas clean and on-brand: **one cable, one meaning** (the port-color rule). A "stereo"
  cable is still one drawn line, not a tangle.
- Mono stays the effortless default — a `1`-channel port is a mono cable, unchanged.

The cost (paid deliberately): `ProcessCtx` and the per-port buffer model gain a channel dimension, and
connections must adapt channel counts (below). That is the invasive part, and it is bounded.

---

## 3. The additive shape — `n_channels` defaults to 1, byte-identical for mono

The migration MUST preserve every committed `golden_render` fingerprint: a graph that is mono today
must render **bit-identically** after. The mechanism is a default of `1`.

- **Contract — channels live on the `PluginManifest`, NOT the wire IR.** A port's channel count is a
  property of the node **type** (a "Stereo Reverb" is always stereo-out, in every graph), so it belongs
  on the static `PluginManifest.ports` (`PortDecl` gains `audio_in_channels` / `audio_out_channels`,
  default `1`), and the **compiler derives it from the registry** at compile time (`compile.rs` already
  resolves `registry.get(&node.manifest_id)`). This deliberately leaves the **wire IR untouched**: the
  heavily-constructed `IrNode` (≈69 sites) and `OjGraph` gain nothing, `ojproto`'s `SCHEMA_VERSION` does
  not bump, and `RtCommand` stays ≤16 bytes. Only the ≈13 manifest builders gain two defaulted fields
  (mirrored in `schemas/oj-plugin-v1.json` + `src/engine/manifest.ts`, exactly like the `abi` block).
  A *dynamic* plugin (hosted/AI) reports its channel layout in its own manifest. (Per-port-within-a-side
  variation — one mono + one stereo input on the same node — is a rare case deferred to a later refinement;
  v1 is one channel count per side, which covers mono, stereo effects, Pan 1→2, and mono-fold 2→1.)
- **Buffers (`compile.rs`).** `out_bufs[node][port]` becomes `channels` rows of `block_size` (today's
  single row is the `channels == 1` case). `in_scratch` likewise gains the channel dimension for the
  widest port.
- **`ProcessCtx` (`dsp.rs`).** Keep the surface a flat **one-slice-per-channel** list, with a parallel
  per-port channel-count so a node knows its layout. A mono node (1 port × 1 channel) sees exactly one
  slice — its `process` is unchanged and recompiles untouched. This is the key to *not* rewriting every
  builtin: the existing `ctx.outputs[0]` mono nodes keep meaning "my one channel."
- **Default everywhere = 1.** With every port `channels == 1`, the buffer layout, routing, and render
  are identical to today → golden renders preserved. Stereo is then opt-in per port.

A node declares its port channel counts in its `PluginManifest` (`PortDecl` gains channel info), so the
visual layer and the compiler agree.

---

## 4. Channel adaptation at connections (the one new routing rule)

A cable may join ports of different channel counts. The mix step (`exec.rs::mix_input`) gains a single,
well-defined adaptation rule, applied off nothing but the pre-computed plan:

- **mono → stereo** (1→N): the mono source feeds **every** destination channel (centred). No pan is
  implied; an explicit Pan node (a plugin) is how a player places it.
- **stereo → mono** (N→1): the source channels are **summed** into the one destination channel (the
  same downmix `AssetPcm` already does, applied at the routing edge instead of the asset).
- **N → N**: channel-for-channel.
- **N → M (mismatched, neither 1):** sum-or-truncate to M, surfaced honestly (a labeled, non-fatal
  note — never a silent wrong routing, never a crash).

This rule lives **once** in the compiler's routing build + the RT mix, so it is uniform and testable,
and it means a stereo effect dropped after a mono source "just works."

---

## 5. The three boundaries to widen

1. **Device output.** `process_block` grows a channel-aware output: the host passes `out` as N
   interleaved (or per-channel) device channels, and the engine writes the **master's resolved input
   port channels** into them. The mono `process_block(&mut [f32])` stays as the `channels == 1`
   convenience path (so the wasm worklet and every current caller keep compiling), with a widened
   sibling for stereo hosts.
2. **The master sink.** `SpeakerOut`/`GraphOut` input port 0 may be stereo; `process_block` emits its N
   channels. The master `soft_limit` + meter + sanitize run **per channel**.
3. **The asset path.** **DONE (both tiers).** `AssetPcm` now carries `channels` and BORROWS the
   interleaved buffer zero-copy instead of downmixing at compile; the per-channel split moved to the
   consuming node. `DspInstance::load_asset` gained a `channels` arg, so the **Sampler**
   (`audio_out_channels = 2`) deinterleaves into planar L/R and plays a stereo sample in true stereo
   (a mono sample plays identically in both lanes, so a mono master reads a byte-identical channel 0 —
   the `golden_render` Sampler gate stays green), while the **Convolution** IR downmixes itself via
   `compile::downmix_to_mono`. The **wasm** asset store preserves stereo too (carries `channels` +
   hashes it in the content address — mono ids unchanged), and the live sample-drop chain
   (`setBuffer` → `loadSample` → both bridges → the native `load_sample` command + the wasm
   `store_asset`) INTERLEAVES instead of downmixing — so a stereo sample plays in true stereo on
   **both tiers** and content-addresses identically across them.

---

## 6. Invariants (must stay true)

- **`channels == 1` is byte-identical to today.** The `golden_render` fingerprint is the gate on every
  step of the migration; a mono graph never changes a sample.
- **`RtCommand` stays ≤ 16 bytes.** Channels are a program/IR shape, never a command field.
- **`ojcore` gains a channel *dimension*, not a channel *policy*.** Pan, width, mono-fold, mid/side are
  **plugins** (nodes), not kernel features. The kernel only routes, adapts (§4), and renders channels.
- **The audio thread still blocks for nothing.** All channel buffers are pre-sized in `compile`; the RT
  loop only points and renders, exactly as now.
- **Mono nodes are never rewritten.** A `1`-in/`1`-out builtin keeps its `process` verbatim; stereo is
  expressed by *new* multi-channel nodes + the adaptation rule.

---

## 7. Phased migration (each step golden-render-clean + committable)

1. **Plumb `n_channels` (default 1).** Add `audio_in_channels`/`audio_out_channels` to `PortDecl`
   (manifest, default 1), derive them in `compile` from the registry, and thread the resulting per-lane
   shape through `compile` (per-lane `out_bufs`/`in_scratch`) and `exec` (`render_node`/`mix_input`),
   all `= 1`. The wire IR is untouched. Golden renders unchanged; this is the byte-identical substrate.
   **Committable alone.**
2. **Stereo device output + stereo master.** Widen `process_block` + `SpeakerOut`/`GraphOut` to N
   channels; per-channel limiter/meter/sanitize. The native + wasm hosts de-interleave a stereo device.
3. **The adaptation rule (§4)** in routing + mix, with tests for 1→2, 2→1, 2→2.
4. **Stereo nodes as plugins** — Pan (mono→stereo), Stereo Width, a stereo-out Sampler — authored
   against the now-stereo `ProcessCtx`. None touch the kernel.

After step 1 the kernel is stereo-*capable* with zero behavior change; steps 2–4 make stereo *audible*
and are independently valuable. Automation, PDC, and MPE are then built **once** against this real
channel model — which is exactly why stereo lands before them.

**Status: COMPLETE (both tiers).** Step 1 (the `n_channels` substrate) → per-lane `compile`/`exec` →
`process_block_into` N-channel output → the §4 adaptation → the native *and* wasm planar hosts → the
general mid-graph lane-aware `mix_input_lane` → two real stereo nodes (`Pan`, `Width`). Every step stayed
golden-render-clean; the `pan_centre`/`pan_hard_left` stereo goldens now lock the path bit-exactly in CI.
A musician can pan and widen sound in true stereo at `<5ms` (native) or `~15–25ms` (browser).

## 8. Authoring a stereo node (the recipe + the traps)

A stereo node is an ordinary plugin whose manifest declares `audio_in_channels` / `audio_out_channels`
greater than 1; the engine derives the lanes and hands `process` the extra `ProcessCtx` slices.
`Pan` (`crates/ojcore/src/pan.rs`, mono→stereo, equal-power) and `Width`
(`crates/ojcore/src/width.rs`, stereo→stereo mid/side) are the worked examples. A new **built-in** stereo
node touches a fixed set of coupled sources — keep them in lockstep or a checker/test fails:

1. **`ojproto::PrimitiveKind`** — add the variant, mirrored in all FIVE SSOT declarations: the Rust enum,
   `wire_shapes.rs`'s list, `schemas/primitive-kinds.json`, the TS `PRIMITIVE_KINDS` tuple, and
   `schemas/oj-plugin-v1.json`'s `kind` enum (the `ssot-set-equality` + `primitive-kinds-parity` tests enforce this).
2. **The node + loader** (`crates/ojcore/src/<node>.rs`) with the channel counts on its `PortDecl`,
   registered in `register.rs` (update its count tests). Smoothers must `reset` to the **stored target**,
   never a hardcoded default.
3. **The backend map** (`src/audio/ojgraph/backendMap.ts`) — map the kind to its real `builtin.*` id on
   BOTH backends. **Trap:** an unmapped kind silently falls back to `builtin.gain`, which writes a single
   lane and collapses the stereo.
4. **The editor node-def** — the `NodeType` union **and** `KNOWN_PLUGIN_IDS` (`src/engine/types.ts`), the
   `nodeDefinitions` entry, `KIND_BY_TYPE`, and (for a signed/wide range) `PARAMS_BY_TYPE`
   (`src/engine/manifest.ts`). **Trap:** miss `KNOWN_PLUGIN_IDS` and `isPluginId` fails, so `get()` returns
   `MISSING_DEFINITION` and the manifest silently becomes `builtin.container`.
5. **A `golden_render` stereo case** so the bounce is locked end to end through the real registry.

Authoring against a Faust/wasm bridge instead needs none of the `PrimitiveKind` churn — the channel counts
ride the dynamic manifest, so only the DSP + ports change.

---

*Related: [BOUNDARY.md](./BOUNDARY.md) §9 (one core, two clocks) · [STABILITY.md](./STABILITY.md)
(the contract this extends additively) · `crates/ojcore/src/compile.rs`, `exec.rs`, `dsp.rs`.*
