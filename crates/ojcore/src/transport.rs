//! Real-time transport clock and finite-state machine.
//!
//! The transport owns the authoritative sample playhead. Musical coordinates
//! are always derived from an immutable [`crate::TempoMapRt`] snapshot; there
//! are deliberately no scalar tempo or meter twins here.

use crate::tempo::{MetricCursor, TempoMapRt};

/// A musical position derived from the sample playhead.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct TransportPos {
    /// One-based bar number.
    pub bar: u32,
    /// One-based beat within the current bar.
    pub beat: u32,
    /// Fractional progress through the current meter beat.
    pub phase: f32,
    /// Musical quarter-note ticks at [`ojproto::PPQ`].
    pub tick: u64,
    /// The sample playhead used for this read.
    pub sample: u64,
}

/// The independent motion dimension of the transport FSM.
#[repr(u8)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Motion {
    /// No timeline movement; live DSP still renders.
    #[default]
    Stopped = 0,
    /// Timeline movement is active.
    Rolling = 1,
    /// Fading the master before stopping.
    DeclickToStop = 2,
    /// Fading the master before changing position.
    DeclickToLocate = 3,
    /// A non-RT locate is outstanding.
    WaitingForLocate = 4,
    /// Metronome-only pre-roll; timeline time remains fixed.
    CountIn = 5,
}

/// What motion should follow a locate.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Disposition {
    MustRoll,
    MustStop,
    RollIfAppropriate,
}

/// RT-internal transport event. It never appears on the wire.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TransportEvent {
    Start,
    Stop {
        flush: bool,
    },
    Locate {
        at: u64,
        roll: Disposition,
        for_loop: bool,
    },
    LocateDone,
    ButlerDone,
}

/// Short, stepped master-gain fade used before stop and locate operations.
///
/// The duration is the sample-rate equivalent of 800 frames at 48 kHz and the
/// gain is updated every four frames, matching the transport specification.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct DeclickAmp {
    gain: f32,
    step: f32,
    remaining: u32,
    until_step: u8,
}

impl Default for DeclickAmp {
    fn default() -> Self {
        Self {
            gain: 1.0,
            step: 0.0,
            remaining: 0,
            until_step: 4,
        }
    }
}

impl DeclickAmp {
    /// Fade length in frames at `sample_rate`.
    pub fn length(sample_rate: f32) -> u32 {
        let rate = if sample_rate.is_finite() && sample_rate > 0.0 {
            sample_rate
        } else {
            48_000.0
        };
        let raw = libm::roundf(rate / 60.0).max(4.0) as u32;
        raw.div_ceil(4) * 4
    }

    /// Begin a unity-to-silence fade.
    pub fn start(&mut self, sample_rate: f32) {
        let length = Self::length(sample_rate);
        self.gain = 1.0;
        self.step = 4.0 / length as f32;
        self.remaining = length;
        self.until_step = 4;
    }

    /// Cancel any fade and return to unity.
    pub fn reset(&mut self) {
        *self = Self::default();
    }

    pub fn remaining(&self) -> u32 {
        self.remaining
    }

    pub fn is_active(&self) -> bool {
        self.remaining != 0
    }

    /// Gain for one master frame, advancing the four-frame stepper once.
    pub fn next_gain(&mut self) -> f32 {
        if self.remaining == 0 {
            return 1.0;
        }
        let gain = self.gain;
        self.remaining -= 1;
        self.until_step -= 1;
        if self.until_step == 0 {
            self.gain = (self.gain - self.step).max(0.0);
            self.until_step = 4;
        }
        gain
    }
}

/// Allocation-free transport finite-state machine.
#[derive(Debug, Clone, Copy)]
pub struct TransportFsm {
    motion: Motion,
    waiting_for_butler: bool,
    locate_target: u64,
    roll_after_locate: Option<bool>,
    punch_or_loop: u8,
    deferred: [Option<TransportEvent>; 8],
    processing: u8,
    declick: DeclickAmp,
    seek_counter: u32,
}

impl Default for TransportFsm {
    fn default() -> Self {
        Self {
            motion: Motion::Stopped,
            waiting_for_butler: false,
            locate_target: u64::MAX,
            roll_after_locate: None,
            punch_or_loop: 0,
            deferred: [None; 8],
            processing: 0,
            declick: DeclickAmp::default(),
            seek_counter: 0,
        }
    }
}

impl TransportFsm {
    pub fn motion(&self) -> Motion {
        self.motion
    }

    pub fn is_rolling(&self) -> bool {
        matches!(
            self.motion,
            Motion::Rolling | Motion::DeclickToStop | Motion::DeclickToLocate
        )
    }

    pub fn begin_count_in(&mut self) {
        self.motion = Motion::CountIn;
        self.declick.reset();
    }

