# OpenJammer Plugin Exception — v1.0

> **STATUS: IN EFFECT.** This is an active additional permission granted by the OpenJammer
> copyright holders under section 7 of the GNU Affero General Public License, version 3.
> OpenJammer is licensed under **AGPL-3.0-only WITH the OpenJammer Plugin Exception**
> ([LICENSE](LICENSE) + this file). In any conflict, [LICENSE](LICENSE) and this file control
> over the plain-language explainer in [LICENSING.md](LICENSING.md). **This is not legal advice;**
> an attorney review is a welcome, non-blocking safety net, not a precondition.
>
> *Why this exists:* OpenJammer's belief is "a minimal core made infinite by everyone." The
> AGPL keeps the **instrument** strongly copyleft (no closed superset can undercut the commons).
> That is the lesson VCV Rack learned in its permissive (BSD) era: a paid, IP-infringing clone
> *plugin* ("Floats") triggered its move to GPL at v1, and a closed commercial *app fork*
> ("miRack") shipped legally from the BSD code — showing how a permissive core lets a closed
> competitor undercut a 100+ developer commons. This Exception makes **plugins — including paid,
> proprietary ones — legal**, so a real creator economy can exist. It is patterned on the **GNU
> Classpath Exception** and the **GCC Runtime Library Exception** (unconditional "under terms of
> your choice"), deliberately **dropping VCV's "free of charge" condition** so commercial plugins
> are permitted. Money lives on the marketplace Terms of Service, never on the license (the "no
> wall" belief).

---

This Exception is an additional permission under section 7 of the GNU Affero General Public
License, version 3 ("AGPLv3"), the license under which OpenJammer (the "Covered Work") is
distributed. The copyright holders grant this Exception for the OpenJammer Covered Work as
distributed in the project's official repository as a whole, and it applies additionally to any
file of the Covered Work that carries a notice referring to this Exception. As permitted by
AGPLv3 section 7, any recipient may remove this Exception from any copy they convey (doing so
only makes that copy more strongly copyleft; it cannot affect copies obtained from upstream).

## 0. Definitions

**"The Covered Work"** means the OpenJammer kernel and application as distributed by the
copyright holders under AGPLv3, including in particular the in-tree built-in DSP kernels
(`crates/ojcore-dsp`, `crates/ojinstrument`), the compiler and scheduler (`crates/ojcore`
`compile.rs`, `exec.rs`), the `manifest_id`→`PrimitiveKind` registry implementation, and the
`PrimitiveKind` enumeration.

**"The Plugin Interface"** means, and is **limited to**, the stable published interface surfaces
of the Covered Work designated FROZEN in [docs/STABILITY.md](docs/STABILITY.md), namely:
(i) the `PluginManifest` type and the persisted `manifest_id` registry key (FROZEN-1); (ii) the
`ojproto` wire types `OjGraph`, `RtCommand`, `RtEvent`, `EngineFrame`, and the `Event` envelope
(FROZEN-2); (iii) the `DspInstance` trait hot-path surface — `process`, `set_param`, `note_on`,
`note_off`, `looper_action` — together with its additive off-real-time `extension(ExtId)` query
(FROZEN-3); and (iv) any C-ABI / IDL / header files the Covered Work publishes for authoring
nodes. The Plugin Interface does **not** include any other source of the Covered Work, and in
particular does not include the `PrimitiveKind` enumeration, the compiler, the scheduler, or the
built-in DSP kernels.

**"A Plugin"** is an Independent Module that provides a node to the Covered Work **and** interacts
with the Covered Work **solely** through the Plugin Interface, in any of these forms:

- **(b)** a node authored as Faust source and compiled for the Covered Work (via `crates/ojfaust`);
- **(c)** a code-node executed in the Covered Work's WebAssembly sandbox through the published
  `oj_*` ABI (via `crates/ojwasm`);
- **(d)** an external VST3, AU, or CLAP binary loaded across a process/FFI boundary by the Covered
  Work's host (via `crates/ojhost`).
- **RESERVED — (a)** a prebuilt third-party `DspInstance` binary loaded across a stable C-ABI seam:
  this form does **not yet exist** (see [docs/STABILITY.md](docs/STABILITY.md) §7; no such ABI is
  published). When that C-ABI seam is published, this Exception is intended to extend to that form;
  until then, any `DspInstance` compiled into the Covered Work in-tree is Covered Work, **not** a
  Plugin.

**"Independent Module"** means a module that makes use of the Plugin Interface but (1) is not
derived from or based on the Covered Work, **and** (2) does not copy a substantial portion of any
source of the Covered Work other than the Plugin Interface. **Both** conditions must hold.

## 1. Grant of additional permission

The copyright holders give you permission to use the Plugin Interface in source and binary forms
in your Plugin, and to link or combine your Plugin with the Covered Work and convey the resulting
combination, **regardless of the license terms of your Plugin** and even if doing so would
otherwise violate the terms of the AGPLv3. You may convey such a combination **under terms of your
choice — including proprietary and commercial terms** — consistent with the licensing of your
Plugin, provided that for each Independent Module so combined you also meet the terms and
conditions of the license of that module.

> *Deliberate deviation from VCV Rack:* VCV's grant is gated on "provided that the Plugin is
> distributed free of charge." That condition is **omitted** here so commercial proprietary plugins
> are permitted. Pattern source for the unconditional grant: GNU Classpath Exception + GCC Runtime
> Library Exception §1.

## 2. Non-interface source stays copyleft

This Exception grants no permission to copy any source of the Covered Work other than the Plugin
Interface. A work that copies a substantial portion of the Covered Work's non-Interface source, or
is otherwise derived from or based on the Covered Work, is a work based on the Covered Work, is
**not** a Plugin, and must be licensed in its entirety under the AGPLv3. In particular, a modified
or repackaged OpenJammer kernel or application is **never** a "Plugin" and never escapes the AGPLv3
by invoking this Exception.

> *This dual gate — solely-through-the-Interface **and** not-derived-from-the-core — is the primary
> anti-leak clause.* "Interface" is anchored to the named STABILITY.md FROZEN surfaces rather than a
> vague "significant portion," so the boundary is precise and self-maintaining as internals churn.

## 3. No weakening of copyleft on the Covered Work

The availability of this Exception does not imply that the Covered Work, or any modified version of
it, is exempt from the AGPLv3. Conveying a modified Covered Work (as opposed to an Independent
Module combined with it) remains fully governed by the AGPLv3, including section 13.

> *Pattern source: GCC Runtime Library Exception §2 "No Weakening of GCC Copyleft."*

## 4. Network use (AGPL section 13) clarification

For the avoidance of doubt, an Independent Module combined with the Covered Work under this
Exception does not, by virtue of that combination alone, become part of the Covered Work's
"Corresponding Source" under sections 1 and 13 of the AGPLv3. Operating a network service with the
Covered Work does not, under this Exception, oblige you to offer the source of independent Plugins
to remote users. Your section 13 obligation continues to cover the Covered Work and your
modifications to it in full, and is in no way diminished by this clause; this clause clarifies only
that the obligation does not reach independent Plugins.

> **Scope clarification, not a waiver.** This clause disposes only of the copyright holders' own
> §13 claim — it declines to treat an independent Plugin as part of *their* Corresponding Source.
> It does not, and could not, waive any third party's §13 rights. The mechanism is well
> established: the FSF's own §7 templates scope Corresponding Source, SPDX lists a
> `GPL-3.0-interface-exception`, and translate5 ships an AGPLv3 §7 exception that carves out
> independent plugins. It is on its strongest footing here because the copyright holders own the
> entire Covered Work. The clause is untested in court; an optional attorney review remains a
> welcome safety net (see [LICENSING.md](LICENSING.md)).

## 5. Generated and compiled DSP

DSP authored as Faust source, or emitted by the Covered Work's in-app authoring/AI tools, is the
author's Independent Module and is not a work based on the Covered Work merely because the Covered
Work's toolchain compiled or generated it. If the Covered Work's toolchain embeds any of the Covered
Work's own source (e.g. a runtime skeleton, glue, or template) into the emitted node, that embedded
portion is licensed to the node author under this same Exception so that the resulting node may
carry the author's chosen license.

> *Pattern source: GCC Runtime Library Exception rationale + the Bison/Autoconf output-exception
> principle.* **Action for counsel + engineering:** verify exactly what, if any, Covered-Work source
> `ojfaust`/`ojwasm` embeds into emitted nodes; if none, the second sentence is belt-and-suspenders;
> if some, this output-exception sentence is required.

## 6. Extension and removal

If you modify the Covered Work, you may extend this Exception to your version, but you are not
obligated to do so; if you do not wish to do so, you may delete this Exception statement from your
version.

> *Pattern source: GNU Classpath Exception final sentence.*

---

*Drafting provenance: VCV Rack v2 LICENSE.md (GPLv3 §7 plugin exception, structure), the GNU
Classpath Exception (unconditional "under terms of your choice"), and the GCC Runtime Library
Exception (combining/output, no-weakening). See [LICENSING.md](LICENSING.md) for the plain-language
explainer and the optional attorney-review checklist.*
