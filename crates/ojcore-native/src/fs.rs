//! Crash-safe atomic writes over an injectable filesystem seam (Track B
//! durability — the Turso/FoundationDB IO-fault-injection model).
//!
//! [`atomic_write`] is the write-temp -> fsync -> atomic-rename -> fsync-dir
//! discipline expressed over an [`OjFs`] trait, so the SAME protocol that makes a
//! recording crash-safe (see `asset::write_wav_file`) can be exercised by a
//! [`SimFs`] that injects a process crash at EVERY step. The property it proves:
//!
//!   after a crash at ANY point during a durable write, the destination is the
//!   COMPLETE old content or the COMPLETE new content — never a torn/partial file.
//!
//! [`RealFs`] is the production std-backed impl (the byte-payload utility that
//! `oj-tauri`'s settings / backup writes — today bare `std::fs::write` — should
//! adopt). The fault sweep lives in tests; it is a MODEL of a process crash
//! (it does not model power-loss fsync reordering, which belongs to the nightly
//! real-process SIGKILL loop), so a green sweep proves the protocol logic, not the
//! kernel/SSD layer.

use std::io;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};

/// A process-wide monotonic nonce for staging temp names. Combined with the PID it
/// makes every in-flight durable write stage into a UNIQUE sibling temp, so two
/// concurrent writers to the same destination never clobber each other's staged
/// bytes before the rename. (A deterministic `<dest>.ojtmp` would let one writer's
/// half-written temp overwrite another's.)
fn next_temp_nonce() -> u64 {
    static NONCE: AtomicU64 = AtomicU64::new(0);
    NONCE.fetch_add(1, Ordering::Relaxed)
}

/// The unique sibling temp name a crash-safe write of `dest` stages into:
/// `<dest>.<pid>.<nonce>.ojtmp`. Same directory ⇒ the rename is a same-filesystem
/// atomic op; unique per write ⇒ concurrent writers don't collide.
pub(crate) fn unique_temp_name(dest: &str) -> String {
    format!("{dest}.{}.{}.ojtmp", std::process::id(), next_temp_nonce())
}

/// The unique sibling temp PATH a crash-safe write of `dest` stages into, built
/// without a lossy UTF-8 conversion (`OsStr`-preserving). Same unique-per-write
/// suffix as [`unique_temp_name`]; the path-based analogue for callers that hold a
/// [`Path`] (e.g. `asset::write_wav_file`).
pub(crate) fn unique_temp_path(dest: &Path) -> std::path::PathBuf {
    let mut s = dest.as_os_str().to_owned();
    s.push(format!(
        ".{}.{}.ojtmp",
        std::process::id(),
        next_temp_nonce()
    ));
    std::path::PathBuf::from(s)
}

/// The filesystem operations a crash-safe write needs. Small + injectable so a
/// fault FS can crash at any step. Paths are plain strings (the harness models a
/// flat namespace; `RealFs` joins them under a base dir).
pub trait OjFs {
    /// Create the temp file, write all bytes, and fsync it to disk.
    fn write_tmp(&mut self, tmp: &str, bytes: &[u8]) -> io::Result<()>;
    /// Atomically rename `from` over `to` (same filesystem).
    fn rename(&mut self, from: &str, to: &str) -> io::Result<()>;
    /// Fsync the directory so a just-completed rename survives power loss.
    fn sync_dir(&mut self) -> io::Result<()>;
    /// Best-effort remove of a staged temp, to avoid leaking it when a write
    /// fails partway through. A missing file is not an error.
    fn remove(&mut self, path: &str);
    /// Read a file's current bytes, or `None` if absent.
    fn read(&self, path: &str) -> Option<Vec<u8>>;
}

/// The crash-safe write protocol: stage to a sibling temp, then atomically
/// replace. The destination is only ever changed by the rename, so an
/// interruption can never leave it torn.
pub fn atomic_write(fs: &mut impl OjFs, dest: &str, bytes: &[u8]) -> io::Result<()> {
    // Unique per write so concurrent writers to `dest` never clobber each other's
    // staged bytes before the rename.
    let tmp = unique_temp_name(dest);
    if let Err(e) = fs.write_tmp(&tmp, bytes) {
        fs.remove(&tmp); // don't leak THIS write's temp on failure
        return Err(e);
    }
    if let Err(e) = fs.rename(&tmp, dest) {
        fs.remove(&tmp);
        return Err(e);
    }
    fs.sync_dir()?;
    Ok(())
}

