//! Dedicated recording butler: drains capture rings, appends float WAV data,
//! journals boundaries, finalizes assets, and reconstructs interrupted takes.

use std::collections::{BTreeSet, HashMap};
use std::fs::{File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::{mpsc, Arc, Mutex};
use std::thread::{self, JoinHandle};

use ojcore::capture::Capture;
use ojcore::TempoMapRt;
use ojproto::{
    capture_mark_kind, CaptureMark, CaptureResult, CaptureSegment, CapturedNote, NodeIdx,
};

use crate::asset::Pcm;
use crate::store::AssetCatalog;

enum Command {
    Summon,
    Pause,
    Stop(mpsc::Sender<Result<CaptureResult, String>>),
    Quit,
}

/// Control handle for the single sequential disk thread.
pub struct Butler {
    tx: mpsc::SyncSender<Command>,
    join: Option<JoinHandle<()>>,
}

impl Butler {
    pub fn start(
        capture: Capture,
        directory: PathBuf,
        take_id: u64,
        sample_rate: u32,
        catalog: Arc<Mutex<AssetCatalog>>,
        tempo: Arc<TempoMapRt>,
    ) -> Result<Self, String> {
        std::fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
        let (tx, rx) = mpsc::sync_channel(8);
        let join = thread::Builder::new()
            .name("oj-capture-butler".into())
            .spawn(move || {
                let mut worker = Worker::new(
                    capture,
                    directory,
                    take_id,
                    sample_rate.max(1),
                    catalog,
                    tempo,
                );
                while let Ok(command) = rx.recv() {
                    match command {
                        Command::Summon => {
                            let _ = worker.drain();
                        }
                        Command::Pause => {
                            let _ = worker.drain();
                            let _ = worker.flush();
                        }
                        Command::Stop(reply) => {
                            let result = worker.finish(false);
                            let _ = reply.send(result);
                        }
                        Command::Quit => break,
                    }
                }
            })
            .map_err(|error| error.to_string())?;
        Ok(Self {
            tx,
            join: Some(join),
        })
    }

    /// Non-blocking one-message wakeup; a full mailbox means work is pending.
    pub fn summon(&self) {
        let _ = self.tx.try_send(Command::Summon);
    }

    pub fn pause(&self) {
        let _ = self.tx.try_send(Command::Pause);
    }

    pub fn stop(&self) -> Result<CaptureResult, String> {
        let (tx, rx) = mpsc::channel();
        self.tx
            .send(Command::Stop(tx))
            .map_err(|error| error.to_string())?;
        rx.recv().map_err(|error| error.to_string())?
    }

    pub fn reclog_path(directory: &Path, take_id: u64) -> PathBuf {
        directory.join(format!("take-{take_id}.reclog"))
    }
}

impl Drop for Butler {
    fn drop(&mut self) {
        let _ = self.tx.send(Command::Quit);
        if let Some(join) = self.join.take() {
            let _ = join.join();
        }
    }
}

struct OpenSegment {
    start_sample: u64,
    start_wav_frame: u64,
    loop_index: u32,
    xruns: u32,
}

struct Track {
    file: File,
    path: PathBuf,
    frames: u64,
    open: Option<OpenSegment>,
    closed: Vec<(u64, u64, u64, u32, u32)>,
    notes: Vec<CaptureMark>,
    capture_start: u64,
    accumulated_offset: u64,
}

struct Worker {
    capture: Capture,
    directory: PathBuf,
    take_id: u64,
    sample_rate: u32,
    catalog: Arc<Mutex<AssetCatalog>>,
    tempo: Arc<TempoMapRt>,
    journal: File,
    tracks: HashMap<u32, Track>,
    finished: Option<CaptureResult>,
}

impl Worker {
    fn new(
        capture: Capture,
        directory: PathBuf,
        take_id: u64,
        sample_rate: u32,
        catalog: Arc<Mutex<AssetCatalog>>,
        tempo: Arc<TempoMapRt>,
    ) -> Self {
        let journal_path = Butler::reclog_path(&directory, take_id);
        let journal = OpenOptions::new()
            .create(true)
            .append(true)
            .open(journal_path)
            .expect("capture journal open");
        Self {
            capture,
            directory,
            take_id,
            sample_rate,
            catalog,
            tempo,
            journal,
            tracks: HashMap::new(),
            finished: None,
        }
    }

    fn track(&mut self, node: u32) -> Result<&mut Track, String> {
        if !self.tracks.contains_key(&node) {
            let path = self
                .directory
                .join(format!("take-{}-{node}.wav", self.take_id));
            let mut file = OpenOptions::new()
                .create(true)
                .truncate(true)
                .read(true)
                .write(true)
                .open(&path)
                .map_err(|error| error.to_string())?;
            write_wav_header(&mut file, self.sample_rate, 0).map_err(|e| e.to_string())?;
            self.tracks.insert(
                node,
                Track {
                    file,
                    path,
                    frames: 0,
                    open: None,
                    closed: Vec::new(),
                    notes: Vec::new(),
                    capture_start: 0,
                    accumulated_offset: 0,
                },
            );
        }
        self.tracks
            .get_mut(&node)
            .ok_or_else(|| "capture track disappeared".to_string())
    }

    fn drain(&mut self) -> Result<(), String> {
        self.capture.drain();
        let mut marks = Vec::new();
        self.capture.drain_marks(&mut marks);
        let mut nodes = BTreeSet::new();
        nodes.extend(self.capture.nodes());
        for mark in &marks {
            nodes.insert(mark.node.0);
        }
        for node in nodes {
            let pcm = self.capture.take(node, 0).unwrap_or_default();
            if !pcm.is_empty() {
                let track = self.track(node)?;
                track
                    .file
                    .seek(SeekFrom::End(0))
                    .map_err(|e| e.to_string())?;
                for sample in &pcm {
                    track
                        .file
                        .write_all(&sample.to_le_bytes())
                        .map_err(|e| e.to_string())?;
                }
                track.frames = track.frames.saturating_add(pcm.len() as u64);
                writeln!(self.journal, "C {node} {}", pcm.len()).map_err(|e| e.to_string())?;
            }
        }
        for mark in marks {
            self.apply_mark(mark)?;
        }
        Ok(())
    }

    fn apply_mark(&mut self, mark: CaptureMark) -> Result<(), String> {
        writeln!(
            self.journal,
            "M {} {} {} {}",
            mark.node.0, mark.kind, mark.at_frame, mark.payload
        )
        .map_err(|e| e.to_string())?;
        let track = self.track(mark.node.0)?;
        match mark.kind {
            capture_mark_kind::RECORD_START | capture_mark_kind::PUNCH_IN => {
                track.capture_start = mark.at_frame;
                let written = track.closed.iter().map(|segment| segment.2).sum();
                track.open = Some(OpenSegment {
                    start_sample: mark.at_frame,
                    start_wav_frame: written,
                    loop_index: 0,
                    xruns: 0,
                });
            }
            capture_mark_kind::XRUN => {
                if let Some(open) = track.open.as_mut() {
                    open.xruns = open.xruns.saturating_add(mark.payload.max(1));
                }
            }
            capture_mark_kind::LOOP_WRAP => {
                close_segment(track, mark.at_frame);
                track.accumulated_offset = u64::from(mark.payload);
                let index = track.closed.len() as u32;
                let written = track.closed.iter().map(|segment| segment.2).sum();
                track.open = Some(OpenSegment {
                    start_sample: track.capture_start,
                    start_wav_frame: written,
                    loop_index: index,
                    xruns: 0,
                });
            }
            capture_mark_kind::RECORD_STOP | capture_mark_kind::PUNCH_OUT => {
                close_segment(track, mark.at_frame);
            }
            capture_mark_kind::NOTE_ON | capture_mark_kind::NOTE_OFF => track.notes.push(mark),
            _ => {}
        }
        Ok(())
    }

    fn flush(&mut self) -> Result<(), String> {
        self.journal.flush().map_err(|e| e.to_string())?;
        for track in self.tracks.values_mut() {
            repair_wav_header(&mut track.file, self.sample_rate, track.frames)
                .map_err(|e| e.to_string())?;
            track.file.flush().map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    fn finish(&mut self, recovered: bool) -> Result<CaptureResult, String> {
        if let Some(result) = self.finished.clone() {
            return Ok(result);
        }
        self.drain()?;
        for track in self.tracks.values_mut() {
            if track.open.is_some() {
                let end = track.open.as_ref().map_or(track.capture_start, |open| {
                    open.start_sample
                        .saturating_add(track.frames.saturating_sub(open.start_wav_frame))
                });
                close_segment(track, end);
            }
        }
        self.flush()?;
        let mut result = CaptureResult {
            take_id: self.take_id,
            recovered,
            ..CaptureResult::default()
        };
        for (&node, track) in &self.tracks {
            let pcm = read_float_wav(&track.path).map_err(|e| e.to_string())?;
            let asset = self
                .catalog
                .lock()
                .map_err(|_| "asset catalog mutex poisoned".to_string())?
                .insert(pcm)
                .map_err(|e| e.to_string())?;
            for &(start_sample, start_frame, frames, loop_index, xruns) in &track.closed {
                let start_tick = self.tempo.tick_at_sample(start_sample);
                let end_tick = self
                    .tempo
                    .tick_at_sample(start_sample.saturating_add(frames));
                result.segments.push(CaptureSegment {
                    node: NodeIdx(node),
                    asset,
                    start_sample,
                    frames,
                    start_tick,
                    length_ticks: end_tick.saturating_sub(start_tick),
                    loop_index,
                    xruns,
                });
                let _ = start_frame;
            }
            for mark in &track.notes {
                let note = (mark.payload & 0xff) as u8;
                let velocity = ((mark.payload >> 8) & 0xff) as u8;
                let event_frame = mark.at_frame.saturating_sub(track.capture_start);
                let contiguous = ojcore::exec::accumulated_capture_frame(
                    track.capture_start,
                    track.accumulated_offset,
                    track.accumulated_offset,
                    event_frame,
                );
                result.notes.push(CapturedNote {
                    node: mark.node,
                    note,
                    velocity,
                    on: mark.kind == capture_mark_kind::NOTE_ON,
                    tick: self.tempo.tick_at_sample(contiguous),
                });
            }
        }
        result
            .segments
            .sort_by_key(|segment| (segment.start_sample, segment.node.0, segment.loop_index));
        result
            .notes
            .sort_by_key(|note| (note.tick, note.node.0, note.note));
        self.finished = Some(result.clone());
        Ok(result)
    }
}

fn close_segment(track: &mut Track, at: u64) {
    if let Some(open) = track.open.take() {
        let available = track.frames.saturating_sub(open.start_wav_frame);
        let stamped = at.saturating_sub(open.start_sample);
        track.closed.push((
            open.start_sample,
            open.start_wav_frame,
            available.min(stamped),
            open.loop_index,
            open.xruns,
        ));
    }
}

fn write_wav_header(file: &mut File, sample_rate: u32, frames: u64) -> std::io::Result<()> {
    let data_bytes = frames.saturating_mul(4).min(u64::from(u32::MAX)) as u32;
    file.seek(SeekFrom::Start(0))?;
    file.write_all(b"RIFF")?;
    file.write_all(&(36_u32.saturating_add(data_bytes)).to_le_bytes())?;
    file.write_all(b"WAVEfmt ")?;
    file.write_all(&16_u32.to_le_bytes())?;
    file.write_all(&3_u16.to_le_bytes())?;
    file.write_all(&1_u16.to_le_bytes())?;
    file.write_all(&sample_rate.to_le_bytes())?;
    file.write_all(&sample_rate.saturating_mul(4).to_le_bytes())?;
    file.write_all(&4_u16.to_le_bytes())?;
    file.write_all(&32_u16.to_le_bytes())?;
    file.write_all(b"data")?;
    file.write_all(&data_bytes.to_le_bytes())?;
    Ok(())
}

fn repair_wav_header(file: &mut File, sample_rate: u32, frames: u64) -> std::io::Result<()> {
    write_wav_header(file, sample_rate, frames)?;
    file.seek(SeekFrom::End(0))?;
    Ok(())
}

fn read_float_wav(path: &Path) -> std::io::Result<Pcm> {
    let mut file = File::open(path)?;
    let mut header = [0_u8; 44];
    file.read_exact(&mut header)?;
    let sample_rate = u32::from_le_bytes(header[24..28].try_into().unwrap_or([0; 4]));
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes)?;
    let samples = bytes
        .chunks_exact(4)
        .map(|chunk| f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]))
        .collect();
    Ok(Pcm {
        samples,
        channels: 1,
        sample_rate,
    })
}

