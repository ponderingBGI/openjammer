//! CodSpeed benchmarks for the OpenJammer DSP kernels.
//!
//! Each benchmark processes a block of samples through one kernel, mirroring the
//! per-buffer work the native engine and the wasm AudioWorklet do on the audio
//! thread. Block size is fixed at 512 samples (a common AudioWorklet quantum
//! multiple) so the measurements track real per-buffer cost.

use criterion::{black_box, criterion_group, criterion_main, Criterion};
use ojcore_dsp::{
    generate_distortion_curve, Biquad, BiquadCoeffs, Convolver, DelayLine, FilterType,
    KarplusString, OnePole, Osc, Waveshaper,
};

const SR: f32 = 48_000.0;
const BLOCK: usize = 512;

/// A deterministic test signal (a normalized ramp/saw) used as the DSP input.
fn signal(n: usize) -> Vec<f32> {
    (0..n).map(|i| (i as f32 / n as f32) * 2.0 - 1.0).collect()
}

fn bench_biquad(c: &mut Criterion) {
    let input = signal(BLOCK);
    let mut group = c.benchmark_group("biquad");

    group.bench_function("design_lowpass", |b| {
        b.iter(|| {
            BiquadCoeffs::design(
                black_box(FilterType::Lowpass),
                black_box(1_000.0),
                black_box(0.707),
                black_box(0.0),
                black_box(SR),
            )
        })
    });

    group.bench_function("process_block", |b| {
        let coeffs = BiquadCoeffs::design(FilterType::Peaking, 800.0, 1.5, 6.0, SR);
        b.iter(|| {
            let mut bq = Biquad::new(coeffs);
            let mut acc = 0.0f32;
            for &x in &input {
                acc += bq.process(black_box(x));
            }
            black_box(acc)
        })
    });

    group.finish();
}

fn bench_waveshaper(c: &mut Criterion) {
    let input = signal(BLOCK);
    let mut group = c.benchmark_group("waveshaper");

    group.bench_function("generate_curve_2048", |b| {
        b.iter(|| generate_distortion_curve(black_box(0.7), black_box(2048)))
    });

    group.bench_function("process_block", |b| {
        let ws = Waveshaper::new(0.7, 2048);
        b.iter(|| {
            let mut acc = 0.0f32;
            for &x in &input {
                acc += ws.process(black_box(x));
            }
            black_box(acc)
        })
    });

    group.finish();
}

fn bench_delay(c: &mut Criterion) {
    let input = signal(BLOCK);
    c.bench_function("delay_process_block", |b| {
        b.iter(|| {
            let mut d = DelayLine::new(4096);
            d.set(0.4, 0.5);
            let mut acc = 0.0f32;
            for &x in &input {
                acc += d.process(black_box(x), 1024);
            }
            black_box(acc)
        })
    });
}

fn bench_convolver(c: &mut Criterion) {
    let input = signal(BLOCK);
    let ir = signal(256); // 256-tap impulse response (cabinet-sim sized)
    c.bench_function("convolver_process_block_256taps", |b| {
        b.iter(|| {
            let mut conv = Convolver::new(256);
            conv.set_ir(&ir);
            let mut acc = 0.0f32;
            for &x in &input {
                acc += conv.process(black_box(x));
            }
            black_box(acc)
        })
    });
}

fn bench_onepole(c: &mut Criterion) {
    c.bench_function("onepole_tick_block", |b| {
        b.iter(|| {
            let mut s = OnePole::new(0.0);
            s.set_time(0.005, SR);
            s.set_target(1.0);
            let mut v = 0.0f32;
            for _ in 0..BLOCK {
                v = s.tick();
            }
            black_box(v)
        })
    });
}

fn bench_osc(c: &mut Criterion) {
    c.bench_function("osc_sine_block", |b| {
        b.iter(|| {
            let mut o = Osc::new();
            o.set_freq(440.0, SR);
            let mut acc = 0.0f32;
            for _ in 0..BLOCK {
                acc += o.next_sine();
            }
            black_box(acc)
        })
    });
}

fn bench_karplus(c: &mut Criterion) {
    c.bench_function("karplus_pluck_and_tick_block", |b| {
        b.iter(|| {
            let mut k = KarplusString::new(2048);
            k.pluck(220.0, SR);
            let mut acc = 0.0f32;
            for _ in 0..BLOCK {
                acc += k.tick();
            }
            black_box(acc)
        })
    });
}

criterion_group!(
    benches,
    bench_biquad,
    bench_waveshaper,
    bench_delay,
    bench_convolver,
    bench_onepole,
    bench_osc,
    bench_karplus,
);
criterion_main!(benches);
