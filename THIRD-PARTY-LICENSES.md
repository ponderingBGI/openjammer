# Third-Party Licenses & Notices

> AGPL §4/§5 require that conveyed binaries carry the appropriate notices. This file has two parts:
> **(A)** the Rust dependency tree (auto-generated), and **(B)** components the cargo tooling **cannot
> see** and that must be **hand-maintained**. Part B is the load-bearing part — a paper-clean
> `cargo deny` gives false confidence about the vendored/native pieces.

## A. Rust dependency tree (auto-generated)

Generate the Part-A notice with **`just licenses`** (runs `cargo about generate` against the committed
[`about.toml`](about.toml)) and bundle the output into the installer payload at release:

```
just licenses               # writes THIRD-PARTY-RUST.html via cargo-about + about.toml
```

**Audit verdict (paper audit, pending a live `cargo deny check licenses` run):** the tree is **clean for
AGPL-3.0 distribution** — every dependency is permissive or AGPL-compatible (MIT, Apache-2.0,
Apache-2.0-WITH-LLVM-exception, BSD, ISC, Zlib, Unicode, MPL-2.0, CC0, BSL-1.0). No SSPL / BUSL /
Commons-Clause / CC-BY-NC present. **Action:** run `cargo deny check licenses` on a real toolchain,
promote `deny.toml`'s license gate to a **required** PR check, trim the allowlist to what is actually
present, and add explicit denials for SSPL-1.0, BUSL-1.1, Commons-Clause, and CC-BY-NC-*.

## B. Components cargo tooling cannot see (HAND-MAINTAINED)

| Component | What | License taken | Notes / action |
|---|---|---|---|
| **JUCE 8** | Vendored C++ (the `plugin-host-juce` host backend), pulled via CMake; not a crate | **AGPLv3** (JUCE is dual-licensed AGPLv3-or-commercial) | Its AGPLv3 option **matches** OpenJammer's AGPL-3.0 → the public installer's JUCE host is license-clean, no commercial JUCE seat needed. Document the AGPLv3 election in the shipped notice. |
| **Steinberg VST3 SDK** | Pulled by JUCE's VST3 path | **GPLv3** (AGPL-compatible) | Document in the installer notice. Only present when the JUCE host ships (the default public installer). |
| **Steinberg VST2 SDK** | VST2 hosting | Proprietary (not freely redistributable) | **OWNER-GATED.** Do **not** enable VST2 in the public installer without the Steinberg VST2 agreement (already reflected by the owner-provisioned VST2 note in `src-tauri`). |
| **libfaust / GRAME runtime** | Faust compilation (`ojfaust`, opt-in `libfaust` feature) + emitted Faust code | Confirm (GRAME) | Audit the libfaust + Faust standard-library + emitted-code licensing before shipping the live Faust path. |
| **Bundled `.sf2` soundfont(s)** | Sample data played by `rustysynth` (which is MIT) | Per-asset — **audit the specific file** | Many GM soundfonts are permissive/CC0; some are not. The soundfont **data** has its own license independent of `rustysynth`. Confirm before bundling. |

> **The default public installer** (`build-installers.yml` → `bun run tauri build`, default features) ships
> the AGPL-JUCE host. Ensure the AGPL text + [LICENSE-EXCEPTION.md](LICENSE-EXCEPTION.md) + this notice
> are bundled into the installer payload. See [LICENSING.md](LICENSING.md) §9 for the JUCE /
> CLAP-default decision.
