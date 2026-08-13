//! The ONE plugin manifest. A [`PluginManifest`] is the static, serializable
//! description of a node type: built-in DSP, a Faust node, an AI-WASM node, and
//! a hosted plugin are ALL described by this same struct ("everything is a
//! plugin", governing principle #2).
//!
//! [`PluginManifest::id`] is the OPEN registry key (an arbitrary string such as
//! `"builtin.gain"` or `"faust.reverb.v3"`). [`PluginManifest::kind`] is the
//! CLOSED [`PrimitiveKind`] the real-time loop lowers that key to — so new
//! manifests can register at runtime without ever touching the RT match arms.
//!
//! This module mirrors `schemas/oj-plugin-v1.json` (JSON Schema, draft
//! 2020-12); `dsp` / `ui` serialize lowercase to match the frozen enum sets.

use alloc::string::String;
use alloc::vec::Vec;
use serde::{Deserialize, Serialize};

use ojproto::PrimitiveKind;

/// How a node's audio is actually computed — selects the executor backend.
/// The string set `{builtin,faust,wasm,none}` is frozen by the v1 schema.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DspKind {
    /// Native Rust kernel compiled into the engine (e.g. the [`crate::GainNode`]).
    Builtin,
    /// Faust-generated DSP hosted via the `FaustHost` primitive.
    Faust,
    /// A WebAssembly module hosted via the `WasmHost` primitive.
    Wasm,
    /// No audio processing (pure routing / I/O / control nodes).
    None,
}

/// How the node's control surface is presented. The string set `{auto,react}`
/// is frozen by the v1 schema.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum UiKind {
    /// Generate a default control surface from [`PluginManifest::params`].
    Auto,
    /// A bespoke React component supplies the UI.
    React,
}

/// Declares one numeric parameter, addressed at runtime by `id`
/// (the one param-addressing scheme — same `u16` id as [`ojproto::Param`]).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ParamDecl {
    pub id: u16,
    pub name: String,
    pub min: f32,
    pub max: f32,
    pub default: f32,
}

/// serde default for the additive per-port channel counts: `1` (mono), so a
/// manifest authored before stereo deserializes as mono.
fn one_channel() -> u8 {
    1
}

/// Declares a node's port topology (audio + control, in + out) and how many
/// CHANNELS each audio port carries (`1` = mono, `2` = stereo).
///
/// Per `docs/CHANNELS.md`: a port carries `n_channels` (one stereo cable, not paired
/// mono wires). The channel counts are a node-TYPE property declared here and DERIVED
/// by the compiler from the registry — additive and `1` by default, so the wire IR
/// never grows and a mono node is byte-identical to before.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct PortDecl {
    pub audio_in: u8,
    pub audio_out: u8,
    pub control_in: u8,
    pub control_out: u8,
    /// Channels carried by EACH audio INPUT port (`1` = mono, `2` = stereo). Default `1`.
    #[serde(default = "one_channel")]
    pub audio_in_channels: u8,
    /// Channels carried by EACH audio OUTPUT port. Default `1` (mono).
    #[serde(default = "one_channel")]
    pub audio_out_channels: u8,
}

impl PortDecl {
    /// Total audio INPUT lanes (`ports × channels`) a node's input scratch must hold.
    /// Channels clamp to `>= 1` so a malformed `0` never under-allocates.
    pub fn audio_in_lanes(&self) -> usize {
        self.audio_in as usize * self.audio_in_channels.max(1) as usize
    }

    /// Total audio OUTPUT lanes (`ports × channels`) a node's output buffers must hold.
    pub fn audio_out_lanes(&self) -> usize {
        self.audio_out as usize * self.audio_out_channels.max(1) as usize
    }
}

/// A contract/ABI version, `major.minor` (see [`Abi`] and `docs/STABILITY.md` §4).
/// A MAJOR bump is breaking; a higher MINOR is backward-compatible (new optional
/// capabilities). Compared with [`ContractVersion::satisfies`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct ContractVersion {
    pub major: u16,
    pub minor: u16,
}

impl ContractVersion {
    pub const fn new(major: u16, minor: u16) -> Self {
        Self { major, minor }
    }

    /// True if a kernel at `self` can load a plugin whose `min_contract` is `min`:
    /// the same MAJOR (no breaking gap) AND at least as new a MINOR.
    pub fn satisfies(self, min: ContractVersion) -> bool {
        self.major == min.major && self.minor >= min.minor
    }
}

