//! Scanning a set of directories for hostable plugins, with the two safety
//! mechanisms the unit requires when full out-of-process (OOP) scanning is
//! deferred: a persistent **blacklist** (a plugin that crashed a prior scan is
//! never probed again) and an on-disk **cache** (probe results are remembered so
//! a restart doesn't re-probe every plugin).
//!
//! # OOP posture (documented deferral)
//!
//! True out-of-process scanning — fork a child, probe one plugin, and treat the
//! child dying as "this plugin is bad" — is the safest default but needs a
//! second executable + an IPC channel. THIS unit defers full OOP and instead
//! ships the two pieces that make in-process scanning *recoverable*:
//!
//! * [`Blacklist`]: a plugin path is appended to the blacklist *before* it is
//!   probed and removed *after* it probes cleanly. So if a probe hard-crashes
//!   the process, the next run sees the path still blacklisted and skips it —
//!   the same crash never kills two scans. This is the standard "blacklist on
//!   crash" recovery DAWs use.
//! * [`ScanCache`]: clean probe results are persisted, so a restart lists
//!   plugins instantly without re-probing.
//!
//! The C++ JUCE backend can later promote this to genuine OOP (JUCE ships
//! `PluginDirectoryScanner` + a child-process pattern); the blacklist/cache file
//! formats are designed to carry over unchanged. See the crate README.

use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};

use crate::backend;
use crate::descriptor::{PluginDescriptor, PluginFormat};
use crate::error::HostError;

/// A persistent set of plugin paths that must NOT be probed (they crashed, or
/// are mid-probe in a run that may yet crash). Stored newline-delimited so it is
/// human-inspectable and trivially mergeable.
#[derive(Debug, Default, Clone)]
pub struct Blacklist {
    entries: BTreeSet<String>,
    /// Where to persist; `None` means in-memory only (tests).
    file: Option<PathBuf>,
}

impl Blacklist {
    /// An in-memory blacklist (not persisted). Used by tests and the no-cache
    /// scan path.
    pub fn in_memory() -> Self {
        Self {
            entries: BTreeSet::new(),
            file: None,
        }
    }

    /// Load (or start) a blacklist backed by `file`. A missing file is an empty
    /// blacklist, not an error.
    pub fn load(file: impl Into<PathBuf>) -> Self {
        let file = file.into();
        let entries = match fs::read_to_string(&file) {
            Ok(text) => text
                .lines()
                .map(str::trim)
                .filter(|l| !l.is_empty())
                .map(str::to_owned)
                .collect(),
            Err(_) => BTreeSet::new(),
        };
        Self {
            entries,
            file: Some(file),
        }
    }

    /// Whether `path` is currently blacklisted.
    pub fn contains(&self, path: &str) -> bool {
        self.entries.contains(path)
    }

    /// Number of blacklisted paths.
    pub fn len(&self) -> usize {
        self.entries.len()
    }

    /// Whether the blacklist is empty.
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    /// Mark `path` as suspect *before* probing it and flush immediately, so a
    /// hard crash mid-probe leaves the path blacklisted for the next run.
    pub fn mark_before_probe(&mut self, path: &str) -> Result<(), HostError> {
        if self.entries.insert(path.to_owned()) {
            self.flush()?;
        }
        Ok(())
    }

    /// Clear `path` *after* it probed cleanly, and flush.
    pub fn clear_after_probe(&mut self, path: &str) -> Result<(), HostError> {
        if self.entries.remove(path) {
            self.flush()?;
        }
        Ok(())
    }

    fn flush(&self) -> Result<(), HostError> {
        if let Some(file) = &self.file {
            if let Some(parent) = file.parent() {
                fs::create_dir_all(parent).map_err(HostError::Io)?;
            }
            let mut text = String::new();
            for e in &self.entries {
                text.push_str(e);
                text.push('\n');
            }
            fs::write(file, text).map_err(HostError::Io)?;
        }
        Ok(())
    }
}

/// An on-disk cache of clean scan results, keyed by plugin path. JSON so it
/// survives a backend change and is debuggable.
#[derive(Debug, Default, Clone, serde::Serialize, serde::Deserialize)]
pub struct ScanCache {
    /// Cached descriptors, in scan order.
    pub descriptors: Vec<PluginDescriptor>,
}

