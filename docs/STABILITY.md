# The Stability Contract — "Don't Break Userspace"

This document answers one question, once, so it stops being re-litigated on every release:
**what does OpenJammer promise will never break, what is free to churn, and how does a new
capability arrive without breaking either.** It is the social contract that makes the
Linux-kernel/distro model real here: *all distros share one kernel* is only true if a plugin,
a project, or a distro authored against the kernel keeps working as the kernel evolves.

It assumes the two beliefs in [agents.md](../agents.md) and the tier split in
[BOUNDARY.md](./BOUNDARY.md). Where BOUNDARY.md decides *which side of the Rust/TS line* a
piece of code lives on, this document decides *which surfaces are frozen* and *how they grow*.

> **Linus's rule, ported:** the kernel may rewrite its own guts freely, but it must never break
> a program that ran against its published interface. OpenJammer's "published interface" is the
> **persisted project + the plugin contract**, not the internals.

---

## 1. Two promises, made to two different audiences

OpenJammer has two ABI surfaces with two *different* guarantees. Conflating them is the mistake
this document exists to prevent.

| Surface | Audience | Promise | Strength |
|---|---|---|---|
| **The persisted surface** — a saved `.oj` project, a published plugin/distro manifest, the `manifest_id` string | A project file, a community plugin, another machine, a future kernel | **Forward + backward compatible.** A project saved today opens on a kernel released years from now; a plugin authored today still loads. | **Frozen. This is the userspace ABI.** |
| **The in-process trait** — `DspInstance` (`crates/ojcore/src/dsp.rs`) as a *recompiled Rust trait* | Code compiled *into one workspace build* | **Source compatible within a build.** All instances compile against one trait generation; defaulted methods grow it without breaking in-tree implementors. | **Source-stable, not binary-stable.** |

The repo today protects the wire IR (`crates/ojproto`) mechanically but has **no written policy**
for the persisted *plugin/project* surface — `manifest.rs` states the *intent* (the open/closed
split, `manifest.rs:6-9`) but nothing names what is frozen. This document is that policy.

---

## 2. The three FROZEN surfaces

These do not change in a breaking way. New information is added only by the additive mechanisms in
§4. Breaking one of these breaks userspace.

### FROZEN-1 — The persisted project
A saved project round-trips on any kernel, even one that has never heard of a node in it. It is:
- the **`manifest_id`** (the open registry key, e.g. `"builtin.gain"`, `"faust.reverb.v3"`),
- an **opaque params + state blob** passed through untouched when the kernel doesn't recognize it,
- a **`schema_version`**, and
- the **port topology** (`n_in` / `n_out`, and post-stereo `n_channels`).

The rule: **an unknown node never deletes the user's work.** It loads as a *labeled passthrough
stub* (`crates/ojhost/src/node.rs` `PassthroughNode`) that preserves topology + params + the ref,
and auto-rebinds if the real node/asset reappears. This is *a held note beats a glitch* applied to
the load path — the project ALWAYS opens.

### FROZEN-2 — The real-time wire shapes
`RtCommand`, `RtEvent`, `EngineFrame`, `OjGraph`, and the `Event` envelope in
`crates/ojproto/src/lib.rs`, mirrored by `packages/oj-protocol-ts` and pinned by
`crates/ojproto/tests/wire_shapes.rs`. Extended **only additively**. The mechanical guards stay:
`RtCommand`/`RtEvent` ≤ 16 bytes (`lib.rs:241`, `lib.rs:407`). New per-note expression rides a
note-id *handle* (a versioned `NoteOnV2` keeping the cap), automation rides a separate timestamped
event ring — **never** a widened `NoteOn`, never a UI-shaped or audio-payload field.

### FROZEN-3 — The `DspInstance` hot path
`process`, `set_param`, `note_on`, `note_off`, `looper_action` (`crates/ojcore/src/dsp.rs`) are
frozen forever. They are the audio-thread surface; changing their signatures would break every
plugin and re-open the RT-safety proof. **New capabilities never add a hot-path method** — they
arrive through the off-RT extension-query (§4).

