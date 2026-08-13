# Licensing — plain language

> **Status: IN EFFECT.** OpenJammer is licensed under **AGPL-3.0-only WITH the OpenJammer Plugin
> Exception** — the AGPL ([LICENSE](LICENSE)) plus the active **Plugin Exception**
> ([LICENSE-EXCEPTION.md](LICENSE-EXCEPTION.md)) that makes proprietary/paid plugins legal. **In any
> conflict, [LICENSE](LICENSE) + [LICENSE-EXCEPTION.md](LICENSE-EXCEPTION.md) control over this
> explainer. This is not legal advice;** an attorney review is a welcome, non-blocking safety net.

## TL;DR

- **The instrument is AGPL-3.0.** Fork the OpenJammer kernel or app and your fork stays AGPL — no
  closed superset can undercut the commons.
- **Plugins are legal under any license, including paid/proprietary** — via the OpenJammer
  Plugin Exception. This is the deliberate, considered divergence from VCV Rack, whose exception only
  frees *free* plugins.
- **Your projects, sounds, recordings, and performances are yours.** Copyleft covers the *code*, not
  the *works you make* with it.

## 1. Why AGPL + an exception

The two beliefs decide it. *A minimal core made infinite by everyone* needs a legal path for a
community — including commercial creators — to build on the core. *No wall* means money may never gate
the instrument's depth or authoring. So: **strong copyleft on the instrument** (the commons is
protected — the lesson of VCV Rack's BSD era, where a paid, IP-infringing clone *plugin* ("Floats")
forced its move to GPL and a closed commercial *app fork* ("miRack") shipped legally from the
permissive code, between them threatening a 100+ developer community), and **a freely-granted plugin
exception** so a paid creator economy is legal. The exception is patterned on the GNU Classpath + GCC
Runtime Library exceptions (unconditional "under terms of your choice"), not VCV's free-only grant.

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

## 6. For contributors — the irreversibility fix (closed)

Once outside contributions accumulate under bare copyleft, a project **cannot amend its exception or
relicense without every contributor's consent** — the trap that froze Linux on GPLv2 and forced VLC's
multi-year relicensing campaign. OpenJammer closes it *before* the first outside PR, while the tree is
still 100% steward-authored. [CONTRIBUTING.md](CONTRIBUTING.md) now requires, by the act of
contributing:

> *By contributing you certify the Developer Certificate of Origin (DCO 1.1) and agree your
> contributions are licensed under AGPL-3.0-only WITH the OpenJammer Plugin Exception
> ([LICENSE](LICENSE) + [LICENSE-EXCEPTION.md](LICENSE-EXCEPTION.md)), and you grant the project
> steward permission to license your contribution under that Exception and under future versions of
> that Exception adopted by the steward.*

This is enforced by a **DCO sign-off check** ([.github/workflows/dco.yml](.github/workflows/dco.yml)).
The **"future versions" latitude** — *not* a broad proprietary CLA — is the load-bearing piece: it lets
a revised Exception (a v1.1, say) ship **without** chasing unanimous consent, while granting the steward
**no** right to take the project proprietary. The narrow scope is deliberate: relicensing latitude
without the rug-pull power that erodes contributor trust.

## 7. Trademark — a supporting moat (the marketplace is the real one)