impl ScanCache {
    /// Load a cache from `file`; a missing/corrupt file yields an empty cache.
    pub fn load(file: impl AsRef<Path>) -> Self {
        fs::read_to_string(file.as_ref())
            .ok()
            .and_then(|t| serde_json::from_str(&t).ok())
            .unwrap_or_default()
    }

    /// Persist this cache to `file` (creating parent dirs).
    pub fn save(&self, file: impl AsRef<Path>) -> Result<(), HostError> {
        let file = file.as_ref();
        if let Some(parent) = file.parent() {
            fs::create_dir_all(parent).map_err(HostError::Io)?;
        }
        let text = serde_json::to_string_pretty(self).map_err(HostError::Serde)?;
        fs::write(file, text).map_err(HostError::Io)
    }
}

/// Walk `dirs` and return one [`PluginDescriptor`] per hostable plugin found,
/// in-memory only (no cache, no persistent blacklist). The simple entry point.
///
/// In the default (scaffold) build the backend probe returns nothing, so this
/// returns an empty `Vec` regardless of what files exist — the documented
/// no-plugin-safe behaviour. With a real backend feature on, it probes each
/// candidate binary.
pub fn scan(dirs: &[PathBuf]) -> Result<Vec<PluginDescriptor>, HostError> {
    let mut blacklist = Blacklist::in_memory();
    scan_with(dirs, &mut blacklist, None)
}

/// Like [`scan`] but with an explicit [`Blacklist`] and optional [`ScanCache`]
/// path. A candidate already in the cache is reused (not re-probed); a candidate
/// in the blacklist is skipped; everything else is probed under the
/// mark-before / clear-after crash guard, and clean results are written back to
/// the cache.
pub fn scan_with(
    dirs: &[PathBuf],
    blacklist: &mut Blacklist,
    cache_file: Option<&Path>,
) -> Result<Vec<PluginDescriptor>, HostError> {
    let mut cache = cache_file.map(ScanCache::load).unwrap_or_default();
    let mut out: Vec<PluginDescriptor> = Vec::new();

    for path in candidate_paths(dirs) {
        let path_str = path.to_string_lossy().into_owned();

        // Already known-good in the cache: reuse without re-probing.
        if let Some(hit) = cache.descriptors.iter().find(|d| d.path == path_str) {
            out.push(hit.clone());
            continue;
        }

        // Known-bad (crashed a prior probe, or mid-probe in a run that died):
        // skip. This is the crash-recovery guarantee.
        if blacklist.contains(&path_str) {
            continue;
        }

        let format = match path
            .extension()
            .and_then(|e| e.to_str())
            .and_then(PluginFormat::from_extension)
        {
            Some(f) => f,
            None => continue,
        };

        // Guard the probe: blacklist BEFORE, clear AFTER a clean probe.
        blacklist.mark_before_probe(&path_str)?;
        match backend::probe(&path, format) {
            Ok(found) => {
                blacklist.clear_after_probe(&path_str)?;
                for d in found {
                    cache.descriptors.push(d.clone());
                    out.push(d);
                }
            }
            Err(e) => {
                // A *soft* probe error (e.g. not actually a plugin) leaves the
                // path blacklisted so we don't keep re-probing a dud, but is not
                // fatal to the overall scan.
                let _ = e;
            }
        }
    }

    if let Some(file) = cache_file {
        cache.save(file)?;
    }
    Ok(out)
}

/// Enumerate candidate plugin paths under `dirs` (one level of recursion into
/// directories; bundles like `.vst3`/`.component` are returned as their
/// directory path, which is what the backend opens). Missing dirs are skipped.
fn candidate_paths(dirs: &[PathBuf]) -> Vec<PathBuf> {
    let mut found = Vec::new();
    for dir in dirs {
        collect_candidates(dir, &mut found, 0);
    }
    found.sort();
    found.dedup();
    found
}