    pub fn finish_count_in(&mut self) {
        if self.motion == Motion::CountIn {
            self.motion = Motion::Rolling;
        }
    }

    pub fn waiting_for_butler(&self) -> bool {
        self.waiting_for_butler
    }

    pub fn seek_counter(&self) -> u32 {
        self.seek_counter
    }

    pub fn declick_remaining(&self) -> u32 {
        self.declick.remaining()
    }

    pub fn next_declick_gain(&mut self) -> f32 {
        self.declick.next_gain()
    }

    fn enqueue(&mut self, event: TransportEvent, sample_rate: f32) -> Option<u64> {
        if self.processing != 0 {
            if let Some(slot) = self.deferred.iter_mut().find(|slot| slot.is_none()) {
                *slot = Some(event);
            }
            return None;
        }

        self.processing = self.processing.saturating_add(1);
        let mut locate = self.apply_event(event, sample_rate);
        while let Some(i) = self.deferred.iter().position(Option::is_some) {
            let deferred = self.deferred[i].take().expect("occupied deferred slot");
            locate = self.apply_event(deferred, sample_rate).or(locate);
        }
        self.processing -= 1;
        locate
    }

    fn apply_event(&mut self, event: TransportEvent, sample_rate: f32) -> Option<u64> {
        match event {
            TransportEvent::Start => {
                self.motion = Motion::Rolling;
                self.roll_after_locate = None;
                self.locate_target = u64::MAX;
                self.declick.reset();
                None
            }
            TransportEvent::Stop { flush } => {
                let _ = flush;
                if self.is_rolling() {
                    self.motion = Motion::DeclickToStop;
                    self.declick.start(sample_rate);
                } else {
                    self.motion = Motion::Stopped;
                }
                None
            }
            TransportEvent::Locate { at, roll, for_loop } => {
                let was_rolling = self.is_rolling();
                let roll_after = match roll {
                    Disposition::MustRoll => true,
                    Disposition::MustStop => false,
                    Disposition::RollIfAppropriate => was_rolling,
                };
                self.seek_counter = self.seek_counter.wrapping_add(1);
                self.locate_target = at;
                self.roll_after_locate = Some(roll_after);
                if was_rolling && !for_loop {
                    self.motion = Motion::DeclickToLocate;
                    self.declick.start(sample_rate);
                    None
                } else {
                    self.finish_locate()
                }
            }
            TransportEvent::LocateDone => self.finish_locate(),
            TransportEvent::ButlerDone => {
                self.waiting_for_butler = false;
                if self.motion == Motion::WaitingForLocate {
                    self.finish_locate()
                } else {
                    None
                }
            }
        }
    }

    fn finish_locate(&mut self) -> Option<u64> {
        let at = (self.locate_target != u64::MAX).then_some(self.locate_target)?;
        self.locate_target = u64::MAX;
        self.motion = if self.roll_after_locate.take().unwrap_or(false) {
            Motion::Rolling
        } else {
            Motion::Stopped
        };
        self.declick.reset();
        Some(at)
    }

    pub fn start(&mut self, sample_rate: f32) {
        let _ = self.enqueue(TransportEvent::Start, sample_rate);
    }

    pub fn stop(&mut self, sample_rate: f32) {
        let _ = self.enqueue(TransportEvent::Stop { flush: false }, sample_rate);
    }

    pub fn locate(
        &mut self,
        at: u64,
        disposition: Disposition,
        for_loop: bool,
        sample_rate: f32,
    ) -> Option<u64> {
        self.enqueue(
            TransportEvent::Locate {
                at,
                roll: disposition,
                for_loop,
            },
            sample_rate,
        )
    }

    /// Finish a declick edge. Returns a deferred locate target when applicable.
    pub fn finish_declick(&mut self, sample_rate: f32) -> Option<u64> {
        if self.declick.is_active() {
            return None;
        }
        match self.motion {
            Motion::DeclickToStop => {
                self.motion = Motion::Stopped;
                self.declick.reset();
                None
            }
            Motion::DeclickToLocate => self.enqueue(TransportEvent::LocateDone, sample_rate),
            _ => None,
        }
    }

    pub fn butler_done(&mut self, sample_rate: f32) -> Option<u64> {
        self.enqueue(TransportEvent::ButlerDone, sample_rate)
    }
}

/// Authoritative sample clock plus loop/punch runtime state.
#[derive(Debug, Clone, Copy)]
pub struct Transport {
    sample_rate: f32,
    sample_pos: u64,
    fsm: TransportFsm,
    loop_range: Option<(u64, u64)>,
    punch_range: Option<(u64, u64)>,
    loop_on: bool,
    punch_on: bool,
    record_armed: bool,
    click_on: bool,
    count_in_on: bool,
}

