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
use std::time::Duration;

use wasmtime::{Config, Engine, Instance, Memory, Module, Store, TypedFunc};

use crate::{Kernel, KernelTrap};

/// wasm linear-memory page size (64 KiB).
const PAGE: usize = 65536;

/// Epoch ticks a single `oj_process` may run before it is pre-empted. The watchdog
/// ticks every [`WATCHDOG_PERIOD`], so a runaway kernel is bounded to roughly
/// `EPOCH_BUDGET * WATCHDOG_PERIOD` of wall-time before bypass. Deliberately
/// generous for v1 so a normal sub-millisecond block never false-trips; tighten
/// toward the `<5ms` RT budget when the latency benchmark lands.
const EPOCH_BUDGET: u64 = 8;
const WATCHDOG_PERIOD: Duration = Duration::from_millis(1);

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
                thread::sleep(WATCHDOG_PERIOD);
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
        store.set_epoch_deadline(EPOCH_BUDGET);
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
        self.store.set_epoch_deadline(EPOCH_BUDGET);
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

        self.store.set_epoch_deadline(EPOCH_BUDGET);
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
        self.store.set_epoch_deadline(EPOCH_BUDGET);
        // A trapped param write poisons the store; the next `process` then returns
        // Err and the host bypasses — so the result is intentionally ignored here.
        let _ = self.oj_param.call(&mut self.store, (idx as i32, value));
    }
}