/// Bounded-depth directory walk. Plugin bundles are themselves directories with
/// a known extension; treat those as leaves (do not descend into them).
fn collect_candidates(dir: &Path, out: &mut Vec<PathBuf>, depth: usize) {
    const MAX_DEPTH: usize = 4;
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let is_plugin_ext = path
            .extension()
            .and_then(|e| e.to_str())
            .and_then(PluginFormat::from_extension)
            .is_some();

        if is_plugin_ext {
            // A bundle dir or a `.clap` file: a leaf candidate either way.
            out.push(path);
        } else if path.is_dir() && depth < MAX_DEPTH {
            collect_candidates(&path, out, depth + 1);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn tmp_dir(tag: &str) -> PathBuf {
        let mut p = std::env::temp_dir();
        p.push(format!(
            "ojhost-test-{tag}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&p).unwrap();
        p
    }

    #[test]
    fn scan_empty_dirs_is_empty() {
        // The no-plugin-safe path: scanning nothing yields nothing, no error.
        let dir = tmp_dir("empty");
        let got = scan(std::slice::from_ref(&dir)).expect("scan ok");
        assert!(got.is_empty());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn scan_missing_dir_is_not_an_error() {
        let got = scan(&[PathBuf::from("/no/such/ojhost/dir")]).expect("scan ok");
        assert!(got.is_empty());
    }

    #[test]
    fn candidate_paths_finds_plugin_extensions_only() {
        let dir = tmp_dir("candidates");
        // A CLAP file, a VST3 bundle dir, and an unrelated file.
        let clap = dir.join("Synth.clap");
        fs::File::create(&clap).unwrap().write_all(b"x").unwrap();
        let vst3 = dir.join("Comp.vst3");
        fs::create_dir_all(&vst3).unwrap();
        let other = dir.join("notes.txt");
        fs::File::create(&other).unwrap().write_all(b"x").unwrap();

        let cands = candidate_paths(std::slice::from_ref(&dir));
        assert!(cands.contains(&clap), "should find .clap");
        assert!(cands.contains(&vst3), "should find .vst3 bundle dir");
        assert!(!cands.contains(&other), "should ignore non-plugin files");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn blacklist_persists_and_skips() {
        let dir = tmp_dir("blacklist");
        let bl_file = dir.join("blacklist.txt");

        let mut bl = Blacklist::load(&bl_file);
        assert!(bl.is_empty());
        bl.mark_before_probe("/p/bad.clap").unwrap();
        assert!(bl.contains("/p/bad.clap"));
        assert_eq!(bl.len(), 1);

        // Reload from disk: still blacklisted (the crash-recovery guarantee).
        let reloaded = Blacklist::load(&bl_file);
        assert!(reloaded.contains("/p/bad.clap"));

        // Clear-after-clean-probe removes and re-persists.
        let mut bl2 = Blacklist::load(&bl_file);
        bl2.clear_after_probe("/p/bad.clap").unwrap();
        assert!(Blacklist::load(&bl_file).is_empty());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn blacklisted_candidate_is_skipped_during_scan() {
        let dir = tmp_dir("skip");
        let clap = dir.join("Bad.clap");
        fs::File::create(&clap).unwrap().write_all(b"x").unwrap();

        let mut bl = Blacklist::in_memory();
        bl.mark_before_probe(&clap.to_string_lossy()).unwrap();

        // Even with a real backend, a blacklisted path must never reach probe.
        let got = scan_with(std::slice::from_ref(&dir), &mut bl, None).expect("scan ok");
        assert!(got.is_empty());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn cache_roundtrips_through_disk() {
        let dir = tmp_dir("cache");
        let file = dir.join("cache.json");

        let cache = ScanCache {
            descriptors: vec![crate::descriptor::PluginDescriptor {
                uid: "x".into(),
                name: "X".into(),
                vendor: "V".into(),
                path: "/p/x.clap".into(),
                format: PluginFormat::Clap,
                is_instrument: true,
                ports: crate::descriptor::PortCounts {
                    audio_in: 0,
                    audio_out: 2,
                },
                param_count: 3,
                latency_samples: 0,
            }],
        };
        cache.save(&file).unwrap();
        let back = ScanCache::load(&file);
        assert_eq!(back.descriptors.len(), 1);
        assert_eq!(back.descriptors[0].uid, "x");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn corrupt_cache_loads_as_empty() {
        let dir = tmp_dir("corrupt");
        let file = dir.join("cache.json");
        fs::write(&file, b"{ this is not json").unwrap();
        let back = ScanCache::load(&file);
        assert!(back.descriptors.is_empty());
        let _ = fs::remove_dir_all(&dir);
    }
}
