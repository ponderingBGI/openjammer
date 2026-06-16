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

use alloc::boxed::Box;
use alloc::vec;
use alloc::vec::Vec;

use ojproto::{AssetId, ConnectionType, NodeIdx, OjGraph, PrimitiveKind};

use crate::dsp::DspInstance;
use crate::registry::PluginRegistry;

/// A borrowed view of an already-decoded mono asset, handed back by an
/// [`AssetResolver`] so [`compile_with_assets`] can install it into a node
/// through [`DspInstance::load_asset`] WITHOUT this `no_std` crate ever owning
/// the PCM (it lives in the host's `ojcore-native::AssetCatalog`).
#[derive(Debug, Clone, Copy)]
pub struct AssetPcm<'a> {
    /// Mono PCM samples in `[-1, 1]`.
    pub pcm: &'a [f32],
    /// The PCM's own capture sample rate (Hz), for resampling correction.
    pub sample_rate: f32,
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
    /// Per-node output scratch: `out_bufs[node][port]` is a `block_size`-long
    /// buffer the node writes its `port`th output into. Pre-sized here.
    pub out_bufs: Vec<Vec<Vec<f32>>>,
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
    for node in &graph.nodes {
        let loader = registry
            .get(&node.manifest_id)
            .ok_or_else(|| CompileError::UnknownManifest(node.manifest_id.clone()))?;
        let mut inst = loader.instantiate(sample_rate, block_size);
        inst.activate(sample_rate, block_size);
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
                inst.load_asset(asset.slot, pcm.pcm, pcm.sample_rate);
            }
        }
        instances.push(inst);
        kinds.push(node.kind);
        ids.push(node.id);
        // One pre-sized output buffer per declared output port.
        let n_out = node.n_out as usize;
        let mut bufs = Vec::with_capacity(n_out);
        for _ in 0..n_out {
            bufs.push(vec![0.0f32; block_size]);
        }
        out_bufs.push(bufs);
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

    // Pre-size the hot-path scratch: one mix row per input port of the widest
    // node, and channel-pointer arrays as wide as the widest port count. Sized
    // here so `process_block` never grows or allocates them.
    let max_in = graph
        .nodes
        .iter()
        .map(|nd| nd.n_in as usize)
        .max()
        .unwrap_or(0);
    let max_out = graph
        .nodes
        .iter()
        .map(|nd| nd.n_out as usize)
        .max()
        .unwrap_or(0);
    let in_scratch = (0..max_in).map(|_| vec![0.0f32; block_size]).collect();

    // No reorder of the by-slot tables is needed: the RT loop walks `schedule`
    // (the computed, cycle-free order) and indexes the by-slot tables by slot.
    Ok(CompiledProgram {
        instances,
        routing,
        out_bufs,
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