/// Crash-safely replace the whole file at `path` (temp in the same dir -> fsync ->
/// atomic rename -> fsync dir). The path-based convenience over [`atomic_write`]
/// for "durably overwrite this config/state file" — a drop-in for a bare
/// `std::fs::write`, which can leave a torn/half-written file if interrupted.
pub fn atomic_write_path(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let parent = match path.parent() {
        Some(p) if !p.as_os_str().is_empty() => p,
        _ => Path::new("."),
    };
    let name = path
        .file_name()
        .ok_or_else(|| io::Error::other("atomic_write_path: path has no file name"))?
        .to_string_lossy()
        .into_owned();
    let mut fs = RealFs::new(parent);
    atomic_write(&mut fs, &name, bytes)
}

/// Production filesystem: real temp + fsync + atomic rename + parent-dir fsync,
/// rooted at a base directory. The byte-payload analogue of the recorder's
/// crash-safe WAV finalize.
#[derive(Debug, Clone)]
pub struct RealFs {
    base: std::path::PathBuf,
}

impl RealFs {
    /// A filesystem rooted at `base` (all paths are joined under it).
    pub fn new(base: impl Into<std::path::PathBuf>) -> Self {
        Self { base: base.into() }
    }
    fn join(&self, p: &str) -> std::path::PathBuf {
        self.base.join(p)
    }
}

