//! Scanning a set of directories for hostable plugins, with the two safety
//! mechanisms required by the reliability contract: a disposable child process
//! per candidate, persistent quarantine with reasons, and an on-disk cache.
//!
//! # OOP posture
//!
//! The normal native build invokes `ojhost-scan-helper` once per candidate and
//! treats a signal, abort, timeout, or malformed response as quarantine. The
//! backend fallback exists only for embedders that do not ship the helper; the
//! Tauri application always ships it beside the main executable.
//!
//! * [`Blacklist`]: a plugin path is appended to the blacklist *before* it is
//!   probed and removed *after* it probes cleanly. So if a probe hard-crashes
//!   the process, the next run sees the path still blacklisted and skips it —
//!   the same crash never kills two scans. This is the standard "blacklist on
//!   crash" recovery DAWs use.
//! * [`ScanCache`]: clean probe results are persisted, so a restart lists
//!   plugins instantly without re-probing.
//!
use std::collections::BTreeMap;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::OnceLock;
use std::time::{Duration, Instant};

use crate::backend;
use crate::descriptor::{PluginDescriptor, PluginFormat};
use crate::error::HostError;

static SCAN_HELPER_OVERRIDE: OnceLock<PathBuf> = OnceLock::new();

/// Point scanning at the application's own executable (or a dedicated helper).
/// OpenJammer uses its packaged main binary in `--ojhost-scan-helper` mode, so
/// release bundles cannot accidentally omit the disposable scanner.
pub fn set_scan_helper_path(path: PathBuf) -> Result<(), PathBuf> {
    SCAN_HELPER_OVERRIDE.set(path)
}

/// A persistent set of plugin paths that must NOT be probed (they crashed, or
/// are mid-probe in a run that may yet crash). Stored newline-delimited so it is
/// human-inspectable and trivially mergeable.
#[derive(Debug, Default, Clone)]
pub struct Blacklist {
    entries: BTreeMap<String, QuarantineEntry>,
    /// Where to persist; `None` means in-memory only (tests).
    file: Option<PathBuf>,
}

/// Persisted reliability history for one plugin binary.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct QuarantineEntry {
    pub path: String,
    pub reason: String,
    pub crash_count: u8,
    pub quarantined: bool,
}

impl QuarantineEntry {
    pub fn benched(&self) -> bool {
        self.crash_count >= 2
    }
}

impl Blacklist {
    /// An in-memory blacklist (not persisted). Used by tests and the no-cache
    /// scan path.
    pub fn in_memory() -> Self {
        Self {
            entries: BTreeMap::new(),
            file: None,
        }
    }

    /// Load (or start) a blacklist backed by `file`. A missing file is an empty
    /// blacklist, not an error.
    pub fn load(file: impl Into<PathBuf>) -> Self {
        let file = file.into();
        let entries = fs::read_to_string(&file).map_or_else(
            |_| BTreeMap::new(),
            |text| {
                text.lines()
                    .filter_map(|line| {
                        let mut fields = line.splitn(4, '\t');
                        let count = fields.next()?.parse::<u8>().ok();
                        if let Some(count) = count {
                            let quarantined = fields.next()? == "1";
                            let reason = fields.next()?.to_owned();
                            let path = fields.next()?.to_owned();
                            Some((
                                path.clone(),
                                QuarantineEntry {
                                    path,
                                    reason,
                                    crash_count: count,
                                    quarantined,
                                },
                            ))
                        } else {
                            // Legacy newline-only blacklist.
                            let path = line.trim().to_owned();
                            (!path.is_empty()).then(|| {
                                (
                                    path.clone(),
                                    QuarantineEntry {
                                        path,
                                        reason: "scan was interrupted".into(),
                                        crash_count: 1,
                                        quarantined: true,
                                    },
                                )
                            })
                        }
                    })
                    .collect()
            },
        );
        Self {
            entries,
            file: Some(file),
        }
    }

    /// Whether `path` is currently blacklisted.
    pub fn contains(&self, path: &str) -> bool {
        self.entries
            .get(path)
            .is_some_and(|entry| entry.quarantined || entry.benched())
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
        self.entries
            .entry(path.to_owned())
            .or_insert_with(|| QuarantineEntry {
                path: path.to_owned(),
                reason: "scan was interrupted".into(),
                crash_count: 0,
                quarantined: true,
            })
            .quarantined = true;
        self.flush()?;
        Ok(())
    }

