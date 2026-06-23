//! The ONE runtime DSP trait, shaped after CLAP's instance/processing
//! lifecycle. Every executor backend (built-in Rust, Faust host, WASM host,
//! hosted plugin) produces a `Box<dyn DspInstance>` and the RT loop drives them
//! all through this identical surface.
//!
//! Real-time contract: [`DspInstance::process`] runs on the audio thread and
//! MUST NOT allocate, lock, or block. All buffers it needs are sized in
//! [`DspInstance::activate`] (which runs off the RT thread); `process` then only
//! reads from / writes into the caller-owned buffers handed in via [`ProcessCtx`].

use crate::manifest::ContractVersion;

/// This kernel build's [`DspInstance`] contract generation (`docs/STABILITY.md` §4).
/// Bumped MINOR when a backward-compatible capability/extension is added; MAJOR
/// only on a breaking change to the frozen hot path (which must never happen).
pub const KERNEL_CONTRACT: ContractVersion = ContractVersion::new(1, 0);

/// The CLOSED set of kernel-known capability EXTENSIONS a node may provide through
/// [`DspInstance::extension`]. Each maps to a reserved `oj.*` capability id in the
/// manifest's `abi` block (`docs/STABILITY.md` §4); new extensions are added here
/// additively. The manifest declares them as OPEN strings, so an old kernel that
/// lacks an id simply never offers it — the negotiation that keeps "distros share
/// one kernel" true.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExtId {
    /// `oj.latency` — the node reports a processing latency in samples (for PDC).
    Latency,
    /// `oj.state` — opaque save/restore of the node's full state (sessions, respawn).
    State,
    /// `oj.note-expression` — per-note expression / MPE.
    NoteExpression,
    /// `oj.offline-render` — the node opts into HQ paths when `realtime == false`.
    OfflineRender,
    /// `oj.gui` — the node provides a custom editor surface.
    Gui,
}

impl ExtId {
    /// The reserved `oj.*` capability id this extension is declared as in a manifest.
    pub const fn capability_id(self) -> &'static str {
        match self {
            ExtId::Latency => "oj.latency",
            ExtId::State => "oj.state",
            ExtId::NoteExpression => "oj.note-expression",
            ExtId::OfflineRender => "oj.offline-render",
            ExtId::Gui => "oj.gui",
        }
    }

    /// Resolve a manifest capability id back to a kernel-known [`ExtId`], or `None`
    /// for an unknown / `vendor.*` id.
    pub fn from_capability_id(id: &str) -> Option<ExtId> {
        match id {
            "oj.latency" => Some(ExtId::Latency),
            "oj.state" => Some(ExtId::State),
            "oj.note-expression" => Some(ExtId::NoteExpression),
            "oj.offline-render" => Some(ExtId::OfflineRender),
            "oj.gui" => Some(ExtId::Gui),
            _ => None,
        }
    }
}

/// Whether THIS kernel build provides the capability `id`. An `oj.*` id counts as
/// supported only once its [`ExtId`] extension is actually wired into the engine;
/// `vendor.*` and unknown ids are never kernel-provided. A plugin that REQUIRES an
/// unsupported capability degrades to a labeled passthrough stub — never a crash
/// (`docs/STABILITY.md` §5).
pub fn kernel_supports_capability(id: &str) -> bool {
    // A capability counts as supported once its extension is actually wired into the
    // engine. `oj.state` is now live: the off-RT `extension(ExtId::State)` save seam
    // + `DspInstance::restore_state` restore seam are implemented (a hosted plugin
    // persists + reloads its opaque state). Others (`oj.latency`, …) are added here
    // as they land; until then a plugin that REQUIRES them degrades to a stub.
    matches!(ExtId::from_capability_id(id), Some(ExtId::State))
}

