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

use ojproto::RtCommand;
use rtrb::{Consumer, Producer, RingBuffer};

use crate::exec::Engine;

/// Producer end of the command ring (held by the control/UI thread).
pub type CommandProducer = Producer<RtCommand>;
/// Consumer end of the command ring (held by the audio thread).
pub type CommandConsumer = Consumer<RtCommand>;

/// A wait-free SPSC ring of [`RtCommand`]s. Construct once, then `split` it into
/// the producer (UI thread) and consumer (audio thread) halves.
pub struct CommandQueue;

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
    /// * `SetParam`  -> resolve node slot, call `set_param(param, value)`.
    /// * `NoteOn`/`NoteOff` -> resolve node slot (proves routing); the current
    ///   [`crate::DspInstance`] trait exposes no note entry point, so the event
    ///   is dropped at the instance seam (a dedicated event port is a later
    ///   unit). Documented as such rather than faked through `set_param`.
    /// * `Bypass`    -> toggle the node's bypass flag.
    /// * `Transport*`/`Seek` -> drive the minimal sample-counting clock.
    pub fn apply(&mut self, cmd: RtCommand) {
        match cmd {
            RtCommand::SetParam { node, param, value } => {
                if let Some(slot) = self.program().slot_of_id(node) {
                    self.program_mut().instances[slot].set_param(param, value);
                }
            }
            RtCommand::NoteOn { node, .. } | RtCommand::NoteOff { node, .. } => {
                // Resolve only; no instance-level note sink exists yet.
                let _ = self.program().slot_of_id(node);
            }
            RtCommand::Bypass { node, on } => {
                if let Some(slot) = self.program().slot_of_id(node) {
                    self.program_mut().bypassed[slot] = on;
                }
            }
            RtCommand::TransportPlay => self.playing = true,
            RtCommand::TransportPause => self.playing = false,
            RtCommand::Seek { samples } => self.sample_pos = samples,
        }
    }

    /// Drain every pending command from `rx`, applying each. Call once at block
    /// start. Wait-free and allocation-free: `pop` reads from the pre-allocated
    /// ring and we apply in place.
    pub fn drain(&mut self, rx: &mut CommandConsumer) {
        while let Ok(cmd) = rx.pop() {
            self.apply(cmd);
        }
    }
}
