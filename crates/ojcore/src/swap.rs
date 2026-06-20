//! Lock-free graph hot-swap with RT-safe deferred drop (std-only).
//!
//! The control thread compiles a new [`CompiledProgram`] and
//! [`ProgramSwap::publish`]es it into a lock-free mailbox (`arc-swap`). The
//! audio thread, at a block boundary, calls [`ProgramSwap::install_into`] to
//! adopt the newest published program into its [`Engine`] — an OWNERSHIP
//! transfer, because the executor needs `&mut` access to each node and so must
//! own the program by value (it cannot process through a shared `Arc`).
//!
//! The KEY real-time invariant: dropping the OLD program (which frees every
//! node's buffers and every `Box<dyn DspInstance>`) must NEVER run on the audio
//! thread. We guarantee that by handing the displaced program to a
//! [`basedrop::Owned`] tied to a [`Collector`]: dropping that `Owned` on the
//! audio thread only *enqueues* the teardown (a couple of atomics, no `free`,
//! no destructors); the actual teardown runs later when the control thread
//! calls [`ProgramSwap::collect`].
//!
//! Behind the `std` feature: `arc-swap` + `basedrop` need OS atomics beyond
//! bare `alloc`, and the compile/exec core stays `no_std` for wasm.

use alloc::sync::Arc;

use arc_swap::ArcSwapOption;
use basedrop::{Collector, Handle, Owned};

use crate::compile::CompiledProgram;
use crate::exec::Engine;

/// Transfer-only wrapper that lets a [`CompiledProgram`] (which is `Send` but
/// NOT `Sync`, because `dyn DspInstance` is only `Send`) ride through an
/// `ArcSwapOption`, whose `Arc<T>` bounds demand `T: Send + Sync`.
///
/// SAFETY: a `RtProgram` is only ever moved by *exclusive ownership transfer* —
/// the mailbox holds at most one `Arc` and `install_into` takes it out before
/// touching the program. No two threads ever access the inner program
/// concurrently, so the `Sync` we assert is vacuously upheld (there is never a
/// shared `&CompiledProgram` observed from two threads at once).
struct RtProgram(CompiledProgram);

// SAFETY: see `RtProgram` docs — exclusive-transfer use makes `Sync` sound.
unsafe impl Sync for RtProgram {}

/// The AUDIO-THREAD end of a [`ProgramSwap`]: a clone-cheap, `Send` handle that
/// installs the newest published program into the engine and defers the old
/// program's drop. Move one into the cpal callback (via [`ProgramSwap::rx`]); the
/// control thread keeps the [`ProgramSwap`] for `publish`/`collect`.
#[derive(Clone)]
pub struct ProgramSwapRx {
    pending: Arc<ArcSwapOption<RtProgram>>,
    handle: Handle,
}

impl ProgramSwapRx {
    /// Adopt the newest published program into `engine` (call from the audio
    /// thread, at a block boundary). Returns `true` if a swap happened.
    ///
    /// RT-safety: the OLD program displaced from the engine is moved into a
    /// `basedrop::Owned` and dropped here — which merely ENQUEUES it for the
    /// collector, never running its (buffer/instance-freeing) destructor on the
    /// audio thread. See module docs.
    pub fn install_into(&self, engine: &mut Engine) -> bool {
        // Take the pending program out of the mailbox (lock-free).
        let Some(arc) = self.pending.swap(None) else {
            return false;
        };
        // We are the sole owner now (mailbox emptied, publisher handed off), so
        // unwrap moves the program out by value with no clone.
        let program = match Arc::try_unwrap(arc) {
            Ok(p) => p.0,
            // Extremely unlikely (a reader still holds it); fall back to a
            // clone-free no-op rather than blocking. Re-store and bail.
            Err(arc) => {
                self.pending.store(Some(arc));
                return false;
            }
        };
        let old = engine.install(program);
        // Deferred drop: enqueue the old program for the collector. Dropping
        // this `Owned` here does NOT run the program's destructor inline.
        drop(Owned::new(&self.handle, old));
        true
    }

    /// Whether a freshly published program is waiting to be installed.
    pub fn has_pending(&self) -> bool {
        self.pending.load().is_some()
    }
}

/// A lock-free publish mailbox for the current [`CompiledProgram`] plus the
/// deferred-drop collector that reclaims displaced programs off the audio
/// thread. The control thread holds this; the audio thread holds a
/// [`ProgramSwapRx`] from [`Self::rx`].
pub struct ProgramSwap {
    /// Newest published-but-not-yet-installed program (the mailbox). `None`
    /// once the audio thread has adopted it, or before the first publish. An
    /// `Arc` so the audio-thread [`ProgramSwapRx`] shares the SAME mailbox.
    pending: Arc<ArcSwapOption<RtProgram>>,
    collector: Collector,
    handle: Handle,
}

impl ProgramSwap {
    /// A new, empty swap. Nothing is pending until the first [`Self::publish`].
    pub fn new() -> Self {
        let collector = Collector::new();
        let handle = collector.handle();
        Self {
            pending: Arc::new(ArcSwapOption::empty()),
            collector,
            handle,
        }
    }

    /// Publish `program` as the newest pending program (call off the audio
    /// thread). If a previously published program was still un-installed, it is
    /// superseded and dropped here on this (off-RT) thread.
    pub fn publish(&self, program: CompiledProgram) {
        self.pending.store(Some(Arc::new(RtProgram(program))));
    }

    /// Whether a freshly published program is waiting to be installed.
    pub fn has_pending(&self) -> bool {
        self.pending.load().is_some()
    }

    /// The audio-thread handle that installs published programs. Clone/move one
    /// into the audio callback; the same lock-free mailbox is shared, so a
    /// [`Self::publish`] from the control thread is seen by `install_into`.
    pub fn rx(&self) -> ProgramSwapRx {
        ProgramSwapRx {
            pending: Arc::clone(&self.pending),
            handle: self.handle.clone(),
        }
    }

    /// Adopt the newest published program into `engine`. Convenience that
    /// forwards to a [`ProgramSwapRx`]; real hosts move an `rx()` into the audio
    /// callback and call [`ProgramSwapRx::install_into`] there. Single-threaded
    /// callers (tests) can use this directly.
    pub fn install_into(&self, engine: &mut Engine) -> bool {
        self.rx().install_into(engine)
    }

    /// Run pending deferred drops (call off the audio thread). Returns how many
    /// allocations were reclaimed.
    pub fn collect(&mut self) -> usize {
        let before = self.collector.alloc_count();
        self.collector.collect();
        before.saturating_sub(self.collector.alloc_count())
    }

    /// Live allocation count still owned by the collector (for tests/metrics).
    pub fn alloc_count(&self) -> usize {
        self.collector.alloc_count()
    }
}

impl Default for ProgramSwap {
    fn default() -> Self {
        Self::new()
    }
}
