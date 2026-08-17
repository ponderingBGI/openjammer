//! Device-free arrangement bounce and upload-ready lossless file encoding.
//!
//! A bounce compiles a fresh engine at the requested sample rate, rescales the
//! sample-addressed tempo/timeline publications to that clock, and drives the
//! same `Engine::process_block_into` path as live playback. File encoding and
//! all allocations happen off the realtime thread.

use std::fs::File;
use std::io::{BufWriter, Write};
use std::path::{Path, PathBuf};

use flacenc::component::BitRepr;
use flacenc::error::Verify;
use ojcore::{
    compile_resilient, AssetResolver, Engine, NoAssets, PluginRegistry, TempoMapRt, TimelineRt,
};
use ojinstrument::{register_all, RegisterOpts};
use ojproto::{OjGraph, RtCommand, TempoMap, Timeline};
use serde::{Deserialize, Serialize};

use crate::fs::unique_temp_path;

const CHANNELS: u16 = 2;
// Mirrors ojcore-dsp's permanent OutputGuard ceiling. Samples pinned here are
// limiter activations caused by an over-full-scale pre-guard mix.
const OUTPUT_LIMITER_CEILING: f32 = 0.999;
const AUTO_TAIL_FLOOR: f32 = 0.000_063_095_73; // -84 dBFS
const AUTO_TAIL_QUIET_SECONDS: f64 = 0.250;
const AUTO_TAIL_CAP_SECONDS: f64 = 30.0;

/// Output word length. FLAC supports the integer variants; WAV supports all.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum BitDepth {
    #[serde(rename = "16")]
    Pcm16,
    #[serde(rename = "24")]
    Pcm24,
    #[serde(rename = "32f")]
    Float32,
}

/// Lossless output container.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ExportFormat {
    Wav,
    Flac,
}

/// Audio rendered after the authored timeline end.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(tag = "mode", rename_all = "camelCase")]
pub enum TailSpec {
    /// Render exactly this many seconds after the authored end.
    Fixed { seconds: f64 },
    /// Stop after 250 ms of block peaks below -84 dBFS, capped at 30 seconds.
    Auto,
}

/// Valid high-resolution bounce settings.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BounceSpec {
    pub sample_rate: u32,
    pub bit_depth: BitDepth,
    pub format: ExportFormat,
    pub tail: TailSpec,
}

/// One progress update, emitted after a rendered engine block.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BounceProgress {
    pub blocks_rendered: u64,
    pub total_blocks_estimate: u64,
}

/// Pre-quantization level and clipping statistics for the rendered stereo mix.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BounceStats {
    /// Maximum absolute sample level expressed in dBFS (silence is clamped to -200).
    pub max_sample_peak_dbfs: f32,
    /// Interleaved channel samples pinned at the engine's 0.999 safety-limiter ceiling.
    pub clipped_sample_count: u64,
    pub frames: u64,
    pub sample_rate: u32,
    pub channels: u16,
}

/// Rendered interleaved stereo PCM and its statistics.
#[derive(Debug, Clone, PartialEq)]
pub struct BounceResult {
    pub interleaved: Vec<f32>,
    pub stats: BounceStats,
}

#[derive(Debug)]
pub enum BounceError {
    InvalidSpec(String),
    Compile(String),
    Encode(String),
    Io(std::io::Error),
}

impl std::fmt::Display for BounceError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidSpec(message) => write!(f, "invalid bounce spec: {message}"),
            Self::Compile(message) => write!(f, "bounce compile failed: {message}"),
            Self::Encode(message) => write!(f, "bounce encode failed: {message}"),
            Self::Io(error) => write!(f, "bounce io failed: {error}"),
        }
    }
}

impl std::error::Error for BounceError {}

impl From<std::io::Error> for BounceError {
    fn from(value: std::io::Error) -> Self {
        Self::Io(value)
    }
}

