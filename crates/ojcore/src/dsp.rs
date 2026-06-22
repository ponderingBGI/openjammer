//! The ONE runtime DSP trait, shaped after CLAP's instance/processing
//! lifecycle. Every executor backend (built-in Rust, Faust host, WASM host,
//! hosted plugin) produces a `Box<dyn DspInstance>` and the RT loop drives them
//! all through this identical surface.
//!
//! Real-time contract: [`DspInstance::process`] runs on the audio thread and
//! MUST NOT allocate, lock, or block. All buffers it needs are sized in
//! [`DspInstance::activate`] (which runs off the RT thread); `process` then only
//! reads from / writes into the caller-owned buffers handed in via [`ProcessCtx`].

/// Per-block audio buffers handed to [`DspInstance::process`].
///
/// We use two independent lifetimes (`'b` for the channel pointer slices, `'s`
/// for the samples) rather than a single `&'a [&'a [f32]]`. Collapsing both into
/// one lifetime would force the borrow of the *outer* pointer array to live as
/// long as the *sample* data, which over-constrains callers that re-point a
/// reusable channel-pointer scratch array each block (the normal RT pattern) —
/// so the split keeps the common case borrow-check-clean with no extra cost.
pub struct ProcessCtx<'b, 's> {
    /// One slice per input channel, each `nframes` long.
    pub inputs: &'b [&'s [f32]],
    /// One slice per output channel, each `nframes` long. Disjoint from inputs.
    pub outputs: &'b mut [&'s mut [f32]],
    /// Number of valid frames in this block (`<= max_block` from `activate`).
    pub nframes: usize,
}

/// A live, processable instance of a plugin/node. `Send` so the engine can move
/// freshly-instantiated nodes onto the RT thread across a graph swap.
///
/// Mirrors the CLAP plugin lifecycle: `activate` → (`start_processing` →
/// `process`* → `stop_processing`)* → `deactivate`. Only `process` and
/// `set_param` are on the hot path; everything else may allocate.
pub trait DspInstance: Send {
    /// Off-RT: bind to a sample rate and the maximum block size that any later
    /// `process` call may request. Implementors size all scratch here.
    fn activate(&mut self, sample_rate: f32, max_block: usize);

    /// Called once before a run of `process` calls begins (e.g. transport
    /// start). Default no-op.
    fn start_processing(&mut self) {}

    /// RT-thread hot path: render `ctx.nframes` frames. MUST NOT allocate.
    fn process(&mut self, ctx: &mut ProcessCtx<'_, '_>);

    /// Called once after a run of `process` calls ends. Default no-op.
    fn stop_processing(&mut self) {}

    /// Off-RT: release activation-time resources. Default no-op.
    fn deactivate(&mut self) {}

    /// Set a parameter by its declared [`crate::ParamDecl::id`]. RT-safe: this
    /// is invoked from the same thread as `process` for the smoothed hot path.
    fn set_param(&mut self, id: u16, value: f32);

    /// RT-thread note-on for instrument/voice nodes (MIDI note 0..=127,
    /// velocity 0..=127). Default no-op so pure-effect nodes (e.g.
    /// [`crate::GainNode`]) are unaffected. RT-safe: invoked from the same
    /// thread as `process`; implementors MUST NOT allocate.
    fn note_on(&mut self, _note: u8, _vel: u8) {}

    /// RT-thread note-off for instrument/voice nodes. Default no-op. RT-safe:
    /// invoked from the same thread as `process`; implementors MUST NOT allocate.
    fn note_off(&mut self, _note: u8) {}

    /// RT-thread looper transport action (one of the [`ojproto::looper_action`]
    /// codes: arm / record / play / stop / clear / overdub). Default no-op so
    /// non-looper nodes ignore it; [`crate::LooperNode`] consumes it to drive its
    /// state machine. RT-safe: invoked from the same thread as `process`;
    /// implementors MUST NOT allocate. Carried by [`ojproto::RtCommand::Looper`].
    fn looper_action(&mut self, _action: u8) {}

    /// RT-thread looper telemetry snapshot for the (ungated) return path:
    /// `(state_u8, pos, loop_len, last_block_peak)`. `state` is an
    /// [`ojproto::looper_state`] code; `pos`/`loop_len` are sample frames.
    /// Default `None` so non-looper nodes contribute no looper frame (same
    /// pattern as [`looper_action`](DspInstance::looper_action));
    /// [`crate::LooperNode`] overrides it. RT-safe: field reads, no allocation.
    fn looper_snapshot(&self) -> Option<(u8, u32, u32, f32)> {
        None
    }

    /// RT-thread drain of a just-occurred looper state transition as
    /// `(from_u8, to_u8)` ([`ojproto::looper_state`] codes), consumed once per
    /// block onto the loss-proof event ring. Default `None`;
    /// [`crate::LooperNode`] overrides it. RT-safe: an `Option::take`, no
    /// allocation.
    fn take_looper_edge(&mut self) -> Option<(u8, u8)> {
        None
    }

    /// OFF-RT asset-resolution seam (the U6 sample / IR loading point).
    ///
    /// Called by [`crate::compile`] (or any host that resolves an
    /// [`ojproto::AssetRef`]) AFTER `activate` + the baked-in `set_param`s, with
    /// the already-decoded mono PCM behind the node's asset slot. `slot` is the
    /// [`ojproto::AssetRef::slot`]; `pcm` is mono `f32` in `[-1, 1]`;
    /// `sample_rate` is the PCM's own capture rate (for resampling correction).
    ///
    /// This runs off the audio thread (at compile / asset-bind time), so unlike
    /// `process` it MAY allocate (e.g. the Sampler copies the PCM into a shared
    /// `Arc`). The default is a no-op so pure-DSP nodes ignore any bound asset;
    /// the Sampler installs it as its playback buffer and the Convolution node as
    /// its impulse response. RT-safe is NOT required here.
    fn load_asset(&mut self, _slot: u16, _pcm: &[f32], _sample_rate: f32) {}

    /// Master-output gain this node contributes when it is the graph's master
    /// sink (SpeakerOut / GraphOut). The executor multiplies the resolved master
    /// mix by this just before it leaves the engine, so a host can give the
    /// SpeakerOut node a real master volume / mute (set via
    /// [`set_param`](DspInstance::set_param)). Default `1.0` (unity): only the
    /// master sink's value is ever read, so every other node ignores it.
    /// RT-safe: a single field read, no allocation.
    fn master_gain(&self) -> f32 {
        1.0
    }

    /// Clear internal state (filter memory, delay lines, phase). Default no-op.
    fn reset(&mut self) {}
}
