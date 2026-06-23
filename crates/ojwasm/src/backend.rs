//! wasmtime realtime execution backend (feature `wasmtime-host`).
//!
//! Builds an epoch-interruptible wasmtime instance of an import-free `oj_*`-ABI
//! module (see `docs/code-node-abi.md`) and drives it as a [`Kernel`].
//!
//! RT-safety: instantiation, memory growth, and `oj_init` all happen OFF the audio
//! thread (in [`build_kernel`] / [`Kernel::init`]); the RT [`Kernel::process`] only
//! copies samples in/out of the pre-grown linear memory and calls the typed
//! `oj_process` — it allocates nothing and never grows memory. A runaway kernel is
//! pre-empted by the engine's epoch deadline (a background watchdog bumps the
//! epoch); a trap or deadline returns [`KernelTrap`] as ordinary control flow, so
//! the host bypasses to a guarded passthrough and the audio thread never panics.

use std::sync::OnceLock;
use std::thread;

use wasmtime::{
    Config, Engine, Global, GlobalType, Instance, Linker, Memory, Module, Mutability, Store,
    TypedFunc, Val, ValType,
};

use crate::{Kernel, KernelTrap};

/// wasm linear-memory page size (64 KiB).
const PAGE: usize = 65536;

// The runaway-kernel epoch guard — `WATCHDOG_PERIOD`, `INIT_EPOCH_BUDGET`, and the
// per-block `epoch_budget_ticks` — lives in `crate` (lib.rs) so it is unit-tested
// without the wasmtime dep. The old FIXED 8-tick (~8 ms) budget is gone: the
// per-block deadline now scales with the block period (`crate::epoch_budget_ticks`).

/// The process-wide, epoch-interruptible wasmtime engine + its watchdog thread.
///
/// One engine is shared by every code-node instance; the watchdog increments its
/// epoch so a runaway `oj_process` is pre-empted. (At wiring time this moves into
/// the native `EngineBackend` so the lifetime is owned rather than process-global;
/// isolated here so the crate tests + builds standalone.)
fn shared_engine() -> &'static Engine {
    static ENGINE: OnceLock<Engine> = OnceLock::new();
    ENGINE.get_or_init(|| {
        let mut config = Config::new();
        config.epoch_interruption(true);
        let engine = Engine::new(&config).expect("epoch-interruptible wasmtime config is valid");
        let watch = engine.clone();
        let _ = thread::Builder::new()
            .name("ojwasm-epoch".into())
            .spawn(move || loop {
                thread::sleep(crate::WATCHDOG_PERIOD);
                watch.increment_epoch();
            });
        engine
    })
}

/// Build a wasm [`Kernel`] from module `bytes`, or `None` when the module is
/// rejected — it declares imports (the ABI forbids them), lacks an `oj_*` export
/// or the `memory` export, or traps during instantiation. The host then falls back
/// to a guarded passthrough rather than failing the graph.
pub(crate) fn build_kernel(
    bytes: &[u8],
    audio_in: usize,
    audio_out: usize,
) -> Option<Box<dyn Kernel>> {
    WasmtimeKernel::new(bytes, audio_in, audio_out)
        .ok()
        .map(|k| Box::new(k) as Box<dyn Kernel>)
}

/// One epoch-interruptible wasmtime instance, driven through the `oj_*` ABI.
struct WasmtimeKernel {
    store: Store<()>,
    memory: Memory,
    oj_init: TypedFunc<(i32, i32), ()>,
    oj_process: TypedFunc<(i32, i32, i32), ()>,
    oj_param: TypedFunc<(i32, f32), ()>,
    audio_in: usize,
    audio_out: usize,
    /// Byte offset of the interleaved input scratch in linear memory.
    in_ptr: usize,
    /// Byte offset of the interleaved output scratch in linear memory.
    out_ptr: usize,
    max_block: usize,
    /// Per-block epoch deadline (in watchdog ticks), set from the block period in
    /// `init`; `INIT_EPOCH_BUDGET` until then. See `crate::epoch_budget_ticks`.
    epoch_budget: u64,
    /// False until `init` grew memory + ran `oj_init` cleanly; a non-usable kernel
    /// makes `process` return [`KernelTrap`] so the host bypasses.
    usable: bool,
}

