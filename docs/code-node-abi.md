# OpenJammer Code-Node `.wasm` ABI (v1)

This document specifies the **binary contract** every AI-authored (or
hand-authored) DSP *code node* `.wasm` module obeys, and the **host-side guard
contract** that wraps it. It is the carefully-crafted deliverable of MILESTONE M6
(D4 of the Ctrl+K / AI plan).

The pipeline that produces a conforming module today:

```
Faust source ── ojfaust CLI Path B ──▶ .wasm  +  faust -json metadata
                                          │
                                          ▼
                          author_wasm_node (src-tauri/src/ai.rs)
                          • FNV-1a hash the wasm bytes  → ai.wasm.<hash>
                          • build the frozen v1 PluginManifest
                          • VALIDATE host-side, fail-closed (D4-A1)
                                          │
                                          ▼
                       AuthoredNode { manifestId, manifestJson, wasmHash, … }
```

> ## FOUNDER-GATED BOUNDARY — read this first
>
> **Nothing in OpenJammer executes a code-node `.wasm` on the audio thread yet.**
> The compile + manifest + validation pipeline above runs NOW and is fully tested.
> The *execution* host — the wasmtime native runtime and the browser AudioWorklet
> wasm executor — is **founder-gated** (plan D4-A2 / A3): it needs a real audio
> device and a `<5 ms`-at-64-samples benchmark that cannot be verified in CI / the
> dev sandbox. Until the founder enables it:
>
> - newly authored nodes stay **audible** via M5's stored-Faust-source `effect`
>   execution path (unchanged);
> - the `.wasm` + manifest are produced and validated for the moment the RT host
>   is switched on;
> - the `wasmtime` crate is **NOT** a dependency, and the existing
>   `effect` + `faustSource` execution path is **NOT** removed.
>
> Every guard, export, and import below is the contract the *future* host will
> honour. The "Founder-gated next steps" section at the end enumerates exactly
> what remains.

---

## 1. Module shape

A code-node module is a single, self-contained `wasm32` module.

- **Imports: NONE.** The module imports no functions and no WASI. The RT instance
  is created with an empty import object / a WASI-less linker. A module that
  declares any import is rejected at load. (No syscalls, no clock, no randomness,
  no host callbacks — a pure sample-in / sample-out kernel.)
- **One linear memory, pre-grown, never grows at runtime.** The module exports a
  single `memory`. The host grows it ONCE at instantiation to hold the I/O scratch
  buffers + the embedded manifest, then the kernel must never call `memory.grow`.
  All `oj_process` scratch lives in this pre-grown region; the kernel allocates
  nothing on the audio thread.
- **No start function side effects.** Any `start`/`__wasm_call_ctors` only zeroes
  module state; it must not touch memory the host has not yet sized.

## 2. Exports (the `oj_*` ABI)