/// Bounce using the full built-in native registry and no external assets.
pub fn bounce<F>(
    graph: OjGraph,
    timeline: Timeline,
    tempo_map: TempoMap,
    spec: BounceSpec,
    progress: F,
) -> Result<BounceResult, BounceError>
where
    F: FnMut(BounceProgress),
{
    bounce_with_assets(graph, timeline, tempo_map, spec, &NoAssets, progress)
}

/// Bounce with a caller-owned asset snapshot (used by the desktop backend).
pub fn bounce_with_assets<A, F>(
    graph: OjGraph,
    timeline: Timeline,
    tempo_map: TempoMap,
    spec: BounceSpec,
    assets: &A,
    progress: F,
) -> Result<BounceResult, BounceError>
where
    A: AssetResolver,
    F: FnMut(BounceProgress),
{
    let mut registry = PluginRegistry::new();
    register_all(&mut registry, RegisterOpts::full());
    bounce_with_registry_and_assets(
        graph, timeline, tempo_map, spec, &registry, assets, progress,
    )
}

/// Bounce with the caller's live plugin registry and asset snapshot.
pub fn bounce_with_registry_and_assets<A, F>(
    mut graph: OjGraph,
    timeline: Timeline,
    tempo_map: TempoMap,
    spec: BounceSpec,
    registry: &PluginRegistry,
    assets: &A,
    mut progress: F,
) -> Result<BounceResult, BounceError>
where
    A: AssetResolver,
    F: FnMut(BounceProgress),
{
    validate_spec(spec)?;
    let block = usize::try_from(graph.block_size.max(1)).unwrap_or(256);
    graph.sample_rate = spec.sample_rate;

    let program = compile_resilient(&graph, registry, assets)
        .map_err(|error| BounceError::Compile(format!("{error:?}")))?;
    let mut engine = Engine::new(program);

    let tempo = rescale_tempo_map(&tempo_map, spec.sample_rate)?;
    let timeline = rescale_timeline(&timeline, spec.sample_rate)?;
    let tempo_rt = TempoMapRt::from_wire(&tempo);
    let authored_frames = usize::try_from(timeline.end)
        .map_err(|_| BounceError::InvalidSpec("timeline is too long for this platform".into()))?;
    engine.install_tempo_map(tempo_rt);
    engine.install_timeline(TimelineRt::from_wire(
        &timeline,
        &TempoMapRt::from_wire(&tempo),
    ));
    engine.apply(RtCommand::TransportPlay);

    let (hard_end, estimate_end) = match spec.tail {
        TailSpec::Fixed { seconds } => {
            if !seconds.is_finite() || seconds < 0.0 {
                return Err(BounceError::InvalidSpec(
                    "fixed tail seconds must be finite and non-negative".into(),
                ));
            }
            let tail = seconds_to_frames(seconds, spec.sample_rate)?;
            let end = authored_frames.saturating_add(tail);
            (Some(end), end)
        }
        TailSpec::Auto => (
            None,
            authored_frames
                .saturating_add(seconds_to_frames(AUTO_TAIL_CAP_SECONDS, spec.sample_rate)?),
        ),
    };
    let total_blocks_estimate = estimate_end.div_ceil(block) as u64;
    let quiet_needed = seconds_to_frames(AUTO_TAIL_QUIET_SECONDS, spec.sample_rate)?;
    let auto_cap = seconds_to_frames(AUTO_TAIL_CAP_SECONDS, spec.sample_rate)?;
    let mut quiet_frames = 0usize;
    let mut rendered_frames = 0usize;
    let mut blocks = 0u64;
    let mut interleaved = Vec::with_capacity(estimate_end.saturating_mul(2));
    let mut left = vec![0.0f32; block];
    let mut right = vec![0.0f32; block];

    loop {
        if hard_end.is_some_and(|end| rendered_frames >= end) {
            break;
        }
        if hard_end.is_none() && rendered_frames >= authored_frames.saturating_add(auto_cap) {
            break;
        }

        left.fill(0.0);
        right.fill(0.0);
        let mut outs: [&mut [f32]; 2] = [&mut left, &mut right];
        engine.process_block_into(&mut outs, block);

        let keep = hard_end.map_or(block, |end| end.saturating_sub(rendered_frames).min(block));
        for frame in 0..keep {
            interleaved.push(left[frame]);
            interleaved.push(right[frame]);
        }

        if hard_end.is_none() {
            let tail_start = authored_frames.saturating_sub(rendered_frames).min(keep);
            if tail_start < keep {
                let peak = left[tail_start..keep]
                    .iter()
                    .chain(&right[tail_start..keep])
                    .fold(0.0f32, |peak, sample| peak.max(sample.abs()));
                if peak < AUTO_TAIL_FLOOR {
                    quiet_frames = quiet_frames.saturating_add(keep - tail_start);
                } else {
                    quiet_frames = 0;
                }
            }
        }

        rendered_frames = rendered_frames.saturating_add(keep);
        blocks += 1;
        progress(BounceProgress {
            blocks_rendered: blocks,
            total_blocks_estimate,
        });
        if hard_end.is_none() && rendered_frames >= authored_frames && quiet_frames >= quiet_needed
        {
            break;
        }
    }

    let stats = statistics(&interleaved, spec.sample_rate);
    Ok(BounceResult { interleaved, stats })
}

