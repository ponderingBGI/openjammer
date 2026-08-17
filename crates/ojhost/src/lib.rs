//! OpenJammer third-party plugin host (UNIT U-JUCE).
//!
//! Hosts VST3 / CLAP (and AU on macOS) plugins so professional users can run
//! their existing tools inside OpenJammer. A hosted plugin is "just a plugin"
//! ([`ojcore::PluginLoader`] + [`ojcore::DspInstance`]): it registers under the
//! `host.plugin` manifest id, lowers to [`ojproto::PrimitiveKind::PluginHost`],
//! and the engine drives it through the identical node surface as a built-in.
//!
//! NATIVE-ONLY: this crate is never compiled to `wasm32`. ALL of OpenJammer's
//! C++ is confined to this crate boundary (the JUCE backend); the rest of the
//! engine stays Rust.
//!
//! # Backends (feature-gated, like `ojfaust`)
//!
//! The DEFAULT build is a dependency-free **scaffold**: [`scan`] returns empty,
//! [`HostedPlugin::load`] is [`HostError::Unavailable`], and the descriptor
//! marshalling / scan cache / crash blacklist / `DspInstance` bridge are all
//! fully present and unit-tested. Real hosting is gated:
//!
//! * `--features clap-host` — pure-Rust CLAP hosting via `clack` (MIT, no C++).
//!   The recommended path to host a real plugin in a CMake-less environment.
//! * `--features juce` — the bundled C++ JUCE 8 host (VST3 + CLAP, + AU on
//!   macOS), built by `build.rs` via CMake FetchContent.
//!
//! See `README.md` for the founder setup steps and the licensing posture.
//!
//! ```
//! use ojhost::{scan, HostedPlugin};
//! use std::path::PathBuf;
//!
//! // Scanning is always safe: empty in the scaffold, real with a backend on.
//! let found = scan(&[PathBuf::from("/no/such/dir")]).unwrap();
//! assert!(found.is_empty());
//! ```
#![forbid(unsafe_op_in_unsafe_fn)]

mod backend;
mod descriptor;
mod error;
mod node;
mod scan;

pub use backend::take_latency_rescan_request;
pub use backend::{HostedEvent, ParamGesture};
pub use descriptor::{
    HostedAudioPort, HostedParam, HostedPortConfig, PluginDescriptor, PluginFormat, PortCounts,
};
pub use error::HostError;
pub use node::{
    hosted_plugin_id, HostedPlugin, HostedStateBlob, PluginEditor, PluginHostLoader,
    PluginHostNode, PLUGIN_HOST_ID,
};
pub use scan::{
    candidate_paths, clap_plugin_dirs, clear_crash_marker, default_plugin_dirs,
    default_reliability_dir, probe_candidate, recover_crash_marker, scan, scan_with,
    set_scan_helper_path, write_crash_marker, Blacklist, ProbeHelperResponse, QuarantineEntry,
    ScanCache,
};

use ojcore::PluginRegistry;

/// Which hosting backend this build was compiled with — reported to the UI so it
/// can show "CLAP only" vs "VST3/CLAP/AU" vs "no hosting".
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HostingBackend {
    /// No backend (default scaffold): scanning is empty, loading is unavailable.
    None,
    /// Pure-Rust CLAP host via `clack`. CLAP only.
    ClapOnly,
    /// JUCE C++ host: VST2 (when owner-provisioned) + VST3 + CLAP (+ AU on macOS).
    Juce,
}

impl HostingBackend {
    /// The backend compiled into THIS build.
    pub const fn current() -> Self {
        #[cfg(feature = "juce")]
        {
            HostingBackend::Juce
        }
        #[cfg(all(feature = "clap-host", not(feature = "juce")))]
        {
            HostingBackend::ClapOnly
        }
        #[cfg(not(any(feature = "clap-host", feature = "juce")))]
        {
            HostingBackend::None
        }
    }

    /// Stable lowercase slug for the UI / logs: `"none" | "clap" | "juce"`.
    /// Lets the shell report which backend a build actually compiled in (the
    /// signal that tells "no plugins installed" apart from "hosting was never
    /// built into this `bun native` run").
    pub const fn slug(self) -> &'static str {
        match self {
            HostingBackend::None => "none",
            HostingBackend::ClapOnly => "clap",
            HostingBackend::Juce => "juce",
        }
    }

    /// The plugin formats this build can host.
    pub fn formats(self) -> &'static [PluginFormat] {
        match self {
            HostingBackend::None => &[],
            HostingBackend::ClapOnly => &[PluginFormat::Clap],
            #[cfg(target_os = "macos")]
            HostingBackend::Juce => &[
                PluginFormat::Vst2,
                PluginFormat::Vst3,
                PluginFormat::Clap,
                PluginFormat::Au,
            ],
            #[cfg(not(target_os = "macos"))]
            HostingBackend::Juce => &[PluginFormat::Vst2, PluginFormat::Vst3, PluginFormat::Clap],
        }
    }
}

