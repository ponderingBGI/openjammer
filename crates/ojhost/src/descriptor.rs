//! The plugin description types every backend produces, and the format taxonomy.
//!
//! A [`PluginDescriptor`] is the static, serializable result of a *scan*: enough
//! to list a plugin in the UI and later re-open it by [`PluginDescriptor::path`]
//! plus [`PluginDescriptor::uid`]. It is intentionally backend-agnostic (the
//! same struct describes a CLAP found by `clack`, a VST3 found by JUCE, or an AU
//! on macOS) so the UI and the [`crate::scan`] cache never branch on backend.

use serde::{Deserialize, Serialize};

/// A hosted-plugin binary format. The set is closed: VST2, VST3, CLAP, and
/// (macOS only) Audio Unit. We carry AU in the enum on every platform so a cache
/// file written on macOS still deserializes elsewhere; scanning only *emits* AU
/// on macOS.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PluginFormat {
    /// Steinberg VST2 (`.dll` Windows, `.vst` macOS, `.so` Linux). JUCE-hosted;
    /// owner-provisioned only because Steinberg discontinued the VST2 SDK.
    Vst2,
    /// Steinberg VST3 (`.vst3`). JUCE-hosted; the VST3 SDK terms apply.
    Vst3,
    /// CLEVER Audio Plugin (`.clap`). Hostable by both `clack` and JUCE; MIT.
    Clap,
    /// Apple Audio Unit (`.component`). macOS only; JUCE-hosted.
    Au,
}

impl PluginFormat {
    /// Stable lowercase format slug for ids / UI.
    pub fn slug(self) -> &'static str {
        match self {
            PluginFormat::Vst2 => "vst2",
            PluginFormat::Vst3 => "vst3",
            PluginFormat::Clap => "clap",
            PluginFormat::Au => "au",
        }
    }

    /// The conventional on-disk extension (no dot) for this format.
    pub fn extension(self) -> &'static str {
        match self {
            #[cfg(target_os = "windows")]
            PluginFormat::Vst2 => "dll",
            #[cfg(target_os = "macos")]
            PluginFormat::Vst2 => "vst",
            #[cfg(all(unix, not(target_os = "macos")))]
            PluginFormat::Vst2 => "so",
            #[cfg(not(any(target_os = "windows", target_os = "macos", unix)))]
            PluginFormat::Vst2 => "vst",
            PluginFormat::Vst3 => "vst3",
            PluginFormat::Clap => "clap",
            PluginFormat::Au => "component",
        }
    }

    /// Map a file extension (case-insensitive, no leading dot) to a format.
    /// AU is only recognized on macOS (its bundle extension is ambiguous
    /// elsewhere and we never host it off-macOS).
    pub fn from_extension(ext: &str) -> Option<PluginFormat> {
        match ext.to_ascii_lowercase().as_str() {
            #[cfg(target_os = "windows")]
            "dll" => Some(PluginFormat::Vst2),
            #[cfg(target_os = "macos")]
            "vst" => Some(PluginFormat::Vst2),
            #[cfg(all(unix, not(target_os = "macos")))]
            "so" => Some(PluginFormat::Vst2),
            "vst3" => Some(PluginFormat::Vst3),
            "clap" => Some(PluginFormat::Clap),
            #[cfg(target_os = "macos")]
            "component" => Some(PluginFormat::Au),
            _ => None,
        }
    }
}

/// Audio port topology a hosted plugin reports, used to wire it into the graph.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct PortCounts {
    /// Main audio input channels (0 for an instrument).
    pub audio_in: u16,
    /// Main audio output channels.
    pub audio_out: u16,
}

/// One automatable parameter a hosted plugin exposes. Captured at scan (the CLAP
/// params extension) so the UI shows a real knob with the plugin's own range,
/// and `set_param` can target the parameter by its stable id.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HostedParam {
    /// The plugin's stable parameter id (CLAP `clap_id`). The UI/engine address
    /// params by their 0-based INDEX; the backend maps index -> this id.
    pub id: u32,
    /// Display name, e.g. "Cutoff".
    pub name: String,
    /// Plugin-defined grouping path (CLAP `module`, slash-separated).
    #[serde(default)]
    pub module: String,
    /// Raw CLAP parameter flags. Kept losslessly so future UI policy does not
    /// require rescanning old plug-ins.
    #[serde(default)]
    pub flags: u32,
    /// Unit suffix inferred from the plug-in's value-to-text result for the
    /// default value. CLAP intentionally has no separate unit declaration.
    #[serde(default)]
    pub unit: String,
    /// Minimum plain value (the parameter's own range, NOT normalized).
    pub min: f64,
    /// Maximum plain value.
    pub max: f64,
    /// Default plain value.
    pub default: f64,
}