| Export | Signature | Called | Meaning |
| --- | --- | --- | --- |
| `oj_init` | `(sr: i32, max_block: i32) -> ()` | once, off-RT, at load | Initialise DSP state for sample rate `sr` and a maximum block size `max_block`. The host has already sized linear memory; the kernel records `sr`/`max_block` and resets filter state. |
| `oj_process` | `(in_ptr: i32, out_ptr: i32, n: i32) -> ()` | every block, on-RT | Read `n` input frames from `in_ptr`, write `n` output frames to `out_ptr` (both are byte offsets into linear memory, `f32` interleaved per the port counts in the manifest). `n <= max_block`. Allocation-free, no imports. |
| `oj_param` | `(idx: i32, val: f32) -> ()` | control-rate, off-RT-ish | Set parameter `idx` (the `id` in the manifest's `params[]`, assigned in Faust UI declaration order) to `val`. Applied at the next block boundary. |
| `oj_manifest_ptr` | `() -> i32` | once, at load | Return the byte offset in linear memory of a NUL-terminated UTF-8 JSON blob `{ ports, params: ParamDecl[] }` embedded by the toolchain. The host reads it to cross-check the manifest it built from `faust -json`. |

### Parameter indexing

`oj_param(idx, val)` uses the SAME sequential index the manifest's `params[]`
carries: parameters are numbered `0,1,2,…` in **Faust UI declaration order**
(`hslider` / `vslider` / `nentry` / `button` / `checkbox`), exactly as
`ojfaust`'s `parse_faust_json` assigns `FaustParam.id`. This keeps the manifest the
UI renders, the validation the host runs, and the live parameter writes all in
agreement.

### Memory & buffer layout

```
linear memory ┌─────────────────────────────────────────────────────┐
              │ kernel state (filters, delay lines, …)               │
              ├─────────────────────────────────────────────────────┤
              │ input scratch   : f32 × max_block × ports.audio_in   │  ← in_ptr
              ├─────────────────────────────────────────────────────┤
              │ output scratch  : f32 × max_block × ports.audio_out  │  ← out_ptr
              ├─────────────────────────────────────────────────────┤
              │ embedded manifest JSON (NUL-terminated)              │  ← oj_manifest_ptr()
              └─────────────────────────────────────────────────────┘
```

The host pre-grows memory to cover all four regions at `oj_init` time and never
again. `in_ptr` / `out_ptr` are passed each block so the host owns the scratch
placement.

## 3. Manifest (frozen v1)

Authoring builds a `PluginManifest` conforming to **`schemas/oj-plugin-v1.json`**
and validates it host-side (`build_and_validate_manifest` in
`src-tauri/src/ai.rs`). A code node's manifest is:

```jsonc
{
  "id":   "ai.wasm.<fnv1a-hex-of-wasm-bytes>",   // OPEN registry key, content-addressed
  "name": "<declared name or 'AI Code Node'>",
  "kind": "WasmHost",                            // CLOSED PrimitiveKind the RT loop lowers to
  "dsp":  "wasm",
  "ui":   "auto",                                // → AutoParamPanel renders params
  "params": [ { "id", "name", "min", "max", "default" }, … ],
  "ports":  { "audio_in", "audio_out", "control_in": 0, "control_out": 0 }
}
```

### Host-side validation (fail-closed, D4-A1)

The host registers a node ONLY if every check passes; a failure returns a
diagnostic and registers **nothing**:

1. **Content-addressed namespace.** `id = "ai.wasm." + FNV-1a(wasm bytes)` (same
   FNV-1a / 8-char-hex as the frontend `shortHash`).
2. **No built-in collision.** The id must not fall in a reserved namespace
   (`builtin.`, `host.`, `oj.builtin.`). An AI node can never shadow a built-in.
3. **Port-arity match.** The manifest's declared `audio_in` / `audio_out` must
   equal the port counts the compiler reported (`faust -json`).
4. **Schema-shape invariants.** Non-empty `id`/`name`; `dsp ∈ {builtin,faust,
   wasm,none}`; `ui ∈ {auto,react}`; every param finite with `min ≤ default ≤
   max`; port counts within `0..=255`.

## 4. Host-wrapper output guards (D4-A4)

Because the kernel is **untrusted**, the host funnels every output sample through
a guard chain that lives in `crates/ojcore-dsp/src/guards.rs` — OUTSIDE the wasm
sandbox, so a kernel can never disable it. The mandated order per output channel,
per sample, is:

```
oj_process output ─▶ scrub_denormals_and_nan ─▶ DcBlocker ─▶ soft_limit ─▶ bus
```

| Guard | Contract |
| --- | --- |
| `scrub_denormals_and_nan(x) -> f32` | `NaN`/`±Inf` → `0.0`; `|x| < 1e-30` (denormal-ish) → `0.0`; else unchanged. Kills the two things that poison the bus + spike CPU. |
| `DcBlocker` (stateful) | One-pole high-pass `y[n] = x[n] − x[n-1] + R·y[n-1]`; removes the slow DC drift an unstable kernel can introduce. One instance per output channel; `reset()` on (re)load. |
| `soft_limit(x) -> f32` | Hard peak limit with a soft cubic knee; output ALWAYS within `±0.999` (`LIMITER_CEILING`). Quiet signals pass untouched; non-finite input → `0.0`. |

`OutputGuard` bundles the chain (`scrub → DC-block → limit`) and exposes
`process(sample)` / `process_buffer(&mut [f32])`. All guards are pure,
allocation-free, `no_std`, and unit-tested (NaN/Inf/denormal/over-unity/DC-offset
buffers asserted finite, bounded, and DC-removed). They run NOW even though the RT
host that calls them is founder-gated — they are the contract a *Bypass-on-trip*
wrapper is built from.

## 5. Error / fallback model

- **No `faust` binary on PATH** → `author_wasm_node` returns `Ok` with
  `diagnostic = "faust not installed"` and no manifest; the frontend falls back to
  storing the source (M5 path), exactly as before.
- **Faust rejected the source** → `Ok` with `diagnostic = <compiler stderr>`; the
  agent feeds this to the bounded `compile_repair` loop and tries a fix.
- **Validation rejected** → `Ok` with a diagnostic; nothing is registered.
- **Success** → `AuthoredNode { manifestId, manifestJson, wasmHash, nIn, nOut }`.

The command always returns `Ok` for recoverable conditions; only true internal
faults (e.g. a serialization failure) map to `Err`.

---

## Founder-gated next steps

These complete the "and run" half. They each need a real audio device and/or a
benchmark that cannot pass in CI, so they are deliberately **out of scope** here
and gated on the founder enabling them:

1. **wasmtime native RT execution host.** Add the `wasmtime` crate; instantiate
   conforming modules with **pooling allocation**, an **AOT `.cwasm`** cache,
   **epoch-based interruption** (a runaway `oj_process` is pre-empted), and
   **Bypass-on-trip** (a trapped/over-budget kernel is muted and the node falls
   back to passthrough, with the `OutputGuard` chain always applied).
2. **AudioWorklet wasm executor (browser run-only).** Run the SAME
   content-addressed `.wasm` in the worklet so a node authored on desktop runs in
   the browser (`codeNodes: 'run-only'`).
3. **64-sample `<5 ms` latency benchmark (D4-A2 GATE).** Prove a representative
   code node processes a 64-sample block well under the realtime budget on the
   native host before the path is enabled by default.
4. **Golden-render A/B.** Render a fixed graph through the stored-Faust `effect`
   path and the new `.wasm` path and assert sample-accurate (within tolerance)
   parity, so promoting a node from source-execution to wasm-execution is audibly
   transparent.

Only after (1)+(3)+(4) land should anyone consider flipping the *execution* path
default; the **authoring + validation pipeline in this document is complete and
verified today**.

---

## Faust's actual wasm ABI + the `FaustWasmKernel` adapter (empirical)

> Status update: the native wasmtime RT host now EXISTS (`crates/ojwasm`, behind
> `--features wasmtime-host`): it runs import-free `oj_*` modules per §2 with the
> guard chain + epoch-preemption + bypass, all unit-tested against hand-written
> WAT fixtures. faust 2.85.5 (with the WebAssembly backend) is installed.

The one open question this document deferred — *does `faust -lang wasm` emit
`oj_*`?* — is resolved empirically: **no.** faust emits its OWN wasm ABI, so the
`oj_*` contract above is for hand-authored modules (Rust/AssemblyScript/WAT), and
faust modules are run through a host-side **adapter** instead.

### What `faust -lang wasm` actually produces (faust 2.85.5)

- **It IMPORTS `env.memoryBase` (an `i32` global).** So a faust module is NOT
  import-free and is rejected by the `oj_*` loader by design. Math-using DSP also
  imports `env._sinf` / `_expf` / … which the adapter's linker must supply.
- **One exported `memory`** (e.g. `(memory (export "memory") 2 1002)` — 2 pages
  initial). faust's static data lives in the low pages.
- **A dsp-pointer ABI** — every function takes a `dsp: i32` pointer to a struct the
  HOST allocates (struct byte size is the faust `-json` `"size"` field):
  - `init(dsp, sample_rate)` — full init (class + instance).
  - `compute(dsp, count, inputs, outputs)` — `inputs`/`outputs` are pointers to
    arrays of per-channel buffer pointers; buffers are **non-interleaved** f32.
  - `setParamValue(dsp, index, value)` / `getParamValue(dsp, index)` — params by the
    sequential `index` from the `-json` `ui[]` (`"index"` field), the same order the
    v1 manifest carries.
  - `getNumInputs(dsp)` / `getNumOutputs(dsp)` / `getSampleRate(dsp)`,
    `instanceInit` / `instanceConstants` / `instanceClear` /
    `instanceResetUserInterface`.

### The decision: `FaustWasmKernel` (host-side adapter), not an `oj_*` wrapper

faust's wasm backend has no `oj_*` architecture-file hook, and re-exporting via a
second linked module is heavy. Instead the host's `Kernel` trait
(`init`/`process`/`param`, interleaved host buffers) is ABI-AGNOSTIC, so faust is
supported by a second `Kernel` impl — `FaustWasmKernel` — that:

1. instantiates with a `Linker` providing `env.memoryBase = 0` + the math shim
   (mapping faust's imported `_sinf`/`_expf`/… to Rust `libm`);
2. lays out the dsp struct + the per-channel I/O buffers + the two pointer arrays in
   **fresh pages above faust's initial memory** (so they never collide with faust's
   static data), and writes the pointer arrays once;
3. `init` → `init(dsp, sr)`; `param(idx,v)` → `setParamValue(dsp, idx, v)`;
   `process` → de-interleave host input into the channel buffers, `compute(dsp, n,
   in_ptrs, out_ptrs)`, re-interleave the channel buffers into host output.

The same `WasmHostNode` then wraps EITHER kernel with the identical guard chain +
epoch-preemption + bypass, so `oj_*` and faust modules are audibly uniform. The dsp
byte size + param indices come from the faust `-json` the authoring side already
parses (`author_wasm_node`). `build_kernel` picks the adapter by sniffing the
module's imports/exports.

### Remaining to end-to-end faust → sound
1. `FaustWasmKernel` in `crates/ojwasm/src/backend.rs` (+ a faust-compiling test).
2. Wire `ojwasm` into the `oj-tauri` engine/registry; `author_wasm_node` stores the
   bytes (fixing the discarded-bytes gap) and registers the loader + recompiles.
3. The 64-sample `<5 ms` benchmark on real hardware (the MOTU M4 is present).