/// Render and crash-safely encode an arrangement, returning the rendered stats.
pub fn bounce_to_file<F, P>(
    graph: OjGraph,
    timeline: Timeline,
    tempo_map: TempoMap,
    spec: BounceSpec,
    path: P,
    progress: F,
) -> Result<BounceStats, BounceError>
where
    F: FnMut(BounceProgress),
    P: AsRef<Path>,
{
    let result = bounce(graph, timeline, tempo_map, spec, progress)?;
    write_audio_file(path, &result.interleaved, spec)?;
    Ok(result.stats)
}

/// Asset-aware form of [`bounce_to_file`].
pub fn bounce_to_file_with_assets<A, F, P>(
    graph: OjGraph,
    timeline: Timeline,
    tempo_map: TempoMap,
    spec: BounceSpec,
    assets: &A,
    path: P,
    progress: F,
) -> Result<BounceStats, BounceError>
where
    A: AssetResolver,
    F: FnMut(BounceProgress),
    P: AsRef<Path>,
{
    let result = bounce_with_assets(graph, timeline, tempo_map, spec, assets, progress)?;
    write_audio_file(path, &result.interleaved, spec)?;
    Ok(result.stats)
}

/// Registry- and asset-aware form used by the desktop app so plugin loaders
/// match live playback while rendering on a background worker.
#[allow(clippy::too_many_arguments)]
pub fn bounce_to_file_with_registry_and_assets<A, F, P>(
    graph: OjGraph,
    timeline: Timeline,
    tempo_map: TempoMap,
    spec: BounceSpec,
    registry: &PluginRegistry,
    assets: &A,
    path: P,
    progress: F,
) -> Result<BounceStats, BounceError>
where
    A: AssetResolver,
    F: FnMut(BounceProgress),
    P: AsRef<Path>,
{
    let result = bounce_with_registry_and_assets(
        graph, timeline, tempo_map, spec, registry, assets, progress,
    )?;
    write_audio_file(path, &result.interleaved, spec)?;
    Ok(result.stats)
}

/// Crash-safely encode already-rendered interleaved stereo audio.
pub fn write_audio_file<P: AsRef<Path>>(
    path: P,
    interleaved: &[f32],
    spec: BounceSpec,
) -> Result<(), BounceError> {
    validate_spec(spec)?;
    let path = path.as_ref();
    if let Some(parent) = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
    {
        if !parent.is_dir() {
            return Err(BounceError::InvalidSpec(format!(
                "output parent does not exist: {}",
                parent.display()
            )));
        }
    }
    let temp = unique_temp_path(path);
    let result = match spec.format {
        ExportFormat::Wav => write_wav(&temp, interleaved, spec),
        ExportFormat::Flac => write_flac(&temp, interleaved, spec),
    };
    if let Err(error) = result {
        let _ = std::fs::remove_file(&temp);
        return Err(error);
    }
    if let Err(error) = std::fs::rename(&temp, path) {
        let _ = std::fs::remove_file(&temp);
        return Err(error.into());
    }
    sync_parent(path)?;
    Ok(())
}