/// One CLAP audio bus. OpenJammer flattens buses, in declaration order, into
/// planar channels at its host boundary while retaining this metadata for UI
/// and future bus-aware routing.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HostedAudioPort {
    pub id: u32,
    pub name: String,
    pub channel_count: u32,
    pub is_input: bool,
    pub is_main: bool,
    pub in_place_pair: Option<u32>,
    pub port_type: Option<String>,
}

/// A selectable CLAP audio-port configuration.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HostedPortConfig {
    pub id: u32,
    pub name: String,
    pub input_ports: u32,
    pub output_ports: u32,
    pub input_channels: u32,
    pub output_channels: u32,
}

/// The static description of one scanned plugin. Backend-agnostic and
/// serializable so it round-trips through the on-disk scan cache and the Tauri
/// IPC boundary to the UI.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PluginDescriptor {
    /// Stable per-binary id. For CLAP this is the plugin's reverse-DNS id; for
    /// VST3/AU it is the component UID rendered as a string. Combined with
    /// [`PluginDescriptor::path`] it uniquely re-opens the plugin.
    pub uid: String,
    /// Human-readable plugin name (for the UI list).
    pub name: String,
    /// Vendor / manufacturer, if the format reports one.
    pub vendor: String,
    /// Filesystem path to the plugin binary/bundle that was scanned.
    pub path: String,
    /// Which binary format this descriptor came from.
    pub format: PluginFormat,
    /// Whether the plugin reports itself as an instrument (note consumer) vs a
    /// pure audio effect. Drives default wiring + whether note events route.
    pub is_instrument: bool,
    /// Audio port topology the plugin reported at scan time.
    pub ports: PortCounts,
    /// Detailed buses in CLAP declaration order. Empty for legacy cache entries
    /// and backends that only report flattened channel counts.
    #[serde(default)]
    pub audio_ports: Vec<HostedAudioPort>,
    /// Selectable CLAP port configurations, if exposed by the plug-in.
    #[serde(default)]
    pub port_configs: Vec<HostedPortConfig>,
    /// Number of note input and output ports reported by CLAP.
    #[serde(default)]
    pub note_ports: PortCounts,
    /// Number of automatable parameters the plugin exposes (equals
    /// `params.len()` when the backend filled the detailed list at scan).
    pub param_count: u32,
    /// The plugin's automatable parameters (id / name / range), captured at scan
    /// so the UI can render real knobs. Empty when a backend reports only a count
    /// (the UI then falls back to generic, index-named params).
    pub params: Vec<HostedParam>,
    /// Processing latency in samples the plugin reports (for PDC /
    /// Live-Monitoring budget enforcement). May be 0 at scan time and refined
    /// once the plugin is activated at the real sample rate.
    pub latency_samples: u32,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn format_extension_roundtrip() {
        #[cfg(target_os = "windows")]
        assert_eq!(PluginFormat::Vst2.extension(), "dll");
        #[cfg(target_os = "macos")]
        assert_eq!(PluginFormat::Vst2.extension(), "vst");
        #[cfg(all(unix, not(target_os = "macos")))]
        assert_eq!(PluginFormat::Vst2.extension(), "so");
        assert_eq!(PluginFormat::Vst3.extension(), "vst3");
        assert_eq!(PluginFormat::Clap.extension(), "clap");
        assert_eq!(PluginFormat::Au.extension(), "component");

        assert_eq!(
            PluginFormat::from_extension("VST3"),
            Some(PluginFormat::Vst3)
        );
        assert_eq!(
            PluginFormat::from_extension("clap"),
            Some(PluginFormat::Clap)
        );
        assert_eq!(PluginFormat::from_extension("wav"), None);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn au_recognized_only_on_macos() {
        assert_eq!(
            PluginFormat::from_extension("component"),
            Some(PluginFormat::Au)
        );
    }

    #[cfg(not(target_os = "macos"))]
    #[test]
    fn au_not_recognized_off_macos() {
        assert_eq!(PluginFormat::from_extension("component"), None);
    }

    #[test]
    fn descriptor_json_roundtrips() {
        let d = PluginDescriptor {
            uid: "com.acme.reverb".into(),
            name: "Acme Reverb".into(),
            vendor: "Acme".into(),
            path: "/plugins/AcmeReverb.clap".into(),
            format: PluginFormat::Clap,
            is_instrument: false,
            ports: PortCounts {
                audio_in: 2,
                audio_out: 2,
            },
            audio_ports: Vec::new(),
            port_configs: Vec::new(),
            note_ports: PortCounts::default(),
            param_count: 12,
            params: Vec::new(),
            latency_samples: 256,
        };
        let json = serde_json::to_string(&d).expect("serialize");
        let back: PluginDescriptor = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(d, back);
        // `format` serializes lowercase so it matches the UI's frozen enum set.
        assert!(json.contains("\"format\":\"clap\""));
    }
}