/// Off-RT capability object behind [`ExtId::State`] (`docs/STABILITY.md` §4): a node
/// that can serialize its full opaque state for sessions / crash-respawn. Returned
/// (as `&dyn Any` → downcast to `&dyn StateSave`) from [`DspInstance::extension`].
/// `save` is `&self` (a live read), so it is the SAVE half only; RESTORE needs
/// `&mut self` and rides [`DspInstance::restore_state`] at construction instead.
/// Both run OFF the audio thread and MAY allocate.
pub trait StateSave {
    /// Serialize the node's full state to an opaque byte blob (e.g. a hosted
    /// plugin's `getStateInformation`). Empty when the node has no extra state.
    fn save(&self) -> alloc::vec::Vec<u8>;
}

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
    /// codes: arm / record / play / stop / clear / overdub / undo_last /
    /// set_mute / delete_layer). `arg` addresses a layer for the indexed actions
    /// (set_mute / delete_layer) and is ignored by the transport actions — see
    /// [`ojproto::looper_action`] for the per-action encoding. Default no-op so
    /// non-looper nodes ignore it; [`crate::LooperNode`] consumes it to drive its
    /// state machine. RT-safe: invoked from the same thread as `process`;
    /// implementors MUST NOT allocate. Carried by [`ojproto::RtCommand::Looper`].
    fn looper_action(&mut self, _action: u8, _arg: u32) {}

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

    /// The MOST-RECENTLY-COMMITTED looper layer's loop PCM `[0, loop_len)`, or an
    /// empty slice for non-looper nodes / before the first commit. The committed
    /// layer is read-only on the render path, so this is a borrow, not a copy.
    /// The WASM host reads it on the commit edge to ship the take's true waveform
    /// to the UI (see `ojcore-wasm::looper_take_pcm`). Default empty;
    /// [`crate::LooperNode`] overrides it. RT-safe: a slice borrow, no allocation.
    fn last_committed_layer_pcm(&self) -> &[f32] {
        &[]
    }

    /// The input block the active looper take just CAPTURED this `process` call,
    /// or `None` when not recording / for non-looper nodes. The NATIVE host reads
    /// it after each block and streams it into the per-looper capture ring (the
    /// `RecorderSink`) so the off-RT side has the take by the commit edge. Default
    /// `None`; [`crate::LooperNode`] overrides it. RT-safe: a slice borrow.
    fn last_captured_block(&self) -> Option<&[f32]> {
        None
    }

    /// OFF-RT asset-resolution seam (the U6 sample / IR loading point).
    ///
    /// Called by [`crate::compile`] (or any host that resolves an
    /// [`ojproto::AssetRef`]) AFTER `activate` + the baked-in `set_param`s, with
    /// the already-decoded PCM behind the node's asset slot. `slot` is the
    /// [`ojproto::AssetRef::slot`]; `pcm` is INTERLEAVED `f32` in `[-1, 1]` with
    /// `channels` channels (`1` = mono); `sample_rate` is the PCM's own capture
    /// rate (for resampling correction). The channel count rides along so a node
    /// keeps the layout it wants — a stereo Sampler plays both channels, while a
    /// mono-only consumer downmixes via [`crate::compile::downmix_to_mono`].
    ///
    /// This runs off the audio thread (at compile / asset-bind time), so unlike
    /// `process` it MAY allocate (e.g. the Sampler copies the PCM into a shared
    /// `Arc`). The default is a no-op so pure-DSP nodes ignore any bound asset;
    /// the Sampler installs it as its playback buffer and the Convolution node as
    /// its impulse response. RT-safe is NOT required here.
    fn load_asset(&mut self, _slot: u16, _pcm: &[f32], _channels: u8, _sample_rate: f32) {}

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

    /// OFF-RT capability query (`docs/STABILITY.md` §4): borrow the extension object
    /// for `id`, or `None` if this node does not provide it. This is the ONE seam
    /// through which capabilities grow — the hot-path methods (`process` /
    /// `set_param` / `note_on` / `note_off`) stay frozen forever, so a new
    /// capability is one off-RT `match` arm here, never a new hot-trait method.
    /// Default `None` (a node provides no extensions unless it opts in). NOT on the
    /// audio thread; MAY allocate. Callers downcast the returned `Any` to the
    /// extension's sub-trait/struct.
    fn extension(&self, _id: ExtId) -> Option<&dyn core::any::Any> {
        None
    }

    /// OFF-RT state RESTORE seam (the `oj.state` capability's `&mut` half — see
    /// [`StateSave`] for the `&self` save half). Called at construction time (right
    /// after `activate` + baked-in `set_param`s + `load_asset`, on the control
    /// thread) with the opaque blob a prior session saved, so the node comes up
    /// exactly as it was left. The default is a no-op so pure-DSP nodes ignore it;
    /// a hosted plugin pushes the blob into `setStateInformation` / the CLAP state
    /// extension. Like `load_asset`, this runs off the audio thread and MAY
    /// allocate; an empty blob restores nothing.
    fn restore_state(&mut self, _blob: &[u8]) {}

    /// Whether this node has LATCHED into a degraded dry-passthrough at runtime —
    /// a hosted plugin that faulted (a segfault caught at the foreign-code
    /// boundary) or a code-node kernel that trapped. Default `false`. The off-RT
    /// control side polls this each tick to surface a non-modal "this node is
    /// passing through" badge — the runtime twin of the load-time
    /// [`crate::CompiledProgram::degraded_stubs`]. A single field read, off the hot
    /// path; recovery is a fresh `instantiate` on the next graph swap.
    fn runtime_degraded(&self) -> bool {
        false
    }

    /// Clear internal state (filter memory, delay lines, phase). Default no-op.
    fn reset(&mut self) {}
}