    /// Persist the reason a child failed. Two failures bench the binary.
    pub fn record_failure(
        &mut self,
        path: &str,
        reason: impl Into<String>,
    ) -> Result<(), HostError> {
        let entry = self
            .entries
            .entry(path.to_owned())
            .or_insert_with(|| QuarantineEntry {
                path: path.to_owned(),
                reason: String::new(),
                crash_count: 0,
                quarantined: true,
            });
        entry.reason = reason.into();
        entry.crash_count = entry.crash_count.saturating_add(1);
        entry.quarantined = true;
        self.flush()
    }

    /// Allow one explicit re-scan while retaining crash history.
    pub fn allow_rescan(&mut self, path: &str) -> Result<(), HostError> {
        if let Some(entry) = self.entries.get_mut(path) {
            entry.quarantined = false;
        }
        self.flush()
    }

    /// Full user pardon: remove quarantine and crash history.
    pub fn pardon(&mut self, path: &str) -> Result<(), HostError> {
        self.entries.remove(path);
        self.flush()
    }

    pub fn entries(&self) -> impl Iterator<Item = &QuarantineEntry> {
        self.entries.values()
    }

    /// Clear `path` *after* it probed cleanly, and flush.
    pub fn clear_after_probe(&mut self, path: &str) -> Result<(), HostError> {
        if self.entries.get(path).is_some_and(|e| e.crash_count == 0) {
            self.entries.remove(path);
        } else if let Some(entry) = self.entries.get_mut(path) {
            entry.quarantined = false;
        }
        self.flush()?;
        Ok(())
    }