/// Repair headers after a crash and report completed journal segments.
pub fn recover_capture(
    directory: &Path,
    take_id: u64,
    sample_rate: u32,
    catalog: &mut AssetCatalog,
    tempo: &TempoMapRt,
) -> Result<CaptureResult, String> {
    let log = std::fs::read_to_string(Butler::reclog_path(directory, take_id))
        .map_err(|e| e.to_string())?;
    let mut starts: HashMap<u32, (u64, u32, u32)> = HashMap::new();
    let mut completed: HashMap<u32, Vec<(u64, u64, u32, u32)>> = HashMap::new();
    let mut captured: HashMap<u32, u64> = HashMap::new();
    for line in log.lines() {
        let fields: Vec<_> = line.split_whitespace().collect();
        match fields.as_slice() {
            ["C", node, frames] => {
                *captured
                    .entry(node.parse().map_err(|_| "bad node")?)
                    .or_default() += frames.parse::<u64>().map_err(|_| "bad frame count")?;
            }
            ["M", node, kind, at, payload] => {
                let node = node.parse::<u32>().map_err(|_| "bad node")?;
                let kind = kind.parse::<u8>().map_err(|_| "bad mark kind")?;
                let at = at.parse::<u64>().map_err(|_| "bad timestamp")?;
                let payload = payload.parse::<u32>().map_err(|_| "bad payload")?;
                match kind {
                    capture_mark_kind::RECORD_START | capture_mark_kind::PUNCH_IN => {
                        starts.insert(node, (at, 0, 0));
                    }
                    capture_mark_kind::XRUN => {
                        if let Some((_, _, xruns)) = starts.get_mut(&node) {
                            *xruns = xruns.saturating_add(payload.max(1));
                        }
                    }
                    capture_mark_kind::LOOP_WRAP
                    | capture_mark_kind::RECORD_STOP
                    | capture_mark_kind::PUNCH_OUT => {
                        if let Some((start, index, xruns)) = starts.remove(&node) {
                            completed
                                .entry(node)
                                .or_default()
                                .push((start, at, index, xruns));
                            if kind == capture_mark_kind::LOOP_WRAP {
                                starts.insert(node, (start, index.saturating_add(1), 0));
                            }
                        }
                    }
                    _ => {}
                }
            }
            _ => {}
        }
    }
    let mut result = CaptureResult {
        take_id,
        recovered: true,
        ..CaptureResult::default()
    };
    for (node, frames) in captured {
        let path = directory.join(format!("take-{take_id}-{node}.wav"));
        let mut file = OpenOptions::new()
            .read(true)
            .write(true)
            .open(&path)
            .map_err(|e| e.to_string())?;
        let physical_frames = file
            .metadata()
            .map_err(|e| e.to_string())?
            .len()
            .saturating_sub(44)
            / 4;
        let frames = frames.min(physical_frames);
        repair_wav_header(&mut file, sample_rate, frames).map_err(|e| e.to_string())?;
        let asset = catalog
            .insert(read_float_wav(&path).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
        for (start, end, loop_index, xruns) in completed.remove(&node).unwrap_or_default() {
            let len = end.saturating_sub(start).min(frames);
            let start_tick = tempo.tick_at_sample(start);
            result.segments.push(CaptureSegment {
                node: NodeIdx(node),
                asset,
                start_sample: start,
                frames: len,
                start_tick,
                length_ticks: tempo
                    .tick_at_sample(start.saturating_add(len))
                    .saturating_sub(start_tick),
                loop_index,
                xruns,
            });
        }
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use ojcore::capture::Capture;
    use ojproto::{capture_mark_kind as kind, AssetId};
    use std::time::{SystemTime, UNIX_EPOCH};

    fn silent_engine(block: u32) -> ojcore::Engine {
        use ojcore::{compile, GainLoader, PluginRegistry, GAIN_ID};
        use ojproto::{ConnectionType, IrEdge, IrNode, OjGraph, PrimitiveKind};
        let mut graph = OjGraph::empty(48_000, block);
        graph.nodes.push(IrNode {
            id: NodeIdx(1),
            manifest_id: GAIN_ID.into(),
            kind: PrimitiveKind::GraphIn,
            params: vec![],
            assets: vec![],
            n_in: 0,
            n_out: 1,
        });
        graph.nodes.push(IrNode {
            id: NodeIdx(2),
            manifest_id: GAIN_ID.into(),
            kind: PrimitiveKind::SpeakerOut,
            params: vec![],
            assets: vec![],
            n_in: 1,
            n_out: 0,
        });
        graph.edges.push(IrEdge {
            from_node: NodeIdx(1),
            from_port: 0,
            to_node: NodeIdx(2),
            to_port: 0,
            kind: ConnectionType::Audio,
        });
        let mut registry = PluginRegistry::new();
        registry.register(Box::new(GainLoader::new()));
        ojcore::Engine::new(compile(&graph, &registry).unwrap())
    }

    fn test_dir(name: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("oj-{name}-{}-{nonce}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("test directory");
        dir
    }

    #[test]
    fn drains_exact_punch_loop_and_xrun_segments() {
        let dir = test_dir("butler");
        let (capture, mut sink) = Capture::new(256);
        let catalog = Arc::new(Mutex::new(AssetCatalog::new()));
        let tempo = Arc::new(TempoMapRt::one_point(48_000, 120.0, 4, 4));
        let butler = Butler::start(capture, dir.clone(), 7, 48_000, Arc::clone(&catalog), tempo)
            .expect("start butler");
        sink.mark(3, kind::PUNCH_IN, 10, 0);
        sink.capture(3, &[1.0, 2.0, 3.0, 4.0]);
        sink.mark(3, kind::XRUN, 12, 2);
        sink.mark(3, kind::LOOP_WRAP, 14, 4);
        sink.capture(3, &[5.0, 6.0, 7.0, 8.0]);
        sink.mark(3, kind::PUNCH_OUT, 18, 0);
        let result = butler.stop().expect("finish capture");
        assert_eq!(result.segments.len(), 2);
        assert_eq!(
            (result.segments[0].start_sample, result.segments[0].frames),
            (10, 4)
        );
        assert_eq!(result.segments[0].xruns, 2);
        assert_eq!(
            (result.segments[1].start_sample, result.segments[1].frames),
            (10, 4)
        );
        assert_eq!(result.segments[1].loop_index, 1);
        let asset = result.segments[0].asset;
        assert_ne!(asset, AssetId(0));
        assert_eq!(
            catalog.lock().unwrap().resolve(asset).unwrap().samples,
            vec![1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0]
        );
        let log = std::fs::read_to_string(Butler::reclog_path(&dir, 7)).unwrap();
        assert!(log.contains("M 3 2 10 0"));
        assert!(log.contains("M 3 5 12 2"));
        assert!(log.contains("M 3 4 14 4"));
        assert!(log.contains("M 3 3 18 0"));
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn recovery_uses_completed_marks_and_physical_wav_length() {
        let dir = test_dir("recover");
        let (capture, mut sink) = Capture::new(256);
        let catalog = Arc::new(Mutex::new(AssetCatalog::new()));
        let tempo = Arc::new(TempoMapRt::one_point(48_000, 120.0, 4, 4));
        let butler = Butler::start(
            capture,
            dir.clone(),
            9,
            48_000,
            Arc::clone(&catalog),
            Arc::clone(&tempo),
        )
        .unwrap();
        sink.mark(4, kind::RECORD_START, 100, 0);
        sink.capture(4, &[0.1, 0.2, 0.3, 0.4]);
        sink.mark(4, kind::LOOP_WRAP, 104, 4);
        butler.pause();
        std::thread::sleep(std::time::Duration::from_millis(20));
        drop(butler);
        let mut recovered_catalog = AssetCatalog::new();
        let result = recover_capture(&dir, 9, 48_000, &mut recovered_catalog, &tempo).unwrap();
        assert!(result.recovered);
        assert_eq!(result.segments.len(), 1);
        assert_eq!(result.segments[0].frames, 4);
        assert!(recovered_catalog.contains(result.segments[0].asset));
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn click_renders_at_bar_and_beat_frames_and_count_in_holds_timeline() {
        use ojproto::{transport_flag, RtCommand, Timeline};
        let mut engine = silent_engine(64);
        let map = TempoMapRt::one_point(48_000, 120.0, 4, 4);
        engine.install_timeline(ojcore::TimelineRt::from_wire(
            &Timeline {
                sample_rate: 48_000,
                events: vec![],
                loop_range: None,
                punch_range: None,
                armed_tracks: vec![],
                count_in_beats: 1,
                end: 48_000,
            },
            &map,
        ));
        engine.apply_rt(RtCommand::TransportSet {
            flag: transport_flag::CLICK,
            on: true,
        });
        engine.apply_rt(RtCommand::TransportSet {
            flag: transport_flag::COUNT_IN,
            on: true,
        });
        engine.apply_rt(RtCommand::TransportPlay);
        assert_eq!(engine.transport().motion(), ojcore::Motion::CountIn);
        let mut rendered = Vec::new();
        for _ in 0..375 {
            let mut block = [0.0_f32; 64];
            engine.process_block(&mut block, 64);
            rendered.extend_from_slice(&block);
        }
        assert_ne!(rendered[0], 0.0, "bar accent begins at count-in frame zero");
        assert!(rendered[24..100].iter().all(|sample| *sample == 0.0));
        assert_eq!(engine.transport().motion(), ojcore::Motion::Rolling);
        assert_eq!(engine.sample_pos(), 0, "timeline was held during pre-roll");
        let mut beat = [0.0_f32; 64];
        engine.process_block(&mut beat, 64);
        assert_ne!(
            beat[0], 0.0,
            "record roll begins seamlessly on an accented beat"
        );
    }
}
