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
use std::time::{Duration, Instant};

use ojcore_native::{atomic_write, RealFs};

const CHILD_DIR_ENV: &str = "OJ_DURABILITY_CHILD_DIR";
const STATE: &str = "state";
const READY: &str = "writer-ready";

/// The writer child: atomically rewrite `state` with an ever-incrementing u64,
/// forever. Never returns — the parent SIGKILLs it.
fn child_write_loop(dir: &str) -> ! {
    let mut fs = RealFs::new(dir);
    let mut v: u64 = 0;
    let mut ready_marked = false;
    loop {
        v = v.wrapping_add(1);
        if atomic_write(&mut fs, STATE, &v.to_le_bytes()).is_ok() && !ready_marked {
            // Test-only process synchronization: the parent must not mistake
            // cold process startup for an interrupted atomic write.
            std::fs::write(PathBuf::from(dir).join(READY), b"ready").expect("mark writer ready");
            ready_marked = true;
        }
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
        let ready = dir.join(READY);
        let _ = std::fs::remove_file(&ready);
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

        // Wait until this child has completed one durable write, then vary the
        // delay so SIGKILL lands at different points in its continuing loop.
        // This separates process-startup scheduling from the crash window.
        let deadline = Instant::now() + Duration::from_secs(5);
        while !ready.exists() {
            if let Some(status) = child.try_wait().expect("poll writer child") {
                panic!("writer child exited before readiness: {status}");
            }
            if Instant::now() >= deadline {
                let _ = child.kill();
                let _ = child.wait();
                panic!("writer child did not become ready");
            }
            std::thread::sleep(Duration::from_millis(5));
        }
        std::thread::sleep(Duration::from_millis(round));
        let _ = child.kill();
        let _ = child.wait();

        // Readiness guarantees the destination already existed. Recovery must
        // therefore find a COMPLETE old or new u64, never absence or a torn file.
        let bytes = std::fs::read(dir.join(STATE)).expect("durable destination remains present");
        assert_eq!(
            bytes.len(),
            8,
            "round {round}: destination was torn ({} bytes, not a complete u64)",
            bytes.len()
        );
        let _v = u64::from_le_bytes(bytes.try_into().unwrap()); // parses cleanly
    }

    let _ = std::fs::remove_dir_all(&dir);
}