    fn flush(&self) -> Result<(), HostError> {
        if let Some(file) = &self.file {
            if let Some(parent) = file.parent() {
                fs::create_dir_all(parent).map_err(HostError::Io)?;
            }
            let mut text = String::new();
            for entry in self.entries.values() {
                use std::fmt::Write as _;
                let reason = entry.reason.replace(['\t', '\n'], " ");
                writeln!(
                    &mut text,
                    "{}\t{}\t{}\t{}",
                    entry.crash_count,
                    u8::from(entry.quarantined),
                    reason,
                    entry.path
                )
                .expect("writing to String is infallible");
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

/// Arm the last-launched plugin marker before entering untrusted runtime code.
/// A clean shutdown removes it; if the process aborts, the next launch recovers
/// it into quarantine. This cannot save the current in-process host from
/// `abort()`—it makes the following launch calm and deterministic.
pub fn write_crash_marker(file: &Path, plugin_path: &str) -> Result<(), HostError> {
    if let Some(parent) = file.parent() {
        fs::create_dir_all(parent).map_err(HostError::Io)?;
    }
    fs::write(file, plugin_path).map_err(HostError::Io)
}

pub fn clear_crash_marker(file: &Path) -> Result<(), HostError> {
    match fs::remove_file(file) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(HostError::Io(error)),
    }
}

/// Consume a prior dirty marker into the persisted crash counter.
pub fn recover_crash_marker(
    file: &Path,
    quarantine: &mut Blacklist,
) -> Result<Option<String>, HostError> {
    let path = match fs::read_to_string(file) {
        Ok(path) => path,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(HostError::Io(error)),
    };
    let path = path.trim().to_owned();
    if !path.is_empty() {
        quarantine.record_failure(&path, "aborted while processing audio")?;
    }
    clear_crash_marker(file)?;
    Ok((!path.is_empty()).then_some(path))
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

/// The OS-standard plugin install directories (VST2/VST3/CLAP everywhere, AU on
/// macOS). The "scan my installed plugins with no arguments"
/// default the UI uses — a missing directory is simply skipped by [`scan`], so
/// this is always safe to pass. Reads `$HOME` / the Windows program-files env
/// vars; pure path construction, no filesystem access.
pub fn default_plugin_dirs() -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = Vec::new();
    let home = std::env::var_os("HOME").map(PathBuf::from);

    #[cfg(target_os = "macos")]
    {
        if let Some(h) = home.as_ref() {
            dirs.push(h.join("Library/Audio/Plug-Ins/CLAP"));
            dirs.push(h.join("Library/Audio/Plug-Ins/VST3"));
            dirs.push(h.join("Library/Audio/Plug-Ins/VST"));
            dirs.push(h.join("Library/Audio/Plug-Ins/Components"));
        }
        dirs.push(PathBuf::from("/Library/Audio/Plug-Ins/CLAP"));
        dirs.push(PathBuf::from("/Library/Audio/Plug-Ins/VST3"));
        dirs.push(PathBuf::from("/Library/Audio/Plug-Ins/VST"));
        dirs.push(PathBuf::from("/Library/Audio/Plug-Ins/Components"));
    }

    #[cfg(target_os = "windows")]
    {
        if let Some(cf) = std::env::var_os("COMMONPROGRAMFILES").map(PathBuf::from) {
            dirs.push(cf.join("CLAP"));
            dirs.push(cf.join("VST3"));
            dirs.push(cf.join("VST2"));
        }
        if let Some(pf) = std::env::var_os("ProgramFiles").map(PathBuf::from) {
            dirs.push(pf.join("VstPlugins"));
            dirs.push(pf.join("Steinberg/VstPlugins"));
        }
        if let Some(la) = std::env::var_os("LOCALAPPDATA").map(PathBuf::from) {
            dirs.push(la.join("Programs/Common/CLAP"));
            dirs.push(la.join("Programs/Common/VST3"));
            dirs.push(la.join("Programs/Common/VST2"));
        }
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        if let Some(h) = home.as_ref() {
            dirs.push(h.join(".clap"));
            dirs.push(h.join(".vst3"));
            dirs.push(h.join(".vst"));
        }
        dirs.push(PathBuf::from("/usr/lib/clap"));
        dirs.push(PathBuf::from("/usr/local/lib/clap"));
        dirs.push(PathBuf::from("/usr/lib/vst3"));
        dirs.push(PathBuf::from("/usr/local/lib/vst3"));
        dirs.push(PathBuf::from("/usr/lib/vst"));
        dirs.push(PathBuf::from("/usr/local/lib/vst"));
    }

    let _ = home; // used per-cfg above
    dirs
}

/// Per-user durable location for scan cache, quarantine reasons, and crash
/// counts. It intentionally does not depend on a GUI framework so tests and
/// headless hosts share the same policy.
pub fn default_reliability_dir() -> PathBuf {
    if let Some(path) = std::env::var_os("XDG_DATA_HOME") {
        return PathBuf::from(path).join("openjammer/plugins");
    }
    if let Some(path) = std::env::var_os("LOCALAPPDATA") {
        return PathBuf::from(path).join("OpenJammer/plugins");
    }
    if let Some(path) = std::env::var_os("HOME") {
        return PathBuf::from(path).join(".local/share/openjammer/plugins");
    }
    std::env::temp_dir().join("openjammer/plugins")
}

/// The subset of [`default_plugin_dirs`] that hold CLAP plugins — where dropping a
/// `.clap` makes it hostable. The Plugins panel shows these as the real "drop a
/// plugin here" folders for this machine (CLAP is the format the pure-Rust backend
/// hosts), instead of generic cross-platform examples.
pub fn clap_plugin_dirs() -> Vec<PathBuf> {
    default_plugin_dirs()
        .into_iter()
        .filter(|p| is_clap_dir(p))
        .collect()
}

/// Whether `dir` is a CLAP install folder, by its leaf name (`CLAP` / `.clap`,
/// case-insensitive). The CLAP spec fixes these folder names, so matching the leaf
/// is robust and keeps VST3 (`VST3` / `.vst3`) dirs out.
fn is_clap_dir(dir: &Path) -> bool {
    dir.file_name()
        .and_then(|n| n.to_str())
        .map(|n| n.eq_ignore_ascii_case("clap") || n.eq_ignore_ascii_case(".clap"))
        .unwrap_or(false)
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
        match probe_candidate_prefer_helper(&path, format) {
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
                blacklist.record_failure(&path_str, e.to_string())?;
            }
        }
    }

    if let Some(file) = cache_file {
        cache.save(file)?;
    }
    Ok(out)
}

/// Probe a single plugin candidate in-process. Public for the optional scan
/// helper binary; normal callers should use [`scan`] / [`scan_with`] so cache,
/// blacklist, and out-of-process crash isolation are applied.
pub fn probe_candidate(path: &Path) -> Result<Vec<PluginDescriptor>, HostError> {
    let format = path
        .extension()
        .and_then(|e| e.to_str())
        .and_then(PluginFormat::from_extension)
        .ok_or_else(|| HostError::Load {
            message: format!("unsupported plugin extension: {}", path.display()),
        })?;
    backend::probe(path, format)
}

fn probe_candidate_prefer_helper(
    path: &Path,
    format: PluginFormat,
) -> Result<Vec<PluginDescriptor>, HostError> {
    match probe_via_helper(path) {
        Ok(found) => Ok(found),
        Err(ProbeHelperError::Unavailable) => backend::probe(path, format),
        Err(ProbeHelperError::Failed(message)) => Err(HostError::Load { message }),
    }
}

#[derive(Debug)]
enum ProbeHelperError {
    Unavailable,
    Failed(String),
}

#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub struct ProbeHelperResponse {
    pub ok: bool,
    pub descriptors: Vec<PluginDescriptor>,
    pub error: Option<String>,
}

