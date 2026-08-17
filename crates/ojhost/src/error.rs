//! Errors raised off the audio thread by the host (scan / load / activate).
//!
//! Everything here is control-rate: NONE of these are ever returned from the
//! real-time `process` path (which cannot fail or allocate). They surface to the
//! UI as strings via the Tauri boundary.

use std::fmt;

/// Why a host operation failed.
#[derive(Debug)]
pub enum HostError {
    /// No real hosting backend is compiled in (neither `clap-host` nor `juce`),
    /// or the backend's runtime prerequisites are missing. **Terminal**: the
    /// scaffold default always returns this from any *load*. Scanning still
    /// succeeds (it returns an empty list), so the UI degrades gracefully.
    Unavailable,
    /// The requested plugin (by path + uid) was not found by any backend.
    NotFound {
        /// The path that was searched.
        path: String,
        /// The plugin uid that was requested within it.
        uid: String,
    },
    /// The backend failed to load/instantiate the plugin. `message` carries the
    /// backend diagnostic verbatim.
    Load {
        /// The backend's load diagnostic.
        message: String,
    },
    /// A filesystem error while scanning / reading the cache or blacklist.
    Io(std::io::Error),
    /// A (de)serialization error for the on-disk scan cache.
    Serde(serde_json::Error),
}

impl fmt::Display for HostError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            HostError::Unavailable => f.write_str(
                "plugin hosting unavailable: build ojhost with `--features clap-host` \
                 (pure-Rust CLAP) or `--features juce` (VST3/AU) — see crate README",
            ),
            HostError::NotFound { path, uid } => {
                write!(f, "no plugin with uid '{uid}' at '{path}'")
            }
            HostError::Load { message } => write!(f, "plugin load failed: {message}"),
            HostError::Io(e) => write!(f, "host I/O error: {e}"),
            HostError::Serde(e) => write!(f, "scan cache (de)serialization error: {e}"),
        }
    }
}

impl std::error::Error for HostError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            HostError::Io(e) => Some(e),
            HostError::Serde(e) => Some(e),
            _ => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unavailable_message_points_at_features() {
        let s = HostError::Unavailable.to_string();
        assert!(s.contains("clap-host"));
        assert!(s.contains("juce"));
    }

    #[test]
    fn not_found_names_the_target() {
        let e = HostError::NotFound {
            path: "/p/x.clap".into(),
            uid: "com.acme".into(),
        };
        let s = e.to_string();
        assert!(s.contains("/p/x.clap"));
        assert!(s.contains("com.acme"));
    }
}