---

## 3. The UNSTABLE mechanism — the "in-tree drivers"

Everything else inside the kernel **churns freely**, because nothing outside the kernel binds to it:

- the **closed `PrimitiveKind` enum** (`crates/ojproto/src/lib.rs`) the RT loop matches on,
- the **compiler + scheduler** (`crates/ojcore/src/compile.rs`, `exec.rs`),
- the **built-in kernel set** (`crates/ojcore-dsp`, `crates/ojinstrument`).

These are OpenJammer's equivalent of Linux's in-tree drivers: refactor, rename, re-order, optimize
at will. The decoupling indirection that makes this safe is **`PluginRegistry::lower(manifest_id)
-> PrimitiveKind`** (`crates/ojcore/src/registry.rs:64`): compilation asks the registry to map the
*open* key to the *closed* primitive, so a new manifest-registered node (AI / Faust / hosted plugin)
appears at runtime **without editing the enum**, and the enum can be reshaped without touching any
persisted project.

> **The open/closed split IS the kernel/userspace split.** The open `manifest_id` string is the
> stable userspace API; the closed `PrimitiveKind` enum is the in-tree driver set; `lower()` is the
> system-call table that decouples them.

---

## 4. How a new capability arrives — the additive `abi` block

`PluginManifest` (`crates/ojcore/src/manifest.rs`) today carries **no** version, min-kernel,
capability, permission, latency, or state information. Every future need (PDC latency, session
state, note-expression, offline-render, GUI, a permissions declaration) is the *same* need described
many ways. They converge to **one** strictly-additive optional block, mirrored in
`schemas/oj-plugin-v1.json` and `packages/oj-protocol-ts`:

```
abi: {
  contract:     { major, minor },   // the DspInstance trait generation this was built against
  min_contract: { major, minor },   // the OLDEST kernel that can load this plugin (the load gate)
  capabilities: [                   // each id open-namespaced: `oj.*` kernel-reserved, `vendor.*` community
    { id: "oj.latency",        required: false },  // unknown OPTIONAL cap -> not offered, still loads
    { id: "oj.state",          required: true  },  // unknown REQUIRED cap -> labeled stub, never a crash
  ],
  permissions:  ["fs", "net", "native"],  // declared here; ENFORCED at the OOP/OS-token point
}
```

The `required` flag per capability carries LV2's required-vs-optional split; the closed
[`crate::dsp::ExtId`] enum is the *runtime* counterpart the kernel maps each known `oj.*` id to.

This is **CLAP's `get_extension`-by-string-id pattern rendered as data**, plus **LV2's
required-vs-optional split** as the safety primitive. It is delivered through exactly **one** new
hot-path-frozen hook on the trait:

```rust
// crates/ojcore/src/dsp.rs — the ONLY way capabilities grow. ExtId is a CLOSED enum.
fn extension(&self, _id: ExtId) -> Option<&dyn core::any::Any> { None }
```

So `process`/`set_param`/`note_on`/`note_off` (FROZEN-3) never change. A new capability is **one
off-RT enum match returning a sub-trait object** (`LatencyExt`, `StateExt`, `OfflineRenderExt`, …),
never a vtable-growing method on the hot trait. The capability **namespace** is governed: the
reserved `oj.` prefix is kernel-registered; the open `vendor.` prefix is for the community.

### Why three version axes, packaged as one block
Overloading the existing `SCHEMA_VERSION` (`lib.rs:18`) would couple three *independent* change-rates:
a manifest-only capability like MPE would force a **wire** bump that breaks the TS-mirror parity test
(`wire_shapes.rs`) for no wire reason. So:
- **`SCHEMA_VERSION` stays wire-IR-only.** (The `lib.rs:359` "no second version axis" comment is
  correct for the *event taxonomy*; it does **not** govern the manifest, which legitimately needs its
  own axis. Document this where the comment lives.)
- **`contract`** is the `DspInstance` trait generation; **`min_contract`** is the oldest kernel that
  loads the plugin; a per-plugin semver lives in the manifest `id`/metadata.