fn probe_via_helper(path: &Path) -> Result<Vec<PluginDescriptor>, ProbeHelperError> {
    let helper = scan_helper_path().ok_or(ProbeHelperError::Unavailable)?;
    let mut child = Command::new(&helper)
        .arg("--ojhost-scan-helper")
        .arg(path)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| ProbeHelperError::Failed(format!("failed to spawn scan helper: {e}")))?;

    // Drain both pipes concurrently. Waiting for exit before reading deadlocks
    // when a legitimate descriptor set (for example 500 params) exceeds the OS
    // pipe buffer—the scanner itself would appear hung.
    let stdout_pipe = child
        .stdout
        .take()
        .ok_or_else(|| ProbeHelperError::Failed("scan helper stdout was not piped".into()))?;
    let stderr_pipe = child
        .stderr
        .take()
        .ok_or_else(|| ProbeHelperError::Failed("scan helper stderr was not piped".into()))?;
    let stdout_reader = std::thread::spawn(move || {
        let mut text = String::new();
        let _ = std::io::BufReader::new(stdout_pipe).read_to_string(&mut text);
        text
    });
    let stderr_reader = std::thread::spawn(move || {
        let mut text = String::new();
        let _ = std::io::BufReader::new(stderr_pipe).read_to_string(&mut text);
        text
    });

    let deadline = Instant::now() + Duration::from_secs(30);
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                let stdout = stdout_reader.join().unwrap_or_default();
                let stderr = stderr_reader.join().unwrap_or_default();
                if !status.success() {
                    return Err(ProbeHelperError::Failed(format!(
                        "scan helper exited with {status}: {stderr}"
                    )));
                }
                let response: ProbeHelperResponse = serde_json::from_str(&stdout).map_err(|e| {
                    ProbeHelperError::Failed(format!("bad scan helper response: {e}"))
                })?;
                return if response.ok {
                    Ok(response.descriptors)
                } else {
                    Err(ProbeHelperError::Failed(
                        response
                            .error
                            .unwrap_or_else(|| "scan helper failed".into()),
                    ))
                };
            }
            Ok(None) => {
                if Instant::now() >= deadline {
                    let _ = child.kill();
                    let _ = child.wait();
                    let _ = stdout_reader.join();
                    let _ = stderr_reader.join();
                    return Err(ProbeHelperError::Failed(format!(
                        "scan helper timed out probing {}",
                        path.display()
                    )));
                }
                std::thread::sleep(Duration::from_millis(25));
            }
            Err(e) => {
                let _ = child.kill();
                let _ = stdout_reader.join();
                let _ = stderr_reader.join();
                return Err(ProbeHelperError::Failed(format!(
                    "scan helper wait failed: {e}"
                )));
            }
        }
    }
}

fn scan_helper_path() -> Option<PathBuf> {
    if let Some(path) = SCAN_HELPER_OVERRIDE.get() {
        return Some(path.clone());
    }
    if let Some(path) = std::env::var_os("OJHOST_SCAN_HELPER").map(PathBuf::from) {
        if path.is_file() {
            return Some(path);
        }
    }
    if let Some(path) = option_env!("CARGO_BIN_EXE_ojhost-scan-helper").map(PathBuf::from) {
        if path.is_file() {
            return Some(path);
        }
    }
    let exe = std::env::current_exe().ok()?;
    let dir = exe.parent()?;
    let name = if cfg!(windows) {
        "ojhost-scan-helper.exe"
    } else {
        "ojhost-scan-helper"
    };
    let candidate = dir.join(name);
    if candidate.is_file() {
        return Some(candidate);
    }
    // Cargo integration tests execute from `target/debug/deps`; the binary
    // target is its parent sibling at `target/debug/ojhost-scan-helper`.
    dir.parent()
        .map(|parent| parent.join(name))
        .filter(|path| path.is_file())
}