fn validate_spec(spec: BounceSpec) -> Result<(), BounceError> {
    if !matches!(spec.sample_rate, 44_100 | 48_000 | 88_200 | 96_000) {
        return Err(BounceError::InvalidSpec(
            "sample rate must be 44100, 48000, 88200, or 96000".into(),
        ));
    }
    if spec.format == ExportFormat::Flac && spec.bit_depth == BitDepth::Float32 {
        return Err(BounceError::InvalidSpec(
            "FLAC does not support 32-bit float; choose 16-bit or 24-bit".into(),
        ));
    }
    Ok(())
}

fn rescale(value: u64, source_rate: u32, target_rate: u32) -> Result<u64, BounceError> {
    if source_rate == 0 {
        return Err(BounceError::InvalidSpec(
            "source sample rate is zero".into(),
        ));
    }
    let numerator = u128::from(value) * u128::from(target_rate) + u128::from(source_rate / 2);
    u64::try_from(numerator / u128::from(source_rate))
        .map_err(|_| BounceError::InvalidSpec("rescaled timeline position overflowed".into()))
}

fn rescale_timeline(timeline: &Timeline, target_rate: u32) -> Result<Timeline, BounceError> {
    let source_rate = timeline.sample_rate;
    let mut out = timeline.clone();
    out.sample_rate = target_rate;
    for event in &mut out.events {
        event.at = rescale(event.at, source_rate, target_rate)?;
    }
    out.end = rescale(out.end, source_rate, target_rate)?;
    out.loop_range = out
        .loop_range
        .map(|(start, end)| -> Result<_, BounceError> {
            Ok((
                rescale(start, source_rate, target_rate)?,
                rescale(end, source_rate, target_rate)?,
            ))
        })
        .transpose()?;
    out.punch_range = out
        .punch_range
        .map(|(start, end)| -> Result<_, BounceError> {
            Ok((
                rescale(start, source_rate, target_rate)?,
                rescale(end, source_rate, target_rate)?,
            ))
        })
        .transpose()?;
    Ok(out)
}

fn rescale_tempo_map(map: &TempoMap, target_rate: u32) -> Result<TempoMap, BounceError> {
    let source_rate = map.sample_rate;
    let mut out = map.clone();
    out.sample_rate = target_rate;
    for point in &mut out.tempos {
        point.sample = rescale(point.sample, source_rate, target_rate)?;
    }
    for point in &mut out.meters {
        point.sample = rescale(point.sample, source_rate, target_rate)?;
    }
    Ok(out)
}

fn seconds_to_frames(seconds: f64, sample_rate: u32) -> Result<usize, BounceError> {
    let frames = seconds * f64::from(sample_rate);
    if !frames.is_finite() || frames > usize::MAX as f64 {
        return Err(BounceError::InvalidSpec(
            "tail duration is too large".into(),
        ));
    }
    Ok(frames.round() as usize)
}

fn statistics(samples: &[f32], sample_rate: u32) -> BounceStats {
    let mut peak = 0.0f32;
    let mut clipped = 0u64;
    for &sample in samples {
        let magnitude = sample.abs();
        if magnitude > peak {
            peak = magnitude;
        }
        if magnitude >= OUTPUT_LIMITER_CEILING {
            clipped += 1;
        }
    }
    BounceStats {
        max_sample_peak_dbfs: if peak > 0.0 {
            20.0 * libm::log10f(peak)
        } else {
            -200.0
        },
        clipped_sample_count: clipped,
        frames: (samples.len() / usize::from(CHANNELS)) as u64,
        sample_rate,
        channels: CHANNELS,
    }
}

