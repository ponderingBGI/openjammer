//! Graph -> program compiler (the OFF-RT half of the engine).
//!
//! [`compile`] turns an [`OjGraph`] into a [`CompiledProgram`] the RT loop can
//! run allocation-free. EVERYTHING that allocates happens here, once, off the
//! audio thread:
//!   * resolve + instantiate every node through the [`PluginRegistry`],
//!   * topologically order the audio edges (Kahn) and HARD-ERROR on any cycle,
//!   * pre-allocate one scratch buffer per node output port,
//!   * pre-compute the routing plan (which buffers feed each node input).
//!
//! `exec.rs` then only reads these pre-built tables and writes into the
//! pre-sized buffers — never allocating, never locking.
//!
//! `no_std`: this module is `alloc`-only so it compiles unchanged for the
//! `wasm32` AudioWorklet.

use alloc::borrow::Cow;
use alloc::boxed::Box;
use alloc::vec;
use alloc::vec::Vec;

use ojproto::{AssetId, ConnectionType, NodeIdx, OjGraph, PrimitiveKind};

use crate::dsp::DspInstance;
use crate::loader::PluginLoader;
use crate::registry::PluginRegistry;

/// Decoded PCM handed back by an [`AssetResolver`] so [`compile_with_assets`] can
/// install it into a node through [`DspInstance::load_asset`]. The buffer is kept
/// in its source INTERLEAVED layout (channel-major frames) and BORROWED zero-copy;
/// the per-channel split / downmix decision moves to the consuming node — a stereo
/// Sampler keeps both channels (`SamplerSample::from_interleaved`), while a node
/// that needs mono (the Convolution IR) downmixes via [`downmix_to_mono`]. This is
/// how the channel model widens to a real stereo Sampler without forcing a mono
/// boundary at compile time (`docs/CHANNELS.md` §5.3).
#[derive(Debug, Clone)]
pub struct AssetPcm<'a> {
    /// Interleaved PCM in `[-1, 1]` (`channels`-major frames). For `channels == 1`
    /// this is plain mono. Borrowed from the host's store (zero-copy).
    pub pcm: Cow<'a, [f32]>,
    /// Number of interleaved channels in `pcm` (`1` = mono).
    pub channels: u8,
    /// The PCM's own capture sample rate (Hz), for resampling correction.
    pub sample_rate: f32,
}

impl<'a> AssetPcm<'a> {
    /// Borrow already-mono PCM — zero-copy, the common live sampler/IR path.
    #[inline]
    pub fn mono(pcm: &'a [f32], sample_rate: f32) -> Self {
        Self {
            pcm: Cow::Borrowed(pcm),
            channels: 1,
            sample_rate,
        }
    }

    /// Borrow an interleaved buffer of `channels` channels UNCHANGED (zero-copy).
    /// Unlike before, this no longer downmixes: the channel count rides along so a
    /// stereo Sampler can play both channels and a mono-only consumer downmixes
    /// itself via [`downmix_to_mono`]. `channels` is clamped to `1..=255`.
    pub fn from_interleaved(samples: &'a [f32], channels: u16, sample_rate: f32) -> Self {
        Self {
            pcm: Cow::Borrowed(samples),
            channels: channels.clamp(1, u8::MAX as u16) as u8,
            sample_rate,
        }
    }
}

/// Downmix an interleaved buffer of `channels` channels to mono by averaging each
/// frame's channels. `channels <= 1` copies through unchanged. A trailing partial
/// frame (samples that don't fill a whole frame) is ignored. Off the RT thread:
/// the consuming node calls this when it needs a single channel (e.g. the
/// Convolution impulse response stays mono).
pub fn downmix_to_mono(interleaved: &[f32], channels: u8) -> Vec<f32> {
    let ch = channels.max(1) as usize;
    if ch == 1 {
        return interleaved.to_vec();
    }
    let frames = interleaved.len() / ch;
    let inv = 1.0 / ch as f32;
    let mut mono = Vec::with_capacity(frames);
    for f in 0..frames {
        let base = f * ch;
        let mut sum = 0.0;
        for c in 0..ch {
            sum += interleaved[base + c];
        }
        mono.push(sum * inv);
    }
    mono
}

/// Resolve an [`AssetId`] (baked into the IR via an [`ojproto::AssetRef`]) to its
/// decoded PCM, or `None` if the host has no such asset. Called off the RT thread
/// at compile time. The default resolver (used by [`compile`]) always returns
/// `None`, so a node with an unresolvable asset simply starts empty (the Sampler
/// renders silence until a sample is bound; the Convolution stays dry).
pub trait AssetResolver {
    /// Borrow the PCM for `id`, if present.
    fn resolve(&self, id: AssetId) -> Option<AssetPcm<'_>>;
}

/// A resolver that knows no assets — the default for [`compile`]. Hosts that own
/// decoded PCM pass their own (e.g. one backed by `ojcore-native::AssetCatalog`).
pub struct NoAssets;

impl AssetResolver for NoAssets {
    #[inline]
    fn resolve(&self, _id: AssetId) -> Option<AssetPcm<'_>> {
        None
    }
}

