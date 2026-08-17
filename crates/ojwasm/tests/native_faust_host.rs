//! End-to-end test of the NATIVE faust path (`--features native-host`).
//!
//! Compiles a real faust DSP to a native `.dll` (faust -lang cpp → cl.exe) at test
//! time, loads it via `WasmHostLoader::new_native` → `NativeKernel`, and drives it
//! through the guarded host. Proves faust source → native code → audio. SKIPS (does
//! not fail) when the faust/MSVC toolchain is unavailable, so CI stays green.
#![cfg(feature = "native-host")]

use ojcore::{
    DspInstance, DspKind, ParamDecl, PluginLoader, PluginManifest, PortDecl, ProcessCtx, UiKind,
};
use ojproto::PrimitiveKind;
use ojwasm::{compile_faust_to_dll, WasmHostLoader};

fn mono_gain_manifest() -> PluginManifest {
    PluginManifest {
        abi: None,
        id: "ai.native.gain".into(),
        name: "Faust Gain (native)".into(),
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
            max: 2.0,
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

#[test]
fn faust_native_dll_runs_end_to_end_and_responds_to_params() {
    let dir = std::env::temp_dir().join(format!("ojwasm_native_{}", std::process::id()));
    let _ = std::fs::create_dir_all(&dir);

    let src = "import(\"stdfaust.lib\"); process = _ * hslider(\"gain\",1,0,2,0.01);";
    let dll = match compile_faust_to_dll(src, &dir) {
        Some(p) => p,
        None => {
            eprintln!("faust/MSVC toolchain unavailable — skipping native faust end-to-end test");
            return;
        }
    };

    let loader = WasmHostLoader::new_native(mono_gain_manifest(), dll);
    let mut node = loader.instantiate(48_000.0, 64);
    node.activate(48_000.0, 64);

    let input = tone(64, 0.2);
    // gain defaults to 1.0 → the native faust kernel passes the signal (guarded).
    let unity = run(node.as_mut(), &input);
    assert!(
        unity.iter().all(|s| s.is_finite() && s.abs() <= 0.999),
        "native faust output must be finite + guarded",
    );
    assert!(
        energy(&unity) > 0.0,
        "the native faust kernel produced audio (not the passthrough fallback)",
    );

    // Drive faust's APIUI setParamValue(index 0) to gain 0 → output collapses.
    node.set_param(0, 0.0);
    let silenced = run(node.as_mut(), &input);
    assert!(
        energy(&silenced) < 0.1 * energy(&unity),
        "native faust setParamValue must take effect: unity={} silenced={}",
        energy(&unity),
        energy(&silenced),
    );
}