impl Default for Transport {
    fn default() -> Self {
        Self::new(48_000.0)
    }
}

impl Transport {
    pub fn new(sample_rate: f32) -> Self {
        Self {
            sample_rate: valid_sample_rate(sample_rate),
            sample_pos: 0,
            fsm: TransportFsm::default(),
            loop_range: None,
            punch_range: None,
            loop_on: false,
            punch_on: false,
            record_armed: false,
            click_on: false,
            count_in_on: false,
        }
    }

    pub fn sample_rate(&self) -> f32 {
        self.sample_rate
    }

    pub fn set_sample_rate(&mut self, sample_rate: f32) {
        self.sample_rate = valid_sample_rate(sample_rate);
    }

    pub fn sample_pos(&self) -> u64 {
        self.sample_pos
    }

    pub fn motion(&self) -> Motion {
        self.fsm.motion()
    }

    pub fn is_playing(&self) -> bool {
        self.fsm.is_rolling()
    }

    pub fn loop_on(&self) -> bool {
        self.loop_on
    }

    pub fn punch_on(&self) -> bool {
        self.punch_on
    }

    pub fn record_armed(&self) -> bool {
        self.record_armed
    }

    pub fn click_on(&self) -> bool {
        self.click_on
    }

    pub fn count_in_on(&self) -> bool {
        self.count_in_on
    }

    pub fn fsm(&self) -> &TransportFsm {
        &self.fsm
    }

    pub fn set_ranges(&mut self, loop_range: Option<(u64, u64)>, punch_range: Option<(u64, u64)>) {
        self.loop_range = loop_range.filter(|(start, end)| start < end);
        self.punch_range = punch_range.filter(|(start, end)| start < end);
    }

    pub fn loop_range(&self) -> Option<(u64, u64)> {
        self.loop_range
    }

    pub fn punch_range(&self) -> Option<(u64, u64)> {
        self.punch_range
    }

    /// Apply one of the compact `ojproto::transport_flag` toggles.
    pub fn set_flag(&mut self, flag: u8, on: bool) {
        match flag {
            ojproto::transport_flag::LOOP_ENABLE => {
                self.loop_on = on;
                if on {
                    self.punch_on = false;
                    self.fsm.punch_or_loop = 2;
                } else if self.fsm.punch_or_loop == 2 {
                    self.fsm.punch_or_loop = 0;
                }
            }
            ojproto::transport_flag::PUNCH_ENABLE => {
                self.punch_on = on;
                if on {
                    self.loop_on = false;
                    self.fsm.punch_or_loop = 1;
                } else if self.fsm.punch_or_loop == 1 {
                    self.fsm.punch_or_loop = 0;
                }
            }
            ojproto::transport_flag::RECORD_ARM => self.record_armed = on,
            ojproto::transport_flag::CLICK => self.click_on = on,
            ojproto::transport_flag::COUNT_IN => self.count_in_on = on,
            _ => {}
        }
    }

    pub fn play(&mut self) {
        self.fsm.start(self.sample_rate);
    }

    pub fn begin_count_in(&mut self) {
        self.fsm.begin_count_in();
    }

    pub fn finish_count_in(&mut self) {
        self.fsm.finish_count_in();
    }

    pub fn pause(&mut self) {
        self.fsm.stop(self.sample_rate);
    }

    pub fn locate(&mut self, sample: u64) {
        if let Some(at) = self.fsm.locate(
            sample,
            Disposition::RollIfAppropriate,
            false,
            self.sample_rate,
        ) {
            self.sample_pos = at;
        }
    }

    /// Maximum frames before a transport edge (declick completion or loop end).
    pub fn frames_until_edge(&self, max: usize) -> usize {
        let mut edge = max;
        if self.fsm.declick_remaining() != 0 {
            edge = edge.min(self.fsm.declick_remaining() as usize);
        }
        if self.fsm.motion() == Motion::Rolling && self.loop_on {
            if let Some((_, end)) = self.loop_range {
                let distance = end.saturating_sub(self.sample_pos) as usize;
                edge = edge.min(distance);
            }
        }
        edge
    }

    /// Gain one rendered master frame during declick states.
    pub fn next_master_gain(&mut self) -> f32 {
        match self.fsm.motion() {
            Motion::DeclickToStop | Motion::DeclickToLocate => self.fsm.next_declick_gain(),
            _ => 1.0,
        }
    }

    /// Advance timeline time after rendering a span.
    pub fn advance(&mut self, nframes: usize) {
        if self.fsm.is_rolling() {
            self.sample_pos = self.sample_pos.wrapping_add(nframes as u64);
        }
    }

