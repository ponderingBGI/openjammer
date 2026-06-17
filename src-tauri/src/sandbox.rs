//! OS-level filesystem jail (Phase 2) — the HARD guarantee behind the default
//! sandbox. The host confines the Pi child at the KERNEL level so a prompt-injected
//! agent physically cannot read/write outside the allowed roots, regardless of the
//! cooperative in-Pi permission-gate. This is what makes "the agent can only change
//! files in its folder" a *real* guarantee rather than a cooperative one.
//!
//! - **Linux:** Landlock (kernel ≥ 5.13), applied via `Command::pre_exec` so the
//!   ruleset restricts the spawned CHILD, not the host. Best-effort by default:
//!   on a kernel without Landlock it degrades to a no-op rather than failing the
//!   spawn (the in-Pi gate remains the layer there).
//! - **macOS / Windows:** not yet wired here ({@link jail_supported} reports it
//!   honestly); the in-Pi gate is the interim layer until a Seatbelt profile /
//!   restricted-token + Job Object lands.
//!
//! YOLO passes no jail at all (full filesystem access — the real Pi experience).

use std::path::PathBuf;
use std::process::Command;

/// The writable + readable roots for a jailed run.
pub struct Jail {
    /// Subtrees the child may WRITE (and read): the project + the agent's own brain.
    pub writable: Vec<PathBuf>,
    /// Extra READ-ONLY subtrees the child needs (system libs, so `pi`/node run).
    pub readable: Vec<PathBuf>,
}

impl Jail {
    /// The default jail: the child may write the project + the agent home (its
    /// memory/sessions), and read the system so `pi`/node can execute. The fine
    /// "no writing the gate's own settings.json" policy is the in-Pi gate's job;
    /// this is the coarse, unbypassable outer boundary.
    pub fn new(project_root: PathBuf, agent_home: PathBuf) -> Self {
        let readable = [
            "/usr", "/lib", "/lib64", "/bin", "/sbin", "/etc", "/opt", "/proc", "/dev", "/tmp",
        ]
        .iter()
        .map(PathBuf::from)
        .collect();
        Self {
            writable: vec![project_root, agent_home],
            readable,
        }
    }
}

/// Whether OS-level confinement is wired for this platform (Linux only for now).
pub fn jail_supported() -> bool {
    cfg!(target_os = "linux")
}

/// Configure `cmd` to enter the jail at spawn. On Linux this installs a Landlock
/// ruleset via `pre_exec` (runs in the child, after fork, before exec); on other
/// platforms it is a no-op and the in-Pi gate is the only layer.
#[cfg(target_os = "linux")]
pub fn apply(cmd: &mut Command, jail: Jail) {
    use std::os::unix::process::CommandExt;
    // SAFETY: the closure only calls async-signal-safe-enough Landlock syscalls
    // (prctl/landlock_*) and path stats before exec; it touches no shared state.
    unsafe {
        cmd.pre_exec(move || enforce(&jail).map_err(std::io::Error::other));
    }
}

#[cfg(not(target_os = "linux"))]
pub fn apply(_cmd: &mut Command, _jail: Jail) {}

/// Install the Landlock ruleset on the current (child) process. Best-effort: on a
/// kernel without Landlock the default compatibility level makes this a no-op
/// success, so the spawn never fails just because the kernel is old. Errors are
/// stringified (Landlock's error isn't `Send + Sync`, which `io::Error` wants).
#[cfg(target_os = "linux")]
fn enforce(jail: &Jail) -> Result<(), String> {
    use landlock::{
        path_beneath_rules, Access, AccessFs, Ruleset, RulesetAttr, RulesetCreatedAttr, ABI,
    };

    let abi = ABI::V2;
    // Filter to paths that exist — `path_beneath_rules` opens each, and a missing
    // root (e.g. no /lib64) must not abort the whole ruleset / the spawn.
    let readable: Vec<&PathBuf> = jail.readable.iter().filter(|p| p.exists()).collect();
    let writable: Vec<&PathBuf> = jail.writable.iter().filter(|p| p.exists()).collect();

    Ruleset::default()
        .handle_access(AccessFs::from_all(abi))
        .map_err(|e| e.to_string())?
        .create()
        .map_err(|e| e.to_string())?
        .add_rules(path_beneath_rules(readable, AccessFs::from_read(abi)))
        .map_err(|e| e.to_string())?
        .add_rules(path_beneath_rules(writable, AccessFs::from_all(abi)))
        .map_err(|e| e.to_string())?
        .restrict_self()
        .map_err(|e| e.to_string())?;
    Ok(())
}