/// Enumerate candidate plugin paths under `dirs` (one level of recursion into
/// directories; bundles like `.vst3`/`.component` are returned as their
/// directory path, which is what the backend opens). Missing dirs are skipped.
///
/// Public so the shell can log *how many plugin-shaped files exist on disk*
/// independently of how many actually probed — the "found N candidates but 0
/// hosted" diagnostic that distinguishes "nothing installed" from "a backend that
/// couldn't open them".
pub fn candidate_paths(dirs: &[PathBuf]) -> Vec<PathBuf> {
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

/// Whether two plugin paths name the same binary, tolerating the cosmetic
/// differences a host introduces. The JUCE scanner reports a plugin's path as its
/// own normalized `File` string — unified separators, and on Windows a possibly
/// different drive-letter / path casing than the candidate path we walked off
/// disk. A raw `candidate == reported` check (which the JUCE probe used to do)
/// then dropped EVERY match when the two differed only by `/` vs `\` or by case,
/// i.e. a scan that *found* plugins returned *none*. Normalize both sides (unify
/// separators, drop a trailing slash, ignore ASCII case on Windows) before
/// comparing. Pure ASCII-casing keeps it dependency-free and covers the real
/// cases (drive letter + Program Files path).
///
/// Its only caller is the `juce` backend (feature-gated off in the scaffold /
/// clap-host builds), but it lives here in the always-compiled scan module so the
/// normalization is unit-tested without the JUCE toolchain — hence the allow when
/// no backend consumes it.
#[cfg_attr(not(feature = "juce"), allow(dead_code))]
pub(crate) fn same_plugin_path(a: &str, b: &str) -> bool {
    fn norm(s: &str) -> String {
        let unified = s.replace('\\', "/");
        let trimmed = unified.trim_end_matches('/');
        if cfg!(windows) {
            trimmed.to_ascii_lowercase()
        } else {
            trimmed.to_owned()
        }
    }
    norm(a) == norm(b)
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
    fn same_plugin_path_tolerates_separators_and_trailing_slash() {
        // `/` vs `\` and a trailing slash are the same plugin (the difference the
        // JUCE scanner introduces vs. the path we walked off disk).
        assert!(same_plugin_path(
            "C:/Program Files/Common Files/VST3/Foo.vst3",
            r"C:\Program Files\Common Files\VST3\Foo.vst3",
        ));
        assert!(same_plugin_path("/a/b/Foo.vst3/", "/a/b/Foo.vst3"));
        // Different binaries must still NOT match.
        assert!(!same_plugin_path("/a/b/Foo.vst3", "/a/b/Bar.vst3"));
    }

    #[cfg(windows)]
    #[test]
    fn same_plugin_path_ignores_case_on_windows() {
        // Drive-letter / Program Files casing differences are the same plugin on
        // Windows (a case-insensitive filesystem).
        assert!(same_plugin_path(
            r"c:\program files\common files\vst3\foo.vst3",
            r"C:\Program Files\Common Files\VST3\Foo.vst3",
        ));
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
                features: vec!["instrument".into()],
                has_gui: false,
                ports: crate::descriptor::PortCounts {
                    audio_in: 0,
                    audio_out: 2,
                },
                audio_ports: Vec::new(),
                port_configs: Vec::new(),
                note_ports: crate::descriptor::PortCounts::default(),
                param_count: 3,
                params: Vec::new(),
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

    #[test]
    fn clap_dirs_are_a_clap_named_subset_of_all_dirs() {
        let all = default_plugin_dirs();
        for d in clap_plugin_dirs() {
            assert!(
                all.contains(&d),
                "a CLAP dir must be one of the scanned dirs"
            );
            let leaf = d.file_name().and_then(|n| n.to_str()).unwrap_or_default();
            assert!(
                leaf.eq_ignore_ascii_case("clap") || leaf.eq_ignore_ascii_case(".clap"),
                "{leaf} is not a CLAP folder name"
            );
            assert!(
                !leaf.eq_ignore_ascii_case("vst3") && !leaf.eq_ignore_ascii_case(".vst3"),
                "a VST3 dir leaked into clap_plugin_dirs"
            );
        }
    }
}