#[cfg(test)]
mod ext_tests {
    use super::*;

    #[test]
    fn ext_id_capability_id_roundtrips() {
        for id in [
            ExtId::Latency,
            ExtId::State,
            ExtId::NoteExpression,
            ExtId::OfflineRender,
            ExtId::Gui,
        ] {
            assert_eq!(ExtId::from_capability_id(id.capability_id()), Some(id));
        }
    }

    #[test]
    fn unknown_and_vendor_capability_ids_are_not_kernel_extensions() {
        assert_eq!(ExtId::from_capability_id("vendor.x"), None);
        assert_eq!(ExtId::from_capability_id("oj.unknown"), None);
    }

    #[test]
    fn kernel_supports_only_the_wired_capabilities() {
        // `oj.state` is wired (save + restore seams implemented), so it is
        // supported; capabilities not yet wired (e.g. `oj.latency`) and
        // vendor/unknown ids are not.
        assert!(kernel_supports_capability(ExtId::State.capability_id()));
        assert!(!kernel_supports_capability(ExtId::Latency.capability_id()));
        assert!(!kernel_supports_capability("vendor.x"));
        assert!(!kernel_supports_capability("oj.unknown"));
    }

    #[test]
    fn default_instance_provides_no_extension() {
        // The reference GainNode opts into nothing, so extension() is None.
        let node = crate::builtin::GainNode::new();
        assert!(node.extension(ExtId::State).is_none());
    }

    /// A node that opts into `oj.state`: `extension(State)` hands back a `StateSave`
    /// (the `&self` save half) and `restore_state` seeds it (the `&mut` half). This
    /// is the exact seam a hosted plugin uses to round-trip its opaque blob.
    #[test]
    fn state_extension_saves_and_restores_a_blob() {
        struct Stateful {
            blob: alloc::vec::Vec<u8>,
        }
        impl StateSave for Stateful {
            fn save(&self) -> alloc::vec::Vec<u8> {
                self.blob.clone()
            }
        }
        impl DspInstance for Stateful {
            fn activate(&mut self, _sr: f32, _mb: usize) {}
            fn process(&mut self, _ctx: &mut ProcessCtx<'_, '_>) {}
            fn set_param(&mut self, _id: u16, _v: f32) {}
            fn extension(&self, id: ExtId) -> Option<&dyn core::any::Any> {
                match id {
                    ExtId::State => Some(self),
                    _ => None,
                }
            }
            fn restore_state(&mut self, blob: &[u8]) {
                self.blob = blob.to_vec();
            }
        }

        let src = Stateful {
            blob: alloc::vec![1, 2, 3, 4],
        };
        // SAVE via the extension (downcast to the StateSave sub-trait).
        let any = src.extension(ExtId::State).expect("opts into oj.state");
        let saver = any.downcast_ref::<Stateful>().expect("downcasts");
        let blob = StateSave::save(saver);
        assert_eq!(blob, alloc::vec![1, 2, 3, 4]);

        // RESTORE into a fresh instance via the &mut seam.
        let mut dst = Stateful {
            blob: alloc::vec::Vec::new(),
        };
        dst.restore_state(&blob);
        assert_eq!(dst.save(), alloc::vec![1, 2, 3, 4]);
    }
}