impl OjFs for RealFs {
    fn write_tmp(&mut self, tmp: &str, bytes: &[u8]) -> io::Result<()> {
        use std::io::Write;
        let path = self.join(tmp);
        let mut f = std::fs::File::create(&path)?;
        f.write_all(bytes)?;
        f.sync_all()
    }
    fn rename(&mut self, from: &str, to: &str) -> io::Result<()> {
        std::fs::rename(self.join(from), self.join(to))
    }
    fn sync_dir(&mut self) -> io::Result<()> {
        // On Unix the parent-dir fsync is what makes the rename itself durable, so a
        // failure must PROPAGATE — swallowing it would silently break the "rename is
        // durable" contract. On Windows a directory handle can't be fsynced this way
        // and the rename is durable regardless, so it stays best-effort.
        #[cfg(not(windows))]
        {
            let d = std::fs::File::open(&self.base)?;
            d.sync_all()?;
        }
        #[cfg(windows)]
        {
            if let Ok(d) = std::fs::File::open(&self.base) {
                let _ = d.sync_all(); // best-effort; the rename is durable regardless
            }
        }
        Ok(())
    }
    fn remove(&mut self, path: &str) {
        let _ = std::fs::remove_file(self.join(path));
    }
    fn read(&self, path: &str) -> Option<Vec<u8>> {
        std::fs::read(self.join(path)).ok()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::sync::atomic::{AtomicU64, Ordering};

    /// Sentinel error a `SimFs` returns at its scripted crash point.
    fn crashed() -> io::Error {
        io::Error::other("simulated process crash")
    }

    #[test]
    fn atomic_write_path_replaces_durably_and_leaves_no_temp() {
        static N: AtomicU64 = AtomicU64::new(0);
        let dir = std::env::temp_dir().join(format!(
            "oj-awp-{}-{}",
            std::process::id(),
            N.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("settings.json");

        atomic_write_path(&path, b"v1").unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"v1");

        // Overwrite atomically; leaves no `.ojtmp` sibling behind (the temp is now
        // uniquely named `<dest>.<pid>.<nonce>.ojtmp`, so scan for ANY such file).
        atomic_write_path(&path, b"v2-longer").unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"v2-longer");
        let leaked_temp = std::fs::read_dir(&dir)
            .unwrap()
            .any(|e| e.unwrap().file_name().to_string_lossy().ends_with(".ojtmp"));
        assert!(!leaked_temp, "temp must not leak");

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// An in-memory filesystem that "crashes" (returns an error, applying the
    /// step's partial effect appropriate to a PROCESS crash) after `crash_after`
    /// successful operations. `torn_temp` truncates the temp write to model a
    /// short write — which must still never corrupt the destination.
    struct SimFs {
        files: HashMap<String, Vec<u8>>,
        ops: usize,
        crash_after: usize,
        torn_temp: bool,
    }
    impl SimFs {
        fn new(initial: &[(&str, &[u8])], crash_after: usize, torn_temp: bool) -> Self {
            let files = initial
                .iter()
                .map(|(k, v)| (k.to_string(), v.to_vec()))
                .collect();
            Self {
                files,
                ops: 0,
                crash_after,
                torn_temp,
            }
        }
        /// Tick the op counter; return true if THIS op is the crash point.
        fn tick(&mut self) -> bool {
            let crash = self.ops == self.crash_after;
            self.ops += 1;
            crash
        }
    }
    impl OjFs for SimFs {
        fn write_tmp(&mut self, tmp: &str, bytes: &[u8]) -> io::Result<()> {
            let crash = self.tick();
            // A torn/short temp write leaves only a prefix in the temp AND fails the
            // step (the real write_all/sync_all would error) — so `atomic_write`
            // never proceeds to the rename, and the partial temp can NEVER reach the
            // destination. The destination is untouched in every temp-write failure.
            if self.torn_temp {
                let half = bytes.len() / 2;
                self.files.insert(tmp.to_string(), bytes[..half].to_vec());
                return Err(crashed());
            }
            self.files.insert(tmp.to_string(), bytes.to_vec());
            if crash {
                return Err(crashed());
            }
            Ok(())
        }
        fn rename(&mut self, from: &str, to: &str) -> io::Result<()> {
            // A process crash AT the rename means it did not happen (the rename is
            // the atomic point): the destination keeps its old content.
            if self.tick() {
                return Err(crashed());
            }
            if let Some(v) = self.files.remove(from) {
                self.files.insert(to.to_string(), v);
            }
            Ok(())
        }
        fn sync_dir(&mut self) -> io::Result<()> {
            if self.tick() {
                return Err(crashed());
            }
            Ok(())
        }
        fn remove(&mut self, path: &str) {
            self.files.remove(path);
        }
        fn read(&self, path: &str) -> Option<Vec<u8>> {
            self.files.get(path).cloned()
        }
    }

    #[test]
    fn crash_at_every_step_leaves_dest_complete_old_or_new() {
        let old = b"the complete OLD take".as_slice();
        let new = b"the complete NEW take, longer".as_slice();
        // atomic_write performs 3 ops (write_tmp, rename, sync_dir); also test the
        // no-crash case (crash_after past the end) and torn-temp variants.
        for torn_temp in [false, true] {
            for crash_after in 0..=3usize {
                let mut fs = SimFs::new(&[("take", old)], crash_after, torn_temp);
                let _ = atomic_write(&mut fs, "take", new); // may "crash" (Err)

                let dest = fs.read("take").expect("dest must always exist");
                assert!(
                    dest == old || dest == new,
                    "torn_temp={torn_temp} crash_after={crash_after}: dest was neither \
                     complete-old nor complete-new (len {})",
                    dest.len()
                );
            }
        }
    }

    #[test]
    fn a_clean_write_results_in_the_new_content() {
        let mut fs = SimFs::new(&[("f", b"old")], usize::MAX, false);
        atomic_write(&mut fs, "f", b"new").expect("clean write");
        assert_eq!(fs.read("f").as_deref(), Some(b"new".as_slice()));
    }

    #[test]
    fn first_ever_write_is_atomic_too() {
        // No pre-existing dest: a crash before rename leaves it ABSENT (a normal
        // cold start), never a torn file; a completed write yields the new content.
        for crash_after in 0..=3usize {
            let mut fs = SimFs::new(&[], crash_after, false);
            let _ = atomic_write(&mut fs, "f", b"hello");
            match fs.read("f") {
                None => {} // absent is fine (crash before rename)
                Some(v) => assert_eq!(v, b"hello", "if present, it is the complete new content"),
            }
        }
    }
}