/// Resolves a node's saved opaque STATE blob (the `oj.state` RESTORE half) — the
/// state analogue of [`AssetResolver`]. [`compile_inner`] applies it via
/// [`DspInstance::restore_state`] right after `activate` and BEFORE the baked-in
/// `set_param`s, so the blob is the BASE state and the IR's CURRENT param values
/// always win (a post-load param edit is never overridden by a stale blob). It is
/// re-applied on EVERY compile, so a graph edit never drops the restored non-param
/// state. The default [`NoState`] restores nothing; the native host passes one
/// wrapping the project's staged blobs (`EngineBackend::stage_plugin_restores`).
pub trait StateResolver {
    /// Borrow the saved state blob for `node`, if a prior session staged one.
    fn resolve_state(&self, node: NodeIdx) -> Option<&[u8]>;
}

/// A resolver that restores no state — the default for [`compile`] /
/// [`compile_with_assets`] / [`compile_resilient`]. The browser tier and tests use
/// it (no hosted-plugin opaque state to restore).
pub struct NoState;

impl StateResolver for NoState {
    #[inline]
    fn resolve_state(&self, _node: NodeIdx) -> Option<&[u8]> {
        None
    }
}

/// One source buffer feeding a node input port: `(node slot, output port)`.
/// `node` is the *compiled* slot index (0..n_nodes), NOT the IR [`NodeIdx`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Source {
    /// Index into [`CompiledProgram::instances`] / `out_bufs` of the producer.
    pub node: usize,
    /// Which output port of that producer node.
    pub port: u16,
}

/// The routing for one node: for each of its input ports, the list of producer
/// buffers feeding it. Multiple sources on one port are summed (mixed) at run
/// time into a reused input-mix scratch — so this stays a flat plan with no
/// per-block allocation.
#[derive(Debug, Clone, Default)]
pub struct NodeRouting {
    /// `inputs[port]` = sources feeding input `port` of this node.
    pub inputs: Vec<Vec<Source>>,
}

/// A fully lowered, pre-allocated program. Owned by the [`crate::Engine`] and
/// handed across the graph-swap seam. Building one may allocate; running one
/// (see `exec.rs`) must not.
pub struct CompiledProgram {
    /// One live DSP instance per node, indexed by compiled slot.
    pub instances: Vec<Box<dyn DspInstance>>,
    /// Per-node routing plan (same indexing as `instances`).
    pub routing: Vec<NodeRouting>,
    /// Per-node output scratch: `out_bufs[node][lane]` is a `block_size`-long buffer
    /// the node writes its `lane`th output into. A node has `n_out × out_channels`
    /// audio LANES (a lane == a port when mono); pre-sized here. See docs/CHANNELS.md.
    pub out_bufs: Vec<Vec<Vec<f32>>>,
    /// Audio OUTPUT channels per port for each node, derived from its manifest
    /// (`PortDecl::audio_out_channels`, clamped `>= 1`). `out_bufs[node]` holds
    /// `n_out × out_channels[node]` lanes; `1` (mono) makes a lane a port.
    pub out_channels: Vec<u8>,
    /// Audio INPUT channels per port for each node (`PortDecl::audio_in_channels`).
    /// Drives input-lane adaptation (a later step); `1` today.
    pub in_channels: Vec<u8>,
    /// Per-node bypass flag (init false). Toggled by `RtCommand::Bypass`.
    pub bypassed: Vec<bool>,
    /// Lowered [`PrimitiveKind`] per node, so the RT loop never touches strings.
    pub kinds: Vec<PrimitiveKind>,
    /// IR node id per compiled slot, for routing commands by `NodeIdx`.
    pub ids: Vec<NodeIdx>,
    /// `(NodeIdx, slot)` sorted by id — lets `Engine::apply` route a command's
    /// `NodeIdx` to its compiled slot by binary search, allocation-free.
    pub id_index: Vec<(NodeIdx, usize)>,
    /// The compiled slot of the master-output node (SpeakerOut / GraphOut).
    pub master_out: usize,
    /// Max frames per block; instances were `activate`d with this.
    pub block_size: usize,
    /// Reusable per-input-port mix scratch, sized to the widest node fan-in
    /// (`max_in` rows of `block_size`). The hot path mixes each input port's
    /// sources into a row here, then hands `&[f32]` rows to the node — so the
    /// producer-buffer read borrow is released before the node's own output
    /// buffers are borrowed mutably (no aliasing, no allocation).
    pub in_scratch: Vec<Vec<f32>>,
    /// Widest input / output port count across all nodes. The [`crate::Engine`]
    /// sizes its channel-pointer scratch to these once at install time.
    pub max_in: usize,
    pub max_out: usize,
    /// Compiler-derived, cycle-free execution order (compiled slots). The RT
    /// loop walks this and indexes the by-slot tables above.
    pub schedule: Vec<usize>,
}

impl CompiledProgram {
    /// The number of compiled nodes.
    pub fn len(&self) -> usize {
        self.instances.len()
    }

    /// Whether the program holds no nodes (cannot happen post-`compile`, which
    /// requires a master output, but kept for clippy's `len`/`is_empty` pair).
    pub fn is_empty(&self) -> bool {
        self.instances.is_empty()
    }

    /// Resolve an IR [`NodeIdx`] to its compiled slot via binary search over
    /// the sorted id index. `None` if the id is not in this program.
    /// Allocation-free — safe to call from the RT thread (e.g. `Engine::apply`).
    pub fn slot_of_id(&self, id: NodeIdx) -> Option<usize> {
        self.id_index
            .binary_search_by_key(&id.0, |(k, _)| k.0)
            .ok()
            .map(|i| self.id_index[i].1)
    }