impl WasmtimeKernel {
    fn new(bytes: &[u8], audio_in: usize, audio_out: usize) -> Result<Self, ()> {
        let engine = shared_engine();
        let module = Module::new(engine, bytes).map_err(|_| ())?;
        // ABI: a conforming module imports NOTHING (no host functions, no WASI).
        if module.imports().count() > 0 {
            return Err(());
        }
        let mut store = Store::new(engine, ());
        // Bound a hostile `start` / ctor so instantiation can't hang the control
        // thread (the watchdog is already bumping the epoch).
        store.set_epoch_deadline(crate::INIT_EPOCH_BUDGET);
        let instance = Instance::new(&mut store, &module, &[]).map_err(|_| ())?;
        let memory = instance.get_memory(&mut store, "memory").ok_or(())?;
        let oj_init = instance
            .get_typed_func::<(i32, i32), ()>(&mut store, "oj_init")
            .map_err(|_| ())?;
        let oj_process = instance
            .get_typed_func::<(i32, i32, i32), ()>(&mut store, "oj_process")
            .map_err(|_| ())?;
        let oj_param = instance
            .get_typed_func::<(i32, f32), ()>(&mut store, "oj_param")
            .map_err(|_| ())?;
        Ok(Self {
            store,
            memory,
            oj_init,
            oj_process,
            oj_param,
            audio_in,
            audio_out,
            in_ptr: 0,
            out_ptr: 0,
            max_block: 0,
            epoch_budget: crate::INIT_EPOCH_BUDGET,
            usable: false,
        })
    }
}

impl Kernel for WasmtimeKernel {
    fn init(&mut self, sample_rate: f32, max_block: usize) {
        self.max_block = max_block;
        // Place I/O scratch in FRESH pages above the module's initial memory (which
        // holds the kernel's own state + its embedded manifest), so host scratch can
        // never collide with them. The host owns this placement; the kernel only
        // ever sees `in_ptr`/`out_ptr` per block.
        let cur_bytes = (self.memory.size(&self.store) as usize) * PAGE;
        let in_bytes = max_block * self.audio_in * 4;
        let out_bytes = max_block * self.audio_out * 4;
        self.in_ptr = cur_bytes;
        self.out_ptr = cur_bytes + in_bytes;
        let needed_end = self.out_ptr + out_bytes;
        let grow_pages = needed_end.saturating_sub(cur_bytes).div_ceil(PAGE);
        let grown = self.memory.grow(&mut self.store, grow_pages as u64).is_ok();
        self.epoch_budget = crate::epoch_budget_ticks(sample_rate, max_block);
        self.store.set_epoch_deadline(self.epoch_budget);
        let inited = self
            .oj_init
            .call(&mut self.store, (sample_rate as i32, max_block as i32))
            .is_ok();
        self.usable = grown && inited;
    }

    fn process(&mut self, input: &[f32], output: &mut [f32], n: usize) -> Result<(), KernelTrap> {
        if !self.usable {
            return Err(KernelTrap);
        }
        let n = n.min(self.max_block);
        let in_len = n * self.audio_in;
        let out_len = n * self.audio_out;

        // Interleaved host input -> wasm linear memory @ in_ptr (LE f32). Scoped so
        // the &mut data borrow drops before the call below.
        {
            let data = self.memory.data_mut(&mut self.store);
            let base = self.in_ptr;
            if base + in_len * 4 > data.len() {
                return Err(KernelTrap);
            }
            for (i, &s) in input.iter().take(in_len).enumerate() {
                let off = base + i * 4;
                data[off..off + 4].copy_from_slice(&s.to_le_bytes());
            }
        }

        self.store.set_epoch_deadline(self.epoch_budget);
        self.oj_process
            .call(
                &mut self.store,
                (self.in_ptr as i32, self.out_ptr as i32, n as i32),
            )
            .map_err(|_| KernelTrap)?;

        // wasm output @ out_ptr -> interleaved host output (LE f32).
        let data = self.memory.data(&self.store);
        let base = self.out_ptr;
        if base + out_len * 4 > data.len() {
            return Err(KernelTrap);
        }
        for (i, slot) in output.iter_mut().take(out_len).enumerate() {
            let off = base + i * 4;
            let mut b = [0u8; 4];
            b.copy_from_slice(&data[off..off + 4]);
            *slot = f32::from_le_bytes(b);
        }
        Ok(())
    }

    fn param(&mut self, idx: u16, value: f32) {
        if !self.usable {
            return;
        }
        self.store.set_epoch_deadline(self.epoch_budget);
        // A trapped param write poisons the store; the next `process` then returns
        // Err and the host bypasses — so the result is intentionally ignored here.
        let _ = self.oj_param.call(&mut self.store, (idx as i32, value));
    }
}

// ===========================================================================
// FaustWasmKernel — runs faust's NATIVE wasm ABI (it does not emit `oj_*`).
// ===========================================================================

/// 8-byte-align `x` (faust's dsp struct + buffers stay naturally aligned).
fn align8(x: usize) -> usize {
    (x + 7) & !7
}

