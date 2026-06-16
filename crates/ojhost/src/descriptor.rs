//! The plugin description types every backend produces, and the format taxonomy.
//!
//! A [`PluginDescriptor`] is the static, serializable result of a *scan*: enough
//! to list a plugin in the UI and later re-open it by [`PluginDescriptor::path`]
//! plus [`PluginDescriptor::uid`]. It is intentionally backend-agnostic (the
//! same struct describes a CLAP found by `clack`, a VST3 found by JUCE, or an AU
//! on macOS) so the UI and the [`crate::scan`] cache never branch on backend.

use serde::{Deserialize, Serialize};

/// A hosted-plugin binary format. The set is closed: VST3, CLAP, and (macOS
/// only) Audio Unit. We carry AU in the enum on every platform so a cache file
/// written on macOS still deserializes elsewhere; scanning only *emits* AU on
/// macOS.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PluginFormat {
    /// Steinberg VST3 (`.vst3`). JUCE-hosted; the VST3 SDK terms apply.
    Vst3,
    /// CLEVER Audio Plugin (`.clap`). Hostable by both `clack` and JUCE; MIT.
    Clap,
    /// Apple Audio Unit (`.component`). macOS only; JUCE-hosted.
    Au,
}

impl PluginFormat {
    /// The conventional on-disk extension (no dot) for this format.
    pub fn extension(self) -> &'static str {
        match self {
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
            "vst3" => Some(PluginFormat::Vst3),
            "clap" => Some(PluginFormat::Clap),
            #[cfg(target_os = "macos")]
            "component" => Some(PluginFormat::Au),
            _ => None,
        }
    }
}

/// Audio port topology a hosted plugin reports, used to wire it into the graph.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct PortCounts {
    /// Main audio input channels (0 for an instrument).
    pub audio_in: u16,
    /// Main audio output channels.
    pub audio_out: u16,
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
    /// Number of automatable parameters the plugin exposes.
    pub param_count: u32,
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
            param_count: 12,
            latency_samples: 256,
        };
        let json = serde_json::to_string(&d).expect("serialize");
        let back: PluginDescriptor = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(d, back);
        // `format` serializes lowercase so it matches the UI's frozen enum set.
        assert!(json.contains("\"format\":\"clap\""));
    }
}