    /// The nodes that DEGRADED to a passthrough stub at compile — their IR `kind` is
    /// not `Passthrough` but they compiled to one (a missing dependency or an
    /// unsatisfiable `abi`; see [`compile_resilient`]). The control plane surfaces
    /// these as labeled stubs (invariant #4a); empty when every node loaded its real
    /// kernel. Pure: a kind-diff against the source `graph`, no extra state.
    pub fn degraded_stubs(&self, graph: &OjGraph) -> Vec<NodeIdx> {
        graph
            .nodes
            .iter()
            .filter(|n| n.kind != PrimitiveKind::Passthrough)
            .filter_map(|n| {
                let slot = self.slot_of_id(n.id)?;
                (self.kinds[slot] == PrimitiveKind::Passthrough).then_some(n.id)
            })
            .collect()
    }
}

/// Why compilation failed. No allocation-time error is silently swallowed:
/// a cycle or an unknown manifest is a HARD error, never a patched-over graph.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CompileError {
    /// A `manifest_id` did not resolve in the registry. Carries the offending id.
    UnknownManifest(alloc::string::String),
    /// The audio graph contains a feedback cycle (residual nodes after Kahn).
    Cycle,
    /// No node of kind `SpeakerOut`/`GraphOut` was found — nothing to output.
    NoMasterOutput,
    /// More than one master-output node — the engine output is ambiguous.
    MultipleMasterOutputs,
    /// An edge referenced a node id absent from `nodes`.
    DanglingEdge,
    /// An edge referenced an output/input port beyond a node's declared count.
    /// Rejected at compile time so it can never index-panic on the audio thread.
    PortOutOfRange,
}

impl core::fmt::Display for CompileError {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match self {
            CompileError::UnknownManifest(id) => write!(f, "unknown manifest id: {id}"),
            CompileError::Cycle => write!(f, "audio graph contains a feedback cycle"),
            CompileError::NoMasterOutput => write!(f, "no SpeakerOut/GraphOut master node"),
            CompileError::MultipleMasterOutputs => write!(f, "multiple master output nodes"),
            CompileError::DanglingEdge => write!(f, "edge references an unknown node id"),
            CompileError::PortOutOfRange => write!(f, "edge references an out-of-range port"),
        }
    }
}

/// Lower an [`OjGraph`] into a runnable [`CompiledProgram`].
///
/// Master-output rule (documented): exactly ONE node of kind
/// [`PrimitiveKind::SpeakerOut`] or [`PrimitiveKind::GraphOut`] must exist. Its
/// resolved input (port 0) becomes the engine's mono output. Zero such nodes is
/// [`CompileError::NoMasterOutput`]; more than one is
/// [`CompileError::MultipleMasterOutputs`].
pub fn compile(
    graph: &OjGraph,
    registry: &PluginRegistry,
) -> Result<CompiledProgram, CompileError> {
    compile_with_assets(graph, registry, &NoAssets)
}

/// Lower an [`OjGraph`] into a runnable [`CompiledProgram`], RESOLVING each
/// node's [`ojproto::AssetRef`]s through `assets` and installing the decoded PCM
/// into the node via [`DspInstance::load_asset`] before the program goes live.
///
/// This is the asset-aware sibling of [`compile`]: a Sampler node that carries an
/// `AssetRef` actually plays the bound sample (and a Convolution node loads its
/// IR), because the host's [`AssetResolver`] (e.g. one backed by
/// `ojcore-native::AssetCatalog`) hands back the PCM here, off the RT thread, at
/// compile time. Assets are installed AFTER `activate` + the baked-in params, so
/// a Sampler's `root_note` param is already in effect when its sample loads.
/// Unresolvable assets are skipped (the node starts empty), never an error.
pub fn compile_with_assets(
    graph: &OjGraph,
    registry: &PluginRegistry,
    assets: &impl AssetResolver,
) -> Result<CompiledProgram, CompileError> {
    compile_inner(graph, registry, assets, &NoState, false)
}

/// The LENIENT sibling of [`compile_with_assets`] for the project-LOAD path: an
/// UNREGISTERED `manifest_id` (a missing plugin / instrument dependency) degrades to
/// a passthrough stub — topology preserved, the project ALWAYS opens (invariant #4a,
/// held-note-beats-a-glitch on load) — instead of failing with
/// [`CompileError::UnknownManifest`]. The strict [`compile`] / [`compile_with_assets`]
/// stay the default so dev + tests still catch a typo'd or corrupt id loudly. (An
/// unsatisfiable `abi` already degrades to a stub in BOTH modes.) The control plane
/// surfaces a stubbed node by diffing the compiled kind against the IR kind.
pub fn compile_resilient(
    graph: &OjGraph,
    registry: &PluginRegistry,
    assets: &impl AssetResolver,
) -> Result<CompiledProgram, CompileError> {
    compile_inner(graph, registry, assets, &NoState, true)
}

/// The LENIENT, STATE-aware compile for the native project-LOAD path: like
/// [`compile_resilient`] but ALSO restores each hosted plugin's saved opaque blob
/// (the `oj.state` restore half) via `states`, applied BEFORE the baked-in params
/// so current params win and the blob is the base. The browser tier / tests use
/// [`compile_resilient`] (no hosted state); only the native host has a real
/// [`StateResolver`].
pub fn compile_resilient_with_state(
    graph: &OjGraph,
    registry: &PluginRegistry,
    assets: &impl AssetResolver,
    states: &dyn StateResolver,
) -> Result<CompiledProgram, CompileError> {
    compile_inner(graph, registry, assets, states, true)
}