fn write_wav(path: &Path, samples: &[f32], spec: BounceSpec) -> Result<(), BounceError> {
    let (bits_per_sample, sample_format) = match spec.bit_depth {
        BitDepth::Pcm16 => (16, hound::SampleFormat::Int),
        BitDepth::Pcm24 => (24, hound::SampleFormat::Int),
        BitDepth::Float32 => (32, hound::SampleFormat::Float),
    };
    let file = File::create(path)?;
    let mut writer = hound::WavWriter::new(
        BufWriter::new(file),
        hound::WavSpec {
            channels: CHANNELS,
            sample_rate: spec.sample_rate,
            bits_per_sample,
            sample_format,
        },
    )
    .map_err(|error| BounceError::Encode(error.to_string()))?;
    let mut dither = Dither::new(0x4f4a_5741_5645_3861);
    for &sample in samples {
        match spec.bit_depth {
            BitDepth::Pcm16 => writer
                .write_sample(quantize(sample + dither.tpdf() / 32_768.0, 16))
                .map_err(|error| BounceError::Encode(error.to_string()))?,
            BitDepth::Pcm24 => writer
                .write_sample(quantize(sample, 24))
                .map_err(|error| BounceError::Encode(error.to_string()))?,
            BitDepth::Float32 => writer
                .write_sample(sample)
                .map_err(|error| BounceError::Encode(error.to_string()))?,
        }
    }
    writer
        .finalize()
        .map_err(|error| BounceError::Encode(error.to_string()))?;
    let file = File::options().write(true).open(path)?;
    file.sync_all()?;
    Ok(())
}

fn write_flac(path: &Path, samples: &[f32], spec: BounceSpec) -> Result<(), BounceError> {
    let bits = match spec.bit_depth {
        BitDepth::Pcm16 => 16,
        BitDepth::Pcm24 => 24,
        BitDepth::Float32 => unreachable!("validated above"),
    };
    let quantized: Vec<i32> = samples
        .iter()
        .map(|&sample| quantize(sample, bits))
        .collect();
    let mut config = flacenc::config::Encoder::default();
    // flacenc 0.5.1's predictive paths can select a catastrophically large
    // Rice-coded subframe for otherwise ordinary 24-bit program material. A
    // single 4,096-frame block can then occupy hundreds of megabytes even
    // though it decodes to the right samples. Constant and verbatim subframes
    // remain lossless and put a strict linear bound on the encoded size.
    config.subframe_coding.use_fixed = false;
    config.subframe_coding.use_lpc = false;
    let config = config
        .into_verified()
        .map_err(|(_, error)| BounceError::Encode(error.to_string()))?;
    let source = flacenc::source::MemSource::from_samples(
        &quantized,
        usize::from(CHANNELS),
        bits as usize,
        spec.sample_rate as usize,
    );
    let stream = flacenc::encode_with_fixed_block_size(&config, source, config.block_size)
        .map_err(|error| BounceError::Encode(error.to_string()))?;
    let mut sink = flacenc::bitsink::ByteSink::new();
    stream
        .write(&mut sink)
        .map_err(|error| BounceError::Encode(error.to_string()))?;
    let mut file = File::create(path)?;
    file.write_all(sink.as_slice())?;
    file.sync_all()?;
    Ok(())
}

fn quantize(sample: f32, bits: u32) -> i32 {
    let scale = (1i64 << (bits - 1)) as f32;
    let min = -(1i64 << (bits - 1));
    let max = (1i64 << (bits - 1)) - 1;
    (sample.clamp(-1.0, 1.0) * scale)
        .round()
        .clamp(min as f32, max as f32) as i32
}

struct Dither(u64);

impl Dither {
    fn new(seed: u64) -> Self {
        Self(seed)
    }

    fn uniform(&mut self) -> f32 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        ((self.0 >> 40) as f32) / ((1u32 << 24) as f32)
    }

    fn tpdf(&mut self) -> f32 {
        self.uniform() - self.uniform()
    }
}