/// One capability a plugin declares against the kernel contract. `id` is an OPEN
/// namespaced string — the `oj.*` prefix is kernel-reserved (each maps to a closed
/// [`crate::dsp::ExtId`]); the `vendor.*` prefix is for the community. `required`
/// = the plugin cannot run without it (an unknown REQUIRED capability degrades the
/// node to a labeled passthrough stub); otherwise it is optional (an unknown
/// OPTIONAL capability is simply not offered). See `docs/STABILITY.md` §4–5.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Capability {
    pub id: String,
    #[serde(default)]
    pub required: bool,
}

/// A coarse permission a plugin/distro declares it needs. DECLARED here; ENFORCED
/// at the out-of-process worker's OS sandbox token, never by the manifest itself
/// (see the native-plugin isolation model). Frozen v1 set.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Permission {
    /// Filesystem access beyond the node's own bundled assets.
    Fs,
    /// Network access.
    Net,
    /// Runs arbitrary native code (a hosted VST3/AU/CLAP or native code-node).
    Native,
}

/// The additive ABI / capability-negotiation block (`docs/STABILITY.md` §4). It is
/// OPTIONAL and strictly additive: a manifest without it is a pre-`abi` plugin that
/// targets the base contract and declares no capabilities or permissions. This is
/// the ONE surface that carries forward/backward compatibility (`min_contract`),
/// capability negotiation, and the declared permission set — so stability, trust,
/// and the distro min-kernel pin never fragment into competing manifest fields.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Abi {
    /// The kernel contract generation the plugin was built against (informational).
    pub contract: ContractVersion,
    /// The OLDEST kernel contract that can load this plugin — the load gate.
    pub min_contract: ContractVersion,
    /// Capabilities the plugin uses, each flagged required-or-optional.
    #[serde(default)]
    pub capabilities: Vec<Capability>,
    /// Coarse permissions the plugin declares it needs (enforced out-of-process).
    #[serde(default)]
    pub permissions: Vec<Permission>,
}

/// Why a plugin's [`Abi`] cannot be satisfied by the running kernel — the reason
/// carried into the labeled passthrough stub's diagnostic. Borrows the offending
/// capability id from the manifest, so it allocates nothing.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AbiUnsupported<'a> {
    /// The plugin's `min_contract` is newer than this kernel's contract.
    ContractTooNew { min: ContractVersion },
    /// The plugin REQUIRES a capability this kernel does not provide.
    MissingCapability { id: &'a str },
}

impl Abi {
    /// Iterate the ids of capabilities this plugin REQUIRES.
    pub fn required_capabilities(&self) -> impl Iterator<Item = &str> {
        self.capabilities
            .iter()
            .filter(|c| c.required)
            .map(|c| c.id.as_str())
    }

    /// Decide whether a kernel at `kernel` contract — supporting the capability ids
    /// for which `supported(id)` is true — can load this plugin. `Ok(())` = load
    /// normally; `Err(reason)` = degrade to a labeled passthrough stub, NEVER a
    /// crash and NEVER a refused project (`docs/STABILITY.md` §5).
    pub fn load_compatibility(
        &self,
        kernel: ContractVersion,
        supported: impl Fn(&str) -> bool,
    ) -> Result<(), AbiUnsupported<'_>> {
        if !kernel.satisfies(self.min_contract) {
            return Err(AbiUnsupported::ContractTooNew {
                min: self.min_contract,
            });
        }
        for id in self.required_capabilities() {
            if !supported(id) {
                return Err(AbiUnsupported::MissingCapability { id });
            }
        }
        Ok(())
    }
}

/// The complete static description of a registrable node type. Serializes to /
/// from the v1 JSON Schema (`schemas/oj-plugin-v1.json`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PluginManifest {
    /// OPEN registry key (arbitrary, namespaced string).
    pub id: String,
    /// Human-readable display name.
    pub name: String,
    /// CLOSED primitive the RT loop lowers `id` to.
    pub kind: PrimitiveKind,
    pub dsp: DspKind,
    pub ui: UiKind,
    pub params: Vec<ParamDecl>,
    pub ports: PortDecl,
    /// The additive ABI / capability-negotiation block (`docs/STABILITY.md` §4).
    /// `None` = a pre-`abi` plugin (the common built-in case): base contract, no
    /// declared capabilities or permissions. Strictly additive — absent in the v1
    /// JSON, so every existing manifest deserializes unchanged.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub abi: Option<Abi>,
}