/// Shared implementation of [`compile_with_assets`] (strict) and
/// [`compile_resilient`] (lenient). `lenient` only changes how an UNREGISTERED
/// `manifest_id` is handled (stub vs error); everything else is identical. `states`
/// restores any per-node saved opaque blob before the baked-in params.
fn compile_inner(
    graph: &OjGraph,
    registry: &PluginRegistry,
    assets: &impl AssetResolver,
    states: &dyn StateResolver,
    lenient: bool,
) -> Result<CompiledProgram, CompileError> {
    let n = graph.nodes.len();
    let sample_rate = graph.sample_rate as f32;
    let block_size = graph.block_size as usize;

    // --- map IR NodeIdx -> compiled slot (0..n) ----------------------------
    // Build a sorted index so lookup is a binary search (no_std-friendly, no
    // hashing dep). IR ids are unique per node.
    let mut id_to_slot: Vec<(NodeIdx, usize)> = graph
        .nodes
        .iter()
        .enumerate()
        .map(|(slot, node)| (node.id, slot))
        .collect();
    id_to_slot.sort_unstable_by_key(|(id, _)| id.0);
    let slot_of = |id: NodeIdx| -> Option<usize> {
        id_to_slot
            .binary_search_by_key(&id.0, |(k, _)| k.0)
            .ok()
            .map(|i| id_to_slot[i].1)
    };

    // --- resolve + instantiate every node ----------------------------------
    let mut instances: Vec<Box<dyn DspInstance>> = Vec::with_capacity(n);
    let mut kinds: Vec<PrimitiveKind> = Vec::with_capacity(n);
    let mut ids: Vec<NodeIdx> = Vec::with_capacity(n);
    let mut out_bufs: Vec<Vec<Vec<f32>>> = Vec::with_capacity(n);
    let mut out_channels: Vec<u8> = Vec::with_capacity(n);
    let mut in_channels: Vec<u8> = Vec::with_capacity(n);
    for node in &graph.nodes {
        // Resolve the loader. STRICT (the default): an unregistered `manifest_id` is a
        // hard error — it catches a typo'd or corrupt id in dev + tests. LENIENT (the
        // `compile_resilient` project-LOAD path): a missing dependency degrades to a
        // passthrough stub so the project ALWAYS opens (invariant #4a), exactly like an
        // unsatisfiable `abi` below.
        let loader = match registry.get(&node.manifest_id) {
            Some(l) => Some(l),
            None if lenient => None,
            None => return Err(CompileError::UnknownManifest(node.manifest_id.clone())),
        };
        // Channels are a node-TYPE property (docs/CHANNELS.md), derived from the
        // loader's manifest (`n_out × out_channels` audio output LANES; `1` = mono =>
        // a lane is a port). `loadable` is false for a missing dependency OR an
        // unsatisfiable `abi` (contract too new / a capability the kernel lacks) — BOTH
        // degrade to a passthrough stub (held-note-beats-a-glitch on load,
        // STABILITY.md §5), never a failed compile. A missing-dep stub keeps the IR
        // topology at mono lanes; the control plane diffs compiled-kind vs IR-kind.
        let (oc, ic, loadable) = match loader {
            Some(l) => {
                let oc = l.manifest().ports.audio_out_channels.max(1);
                let ic = l.manifest().ports.audio_in_channels.max(1);
                let abi_ok = l.manifest().abi.as_ref().is_none_or(|abi| {
                    abi.load_compatibility(
                        crate::dsp::KERNEL_CONTRACT,
                        crate::dsp::kernel_supports_capability,
                    )
                    .is_ok()
                });
                (oc, ic, abi_ok)
            }
            None => (1, 1, false),
        };
        let (mut inst, kind) = match (loader, loadable) {
            (Some(l), true) => (l.instantiate(sample_rate, block_size), node.kind),
            _ => (
                crate::structural::StructuralLoader::passthrough()
                    .instantiate(sample_rate, block_size),
                PrimitiveKind::Passthrough,
            ),
        };
        inst.activate(sample_rate, block_size);
        // oj.state RESTORE (off-RT, BEFORE params): seed the node with a prior
        // session's opaque blob so it is the BASE state. The baked-in `set_param`s
        // below then override with the CURRENT param values, so a post-load param
        // edit always wins and the blob never reverts it. Re-applied on EVERY
        // compile, so a graph edit never drops the restored non-param state. Default
        // `NoState` resolves nothing (browser tier / tests); a hosted plugin pushes
        // the blob into setStateInformation / the CLAP state extension.
        if let Some(blob) = states.resolve_state(node.id) {
            inst.restore_state(blob);
        }
        // Apply any baked-in param defaults from the IR, then snap smoothers.
        for p in &node.params {
            inst.set_param(p.id, p.value);
        }
        inst.reset();
        // Resolve + install any bound assets (sample PCM / impulse response).
        // Off the RT thread, AFTER params so e.g. a Sampler's root note is set.
        // Unresolvable assets are skipped — the node simply starts empty.
        for asset in &node.assets {
            if let Some(pcm) = assets.resolve(asset.asset) {
                inst.load_asset(asset.slot, &pcm.pcm, pcm.channels, pcm.sample_rate);
            }
        }
        instances.push(inst);
        kinds.push(kind);
        ids.push(node.id);
        // One pre-sized buffer per output LANE (`n_out` audio ports × channels).
        let lanes = node.n_out as usize * oc as usize;
        let mut bufs = Vec::with_capacity(lanes);
        for _ in 0..lanes {
            bufs.push(vec![0.0f32; block_size]);
        }
        out_bufs.push(bufs);
        out_channels.push(oc);
        in_channels.push(ic);
    }

    // --- build routing: for each node input port, the producer buffers -----
    // Only AUDIO edges route samples; control edges are a later unit.
    let mut routing: Vec<NodeRouting> = graph
        .nodes
        .iter()
        .map(|node| NodeRouting {
            inputs: vec![Vec::new(); node.n_in as usize],
        })
        .collect();
    for edge in &graph.edges {
        if edge.kind != ConnectionType::Audio {
            continue;
        }
        let from = slot_of(edge.from_node).ok_or(CompileError::DanglingEdge)?;
        let to = slot_of(edge.to_node).ok_or(CompileError::DanglingEdge)?;
        let port = edge.to_port as usize;
        // Reject out-of-range ports at COMPILE time: an unchecked port would
        // index-panic in `mix_input`/the render step on the audio thread, which
        // the RT-safety contract forbids. Validate BOTH the destination input
        // port and the source output port the run-time loop will dereference.
        if port >= routing[to].inputs.len() {
            return Err(CompileError::PortOutOfRange);
        }
        if (edge.from_port as usize) >= out_bufs[from].len() {
            return Err(CompileError::PortOutOfRange);
        }
        routing[to].inputs[port].push(Source {
            node: from,
            port: edge.from_port,
        });
    }

    // --- Kahn topological sort over audio edges; HARD-ERROR on cycle -------
    // We DERIVE our own order rather than trust `graph.schedule`: the compiler
    // is the authority on RT-safe ordering and must reject feedback loops, so
    // it cannot defer that to an upstream field that may be stale or wrong.
    let order = topo_sort(n, &graph.edges, &slot_of)?;

    // --- identify the single master output ---------------------------------
    let mut master: Option<usize> = None;
    for (slot, kind) in kinds.iter().enumerate() {
        if matches!(kind, PrimitiveKind::SpeakerOut | PrimitiveKind::GraphOut) {
            if master.is_some() {
                return Err(CompileError::MultipleMasterOutputs);
            }
            master = Some(slot);
        }
    }
    let master_out = master.ok_or(CompileError::NoMasterOutput)?;

    // Pre-size the hot-path scratch: one mix row per input LANE (audio ports ×
    // channels) of the widest node, and channel-pointer arrays as wide as the
    // widest lane count. Sized here so `process_block` never grows or allocates.
    // Equals the widest port count when mono.
    let max_in = graph
        .nodes
        .iter()
        .zip(in_channels.iter())
        .map(|(nd, &ic)| nd.n_in as usize * ic.max(1) as usize)
        .max()
        .unwrap_or(0);
    // Widest output LANE count (ports × channels) — the Engine sizes its output
    // channel-pointer scratch to this. Equals the widest port count when mono.
    let max_out = out_bufs.iter().map(|b| b.len()).max().unwrap_or(0);
    let in_scratch = (0..max_in).map(|_| vec![0.0f32; block_size]).collect();

    // No reorder of the by-slot tables is needed: the RT loop walks `schedule`
    // (the computed, cycle-free order) and indexes the by-slot tables by slot.
    Ok(CompiledProgram {
        instances,
        routing,
        out_bufs,
        out_channels,
        in_channels,
        bypassed: vec![false; n],
        kinds,
        ids,
        master_out,
        block_size,
        in_scratch,
        max_in,
        max_out,
        schedule: order,
        id_index: id_to_slot,
    })
}