fn sync_parent(path: &Path) -> Result<(), BounceError> {
    let parent: PathBuf = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."))
        .to_path_buf();
    #[cfg(not(windows))]
    File::open(parent)?.sync_all()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use ojcore::{GAIN_ID, GAIN_PARAM, SPEAKER_OUT_ID};
    use ojinstrument::{param, OSC_ID};
    use ojproto::{
        sched_event_kind, ConnectionType, IrEdge, IrNode, MeterPoint, NodeIdx, Param,
        PrimitiveKind, SchedEvent, TempoPoint,
    };
    use std::sync::atomic::{AtomicU64, Ordering};

    fn temp_file(extension: &str) -> PathBuf {
        static NEXT: AtomicU64 = AtomicU64::new(0);
        std::env::temp_dir().join(format!(
            "oj-bounce-{}-{}.{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed),
            extension
        ))
    }

    fn node(
        id: u32,
        manifest_id: &str,
        kind: PrimitiveKind,
        n_in: u8,
        n_out: u8,
        params: Vec<Param>,
    ) -> IrNode {
        IrNode {
            id: NodeIdx(id),
            manifest_id: manifest_id.into(),
            kind,
            params,
            assets: Vec::new(),
            n_in,
            n_out,
        }
    }

    fn edge(from: u32, to: u32, to_port: u16) -> IrEdge {
        IrEdge {
            from_node: NodeIdx(from),
            from_port: 0,
            to_node: NodeIdx(to),
            to_port,
            kind: ConnectionType::Audio,
        }
    }

    fn fixture(hot: bool) -> (OjGraph, Timeline, TempoMap) {
        let mut graph = OjGraph::empty(48_000, 64);
        let gain = if hot { 1.0 } else { 0.4 };
        graph.nodes.push(node(
            1,
            OSC_ID,
            PrimitiveKind::Osc,
            0,
            1,
            vec![
                Param {
                    id: param::GAIN,
                    value: gain,
                },
                Param {
                    id: param::ATTACK,
                    value: 0.0,
                },
                Param {
                    id: param::DECAY,
                    value: 0.0,
                },
                Param {
                    id: param::SUSTAIN,
                    value: 1.0,
                },
                Param {
                    id: param::RELEASE,
                    value: 0.03,
                },
            ],
        ));
        if hot {
            graph.nodes.push(node(
                2,
                GAIN_ID,
                PrimitiveKind::Gain,
                1,
                1,
                vec![Param {
                    id: GAIN_PARAM,
                    value: 4.0,
                }],
            ));
            graph.nodes.push(node(
                3,
                SPEAKER_OUT_ID,
                PrimitiveKind::SpeakerOut,
                1,
                0,
                vec![],
            ));
            graph.edges.extend([edge(1, 2, 0), edge(2, 3, 0)]);
        } else {
            graph.nodes.push(node(
                2,
                SPEAKER_OUT_ID,
                PrimitiveKind::SpeakerOut,
                1,
                0,
                vec![],
            ));
            graph.edges.push(edge(1, 2, 0));
        }
        let mut events = vec![SchedEvent {
            at: 0,
            node: NodeIdx(1),
            kind: sched_event_kind::NOTE_ON,
            a: 60,
            b: 127,
            value: 0.0,
        }];
        events.push(SchedEvent {
            at: 2_400,
            node: NodeIdx(1),
            kind: sched_event_kind::NOTE_OFF,
            a: 60,
            b: 0,
            value: 0.0,
        });
        let timeline = Timeline {
            sample_rate: 48_000,
            events,
            loop_range: None,
            punch_range: None,
            armed_tracks: vec![],
            count_in_beats: 0,
            end: 2_400,
        };
        let tempo = TempoMap {
            ppq: ojproto::PPQ,
            sample_rate: 48_000,
            tempos: vec![TempoPoint {
                tick: 0,
                sample: 0,
                bpm_start: 120.0,
                bpm_end: 120.0,
                continuing: false,
            }],
            meters: vec![MeterPoint {
                tick: 0,
                sample: 0,
                bar: 1,
                divisions_per_bar: 4,
                note_value: 4,
            }],
        };
        (graph, timeline, tempo)
    }

    fn spec(bit_depth: BitDepth, format: ExportFormat, tail: TailSpec) -> BounceSpec {
        BounceSpec {
            sample_rate: 48_000,
            bit_depth,
            format,
            tail,
        }
    }

    #[test]
    fn scheduled_fixture_has_exact_fixed_tail_and_valid_24_bit_header() {
        let (graph, timeline, tempo) = fixture(false);
        let bounce_spec = spec(
            BitDepth::Pcm24,
            ExportFormat::Wav,
            TailSpec::Fixed { seconds: 0.1 },
        );
        let mut progress = Vec::new();
        let result = bounce(graph, timeline, tempo, bounce_spec, |update| {
            progress.push(update)
        })
        .expect("bounce");
        assert_eq!(result.stats.frames, 2_400 + 4_800);
        assert!(result.interleaved.iter().any(|sample| sample.abs() > 0.01));
        assert!(!progress.is_empty());

        let path = temp_file("wav");
        write_audio_file(&path, &result.interleaved, bounce_spec).expect("write wav");
        let reader = hound::WavReader::open(&path).expect("read wav");
        assert_eq!(reader.spec().sample_rate, 48_000);
        assert_eq!(reader.spec().bits_per_sample, 24);
        assert_eq!(reader.spec().channels, 2);
        assert_eq!(reader.duration(), 7_200);
        std::fs::remove_file(path).expect("remove fixture");
    }

    #[test]
    fn resamples_timeline_clock_and_auto_tail_observes_quiet_window() {
        let (graph, timeline, tempo) = fixture(false);
        let result = bounce(
            graph,
            timeline,
            tempo,
            BounceSpec {
                sample_rate: 96_000,
                bit_depth: BitDepth::Float32,
                format: ExportFormat::Wav,
                tail: TailSpec::Auto,
            },
            |_| {},
        )
        .expect("auto bounce");
        let authored = 4_800u64;
        assert!(result.stats.frames >= authored + 24_000);
        assert!(result.stats.frames < authored + 96_000);
        assert_eq!(result.stats.frames % 64, 0, "auto tail ends on a block");
    }

    #[test]
    fn wav_quantization_roundtrips_and_dither_is_16_bit_only() {
        let (graph, timeline, tempo) = fixture(false);
        let result = bounce(
            graph,
            timeline,
            tempo,
            spec(
                BitDepth::Pcm24,
                ExportFormat::Wav,
                TailSpec::Fixed { seconds: 0.0 },
            ),
            |_| {},
        )
        .expect("bounce");
        let path = temp_file("wav");
        let spec24 = spec(
            BitDepth::Pcm24,
            ExportFormat::Wav,
            TailSpec::Fixed { seconds: 0.0 },
        );
        write_audio_file(&path, &result.interleaved, spec24).expect("write 24-bit");
        let decoded: Vec<i32> = hound::WavReader::open(&path)
            .expect("reader")
            .samples::<i32>()
            .map(|sample| sample.expect("sample"))
            .collect();
        for (&source, decoded) in result.interleaved.iter().zip(decoded) {
            let restored = decoded as f32 / 8_388_608.0;
            assert!((source.clamp(-1.0, 1.0) - restored).abs() <= 1.0 / 8_388_608.0);
        }
        std::fs::remove_file(&path).expect("remove 24-bit");

        let silence = vec![0.0f32; 4_096];
        let wav16 = temp_file("wav");
        write_audio_file(
            &wav16,
            &silence,
            spec(
                BitDepth::Pcm16,
                ExportFormat::Wav,
                TailSpec::Fixed { seconds: 0.0 },
            ),
        )
        .expect("write 16-bit");
        let dithered: Vec<i16> = hound::WavReader::open(&wav16)
            .expect("reader")
            .samples::<i16>()
            .map(|sample| sample.expect("sample"))
            .collect();
        assert!(dithered.iter().any(|&sample| sample != 0));
        std::fs::remove_file(wav16).expect("remove 16-bit");

        let wav24 = temp_file("wav");
        write_audio_file(&wav24, &silence, spec24).expect("write silent 24-bit");
        assert!(hound::WavReader::open(&wav24)
            .expect("reader")
            .samples::<i32>()
            .all(|sample| sample.expect("sample") == 0));
        std::fs::remove_file(wav24).expect("remove silent 24-bit");
    }

    #[test]
    fn hot_scheduled_fixture_reports_clipping() {
        let (graph, timeline, tempo) = fixture(true);
        let result = bounce(
            graph,
            timeline,
            tempo,
            spec(
                BitDepth::Float32,
                ExportFormat::Wav,
                TailSpec::Fixed { seconds: 0.0 },
            ),
            |_| {},
        )
        .expect("hot bounce");
        assert!(
            result.stats.max_sample_peak_dbfs > -0.01,
            "stats: {:?}",
            result.stats
        );
        assert!(
            result.stats.clipped_sample_count > 0,
            "stats: {:?}",
            result.stats
        );
    }

    #[test]
    fn flac_24_bit_decodes_losslessly() {
        let samples: Vec<f32> = (0..64).map(|index| (index as f32 / 31.5) - 1.0).collect();
        let path = temp_file("flac");
        write_audio_file(
            &path,
            &samples,
            spec(
                BitDepth::Pcm24,
                ExportFormat::Flac,
                TailSpec::Fixed { seconds: 0.0 },
            ),
        )
        .expect("write flac");
        let mut reader = claxon::FlacReader::open(&path).expect("open flac");
        assert_eq!(reader.streaminfo().sample_rate, 48_000);
        assert_eq!(reader.streaminfo().channels, 2);
        assert_eq!(reader.streaminfo().bits_per_sample, 24);
        let decoded: Vec<i32> = reader
            .samples()
            .map(|sample| sample.expect("decode sample"))
            .collect();
        let expected: Vec<i32> = samples.iter().map(|&sample| quantize(sample, 24)).collect();
        assert_eq!(decoded, expected);
        std::fs::remove_file(path).expect("remove flac");
    }

    #[test]
    fn multi_block_flac_is_smaller_than_wav_and_sample_exact() {
        const FLAC_BLOCK_SIZE: u64 = 4_096;
        let (graph, mut timeline, tempo) = fixture(false);
        timeline.end = FLAC_BLOCK_SIZE * 9 + 123;
        let wav_path = temp_file("wav");
        let flac_path = temp_file("flac");
        let wav_spec = spec(
            BitDepth::Pcm24,
            ExportFormat::Wav,
            TailSpec::Fixed { seconds: 0.0 },
        );
        let flac_spec = BounceSpec {
            format: ExportFormat::Flac,
            ..wav_spec
        };

        let wav_stats = bounce_to_file(
            graph.clone(),
            timeline.clone(),
            tempo.clone(),
            wav_spec,
            &wav_path,
            |_| {},
        )
        .expect("bounce multi-block wav");
        let flac_stats = bounce_to_file(graph, timeline, tempo, flac_spec, &flac_path, |_| {})
            .expect("bounce multi-block flac");
        assert_eq!(wav_stats.frames, FLAC_BLOCK_SIZE * 9 + 123);
        assert_eq!(flac_stats.frames, wav_stats.frames);
        assert!(
            std::fs::metadata(&flac_path).expect("flac metadata").len()
                < std::fs::metadata(&wav_path).expect("wav metadata").len(),
            "multi-block FLAC must be smaller than its raw PCM WAV"
        );

        let wav_samples: Vec<i32> = hound::WavReader::open(&wav_path)
            .expect("open wav")
            .samples::<i32>()
            .map(|sample| sample.expect("decode wav sample"))
            .collect();
        let mut flac_reader = claxon::FlacReader::open(&flac_path).expect("open flac");
        let streaminfo = flac_reader.streaminfo();
        let channels = usize::try_from(streaminfo.channels).expect("channel count");
        let total_samples = streaminfo.samples.expect("STREAMINFO total_samples");
        let flac_samples: Vec<i32> = flac_reader
            .samples()
            .map(|sample| sample.expect("decode flac sample"))
            .collect();
        let decoded_frames = flac_samples.len() / channels;
        assert_eq!(decoded_frames as u64, total_samples);
        assert_eq!(flac_samples, wav_samples);

        std::fs::remove_file(wav_path).expect("remove wav");
        std::fs::remove_file(flac_path).expect("remove flac");
    }
}
