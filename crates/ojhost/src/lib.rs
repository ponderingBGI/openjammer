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

pub use descriptor::{PluginDescriptor, PluginFormat, PortCounts};
pub use error::HostError;
pub use node::{HostedPlugin, PluginHostLoader, PluginHostNode, PLUGIN_HOST_ID};
pub use scan::{scan, scan_with, Blacklist, ScanCache};

use ojcore::PluginRegistry;

/// Which hosting backend this build was compiled with — reported to the UI so it
/// can show "CLAP only" vs "VST3/CLAP/AU" vs "no hosting".
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HostingBackend {
    /// No backend (default scaffold): scanning is empty, loading is unavailable.
    None,
    /// Pure-Rust CLAP host via `clack`. CLAP only.
    ClapOnly,
    /// JUCE C++ host: VST3 + CLAP (+ AU on macOS).
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

    /// The plugin formats this build can host.
    pub fn formats(self) -> &'static [PluginFormat] {
        match self {
            HostingBackend::None => &[],
            HostingBackend::ClapOnly => &[PluginFormat::Clap],
            #[cfg(target_os = "macos")]
            HostingBackend::Juce => &[PluginFormat::Vst3, PluginFormat::Clap, PluginFormat::Au],
            #[cfg(not(target_os = "macos"))]
            HostingBackend::Juce => &[PluginFormat::Vst3, PluginFormat::Clap],
        }
    }
}

/// Register one [`PluginHostLoader`] per scanned plugin into `reg`.
///
/// All hosted plugins share the `host.plugin` manifest id, so a `PluginRegistry`
/// (keyed by id) holds exactly ONE of them at a time — the last registered wins.
/// This is sufficient for the current single-hosted-plugin path; a future unit
/// can extend the registry / IR to address multiple hosted plugins by descriptor
/// without changing this crate's public surface. Returns the number registered.
///
/// Returns `0` (and registers nothing) in the scaffold build, since [`scan`]
/// finds no plugins there.
pub fn register_scanned(reg: &mut PluginRegistry, descriptors: &[PluginDescriptor]) -> usize {
    let mut n = 0;
    for desc in descriptors {
        reg.register(Box::new(PluginHostLoader::new(desc.clone())));
        n += 1;
    }
    n
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
            ports: PortCounts {
                audio_in: 2,
                audio_out: 2,
            },
            param_count: 5,
            latency_samples: 0,
        }];
        let n = register_scanned(&mut reg, &descs);
        assert_eq!(n, 1);
        assert!(reg.contains(PLUGIN_HOST_ID));
        assert_eq!(
            reg.lower(PLUGIN_HOST_ID),
            Some(ojproto::PrimitiveKind::PluginHost)
        );
    }

    #[test]
    fn register_scanned_empty_registers_nothing() {
        let mut reg = PluginRegistry::new();
        assert_eq!(register_scanned(&mut reg, &[]), 0);
        assert!(!reg.contains(PLUGIN_HOST_ID));
    }
}
