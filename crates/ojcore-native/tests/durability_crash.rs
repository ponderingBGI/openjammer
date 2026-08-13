//! Real-process crash durability (Track B P2 — the real-kill cross-check).
//!
//! `SimFs` proves the atomic-write PROTOCOL deterministically (a modeled crash at
//! every syscall); this is the reality check it cannot be: a REAL child process
//! writes versions through `atomic_write` in a tight loop and is `SIGKILL`ed at an
//! arbitrary point, then a fresh read asserts the destination is a COMPLETE value
//! (exactly one `u64`), never torn — no matter where the kill landed. It catches
//! what a model can't (the actual libc/rename/fsync path on this OS).
//!
//! `#[ignore]`d: it spawns + kills subprocesses, so it runs in the nightly lane
//! (`cargo test -p ojcore-native --test durability_crash -- --ignored`), not the
//! per-PR gate. The test re-execs ITSELF as the writer child (detected via an env
//! var), the classic self-exec crash-test pattern.

use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use ojcore_native::{atomic_write, RealFs};

const CHILD_DIR_ENV: &str = "OJ_DURABILITY_CHILD_DIR";
const STATE: &str = "state";

/// The writer child: atomically rewrite `state` with an ever-incrementing u64,
/// forever. Never returns — the parent SIGKILLs it.
fn child_write_loop(dir: &str) -> ! {
    let mut fs = RealFs::new(dir);
    let mut v: u64 = 0;
    loop {
        v = v.wrapping_add(1);
        let _ = atomic_write(&mut fs, STATE, &v.to_le_bytes());
    }
}

fn unique_dir() -> PathBuf {
    static N: AtomicU64 = AtomicU64::new(0);
    let n = N.fetch_add(1, Ordering::Relaxed);
    let dir = std::env::temp_dir().join(format!("oj-durability-{}-{}", std::process::id(), n));
    std::fs::create_dir_all(&dir).expect("mkdir");
    dir
}

#[test]
#[ignore = "spawns + SIGKILLs subprocesses; run in nightly with -- --ignored"]
fn destination_survives_repeated_sigkill() {
    // Child mode: just loop writing until killed.
    if let Ok(dir) = std::env::var(CHILD_DIR_ENV) {
        child_write_loop(&dir);
    }

    let dir = unique_dir();
    let exe = std::env::current_exe().expect("test exe");

    for round in 0..6 {
        let mut child = Command::new(&exe)
            .args([
                "--exact",
                "destination_survives_repeated_sigkill",
                "--ignored",
            ])
            .env(CHILD_DIR_ENV, &dir)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("spawn writer child");

        // Let it get well into the write loop, then kill it mid-flight (SIGKILL on
        // Unix — no destructors, the worst-case interruption).
        std::thread::sleep(Duration::from_millis(50));
        let _ = child.kill();
        let _ = child.wait();

        // Recovery: the destination is either absent (killed before the first
        // rename, round 0 only) or a COMPLETE 8-byte u64 — never a torn/partial
        // file, because `atomic_write` only ever swaps it via an atomic rename.
        match std::fs::read(dir.join(STATE)) {
            Ok(bytes) => {
                assert_eq!(
                    bytes.len(),
                    8,
                    "round {round}: destination was torn ({} bytes, not a complete u64)",
                    bytes.len()
                );
                let _v = u64::from_le_bytes(bytes.try_into().unwrap()); // parses cleanly
            }
            Err(_) => assert_eq!(round, 0, "only the first round may find no file yet"),
        }
    }

    let _ = std::fs::remove_dir_all(&dir);
}