/// Kahn's algorithm over the AUDIO edges only. Returns the node slots in a
/// valid execution order, or [`CompileError::Cycle`] if any node remains with a
/// non-zero in-degree (a residual cycle) — we NEVER break cycles silently.
fn topo_sort(
    n: usize,
    edges: &[ojproto::IrEdge],
    slot_of: &impl Fn(NodeIdx) -> Option<usize>,
) -> Result<Vec<usize>, CompileError> {
    let mut indeg = vec![0u32; n];
    // Adjacency as flat (from -> to) pairs; we only need successor scans.
    let mut succ: Vec<Vec<usize>> = vec![Vec::new(); n];
    for edge in edges {
        if edge.kind != ConnectionType::Audio {
            continue;
        }
        let from = slot_of(edge.from_node).ok_or(CompileError::DanglingEdge)?;
        let to = slot_of(edge.to_node).ok_or(CompileError::DanglingEdge)?;
        // Self-loops are cycles; counting them keeps `to` permanently blocked.
        succ[from].push(to);
        indeg[to] += 1;
    }

    // Seed the queue with every zero-in-degree node, in slot order for
    // determinism (stable schedules => reproducible golden renders).
    let mut queue: Vec<usize> = (0..n).filter(|&i| indeg[i] == 0).collect();
    let mut order: Vec<usize> = Vec::with_capacity(n);
    let mut head = 0;
    while head < queue.len() {
        let node = queue[head];
        head += 1;
        order.push(node);
        for &nxt in &succ[node] {
            indeg[nxt] -= 1;
            if indeg[nxt] == 0 {
                queue.push(nxt);
            }
        }
    }

    if order.len() != n {
        return Err(CompileError::Cycle);
    }
    Ok(order)
}

#[cfg(test)]
mod asset_pcm_tests {
    use super::{downmix_to_mono, AssetPcm};
    use alloc::borrow::Cow;

