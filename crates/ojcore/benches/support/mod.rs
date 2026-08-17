//! Rust-side lowering for the deterministic arrangement fixtures exported by the UI.
//!
//! This intentionally mirrors the musical parts of `src/song/conduct.ts` used by
//! the engine macro benches: clip windowing, constant-tempo sample addressing,
//! linear automation densification, per-track gain/pan stages, and the release
//! tail. Keeping the committed input as the authoring arrangement means the Rust
//! and browser performance suites measure the same fixture rather than hand-made
//! lookalikes.

#![allow(dead_code)] // Each consuming bench crate uses one half of this shared helper.

use std::collections::HashMap;

use ojcore::{GAIN_ID, PAN_ID, SPEAKER_OUT_ID};
use ojproto::{
    sched_event_kind, ConnectionType, IrEdge, IrNode, MeterPoint, NodeIdx, OjGraph, Param,
    PrimitiveKind, SchedEvent, TempoMap, TempoPoint, Timeline,
};
use serde::Deserialize;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Arrangement {
    tempo_bpm: f64,
    ppq: u32,
    sample_rate: u32,
    block_size: u32,
    time_signature: [u8; 2],
    tracks: Vec<Track>,
    #[serde(default)]
    sources: HashMap<String, Source>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Track {
    #[serde(rename = "ref")]
    node_ref: String,
    clips: Vec<Clip>,
    #[serde(default)]
    gain_db: f32,
    #[serde(default)]
    pan: f32,
    #[serde(default)]
    mute: bool,
    #[serde(default)]
    automation: Vec<AutomationLane>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Clip {
    source_id: String,
    start_tick: u64,
    length_tick: u64,
    #[serde(default)]
    source_start: u64,
    #[serde(default)]
    gain: Option<f32>,
    #[serde(default)]
    mute: bool,
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
enum Source {
    Midi {
        notes: Vec<Note>,
    },
    Audio {
        #[serde(rename = "assetId")]
        asset_id: String,
    },
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Note {
    tick: u64,
    dur_tick: u64,
    pitch: u8,
    vel: u8,
}

#[derive(Deserialize)]
struct AutomationLane {
    #[serde(rename = "ref")]
    node_ref: String,
    param: u16,
    #[serde(default = "play_state")]
    state: String,
    #[serde(default)]
    interp: String,
    points: Vec<AutomationPoint>,
}

#[derive(Clone, Copy, Deserialize)]
struct AutomationPoint {
    tick: u64,
    value: f32,
}

fn play_state() -> String {
    "Play".into()
}

pub(crate) struct ConductedFixture {
    pub(crate) graph: OjGraph,
    pub(crate) tempo_map: TempoMap,
    pub(crate) timeline: Timeline,
}

pub(crate) fn first_light() -> ConductedFixture {
    let arrangement: Arrangement =
        serde_json::from_str(include_str!("../fixtures/first-light.json"))
            .expect("First Light fixture must deserialize");
    conduct(arrangement, true)
}

pub(crate) fn hundred_tracks_timeline() -> (TempoMap, Timeline) {
    let arrangement: Arrangement =
        serde_json::from_str(include_str!("../fixtures/hundred-tracks.json"))
            .expect("Hundred Tracks fixture must deserialize");
    let conducted = conduct(arrangement, false);
    (conducted.tempo_map, conducted.timeline)
}

fn conduct(arrangement: Arrangement, build_graph: bool) -> ConductedFixture {
    let tempo_map = tempo_map(&arrangement);
    let mut node_index = HashMap::with_capacity(arrangement.tracks.len() * 3);
    for (index, track) in arrangement.tracks.iter().enumerate() {
        node_index.insert(track.node_ref.clone(), NodeIdx(index as u32));
    }

    let graph = if build_graph {
        first_light_graph(&arrangement, &mut node_index)
    } else {
        OjGraph::empty(arrangement.sample_rate, arrangement.block_size)
    };
    let timeline = timeline(&arrangement, &tempo_map, &node_index);
    ConductedFixture {
        graph,
        tempo_map,
        timeline,
    }
}

fn tempo_map(arrangement: &Arrangement) -> TempoMap {
    TempoMap {
        ppq: arrangement.ppq,
        sample_rate: arrangement.sample_rate,
        tempos: vec![TempoPoint {
            tick: 0,
            sample: 0,
            bpm_start: arrangement.tempo_bpm as f32,
            bpm_end: arrangement.tempo_bpm as f32,
            continuing: false,
        }],
        meters: vec![MeterPoint {
            tick: 0,
            sample: 0,
            bar: 1,
            divisions_per_bar: arrangement.time_signature[0],
            note_value: arrangement.time_signature[1],
        }],
    }
}

fn first_light_graph(
    arrangement: &Arrangement,
    node_index: &mut HashMap<String, NodeIdx>,
) -> OjGraph {
    let mut graph = OjGraph::empty(arrangement.sample_rate, arrangement.block_size);
    let track_count = arrangement.tracks.len() as u32;
    let speaker = NodeIdx(track_count);
    for (index, track) in arrangement.tracks.iter().enumerate() {
        let instrument = NodeIdx(index as u32);
        let gain = NodeIdx(track_count + 1 + index as u32 * 2);
        let pan = NodeIdx(gain.0 + 1);
        node_index.insert(format!("{}:output:gain", track.node_ref), gain);
        node_index.insert(format!("{}:output:pan", track.node_ref), pan);
        graph.nodes.push(node(
            instrument,
            "builtin.karplus",
            PrimitiveKind::KarplusString,
            vec![],
            0,
            1,
        ));
        graph.nodes.push(node(
            gain,
            GAIN_ID,
            PrimitiveKind::Gain,
            vec![Param {
                id: 0,
                value: db_to_gain(track.gain_db),
            }],
            1,
            1,
        ));
        graph.nodes.push(node(
            pan,
            PAN_ID,
            PrimitiveKind::Pan,
            vec![Param {
                id: 0,
                value: track.pan,
            }],
            1,
            1,
        ));
        graph.edges.push(edge(instrument, gain));
        graph.edges.push(edge(gain, pan));
        graph.edges.push(edge(pan, speaker));
    }
    graph.nodes.push(node(
        speaker,
        SPEAKER_OUT_ID,
        PrimitiveKind::SpeakerOut,
        vec![],
        1,
        0,
    ));
    graph
}

fn node(
    id: NodeIdx,
    manifest_id: &str,
    kind: PrimitiveKind,
    params: Vec<Param>,
    n_in: u8,
    n_out: u8,
) -> IrNode {
    IrNode {
        id,
        manifest_id: manifest_id.into(),
        kind,
        params,
        assets: vec![],
        n_in,
        n_out,
    }
}

fn edge(from_node: NodeIdx, to_node: NodeIdx) -> IrEdge {
    IrEdge {
        from_node,
        from_port: 0,
        to_node,
        to_port: 0,
        kind: ConnectionType::Audio,
    }
}

fn timeline(
    arrangement: &Arrangement,
    tempo_map: &TempoMap,
    node_index: &HashMap<String, NodeIdx>,
) -> Timeline {
    let mut events = Vec::new();
    let mut last_tick = 0;
    for track in &arrangement.tracks {
        let node = node_index[track.node_ref.as_str()];
        if !track.mute {
            for clip in &track.clips {
                if clip.mute || clip.length_tick == 0 {
                    continue;
                }
                let Some(source) = arrangement.sources.get(&clip.source_id) else {
                    continue;
                };
                match source {
                    Source::Midi { notes } => {
                        for note in notes {
                            let note_end = note.tick.saturating_add(note.dur_tick.max(1));
                            let window_end = clip.source_start.saturating_add(clip.length_tick);
                            if note_end <= clip.source_start || note.tick >= window_end {
                                continue;
                            }
                            let on_tick = clip
                                .start_tick
                                .saturating_add(note.tick.saturating_sub(clip.source_start));
                            let off_tick = clip.start_tick.saturating_add(
                                clip.length_tick
                                    .min(note_end.saturating_sub(clip.source_start)),
                            );
                            if off_tick <= on_tick {
                                continue;
                            }
                            last_tick = last_tick.max(off_tick);
                            events.push(sched(
                                tick_to_sample(tempo_map, on_tick),
                                node,
                                sched_event_kind::NOTE_ON,
                                note.pitch.min(127),
                                note.vel.min(127),
                                0.0,
                            ));
                            events.push(sched(
                                tick_to_sample(tempo_map, off_tick),
                                node,
                                sched_event_kind::NOTE_OFF,
                                note.pitch.min(127),
                                0,
                                0.0,
                            ));
                        }
                    }
                    Source::Audio { asset_id } => {
                        let sampler_offset = clip.source_start;
                        let _asset = u64::from_str_radix(asset_id.trim_start_matches("0x"), 16)
                            .unwrap_or_default();
                        last_tick = last_tick.max(clip.start_tick.saturating_add(clip.length_tick));
                        events.push(sched(
                            tick_to_sample(tempo_map, clip.start_tick),
                            node,
                            sched_event_kind::SAMPLER_START,
                            sampler_offset as u8,
                            (sampler_offset >> 8) as u8,
                            (sampler_offset >> 16) as f32,
                        ));
                        let _ = clip.gain;
                    }
                }
            }
        }

        for lane in &track.automation {
            if lane.state != "Play" {
                continue;
            }
            let Some(&automation_node) = node_index.get(lane.node_ref.as_str()) else {
                continue;
            };
            let points = densify(lane, arrangement.ppq);
            let is_gain = lane.node_ref.ends_with(":output:gain");
            for point in points {
                last_tick = last_tick.max(point.tick);
                let value = if is_gain {
                    db_to_gain(point.value)
                } else {
                    point.value
                };
                events.push(sched(
                    tick_to_sample(tempo_map, point.tick),
                    automation_node,
                    sched_event_kind::SET_PARAM,
                    lane.param as u8,
                    (lane.param >> 8) as u8,
                    value,
                ));
            }
        }
    }

    let beats_per_bar = u64::from(arrangement.time_signature[0]);
    let tail_ticks = (u64::from(arrangement.ppq) * beats_per_bar)
        .max((arrangement.tempo_bpm * f64::from(arrangement.ppq) / 60.0).round() as u64);
    Timeline {
        sample_rate: arrangement.sample_rate,
        events,
        loop_range: None,
        punch_range: None,
        armed_tracks: vec![],
        count_in_beats: 0,
        end: tick_to_sample(tempo_map, last_tick.saturating_add(tail_ticks)),
    }
}

fn densify(lane: &AutomationLane, ppq: u32) -> Vec<AutomationPoint> {
    if lane.interp != "Linear" {
        return lane.points.clone();
    }
    let mut points = Vec::new();
    let step = u64::from(ppq).div_ceil(32).max(1);
    for (index, &point) in lane.points.iter().enumerate() {
        let Some(&next) = lane.points.get(index + 1) else {
            points.push(point);
            break;
        };
        if next.tick <= point.tick {
            points.push(point);
            continue;
        }
        let count = next.tick.saturating_sub(point.tick).div_ceil(step).min(128);
        for item in 0..count {
            let mix = item as f64 / count as f64;
            points.push(AutomationPoint {
                tick: (point.tick as f64 + (next.tick - point.tick) as f64 * mix).round() as u64,
                value: point.value + (next.value - point.value) * mix as f32,
            });
        }
    }
    points
}

fn sched(at: u64, node: NodeIdx, kind: u8, a: u8, b: u8, value: f32) -> SchedEvent {
    SchedEvent {
        at,
        node,
        kind,
        a,
        b,
        value,
    }
}

fn tick_to_sample(map: &TempoMap, tick: u64) -> u64 {
    ((tick as f64 * 60.0 * f64::from(map.sample_rate))
        / (f64::from(map.tempos[0].bpm_start) * f64::from(map.ppq)))
    .round() as u64
}

fn db_to_gain(db: f32) -> f32 {
    if db <= -60.0 {
        0.0
    } else {
        libm::powf(10.0, db / 20.0)
    }
}
