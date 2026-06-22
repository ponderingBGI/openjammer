# Licensing — plain language

> **Status: this describes a PROPOSAL.** OpenJammer is licensed today under the **GNU AGPL-3.0**
> ([LICENSE](LICENSE)) alone. The **Plugin Exception** that makes proprietary/paid plugins legal is a
> **draft** ([LICENSE-EXCEPTION.md](LICENSE-EXCEPTION.md)) that takes effect only after attorney review
> and steward adoption. **In any conflict, [LICENSE](LICENSE) + [LICENSE-EXCEPTION.md](LICENSE-EXCEPTION.md)
> control over this explainer. This is not legal advice.**

## TL;DR

- **The instrument is AGPL-3.0.** Fork the OpenJammer kernel or app and your fork stays AGPL — no
  closed superset can undercut the commons.
- **Plugins are legal under any license, including paid/proprietary** — via the (draft) OpenJammer
  Plugin Exception. This is the deliberate, considered divergence from VCV Rack, whose exception only
  frees *free* plugins.
- **Your projects, sounds, recordings, and performances are yours.** Copyleft covers the *code*, not
  the *works you make* with it.

## 1. Why AGPL + an exception

The two beliefs decide it. *A minimal core made infinite by everyone* needs a legal path for a
community — including commercial creators — to build on the core. *No wall* means money may never gate
the instrument's depth or authoring. So: **strong copyleft on the instrument** (the commons is
protected — the lesson of VCV Rack's BSD era, where the unlicensed "Floats" clone and the closed
"miRack" fork could undercut 100+ developers), and **a freely-granted plugin exception** so a paid
creator economy is legal. The exception is patterned on the GNU Classpath + GCC Runtime Library
exceptions (unconditional "under terms of your choice"), not VCV's free-only grant.

## 2. What the exception covers — the plugin kinds

A **Plugin** talks to the core *only* through the published contract and is any of: a **Faust** node,
a **WASM code-node** (the `oj_*` sandbox ABI), or a **hosted VST3 / AU / CLAP** binary. A future
**prebuilt-`DspInstance` C-ABI** kind is *reserved* — it does not exist yet ([STABILITY.md](docs/STABILITY.md)
§7). **Today's in-tree built-in DSP is part of the core, not a plugin.**

## 3. The boundary, for plugin authors

**Talk to the core only through the published contract** — `PluginManifest`, the `DspInstance` trait,
the `ojproto` wire types, and the `manifest_id` registry seam (the **FROZEN** surfaces in
[docs/STABILITY.md](docs/STABILITY.md)) — and **your plugin can carry any license you like, including
commercial.** Copy the core's *internals* (the compiler, scheduler, `PrimitiveKind`, the built-in
kernels) and you are bound by the AGPL. The boundary is the named frozen surfaces, not a vague
"how much did you copy."

## 4. Commercial / paid plugins — yes

Explicitly **legal**. The marketplace revenue-share and plugin signing are a **separate contract**
(the marketplace Terms of Service), **not** a condition of the license. Money stays entirely off the
license, so the "no wall" belief holds.

## 5. For service operators (AGPL §13)

§13 bites only on a **modified, networked** build. Per tier:

- **Native desktop app** — inert (local, single-user). No §13 obligation.
- **Browser PWA / LAN collab** — ship an in-app **"Source" → the exact running git commit** link (no
  charge) plus the bundled AGPL + exception text. Wire the commit hash in at build time; ship this with
  the *first* networked build so §13 is never retrofitted.
- **Future hosted convenience services** (cloud Faust build, remote-proxy agent, collab relay) — these
  run a modified networked engine and **must publish their own modified Corresponding Source** (the
  anti-closed-fork guarantee for the service tier). Exception §4 clarifies that **independent plugins
  are not pulled into that source**. Architect each service around an *unmodified* engine where feasible,
  and **get a counsel opinion per service before it ships** (the cloud Faust-build path — server-side
  compilation of third-party DSP — is the sharpest case).

## 6. For contributors — the irreversibility fix

Once outside contributions accumulate under AGPL-only terms, the project **cannot amend the exception
or relicense without every contributor's consent.** [CONTRIBUTING.md](CONTRIBUTING.md) today names only
AGPL and grants the steward no relicensing latitude — **this gap must be closed before accepting outside
PRs.** Recommended (draft, pending counsel):

> *By contributing, you certify the DCO and agree your contributions are licensed under AGPL-3.0-only
> WITH the OpenJammer Plugin Exception ([LICENSE](LICENSE) + [LICENSE-EXCEPTION.md](LICENSE-EXCEPTION.md)),
> and you grant the project steward permission to license your contribution under that Exception and
> under future versions of that Exception adopted by the steward.*

Enable a DCO sign-off check. A **lightweight steward-grant CLA** is recommended on top, because a
counsel-unreviewed exception will almost certainly need a v0.2 — and only a CLA lets that revision ship
without chasing unanimous consent.

## 7. Trademark — the real anti-fork moat

Because the exception *deliberately* permits commercial plugins and does **not** copyleft them, the
durable anti-fork protection is the **brand**, not the license. "OpenJammer" + the logo are marks of the
steward; forks must rename; nominative use ("for OpenJammer", "compatible with OpenJammer") is fine.
**Register the mark before marketplace launch.** See [TRADEMARK.md](TRADEMARK.md).

## 8. Your content is yours

