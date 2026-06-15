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

/// Declares a node's port topology (audio + control, in + out).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct PortDecl {
    pub audio_in: u8,
    pub audio_out: u8,
    pub control_in: u8,
    pub control_out: u8,
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
}