    /// Apply an edge reached after a rendered span.
    pub fn finish_edge(&mut self) {
        if self.fsm.declick_remaining() == 0 {
            if let Some(at) = self.fsm.finish_declick(self.sample_rate) {
                self.sample_pos = at;
            }
        }
        if self.fsm.motion() == Motion::Rolling && self.loop_on {
            if let Some((start, end)) = self.loop_range {
                if self.sample_pos >= end {
                    if let Some(at) =
                        self.fsm
                            .locate(start, Disposition::MustRoll, true, self.sample_rate)
                    {
                        self.sample_pos = at;
                    }
                }
            }
        }
    }

    /// Derive the current musical coordinates through `map`.
    pub fn position(&self, map: &TempoMapRt, cursor: &mut MetricCursor) -> TransportPos {
        let tick = map.tick_at_sample_with_cursor(self.sample_pos, cursor);
        let metric = map.meter_at_sample_with_cursor(self.sample_pos, cursor);
        TransportPos {
            bar: metric.bar,
            beat: metric.beat,
            phase: metric.phase,
            tick,
            sample: self.sample_pos,
        }
    }
}

fn valid_sample_rate(sample_rate: f32) -> f32 {
    if sample_rate.is_finite() && sample_rate > 0.0 {
        sample_rate
    } else {
        48_000.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ojproto::{MeterPoint, TempoMap, TempoPoint, PPQ};

    const SR: f32 = 48_000.0;

    fn map(beats_per_bar: u8) -> TempoMapRt {
        TempoMapRt::from_wire(&TempoMap {
            ppq: PPQ,
            sample_rate: SR as u32,
            tempos: alloc::vec![TempoPoint {
                tick: 0,
                sample: 0,
                bpm_start: 120.0,
                bpm_end: 120.0,
                continuing: false,
            }],
            meters: alloc::vec![MeterPoint {
                tick: 0,
                sample: 0,
                bar: 1,
                divisions_per_bar: beats_per_bar,
                note_value: 4,
            }],
        })
    }

    #[test]
    fn one_point_map_drives_position() {
        let mut transport = Transport::new(SR);
        transport.locate(96_000 + 48_000);
        let pos = transport.position(&map(4), &mut MetricCursor::default());
        assert_eq!((pos.bar, pos.beat, pos.tick), (2, 3, 5_760));
        assert!(pos.phase < 1e-6);
    }

    #[test]
    fn stop_declicks_then_stops() {
        let mut transport = Transport::new(SR);
        transport.play();
        transport.pause();
        assert_eq!(transport.motion(), Motion::DeclickToStop);
        let len = DeclickAmp::length(SR) as usize;
        for _ in 0..len {
            let _ = transport.next_master_gain();
        }
        transport.advance(len);
        transport.finish_edge();
        assert_eq!(transport.motion(), Motion::Stopped);
        assert_eq!(transport.sample_pos(), len as u64);
    }

    #[test]
    fn rolling_locate_defers_jump_until_declick_finishes() {
        let mut transport = Transport::new(SR);
        transport.play();
        transport.advance(64);
        transport.locate(48_000);
        assert_eq!(transport.motion(), Motion::DeclickToLocate);
        assert_eq!(transport.sample_pos(), 64);
        let len = DeclickAmp::length(SR) as usize;
        for _ in 0..len - 1 {
            let _ = transport.next_master_gain();
        }
        transport.finish_edge();
        assert_eq!(transport.sample_pos(), 64);
        let _ = transport.next_master_gain();
        transport.advance(len);
        transport.finish_edge();
        assert_eq!(transport.sample_pos(), 48_000);
        assert_eq!(transport.motion(), Motion::Rolling);
    }

    #[test]
    fn transport_set_toggles_and_locks_punch_against_loop() {
        let mut transport = Transport::new(SR);
        transport.set_flag(ojproto::transport_flag::LOOP_ENABLE, true);
        assert!(transport.loop_on());
        transport.set_flag(ojproto::transport_flag::PUNCH_ENABLE, true);
        assert!(transport.punch_on());
        assert!(!transport.loop_on());
        transport.set_flag(ojproto::transport_flag::RECORD_ARM, true);
        transport.set_flag(ojproto::transport_flag::CLICK, true);
        assert!(transport.record_armed());
        assert!(transport.click_on());
    }

    #[test]
    fn loop_wrap_edge_is_sample_exact() {
        let mut transport = Transport::new(SR);
        transport.set_ranges(Some((10, 14)), None);
        transport.set_flag(ojproto::transport_flag::LOOP_ENABLE, true);
        transport.locate(12);
        transport.play();

        let mut observed = [0u64; 6];
        for sample in &mut observed {
            *sample = transport.sample_pos();
            transport.advance(1);
            transport.finish_edge();
        }
        assert_eq!(observed, [12, 13, 10, 11, 12, 13]);
    }
}
