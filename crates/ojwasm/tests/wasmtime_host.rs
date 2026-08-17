//! Integration tests for the wasmtime execution backend (`--features wasmtime-host`).
//!
//! Drives the REAL host (WasmHostLoader → WasmHostNode → wasmtime) against tiny
//! hand-written `oj_*`-ABI WAT fixtures — so execution, params, trap-bypass, epoch
//! pre-emption, and import rejection are all proven without faust / libfaust.
#![cfg(feature = "wasmtime-host")]

use ojcore::{
    DspInstance, DspKind, ParamDecl, PluginLoader, PluginManifest, PortDecl, ProcessCtx, UiKind,
};
use ojproto::PrimitiveKind;
use ojwasm::{wasm_id_for, WasmHostLoader};

// --- oj_* ABI fixtures (parsed as WAT by wasmtime's `wat` feature) -----------

/// A conforming mono gain kernel: `out[i] = in[i] * gain`, gain via `oj_param(0)`.
const GAIN_WAT: &str = r#"(module
  (memory (export "memory") 1)
  (global $gain (mut f32) (f32.const 1.0))
  (func (export "oj_init") (param i32 i32))
  (func (export "oj_param") (param $idx i32) (param $val f32)
    (if (i32.eqz (local.get $idx)) (then (global.set $gain (local.get $val)))))
  (func (export "oj_process") (param $in i32) (param $out i32) (param $n i32)
    (local $i i32)
    (block $done (loop $loop
      (br_if $done (i32.ge_s (local.get $i) (local.get $n)))
      (f32.store
        (i32.add (local.get $out) (i32.shl (local.get $i) (i32.const 2)))
        (f32.mul
          (f32.load (i32.add (local.get $in) (i32.shl (local.get $i) (i32.const 2))))
          (global.get $gain)))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br $loop))))
  (func (export "oj_manifest_ptr") (result i32) (i32.const 1024))
  (data (i32.const 1024) "{\"ports\":{\"audio_in\":1,\"audio_out\":1},\"params\":[]}\00"))"#;

/// `oj_process` traps immediately — the host must bypass without panicking.
const TRAP_WAT: &str = r#"(module
  (memory (export "memory") 1)
  (func (export "oj_init") (param i32 i32))
  (func (export "oj_param") (param i32 f32))
  (func (export "oj_process") (param i32 i32 i32) unreachable)
  (func (export "oj_manifest_ptr") (result i32) (i32.const 0)))"#;

/// `oj_process` loops forever — the epoch watchdog must pre-empt it (trap → bypass)
/// rather than hang the audio thread.
const SPIN_WAT: &str = r#"(module
  (memory (export "memory") 1)
  (func (export "oj_init") (param i32 i32))
  (func (export "oj_param") (param i32 f32))
  (func (export "oj_process") (param i32 i32 i32) (loop $l (br $l)))
  (func (export "oj_manifest_ptr") (result i32) (i32.const 0)))"#;

/// Would DOUBLE the signal, but declares a host import — the ABI forbids imports,
/// so the module is rejected at load and the node falls back to passthrough (the
/// `* 2` body never runs).
const IMPORT_WAT: &str = r#"(module
  (import "env" "host_fn" (func $h))
  (memory (export "memory") 1)
  (func (export "oj_init") (param i32 i32))
  (func (export "oj_param") (param i32 f32))
  (func (export "oj_process") (param $in i32) (param $out i32) (param $n i32)
    (local $i i32)
    (block $done (loop $loop
      (br_if $done (i32.ge_s (local.get $i) (local.get $n)))
      (f32.store
        (i32.add (local.get $out) (i32.shl (local.get $i) (i32.const 2)))
        (f32.mul
          (f32.load (i32.add (local.get $in) (i32.shl (local.get $i) (i32.const 2))))
          (f32.const 2.0)))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br $loop))))
  (func (export "oj_manifest_ptr") (result i32) (i32.const 0)))"#;

// --- helpers -----------------------------------------------------------------