/// Register one [`PluginHostLoader`] per scanned plugin into `reg`.
///
/// Each hosted plugin registers under a stable unique manifest id derived from
/// `(format, uid, path)`, so multiple scanned plugins can coexist and the native
/// IR can address the exact plugin by manifest id. Returns `0` (and registers
/// nothing) in the scaffold build, since [`scan`] finds no plugins there.
pub fn register_scanned(reg: &mut PluginRegistry, descriptors: &[PluginDescriptor]) -> usize {
    let mut n = 0;
    for desc in descriptors {
        reg.register(Box::new(PluginHostLoader::new(desc.clone())));
        n += 1;
    }
    n
}

/// DEV/TEST ONLY: arm the hosted-plugin crash boundary so the NEXT guarded
/// `processBlock` deliberately faults — used to PROVE the C++ SEH/signal latch on a
/// live machine, since the scaffold sandbox has no JUCE build to run it. A node
/// faults, the Rust latch quarantines it to a dry passthrough + crash badge, and
/// every sibling keeps playing.
///
/// A **no-op unless** the build has `juce` AND was built with `OJHOST_FAULT_INJECT=1`
/// (build.rs then emits `--cfg oj_fault_inject`). In any other build — including
/// every shipped one — the fault code is not compiled in, so this does nothing and
/// can never crash the app. Not for product code; the only caller is the dev-gated
/// Tauri command.
pub fn arm_fault() {
    #[cfg(all(feature = "juce", oj_fault_inject))]
    backend::arm_fault();
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::descriptor::PortCounts;

    #[test]
    fn current_backend_matches_features() {
        let b = HostingBackend::current();
        #[cfg(not(any(feature = "clap-host", feature = "juce")))]
        assert_eq!(b, HostingBackend::None);
        #[cfg(all(feature = "clap-host", not(feature = "juce")))]
        assert_eq!(b, HostingBackend::ClapOnly);
        #[cfg(feature = "juce")]
        assert_eq!(b, HostingBackend::Juce);
    }

    #[test]
    fn scaffold_backend_hosts_no_formats() {
        #[cfg(not(any(feature = "clap-host", feature = "juce")))]
        assert!(HostingBackend::current().formats().is_empty());
    }

    #[test]
    fn clap_backend_hosts_clap() {
        #[cfg(all(feature = "clap-host", not(feature = "juce")))]
        assert_eq!(HostingBackend::current().formats(), &[PluginFormat::Clap]);
    }

    #[test]
    fn register_scanned_adds_one_loader_per_descriptor() {
        let mut reg = PluginRegistry::new();
        let descs = vec![PluginDescriptor {
            uid: "com.acme.reverb".into(),
            name: "Acme Reverb".into(),
            vendor: "Acme".into(),
            path: "/p/AcmeReverb.clap".into(),
            format: PluginFormat::Clap,
            is_instrument: false,
            features: vec!["audio-effect".into(), "reverb".into()],
            has_gui: false,
            ports: PortCounts {
                audio_in: 2,
                audio_out: 2,
            },
            audio_ports: Vec::new(),
            port_configs: Vec::new(),
            note_ports: PortCounts::default(),
            param_count: 5,
            params: Vec::new(),
            latency_samples: 0,
        }];
        let id = hosted_plugin_id(&descs[0]);
        let n = register_scanned(&mut reg, &descs);
        assert_eq!(n, 1);
        assert!(reg.contains(&id));
        assert_eq!(reg.lower(&id), Some(ojproto::PrimitiveKind::PluginHost));
    }

    #[test]
    fn register_scanned_empty_registers_nothing() {
        let mut reg = PluginRegistry::new();
        assert_eq!(register_scanned(&mut reg, &[]), 0);
        assert!(!reg.contains(PLUGIN_HOST_ID));
    }

    #[test]
    fn default_plugin_dirs_are_nonempty_and_clap_shaped() {
        let dirs = default_plugin_dirs();
        assert!(!dirs.is_empty(), "no default plugin dirs for this platform");
        // At least one standard CLAP directory is present.
        assert!(
            dirs.iter().any(|d| {
                let s = d.to_string_lossy().to_lowercase();
                s.contains("clap")
            }),
            "default dirs missing a CLAP path: {dirs:?}"
        );
    }
}
