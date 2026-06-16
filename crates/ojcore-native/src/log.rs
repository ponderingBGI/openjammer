//! L1 — the off-RT structured logging sink (`tracing`).
//!
//! This is the *consumer* half of OpenJammer's logging story; the RT codec and
//! the wire schema are owned elsewhere (L2: `ojproto::Event` + the
//! `ojcore::meter::event_frame` codec). Here we adopt `tracing` strictly as the
//! off-realtime structured backbone: a subscriber that fans every record out to
//!
//! * a human-readable **stderr** layer (dev convenience), and
//! * a non-blocking, **daily-rolling NDJSON file** under the platform log dir —
//!   the founder's "everything on device" principle: logs are written locally,
//!   searchably (one structured JSON object per line), and never shipped to a
//!   server.
//!
//! It also installs the [`tracing_log::LogTracer`] bridge so transitive `log`
//! records from `cpal` / `tauri` / plugin hosts are captured rather than lost.
//!
//! REAL-TIME SAFETY (foundation F-shared). `tracing` is the off-RT sink ONLY. It
//! is never called from the audio callback: the engine core (`ojcore`,
//! `ojcore-dsp`) has no `tracing` dependency at all, so a `tracing::*` call on
//! the audio thread *cannot compile* there; on this crate, the macros are used
//! only from the off-RT control path (the dedicated event-drain thread in the
//! Tauri shell). The non-blocking file writer formats on the *caller*, so even
//! here it must stay off any latency-sensitive path — which the drain thread is.

use std::path::Path;

use tracing_appender::non_blocking::WorkerGuard;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;
use tracing_subscriber::{fmt, EnvFilter};

/// Bring up the process-wide `tracing` subscriber and return its flush
/// [`WorkerGuard`].
///
/// Layers, in order:
/// 1. an [`EnvFilter`] read from the `OJ_LOG` env var (falling back to `info`),
///    so verbosity is tunable without a rebuild;
/// 2. a human-readable [`fmt`] layer to **stderr**;
/// 3. a non-blocking JSON [`fmt`] layer writing **`openjammer.ndjson`** under
///    `log_dir`, rolled daily by [`tracing_appender::rolling::daily`].
///
/// The returned [`WorkerGuard`] MUST be held for the process lifetime: dropping
/// it flushes any buffered records out of the non-blocking writer. The caller
/// (the Tauri `setup` hook) parks it in managed state for exactly that reason.
///
/// Idempotency: calling this more than once is harmless — the second
/// `registry().init()` would fail to set the (already-set) global default and
/// panic via `init()`, so this is intended to be called EXACTLY once, early in
/// `run()` / a harness `main()`, before any `tracing` call site.
///
/// `log_dir` is assumed to already exist (the caller creates it); if the rolling
/// appender cannot open the file it falls back to a no-op writer rather than
/// panicking, so logging never takes the app down.
pub fn init_logging(log_dir: &Path) -> WorkerGuard {
    // Daily-rolling NDJSON file (one structured record per line). `non_blocking`
    // offloads the byte flush to a background thread; the returned guard flushes
    // it on drop.
    let file_appender = tracing_appender::rolling::daily(log_dir, "openjammer.ndjson");
    let (non_blocking, guard) = tracing_appender::non_blocking(file_appender);

    // `OJ_LOG` (e.g. `OJ_LOG=ojcore=debug,info`) tunes verbosity at runtime; a
    // missing/empty var defaults to `info`.
    let filter = EnvFilter::try_from_env("OJ_LOG").unwrap_or_else(|_| EnvFilter::new("info"));

    // Build the layer stack inline: binding each `fmt::layer()` to a standalone
    // `let` leaves its subscriber type parameter unconstrained ("type
    // annotations needed"); used directly as a `.with(..)` argument it infers
    // from the registry being layered.
    tracing_subscriber::registry()
        .with(filter)
        .with(fmt::layer().with_writer(std::io::stderr))
        .with(fmt::layer().json().with_writer(non_blocking))
        .init();

    // Capture transitive `log` records (cpal / tauri / plugin hosts) into the
    // same pipeline. Best-effort: if a `log` logger is already installed (e.g.
    // `tracing-subscriber`'s own `tracing-log` feature did it during `init`),
    // this is a no-op rather than an error.
    let _ = tracing_log::LogTracer::init();

    guard
}