Because the exception *deliberately* permits commercial plugins and does **not** copyleft them, the
license is not what stops a closed competitor — so be honest about what the trademark does. It protects
the **name**, not the project: rename-forks (OpenTofu, Valkey, OpenSearch) show a determined competitor
can simply rebrand and still gain traction. The **durable** anti-fork moat is therefore the **two-sided
plugin-marketplace network effect plus maintainer and community trust** — the things a rename cannot
take. The trademark plays a real *supporting* role: "OpenJammer" + the logo are marks of the steward,
forks must rename, and nominative use ("for OpenJammer", "compatible with OpenJammer") is always fine.
Its genuine leverage point is a licensed **"Certified for OpenJammer" badge** (the Apple "Made for
iPhone" model) — distinct from free nominative use, granted only through the marketplace.
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
pulls; and **libfaust/GRAME** + any bundled **`.sf2` soundfont** data (audit the specific asset). The
`deny.toml` license gate is now a **required** check (`supply-chain.yml`); because its allow-list is
exhaustive, the copyleft-poison licenses (SSPL / BUSL / Commons-Clause / CC-BY-NC) are denied by
omission. Generate the Part-A notice bundle with `just licenses` (cargo-about).

### JUCE-in-the-installer decision

**Keep JUCE as the default for the public binary installer** (its AGPLv3 option matches ours, so the
shipped VST3/AU/CLAP host is license-clean and needs no commercial JUCE seat), and **flip the
from-source / CI default to CLAP-only** (pure-Rust MIT `clack`): faster CI, no vendored-C++ burden, an
AGPL-JUCE-free build path for redistributors, and JUCE becomes an explicit opt-in capability rather than
an invisible default in every dev build. VST2 stays **owner-gated** (the Steinberg VST2 SDK is not freely
redistributable). *This is a build-config recommendation for owner ratification; it is not yet applied.*

## 10. SPDX / tooling

Keep `license = "AGPL-3.0-only"` in `Cargo.toml` (don't break `cargo-deny`/SPDX validators with a
non-standard id; an AGPL §7 additional permission is expressed out-of-band, not in the SPDX id). The
*effective* expression is the whole-license ref
**`LicenseRef-AGPL-3.0-only-WITH-OpenJammer-Plugin-Exception`** today (valid in SPDX 2.x; accepted by
`cargo-deny`/crates.io), migrating to **`AGPL-3.0-only WITH AdditionRef-OpenJammer-Plugin-Exception`**
once tooling supports SPDX 3.0's `AdditionRef-`. The form `... WITH LicenseRef-...` is **invalid** SPDX
(the right of `WITH` must be a registered exception id), so it is deliberately not used. Scanners may
flag "AGPL with unknown exception" — friction, not a defect.

## 11. Not legal advice

Everything above and in [LICENSE-EXCEPTION.md](LICENSE-EXCEPTION.md) was drafted carefully but is **not
legal advice**. The Exception is **in effect** — adopted by the steward while the tree was 100%
steward-owned, which is its strongest footing. A FOSS-competent attorney review remains a **welcome,
non-blocking** safety net; the checklist below is the brief to hand them, and the contributor
"future-versions" grant (§6) means any revision they suggest ships without a consent campaign.

---

## Appendix — Optional attorney-review checklist (non-blocking)

The Exception is already in effect; this is the brief to hand a FOSS-competent attorney **if and when**
you want a review. Items marked ✓ are already resolved, and the §6 future-versions grant means any
revision ships without unanimous consent:

1. **§1 grant wording** — confirm it reaches all intended plugin kinds (Faust, WASM, hosted) and that
   omitting VCV's "free of charge" condition validly permits **commercial proprietary plugins** under
   AGPL §7.
2. **§4 network clarification** — confirm it is a valid scope clarification (the steward declining to
   treat an independent plugin as part of *their* §13 Corresponding Source, not an attempt to waive a
   third party's rights). The mechanism has precedent (FSF §7 templates; SPDX
   `GPL-3.0-interface-exception`; translate5's AGPLv3 exception); untested in court, on its strongest
   footing because the steward owns the whole core. *Highest of the remaining items.*
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
7. ✓ **Contributor mechanism** — RESOLVED: DCO 1.1 + the narrow future-versions grant are adopted in
   [CONTRIBUTING.md](CONTRIBUTING.md) and enforced by [.github/workflows/dco.yml](.github/workflows/dco.yml),
   while the tree is still 100% steward-owned. A revised v1.1 ships without unanimous consent.
8. **Trademark** — register "OpenJammer" + logo (trademark counsel); adopt [TRADEMARK.md](TRADEMARK.md).
   Sequence: mark in place **before** marketplace launch.
9. **Third-party notice bundle** — confirm AGPL §4/§5 conveyance for the public installer, especially the
   hand-audited JUCE-under-AGPLv3 + Steinberg VST3-SDK-GPLv3 + libfaust/GRAME + bundled `.sf2` entries.
10. ✓ **SPDX / LicenseRef** — RESOLVED: `Cargo.toml` keeps `AGPL-3.0-only`; the effective expression is
    the whole-license ref `LicenseRef-AGPL-3.0-only-WITH-OpenJammer-Plugin-Exception` (§10). Confirm it
    does not misrepresent the license to redistributors.
11. **Marketplace revenue vehicle** — confirm the signed-marketplace **Terms of Service** (not the
    license, not the exception) is the right instrument for revenue-share + signing, keeping money off
    the license.
12. ✓ **`cargo deny check licenses`** — RESOLVED: gate promoted to **required** in `supply-chain.yml`;
    the cargo-deny v2 allow-list is exhaustive, so SSPL / BUSL / Commons-Clause / CC-BY-NC are denied by
    omission (v2 has no separate `deny` list). Re-run on a real toolchain whenever deps change.