#[cfg(test)]
mod abi_tests {
    use super::*;
    use alloc::string::String;
    use alloc::vec;

    fn cap(id: &str, required: bool) -> Capability {
        Capability {
            id: String::from(id),
            required,
        }
    }

    #[test]
    fn contract_version_satisfies_same_major_newer_minor() {
        let kernel = ContractVersion::new(1, 2);
        assert!(kernel.satisfies(ContractVersion::new(1, 0))); // older min: ok
        assert!(kernel.satisfies(ContractVersion::new(1, 2))); // equal: ok
        assert!(!kernel.satisfies(ContractVersion::new(1, 3))); // newer min: kernel too old
        assert!(!kernel.satisfies(ContractVersion::new(0, 9))); // different major
        assert!(!kernel.satisfies(ContractVersion::new(2, 0))); // different major
    }

    #[test]
    fn unsupported_optional_capability_still_loads() {
        let abi = Abi {
            contract: ContractVersion::new(1, 0),
            min_contract: ContractVersion::new(1, 0),
            capabilities: vec![cap("oj.latency", false)], // OPTIONAL
            permissions: vec![],
        };
        // The kernel supports nothing, but the capability is optional -> loads.
        assert_eq!(
            abi.load_compatibility(ContractVersion::new(1, 0), |_| false),
            Ok(())
        );
    }

    #[test]
    fn contract_too_new_degrades() {
        let abi = Abi {
            contract: ContractVersion::new(1, 5),
            min_contract: ContractVersion::new(1, 5),
            capabilities: vec![],
            permissions: vec![],
        };
        assert_eq!(
            abi.load_compatibility(ContractVersion::new(1, 0), |_| true),
            Err(AbiUnsupported::ContractTooNew {
                min: ContractVersion::new(1, 5),
            })
        );
    }

    #[test]
    fn missing_required_capability_degrades_then_loads_when_provided() {
        let abi = Abi {
            contract: ContractVersion::new(1, 0),
            min_contract: ContractVersion::new(1, 0),
            capabilities: vec![cap("vendor.secret", true)], // REQUIRED
            permissions: vec![Permission::Native],
        };
        // Unsupported required capability -> degrade (a labeled stub, never a crash).
        assert_eq!(
            abi.load_compatibility(ContractVersion::new(1, 0), |_| false),
            Err(AbiUnsupported::MissingCapability {
                id: "vendor.secret"
            })
        );
        // ...but loads cleanly once the kernel provides it.
        assert_eq!(
            abi.load_compatibility(ContractVersion::new(1, 0), |id| id == "vendor.secret"),
            Ok(())
        );
    }

    #[test]
    fn required_capabilities_filters_optional() {
        let abi = Abi {
            contract: ContractVersion::new(1, 0),
            min_contract: ContractVersion::new(1, 0),
            capabilities: vec![cap("oj.state", true), cap("oj.gui", false)],
            permissions: vec![],
        };
        let req: alloc::vec::Vec<&str> = abi.required_capabilities().collect();
        assert_eq!(req, vec!["oj.state"]);
    }

    #[test]
    fn port_decl_channel_lanes() {
        // Mono (default 1 channel per port): lanes == ports (byte-identical world).
        let mono = PortDecl {
            audio_in: 1,
            audio_out: 1,
            control_in: 0,
            control_out: 0,
            audio_in_channels: 1,
            audio_out_channels: 1,
        };
        assert_eq!(mono.audio_in_lanes(), 1);
        assert_eq!(mono.audio_out_lanes(), 1);

        // A stereo-out node: one output port carrying two channels = two lanes.
        let stereo_out = PortDecl {
            audio_in: 1,
            audio_out: 1,
            control_in: 0,
            control_out: 0,
            audio_in_channels: 1,
            audio_out_channels: 2,
        };
        assert_eq!(stereo_out.audio_in_lanes(), 1);
        assert_eq!(stereo_out.audio_out_lanes(), 2);

        // A malformed 0 channel-count clamps to >= 1 per port (never under-allocates).
        let malformed = PortDecl {
            audio_in: 2,
            audio_out: 0,
            control_in: 0,
            control_out: 0,
            audio_in_channels: 0,
            audio_out_channels: 0,
        };
        assert_eq!(malformed.audio_in_lanes(), 2);
        assert_eq!(malformed.audio_out_lanes(), 0);
    }
}