    #[test]
    fn mono_borrows_zero_copy() {
        let src = [0.1_f32, -0.2, 0.3];
        let a = AssetPcm::mono(&src, 48_000.0);
        assert!(matches!(a.pcm, Cow::Borrowed(_)), "mono must not allocate");
        assert_eq!(a.pcm.as_ref(), &src);
        assert_eq!(a.channels, 1);
        assert_eq!(a.sample_rate, 48_000.0);
    }

    #[test]
    fn from_interleaved_passes_mono_through_without_copy() {
        let src = [0.1_f32, -0.2, 0.3];
        let a = AssetPcm::from_interleaved(&src, 1, 48_000.0);
        assert!(
            matches!(a.pcm, Cow::Borrowed(_)),
            "1-channel must be borrowed"
        );
        assert_eq!(a.channels, 1);
        assert_eq!(a.pcm.as_ref(), &src);
    }

    #[test]
    fn from_interleaved_preserves_stereo_interleaved_zero_copy() {
        // The interleaved buffer + channel count now ride along UNCHANGED (the
        // per-channel split moved to the consuming node); no downmix, no alloc.
        let src = [1.0_f32, 3.0, -1.0, 1.0, 0.5, 0.5];
        let a = AssetPcm::from_interleaved(&src, 2, 44_100.0);
        assert!(
            matches!(a.pcm, Cow::Borrowed(_)),
            "stereo is borrowed, not downmixed"
        );
        assert_eq!(a.channels, 2);
        assert_eq!(a.pcm.as_ref(), &src);
        assert_eq!(a.sample_rate, 44_100.0);
    }

    #[test]
    fn from_interleaved_clamps_channels_to_u8() {
        let src = [0.0_f32; 4];
        assert_eq!(AssetPcm::from_interleaved(&src, 0, 48_000.0).channels, 1);
        assert_eq!(
            AssetPcm::from_interleaved(&src, 999, 48_000.0).channels,
            255
        );
    }

    #[test]
    fn downmix_to_mono_averages_frames_and_drops_partial() {
        // Stereo L/R frames: (1,3)->2, (-1,1)->0, (0.5,0.5)->0.5.
        assert_eq!(
            downmix_to_mono(&[1.0_f32, 3.0, -1.0, 1.0, 0.5, 0.5], 2),
            vec![2.0_f32, 0.0, 0.5]
        );
        // 3-channel frame (3,6,9)->6; the trailing partial (1,2) is ignored.
        assert_eq!(
            downmix_to_mono(&[3.0_f32, 6.0, 9.0, 1.0, 2.0], 3),
            vec![6.0_f32]
        );
        // Mono copies through unchanged.
        assert_eq!(downmix_to_mono(&[0.1_f32, -0.2], 1), vec![0.1_f32, -0.2]);
    }
}

#[cfg(test)]
mod channel_lane_tests {
    use super::*;
    use crate::dsp::{DspInstance, ProcessCtx};
    use crate::loader::PluginLoader;
    use crate::manifest::{Abi, ContractVersion, DspKind, PluginManifest, PortDecl, UiKind};
    use alloc::boxed::Box;
    use alloc::string::String;
    use alloc::vec;
    use ojproto::{ConnectionType, IrEdge, IrNode, NodeIdx, OjGraph};

    /// A no-op node whose manifest declares a STEREO (2-channel) audio output port.
    struct StereoNode;
    impl DspInstance for StereoNode {
        fn activate(&mut self, _sr: f32, _mb: usize) {}
        fn process(&mut self, _ctx: &mut ProcessCtx<'_, '_>) {}
        fn set_param(&mut self, _id: u16, _v: f32) {}
    }
    struct StereoLoader {
        manifest: PluginManifest,
    }
    impl PluginLoader for StereoLoader {
        fn manifest(&self) -> &PluginManifest {
            &self.manifest
        }
        fn instantiate(&self, _sr: f32, _mb: usize) -> Box<dyn DspInstance> {
            Box::new(StereoNode)
        }
    }

    /// The compiler derives a node's audio output channel count from its manifest
    /// and allocates `n_out × channels` output LANES — so a stereo node gets two
    /// output buffers while a mono master keeps one. (docs/CHANNELS.md step 1.)
    #[test]
    fn stereo_manifest_allocates_two_output_lanes() {
        let mut reg = PluginRegistry::new();
        reg.register(Box::new(StereoLoader {
            manifest: PluginManifest {
                abi: None,
                id: String::from("test.stereo"),
                name: String::from("Stereo"),
                kind: PrimitiveKind::Osc,
                dsp: DspKind::Builtin,
                ui: UiKind::Auto,
                params: vec![],
                ports: PortDecl {
                    audio_in: 0,
                    audio_out: 1,
                    control_in: 0,
                    control_out: 0,
                    audio_in_channels: 1,
                    audio_out_channels: 2,
                },
            },
        }));
        reg.register(Box::new(crate::structural::StructuralLoader::speaker_out()));

        let mut g = OjGraph::empty(48_000, 64);
        g.nodes.push(IrNode {
            id: NodeIdx(1),
            manifest_id: String::from("test.stereo"),
            kind: PrimitiveKind::Osc,
            params: vec![],
            assets: vec![],
            n_in: 0,
            n_out: 1,
        });
        g.nodes.push(IrNode {
            id: NodeIdx(2),
            manifest_id: String::from(crate::SPEAKER_OUT_ID),
            kind: PrimitiveKind::SpeakerOut,
            params: vec![],
            assets: vec![],
            n_in: 1,
            n_out: 0,
        });
        g.edges.push(IrEdge {
            from_node: NodeIdx(1),
            from_port: 0,
            to_node: NodeIdx(2),
            to_port: 0,
            kind: ConnectionType::Audio,
        });

        let prog = compile(&g, &reg).expect("compiles");
        let stereo = prog.slot_of_id(NodeIdx(1)).unwrap();
        assert_eq!(prog.out_channels[stereo], 2);
        assert_eq!(
            prog.out_bufs[stereo].len(),
            2,
            "1 audio out port × 2 channels = 2 output lanes"
        );
        // The mono master sink is unchanged: 1 channel, no output lanes.
        let spk = prog.slot_of_id(NodeIdx(2)).unwrap();
        assert_eq!(prog.out_channels[spk], 1);
        assert!(prog.out_bufs[spk].is_empty());
    }