- All three are carried by the **single additive `abi` field**, so `min_contract` + capabilities
  arrive **without a global breaking bump** — the only way distros can keep sharing one kernel.

The same block carries `permissions` + provenance, so **stability, trust, and the distro
min-kernel pin share one surface** rather than fragmenting into five competing manifest additions.

---

## 5. Graceful degradation — the negotiation rules

The contract is only "unbreakable" if mismatches degrade instead of crash:

| Situation | Behavior |
|---|---|
| **Old plugin on a new kernel** | Unknown `optional` capability ids return `None` from `extension()`; the plugin loads and runs. New kernel features it predates simply aren't offered to it. |
| **New plugin on an old kernel** | An unknown **`required`** capability (or `min_contract` > the running kernel) is refused with a *diagnostic*, and the node degrades to a **labeled passthrough stub** (FROZEN-1) — never a crash, never a refused project. |
| **Unknown `manifest_id` entirely** | Labeled passthrough stub that preserves topology + params + the ref and auto-rebinds (FROZEN-1). |

A version/capability mismatch must **never** surface as a modal error or a refused project — that
would be the "wall" `PRODUCT.md` forbids. It is always a quiet, labeled, reversible stub.

---

## 6. `PrimitiveKind` admission + deprecation policy

`PrimitiveKind` is UNSTABLE (§3), but adding a variant still touches every RT match arm, so it is
not free. **Admission test:** a kind enters the enum *only* when its behavior cannot be composed
from existing primitives + manifest params **and** it needs a distinct RT match arm. Otherwise it is
a manifest-registered node behind an existing bridge primitive (`FaustHost` / `WasmHost` /
`PluginHost`) — the default answer (code-value #2, *when in doubt it is a plugin*).

**Deprecation:** keep a variant and its `lower()` mapping until a **golden-old-project corpus** (one
curated `.oj` per released schema, in CI) no longer lowers any project to it. Never delete a variant
that any corpus project still reaches. This corpus is also the cheap, **device-free** CI proof that
the persisted surface (FROZEN-1) actually holds — `golden-old-project-opens` + the existing
bit-identical-bounce gate (`crates/ojinstrument/tests/golden_render.rs`) verify the stability
contract without a hardware rig.

---

## 7. The open sub-problem — a C-ABI for prebuilt third-party plugins

The promise above is **firm** for the **persisted surface** (FROZEN-1) and for **in-tree /
recompiled** plugins (built in the workspace against one trait generation). It is **soft** for a
*prebuilt third-party binary*: a Rust `dyn Trait` vtable is **not** a stable binary ABI across
compilers/versions, so a `.dll`/`.so` plugin compiled elsewhere cannot rely on `DspInstance` alone.
Closing this needs a **C-ABI seam** (a `#[repr(C)]` v-table, à la CLAP's C interface) at the dynamic
load boundary. That is future work; until it lands, "third-party plugins" means *hosted CLAP/VST3/AU*
(via `crates/ojhost`, their own stable ABIs) and *source/wasm nodes* (`ojfaust` / `ojwasm`, recompiled
or sandboxed), **not** prebuilt Rust `DspInstance` binaries.

---

## 8. When this changes

Like BOUNDARY.md, this is durable, not frozen-by-fiat. A FROZEN surface may gain a field only through
the additive mechanisms in §4 (never a breaking change), and the policy itself changes only when a
named condition fires — e.g. the C-ABI seam (§7) is built, or the persisted format adopts a new
container (the `.oj` Loro-CRDT container is such an additive evolution: a *new outer wrapper* around
the same frozen inner surfaces, with a `schema_version` header + the migration path in
`serialization.ts`). When in doubt, the answer mirrors agents.md: **the published interface does not
break; the internals are free.**

---

*Related: [BOUNDARY.md](./BOUNDARY.md) (which side of the Rust/TS line) · [agents.md](../agents.md)
(the two beliefs + code values) · `crates/ojcore/src/manifest.rs`, `registry.rs`, `dsp.rs`,
`crates/ojproto/src/lib.rs` (the surfaces this governs).*