/// Build a [`Kernel`] from a `faust -lang wasm` module (faust's native ABI), or
/// `None` if it can't be instantiated/driven. `dsp_size` is faust's `-json`
/// `"size"` (the dsp struct byte size the host must allocate).
pub(crate) fn build_faust_kernel(bytes: &[u8], dsp_size: usize) -> Option<Box<dyn Kernel>> {
    FaustWasmKernel::new(bytes, dsp_size)
        .ok()
        .map(|k| Box::new(k) as Box<dyn Kernel>)
}

/// Adapts a faust wasm module to the [`Kernel`] trait. faust exports a dsp-pointer
/// ABI (`init(dsp,sr)`, `compute(dsp,count,inputs,outputs)`,
/// `setParamValue(dsp,index,value)`) over channel buffers reached through pointer
/// arrays, and imports `env.memoryBase`. This wrapper supplies that import, lays
/// the dsp struct + per-channel I/O buffers + the two pointer arrays out in fresh
/// pages above faust's own memory, and transposes interleaved host audio ↔ faust's
/// non-interleaved channel buffers.
struct FaustWasmKernel {
    store: Store<()>,
    memory: Memory,
    init: TypedFunc<(i32, i32), ()>,
    compute: TypedFunc<(i32, i32, i32, i32), ()>,
    set_param: TypedFunc<(i32, i32, f32), ()>,
    dsp: usize,
    dsp_size: usize,
    num_in: usize,
    num_out: usize,
    /// Byte offset of the input pointer-array (one i32 per input channel).
    in_ptrs: usize,
    /// Byte offset of the output pointer-array.
    out_ptrs: usize,
    /// Byte offset of input channel buffer `i` = `in_buf0 + i*max_block*4`.
    in_buf0: usize,
    out_buf0: usize,
    max_block: usize,
    /// Per-block epoch deadline (in watchdog ticks); see `crate::epoch_budget_ticks`.
    epoch_budget: u64,
    usable: bool,
}

impl FaustWasmKernel {
    fn new(bytes: &[u8], dsp_size: usize) -> Result<Self, ()> {
        let engine = shared_engine();
        // NOTE: faust's `-lang wasm` output always carries a wasm exception-handling
        // tag section, which wasmtime 45 + cranelift cannot parse/execute (see
        // docs/code-node-abi.md), so Module::new below currently fails for faust
        // modules → the host falls back to a guarded passthrough. This adapter is
        // otherwise complete and runs once the toolchain supports exception wasm
        // (or faust gains an exception-free output mode).
        let module = Module::new(engine, bytes).map_err(|_| ())?;
        let mut store = Store::new(engine, ());
        store.set_epoch_deadline(crate::INIT_EPOCH_BUDGET);

        // faust imports `env.memoryBase` + `env.tableBase` (base offsets for its
        // addresses); a standalone module wants 0 for both.
        let mut linker = Linker::new(engine);
        let i32_const0 = GlobalType::new(ValType::I32, Mutability::Const);
        let mem_base = Global::new(&mut store, i32_const0.clone(), Val::I32(0)).map_err(|_| ())?;
        linker
            .define(&store, "env", "memoryBase", mem_base)
            .map_err(|_| ())?;
        let table_base = Global::new(&mut store, i32_const0, Val::I32(0)).map_err(|_| ())?;
        linker
            .define(&store, "env", "tableBase", table_base)
            .map_err(|_| ())?;

        let instance = linker.instantiate(&mut store, &module).map_err(|_| ())?;
        let memory = instance.get_memory(&mut store, "memory").ok_or(())?;
        let init = instance
            .get_typed_func::<(i32, i32), ()>(&mut store, "init")
            .map_err(|_| ())?;
        let compute = instance
            .get_typed_func::<(i32, i32, i32, i32), ()>(&mut store, "compute")
            .map_err(|_| ())?;
        let set_param = instance
            .get_typed_func::<(i32, i32, f32), ()>(&mut store, "setParamValue")
            .map_err(|_| ())?;
        let get_num_in = instance
            .get_typed_func::<i32, i32>(&mut store, "getNumInputs")
            .map_err(|_| ())?;
        let get_num_out = instance
            .get_typed_func::<i32, i32>(&mut store, "getNumOutputs")
            .map_err(|_| ())?;
        // getNumInputs/Outputs return compile-time constants (the dsp arg is
        // ignored), so they are safe to call before init with a 0 pointer.
        let num_in = get_num_in.call(&mut store, 0).map_err(|_| ())?.max(0) as usize;
        let num_out = get_num_out.call(&mut store, 0).map_err(|_| ())?.max(0) as usize;

        Ok(Self {
            store,
            memory,
            init,
            compute,
            set_param,
            dsp: 0,
            dsp_size,
            num_in,
            num_out,
            in_ptrs: 0,
            out_ptrs: 0,
            in_buf0: 0,
            out_buf0: 0,
            max_block: 0,
            epoch_budget: crate::INIT_EPOCH_BUDGET,
            usable: false,
        })
    }
}