    /// `compile_resilient_with_state` restores a node's saved blob BEFORE the
    /// baked-in params (so the blob is the BASE and the current param wins), and it
    /// is re-applied every compile (a graph edit never drops the restored state). A
    /// node whose `restore_state` sets its value and `set_param` overrides it ends at
    /// the PARAM value when a param is present (proving restore ran first), and at the
    /// BLOB value when no param overrides (proving the restore round-trips).
    #[test]
    fn compile_restores_state_before_params() {
        struct StatefulNode {
            value: u8,
        }
        impl DspInstance for StatefulNode {
            fn activate(&mut self, _sr: f32, _mb: usize) {}
            fn process(&mut self, _ctx: &mut ProcessCtx<'_, '_>) {}
            fn set_param(&mut self, _id: u16, v: f32) {
                self.value = v as u8;
            }
            fn restore_state(&mut self, blob: &[u8]) {
                if let Some(&b) = blob.first() {
                    self.value = b;
                }
            }
            fn save_state(&self) -> alloc::vec::Vec<u8> {
                vec![self.value]
            }
        }
        struct StatefulLoader {
            manifest: PluginManifest,
        }
        impl PluginLoader for StatefulLoader {
            fn manifest(&self) -> &PluginManifest {
                &self.manifest
            }
            fn instantiate(&self, _sr: f32, _mb: usize) -> Box<dyn DspInstance> {
                Box::new(StatefulNode { value: 0 })
            }
        }
        struct OneState {
            blob: alloc::vec::Vec<u8>,
        }
        impl StateResolver for OneState {
            fn resolve_state(&self, node: NodeIdx) -> Option<&[u8]> {
                (node == NodeIdx(1)).then(|| self.blob.as_slice())
            }
        }

        let manifest = |id: &str| PluginManifest {
            abi: None,
            id: String::from(id),
            name: String::from("Stateful"),
            kind: PrimitiveKind::Osc,
            dsp: DspKind::Builtin,
            ui: UiKind::Auto,
            params: vec![],
            ports: PortDecl {
                audio_in: 0,
                audio_out: 1,
                control_in: 0,
                control_out: 0,
                audio_in_channels: 1,
                audio_out_channels: 1,
            },
        };
        let build_reg = || {
            let mut reg = PluginRegistry::new();
            reg.register(Box::new(StatefulLoader {
                manifest: manifest("test.stateful"),
            }));
            reg.register(Box::new(crate::structural::StructuralLoader::speaker_out()));
            reg
        };
        let build_graph = |param: Option<f32>| {
            let mut g = OjGraph::empty(48_000, 64);
            g.nodes.push(IrNode {
                id: NodeIdx(1),
                manifest_id: String::from("test.stateful"),
                kind: PrimitiveKind::Osc,
                params: param
                    .map(|v| vec![ojproto::Param { id: 0, value: v }])
                    .unwrap_or_default(),
                assets: vec![],
                n_in: 0,
                n_out: 1,
            });
            g.nodes.push(IrNode {
                id: NodeIdx(2),
                manifest_id: String::from(crate::SPEAKER_OUT_ID),
                kind: PrimitiveKind::SpeakerOut,
                params: vec![],
                assets: vec![],
                n_in: 1,
                n_out: 0,
            });
            g.edges.push(IrEdge {
                from_node: NodeIdx(1),
                from_port: 0,
                to_node: NodeIdx(2),
                to_port: 0,
                kind: ConnectionType::Audio,
            });
            g
        };
        let states = OneState { blob: vec![99] };

        // Param present: restore(99) THEN set_param(5) -> value 5 (param wins -> restore was first).
        let prog =
            compile_resilient_with_state(&build_graph(Some(5.0)), &build_reg(), &NoAssets, &states)
                .expect("compiles");
        let slot = prog.slot_of_id(NodeIdx(1)).unwrap();
        assert_eq!(
            prog.instances[slot].save_state(),
            vec![5u8],
            "restore is the BASE; the current param overrides it (so restore ran first)"
        );

        // No param: the restored blob value survives (restore round-trips end to end).
        let prog2 =
            compile_resilient_with_state(&build_graph(None), &build_reg(), &NoAssets, &states)
                .expect("compiles");
        let slot2 = prog2.slot_of_id(NodeIdx(1)).unwrap();
        assert_eq!(
            prog2.instances[slot2].save_state(),
            vec![99u8],
            "the staged blob restores when no param overrides it"
        );
    }

