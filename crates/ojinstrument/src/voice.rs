//! Shared voice-allocation policy for the polyphonic instruments.
//!
//! Each instrument owns a fixed array of voices and a parallel array of
//! liveness/age metadata tracked here. [`VoiceAlloc`] answers the only two
//! questions every poly instrument needs on the hot path, allocation-free:
//!   * which slot should a new note take? (a free voice, else oldest-first
//!     steal), and
//!   * which slot currently plays a given note? (for note-off).
//!
//! The instrument keeps the actual DSP state (oscillator phase, sample read
//! position, string buffer, envelope) in its own array indexed by the same
//! slot, so this module never touches audio data — it is pure bookkeeping.

use crate::MAX_VOICES;

/// Per-slot voice bookkeeping: which MIDI note (if any) it plays and a
/// monotonically increasing "age stamp" used to pick the oldest voice to steal.
#[derive(Debug, Clone, Copy)]
struct Slot {
    /// The MIDI note this voice is currently sounding, or `None` if free.
    note: Option<u8>,
    /// Age stamp at allocation; lower = older. Only meaningful when `active`.
    stamp: u64,
    /// Whether the voice's envelope is still producing sound (set false once
    /// the instrument observes its envelope go idle).
    active: bool,
}

impl Slot {
    const fn empty() -> Self {
        Self {
            note: None,
            stamp: 0,
            active: false,
        }
    }
}

/// Fixed-capacity voice allocator with oldest-first steal. Bookkeeping only;
/// the instrument owns the DSP state arrays indexed by the returned slot.
#[derive(Debug)]
pub struct VoiceAlloc {
    slots: [Slot; MAX_VOICES],
    next_stamp: u64,
}

impl Default for VoiceAlloc {
    fn default() -> Self {
        Self::new()
    }
}

impl VoiceAlloc {
    pub fn new() -> Self {
        Self {
            slots: [Slot::empty(); MAX_VOICES],
            next_stamp: 0,
        }
    }

    /// Allocate a slot for a new `note`. Prefers a free (inactive) voice; if
    /// none, steals the oldest active voice. Returns `(slot, stolen)` where
    /// `stolen` is true if an active voice was reclaimed (the instrument should
    /// hard-reset that slot's DSP state to avoid a click). RT-safe.
    pub fn allocate(&mut self, note: u8) -> (usize, bool) {
        let stamp = self.next_stamp;
        self.next_stamp = self.next_stamp.wrapping_add(1);

        // First choice: any inactive slot.
        if let Some(i) = self.slots.iter().position(|s| !s.active) {
            self.slots[i] = Slot {
                note: Some(note),
                stamp,
                active: true,
            };
            return (i, false);
        }

        // Otherwise steal the oldest active voice (smallest stamp).
        let mut oldest = 0usize;
        let mut oldest_stamp = u64::MAX;
        for (i, s) in self.slots.iter().enumerate() {
            if s.stamp <= oldest_stamp {
                oldest_stamp = s.stamp;
                oldest = i;
            }
        }
        self.slots[oldest] = Slot {
            note: Some(note),
            stamp,
            active: true,
        };
        (oldest, true)
    }

    /// Find the (active) slot currently sounding `note`, if any. When several
    /// voices share a note (re-triggers), the most recently allocated wins so a
    /// note-off releases the freshest voice. RT-safe.
    pub fn slot_of_note(&self, note: u8) -> Option<usize> {
        let mut best: Option<(usize, u64)> = None;
        for (i, s) in self.slots.iter().enumerate() {
            if s.active && s.note == Some(note) {
                match best {
                    Some((_, st)) if s.stamp <= st => {}
                    _ => best = Some((i, s.stamp)),
                }
            }
        }
        best.map(|(i, _)| i)
    }

    /// Mark a slot free once its envelope has gone idle. The instrument calls
    /// this after observing the slot produce silence. RT-safe.
    pub fn release_slot(&mut self, slot: usize) {
        if let Some(s) = self.slots.get_mut(slot) {
            s.active = false;
            s.note = None;
        }
    }

    /// Free every voice (instrument reset). RT-safe.
    pub fn clear(&mut self) {
        for s in self.slots.iter_mut() {
            *s = Slot::empty();
        }
        self.next_stamp = 0;
    }

    /// Whether `slot` is currently allocated to a sounding voice.
    #[inline]
    pub fn is_active(&self, slot: usize) -> bool {
        self.slots.get(slot).map(|s| s.active).unwrap_or(false)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allocates_distinct_free_slots() {
        let mut va = VoiceAlloc::new();
        let (a, sa) = va.allocate(60);
        let (b, sb) = va.allocate(64);
        assert_ne!(a, b);
        assert!(!sa && !sb, "fresh allocations should not steal");
        assert_eq!(va.slot_of_note(60), Some(a));
        assert_eq!(va.slot_of_note(64), Some(b));
    }

    #[test]
    fn steals_oldest_when_full() {
        let mut va = VoiceAlloc::new();
        let first = va.allocate(1).0;
        for n in 2..=MAX_VOICES as u8 {
            va.allocate(n);
        }
        // Pool is full; the next allocation must steal the oldest (first) slot.
        let (slot, stolen) = va.allocate(99);
        assert!(stolen, "full pool should steal");
        assert_eq!(slot, first, "should reclaim the oldest voice");
        assert_eq!(va.slot_of_note(99), Some(first));
    }

    #[test]
    fn release_frees_slot_for_reuse() {
        let mut va = VoiceAlloc::new();
        let s = va.allocate(40).0;
        assert!(va.is_active(s));
        va.release_slot(s);
        assert!(!va.is_active(s));
        assert_eq!(va.slot_of_note(40), None);
    }
}