impl Kernel for FaustWasmKernel {
    fn init(&mut self, sample_rate: f32, max_block: usize) {
        self.max_block = max_block;
        // Lay the dsp struct + pointer arrays + per-channel I/O buffers out in fresh
        // pages ABOVE faust's initial memory, so they never collide with faust's
        // static data (which lives in the low pages).
        let base = (self.memory.size(&self.store) as usize) * PAGE;
        let dsp = align8(base);
        let in_ptrs = align8(dsp + self.dsp_size);
        let out_ptrs = in_ptrs + self.num_in * 4;
        let in_buf0 = align8(out_ptrs + self.num_out * 4);
        let out_buf0 = in_buf0 + self.num_in * max_block * 4;
        let end = out_buf0 + self.num_out * max_block * 4;

        let cur_bytes = base;
        let grow_pages = end.saturating_sub(cur_bytes).div_ceil(PAGE);
        if self
            .memory
            .grow(&mut self.store, grow_pages as u64)
            .is_err()
        {
            self.usable = false;
            return;
        }
        self.dsp = dsp;
        self.in_ptrs = in_ptrs;
        self.out_ptrs = out_ptrs;
        self.in_buf0 = in_buf0;
        self.out_buf0 = out_buf0;

        // Write the (fixed) pointer arrays: in_ptrs[i] -> input buffer i, etc.
        {
            let data = self.memory.data_mut(&mut self.store);
            for i in 0..self.num_in {
                let p = (in_buf0 + i * max_block * 4) as i32;
                data[in_ptrs + i * 4..in_ptrs + i * 4 + 4].copy_from_slice(&p.to_le_bytes());
            }
            for i in 0..self.num_out {
                let p = (out_buf0 + i * max_block * 4) as i32;
                data[out_ptrs + i * 4..out_ptrs + i * 4 + 4].copy_from_slice(&p.to_le_bytes());
            }
        }

        self.epoch_budget = crate::epoch_budget_ticks(sample_rate, max_block);
        self.store.set_epoch_deadline(self.epoch_budget);
        self.usable = self
            .init
            .call(&mut self.store, (self.dsp as i32, sample_rate as i32))
            .is_ok();
    }

    fn process(&mut self, input: &[f32], output: &mut [f32], n: usize) -> Result<(), KernelTrap> {
        if !self.usable {
            return Err(KernelTrap);
        }
        let n = n.min(self.max_block);
        // De-interleave host input -> faust's per-channel buffers.
        {
            let data = self.memory.data_mut(&mut self.store);
            for ch in 0..self.num_in {
                let buf = self.in_buf0 + ch * self.max_block * 4;
                for f in 0..n {
                    let s = input.get(f * self.num_in + ch).copied().unwrap_or(0.0);
                    let off = buf + f * 4;
                    if off + 4 > data.len() {
                        return Err(KernelTrap);
                    }
                    data[off..off + 4].copy_from_slice(&s.to_le_bytes());
                }
            }
        }

        self.store.set_epoch_deadline(self.epoch_budget);
        self.compute
            .call(
                &mut self.store,
                (
                    self.dsp as i32,
                    n as i32,
                    self.in_ptrs as i32,
                    self.out_ptrs as i32,
                ),
            )
            .map_err(|_| KernelTrap)?;

        // Re-interleave faust's per-channel output -> interleaved host output.
        let data = self.memory.data(&self.store);
        for ch in 0..self.num_out {
            let buf = self.out_buf0 + ch * self.max_block * 4;
            for f in 0..n {
                let off = buf + f * 4;
                let idx = f * self.num_out + ch;
                if off + 4 > data.len() || idx >= output.len() {
                    return Err(KernelTrap);
                }
                let mut b = [0u8; 4];
                b.copy_from_slice(&data[off..off + 4]);
                output[idx] = f32::from_le_bytes(b);
            }
        }
        Ok(())
    }

    fn param(&mut self, idx: u16, value: f32) {
        if !self.usable {
            return;
        }
        self.store.set_epoch_deadline(self.epoch_budget);
        let _ = self
            .set_param
            .call(&mut self.store, (self.dsp as i32, idx as i32, value));
    }
}