    /// An incompatible-abi plugin (declares a kernel contract NEWER than this kernel)
    /// DEGRADES to a passthrough stub instead of failing the compile — invariant #4a,
    /// held-note-beats-a-glitch on LOAD. The project still compiles and stays audible.
    #[test]
    fn abi_incompatible_plugin_degrades_to_passthrough_stub() {
        struct AbiNode;
        impl DspInstance for AbiNode {
            fn activate(&mut self, _sr: f32, _mb: usize) {}
            fn process(&mut self, _ctx: &mut ProcessCtx<'_, '_>) {}
            fn set_param(&mut self, _id: u16, _v: f32) {}
        }
        struct AbiLoader {
            manifest: PluginManifest,
        }
        impl PluginLoader for AbiLoader {
            fn manifest(&self) -> &PluginManifest {
                &self.manifest
            }
            fn instantiate(&self, _sr: f32, _mb: usize) -> Box<dyn DspInstance> {
                Box::new(AbiNode)
            }
        }

        let mut reg = PluginRegistry::new();
        // Requires kernel contract >= 2.0, but KERNEL_CONTRACT is 1.0 — unsatisfiable.
        reg.register(Box::new(AbiLoader {
            manifest: PluginManifest {
                abi: Some(Abi {
                    contract: ContractVersion::new(2, 0),
                    min_contract: ContractVersion::new(2, 0),
                    capabilities: vec![],
                    permissions: vec![],
                }),
                id: String::from("test.future"),
                name: String::from("FromTheFuture"),
                kind: PrimitiveKind::Gain,
                dsp: DspKind::Builtin,
                ui: UiKind::Auto,
                params: vec![],
                ports: PortDecl {
                    audio_in: 1,
                    audio_out: 1,
                    control_in: 0,
                    control_out: 0,
                    audio_in_channels: 1,
                    audio_out_channels: 1,
                },
            },
        }));
        reg.register(Box::new(crate::structural::StructuralLoader::speaker_out()));

        let mut g = OjGraph::empty(48_000, 64);
        g.nodes.push(IrNode {
            id: NodeIdx(1),
            manifest_id: String::from("test.future"),
            kind: PrimitiveKind::Gain,
            params: vec![],
            assets: vec![],
            n_in: 1,
            n_out: 1,
        });
        g.nodes.push(IrNode {
            id: NodeIdx(2),
            manifest_id: String::from(crate::SPEAKER_OUT_ID),
            kind: PrimitiveKind::SpeakerOut,
            params: vec![],
            assets: vec![],
            n_in: 1,
            n_out: 0,
        });
        g.edges.push(IrEdge {
            from_node: NodeIdx(1),
            from_port: 0,
            to_node: NodeIdx(2),
            to_port: 0,
            kind: ConnectionType::Audio,
        });

        // Compiles (no error — the project opens) and the incompatible node is now a
        // passthrough stub, not its declared Gain kind.
        let prog = compile(&g, &reg).expect("compiles with a degraded stub, never errors");
        let stub = prog.slot_of_id(NodeIdx(1)).unwrap();
        assert_eq!(
            prog.kinds[stub],
            PrimitiveKind::Passthrough,
            "incompatible-abi node degraded to a passthrough stub"
        );
    }

    /// A graph referencing an UNREGISTERED `manifest_id`: strict `compile` errors
    /// (`UnknownManifest`, so dev + tests catch a typo), but `compile_resilient`
    /// degrades the missing dependency to a passthrough stub so the project still
    /// opens (invariant #4a, held-note-beats-a-glitch on load).
    #[test]
    fn missing_dependency_is_strict_error_but_lenient_passthrough_stub() {
        let mut reg = PluginRegistry::new();
        reg.register(Box::new(crate::structural::StructuralLoader::speaker_out()));

        let mut g = OjGraph::empty(48_000, 64);
        g.nodes.push(IrNode {
            id: NodeIdx(1),
            manifest_id: String::from("missing.plugin.v9"), // never registered
            kind: PrimitiveKind::Gain,
            params: vec![],
            assets: vec![],
            n_in: 1,
            n_out: 1,
        });
        g.nodes.push(IrNode {
            id: NodeIdx(2),
            manifest_id: String::from(crate::SPEAKER_OUT_ID),
            kind: PrimitiveKind::SpeakerOut,
            params: vec![],
            assets: vec![],
            n_in: 1,
            n_out: 0,
        });
        g.edges.push(IrEdge {
            from_node: NodeIdx(1),
            from_port: 0,
            to_node: NodeIdx(2),
            to_port: 0,
            kind: ConnectionType::Audio,
        });

        // Strict: a hard error — the default, so a typo/corruption is caught loudly.
        assert!(matches!(
            compile(&g, &reg),
            Err(CompileError::UnknownManifest(_))
        ));

        // Lenient: the project opens; the missing node is a passthrough stub with its
        // IR topology preserved (one mono output lane).
        let prog =
            compile_resilient(&g, &reg, &NoAssets).expect("resilient compile opens the project");
        let stub = prog.slot_of_id(NodeIdx(1)).unwrap();
        assert_eq!(
            prog.kinds[stub],
            PrimitiveKind::Passthrough,
            "missing dependency degraded to a passthrough stub"
        );
        assert_eq!(prog.out_bufs[stub].len(), 1, "topology preserved at mono");
        // The control plane can enumerate the degraded node(s) for a UI label.
        assert_eq!(prog.degraded_stubs(&g), vec![NodeIdx(1)]);
    }
}