Projects (`.oj` files), sounds, recordings, and performances you create with OpenJammer are yours. The
copyleft terms of the kernel and application do not extend to the works you author or perform with it.
(The Blender-style promise — orthogonal to the code exception.)

## 9. Dependencies & third-party components

A dependency-license audit found the Rust tree **clean for AGPL distribution** — every dependency is
permissive or AGPL-compatible (wasmtime/cranelift Apache-2.0-WITH-LLVM-exception, clack/cpal/serde/Loro/
rustysynth all MIT-or-Apache, etc.); **no SSPL/BUSL/Commons-Clause/CC-BY-NC** present. Two classes need a
**hand-maintained** [THIRD-PARTY-LICENSES.md](THIRD-PARTY-LICENSES.md) (cargo tooling can't see them):
**JUCE 8** (taken under its **AGPLv3** option — compatible) and the **Steinberg VST3 SDK** (GPLv3) it
pulls; and **libfaust/GRAME** + any bundled **`.sf2` soundfont** data (audit the specific asset). Promote
`deny.toml`'s license gate to a **required** check and add explicit denials for the copyleft-poison
licenses.

### JUCE-in-the-installer decision

**Keep JUCE as the default for the public binary installer** (its AGPLv3 option matches ours, so the
shipped VST3/AU/CLAP host is license-clean and needs no commercial JUCE seat), and **flip the
from-source / CI default to CLAP-only** (pure-Rust MIT `clack`): faster CI, no vendored-C++ burden, an
AGPL-JUCE-free build path for redistributors, and JUCE becomes an explicit opt-in capability rather than
an invisible default in every dev build. VST2 stays **owner-gated** (the Steinberg VST2 SDK is not freely
redistributable). *This is a build-config recommendation for owner ratification; it is not yet applied.*

## 10. SPDX / tooling

Keep `license = "AGPL-3.0-only"` in `Cargo.toml` (don't break `cargo-deny`/SPDX validators with a
non-standard id). The *effective* expression, expressed out-of-band, is
**`AGPL-3.0-only WITH LicenseRef-OpenJammer-Plugin-Exception`** (`LicenseRef-` because there is no
registered SPDX exception id). Scanners may flag "AGPL with unknown exception" — friction, not a defect.

## 11. Not legal advice

Everything above and in [LICENSE-EXCEPTION.md](LICENSE-EXCEPTION.md) is a careful **draft for counsel**.
The exception is **not in effect** until a FOSS-competent attorney reviews it (see the checklist below)
and the steward adopts it. Until then, OpenJammer is AGPL-3.0.

---

## Appendix — Counsel sign-off checklist

Hand this to a FOSS-competent attorney before adopting [LICENSE-EXCEPTION.md](LICENSE-EXCEPTION.md):

1. **§1 grant wording** — confirm it reaches all intended plugin kinds (Faust, WASM, hosted) and that
   omitting VCV's "free of charge" condition validly permits **commercial proprietary plugins** under
   AGPL §7.
2. **§4 network clarification** — the novel, no-precedent clause: confirm it is a valid scope
   clarification (not an unenforceable attempt to waive a third party's §13 rights) and actually keeps an
   independent plugin's source out of a hosted service's Corresponding Source. *Highest scrutiny.*
3. **§13 per future hosted service** — opine separately on each (cloud Faust build, remote-proxy agent,
   collab relay) **before it ships**; the server-side Faust-build path is the sharpest case.
4. **The dual anti-leak gate** (§0/§2: "solely through the Plugin Interface" **and** "not derived from or
   based on the Covered Work") — confirm it closes the forked-core-masquerading-as-a-plugin attack and
   that anchoring "Interface" to the STABILITY.md FROZEN list is sound and self-maintaining.
5. **Built-in exclusion + reserved C-ABI** — confirm the in-tree built-in `DspInstance`/kernels are
   Covered Work (pure AGPL), the future prebuilt C-ABI form is correctly reserved, and no current code
   path lets a built-in escape AGPL ([STABILITY.md](docs/STABILITY.md) §7).
6. **§5 generated/compiled DSP** — counsel **+ engineering** verify what (if any) Covered-Work source
   `ojfaust`/`ojwasm` embed into emitted nodes; if any, confirm the output-exception wording frees it.
7. **Contributor mechanism** — choose DCO-only vs the lightweight steward-grant CLA; draft the
   CONTRIBUTING.md inbound statement (naming the Exception + the steward relicensing grant) so a
   counsel-revised v0.2 won't need unanimous consent. **Do before accepting outside PRs.**
8. **Trademark** — register "OpenJammer" + logo (trademark counsel); adopt [TRADEMARK.md](TRADEMARK.md).
   Sequence: mark in place **before** marketplace launch.
9. **Third-party notice bundle** — confirm AGPL §4/§5 conveyance for the public installer, especially the
   hand-audited JUCE-under-AGPLv3 + Steinberg VST3-SDK-GPLv3 + libfaust/GRAME + bundled `.sf2` entries.
10. **SPDX / LicenseRef** — confirm keeping `license = "AGPL-3.0-only"` machine-readable while expressing
    the exception out-of-band does not misrepresent the license to redistributors.
11. **Marketplace revenue vehicle** — confirm the signed-marketplace **Terms of Service** (not the
    license, not the exception) is the right instrument for revenue-share + signing, keeping money off
    the license.
12. **`cargo deny check licenses`** — run on a real toolchain and promote the gate to **required**; the
    paper audit is not a substitute. Add explicit denials for SSPL / BUSL / Commons-Clause / CC-BY-NC.