fn mono_manifest(bytes: &[u8]) -> PluginManifest {
    PluginManifest {
        abi: None,
        id: wasm_id_for(bytes),
        name: "Code Node".into(),
        kind: PrimitiveKind::WasmHost,
        dsp: DspKind::Wasm,
        ui: UiKind::Auto,
        params: vec![ParamDecl {
            module: String::new(),
            unit: String::new(),
            flags: 0,
            id: 0,
            name: "gain".into(),
            min: 0.0,
            max: 4.0,
            default: 1.0,
        }],
        ports: PortDecl {
            audio_in: 1,
            audio_out: 1,
            control_in: 0,
            control_out: 0,
            audio_in_channels: 1,
            audio_out_channels: 1,
        },
    }
}

/// Build + activate a node from a WAT fixture (mono, 64-sample blocks).
fn node_for(wat: &str) -> Box<dyn DspInstance> {
    let bytes = wat.as_bytes().to_vec();
    let loader = WasmHostLoader::new(mono_manifest(&bytes), bytes);
    let mut node = loader.instantiate(48_000.0, 64);
    node.activate(48_000.0, 64);
    node
}

fn run(node: &mut dyn DspInstance, input: &[f32]) -> Vec<f32> {
    let n = input.len();
    let mut out = vec![0.0f32; n];
    let ins: [&[f32]; 1] = [input];
    let mut outs: [&mut [f32]; 1] = [&mut out];
    let mut ctx = ProcessCtx {
        inputs: &ins,
        outputs: &mut outs,
        nframes: n,
    };
    node.process(&mut ctx);
    out
}

fn tone(n: usize, amp: f32) -> Vec<f32> {
    (0..n).map(|i| libm::sinf(i as f32 * 0.7) * amp).collect()
}

fn energy(buf: &[f32]) -> f32 {
    buf.iter().map(|s| s * s).sum()
}

// --- tests -------------------------------------------------------------------

#[test]
fn gain_kernel_executes_and_responds_to_params() {
    let mut node = node_for(GAIN_WAT);
    let input = tone(64, 0.15);

    // gain defaults to 1.0 → guarded passthrough (signal present, finite, bounded).
    let unity = run(node.as_mut(), &input);
    assert!(unity.iter().all(|s| s.is_finite() && s.abs() <= 0.999));
    assert!(energy(&unity) > 0.0, "the wasm kernel produced output");

    // Raise the gain via the oj_param seam → louder. A passthrough FALLBACK would
    // ignore set_param, so this proves the real kernel ran the param write.
    node.set_param(0, 2.0);
    let louder = run(node.as_mut(), &input);
    assert!(
        energy(&louder) > 2.5 * energy(&unity),
        "oj_param must change the kernel output: unity={} louder={}",
        energy(&unity),
        energy(&louder),
    );
}

#[test]
fn a_trapping_kernel_bypasses_without_panic() {
    let mut node = node_for(TRAP_WAT);
    let input = tone(64, 0.3);
    let out = run(node.as_mut(), &input);
    // The trap is caught as control flow: no panic, output finite, dry signal
    // passes through (guarded) rather than emitting garbage.
    assert!(out.iter().all(|s| s.is_finite()));
    assert!(energy(&out) > 0.0, "bypass passes the dry signal");
}

#[test]
fn a_runaway_kernel_is_epoch_preempted() {
    // oj_process loops forever; the epoch watchdog must pre-empt it so this call
    // RETURNS (rather than hanging the test) and the node bypasses to passthrough.
    let mut node = node_for(SPIN_WAT);
    let input = tone(64, 0.25);
    let out = run(node.as_mut(), &input); // returns once the epoch deadline trips
    assert!(out.iter().all(|s| s.is_finite()));
    assert!(
        energy(&out) > 0.0,
        "after pre-emption the dry signal passes through"
    );
}

#[test]
fn a_module_with_imports_is_rejected() {
    // The IMPORT fixture would double the signal, but it declares an import and is
    // rejected at load → the node is a passthrough, so the `* 2` never applies and
    // set_param is a no-op (no kernel).
    let mut node = node_for(IMPORT_WAT);
    let input = tone(64, 0.2);
    node.set_param(0, 4.0); // ignored: there is no kernel
    let out = run(node.as_mut(), &input);
    assert!(out.iter().all(|s| s.is_finite()));
    // Passthrough, NOT doubled/quadrupled: energy stays close to the input's.
    assert!(
        energy(&out) < 2.0 * energy(&input),
        "an imported-fn module must be rejected (no execution): in={} out={}",
        energy(&input),
        energy(&out),
    );
}
