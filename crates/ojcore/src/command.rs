//! The UI -> RT command seam (std-only).
//!
//! A [`CommandQueue`] is a wait-free SPSC ring (via `rtrb`) of [`RtCommand`].
//! The UI/control thread owns the [`CommandProducer`]; the audio thread owns the
//! [`CommandConsumer`] and drains it at each block start through
//! [`Engine::drain`]. [`RtCommand`] is `Copy` and `<= 16 B` (enforced in
//! `ojproto`), so nothing heap-allocated crosses this seam.
//!
//! Behind the `std` feature: `rtrb` needs OS atomics/threads beyond bare
//! `alloc`, and the compile/exec core must stay `no_std` for wasm.

use ojproto::{RtCommand, TimedCommand};
use rtrb::{Consumer, Producer, PushError, RingBuffer};

use crate::exec::Engine;

/// Producer end of the command ring (held by the control/UI thread).
pub type CommandProducer = Producer<RtCommand>;
/// Consumer end of the command ring (held by the audio thread).
pub type CommandConsumer = Consumer<RtCommand>;

/// A wait-free SPSC ring of [`RtCommand`]s. Construct once, then `split` it into
/// the producer (UI thread) and consumer (audio thread) halves.
pub struct CommandQueue;

/// Producer end of the dedicated timestamped command ring. It enforces the
/// single-producer non-decreasing timestamp contract in debug builds.
pub struct TimedCommandProducer {
    inner: Producer<TimedCommand>,
    last_at: u64,
}

impl TimedCommandProducer {
    pub fn push(&mut self, command: TimedCommand) -> Result<(), PushError<TimedCommand>> {
        debug_assert!(command.at == 0 || command.at >= self.last_at);
        self.inner.push(command)?;
        if command.at != 0 {
            self.last_at = command.at;
        }
        Ok(())
    }
}
/// Consumer end of the dedicated timestamped command ring.
pub type TimedCommandConsumer = Consumer<TimedCommand>;

/// A second wait-free SPSC ring for [`TimedCommand`]. The frozen immediate
/// [`RtCommand`] ring remains unchanged.
pub struct TimedCommandQueue;

impl TimedCommandQueue {
    pub fn split(capacity: usize) -> (TimedCommandProducer, TimedCommandConsumer) {
        let (inner, consumer) = RingBuffer::new(capacity);
        (TimedCommandProducer { inner, last_at: 0 }, consumer)
    }
}

impl CommandQueue {
    /// Allocate a ring with room for `capacity` pending commands and split it
    /// into its producer/consumer halves. Allocation happens here, once, off
    /// the RT thread; `push`/`pop` afterward are wait-free and allocation-free.
    pub fn split(capacity: usize) -> (CommandProducer, CommandConsumer) {
        RingBuffer::new(capacity)
    }
}

impl Engine {
    /// Apply a single command to the running program. RT-safe: a bounded amount
    /// of work, no allocation, no locking.
    ///
    /// Thin std-side alias for the no_std [`Engine::apply_rt`] (the SINGLE
    /// source of truth for command routing, shared with the wasm host). Kept for
    /// the existing std host API; all per-variant logic lives in `apply_rt`.
    #[inline]
    pub fn apply(&mut self, cmd: RtCommand) {
        self.apply_rt(cmd);
    }

    /// Drain every pending command from `rx`, applying each. Call once at block
    /// start. Wait-free and allocation-free: `pop` reads from the pre-allocated
    /// ring and we apply in place.
    pub fn drain(&mut self, rx: &mut CommandConsumer) {
        while let Ok(cmd) = rx.pop() {
            self.apply(cmd);
        }
    }

    /// Drain timestamped commands into the engine's preallocated pending queue.
    /// Producers must push in non-decreasing `at` order.
    pub fn drain_timed(&mut self, rx: &mut TimedCommandConsumer) {
        while let Ok(cmd) = rx.pop() {
            let _ = self.enqueue_timed(cmd);
        }
    }
}
