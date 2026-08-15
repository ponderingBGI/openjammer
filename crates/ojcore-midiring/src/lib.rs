//! Lock-free single-producer / single-consumer byte ring with a **frozen**
//! `#[repr(C)]` memory layout.
//!
//! The layout is fixed so that JavaScript (driving a `SharedArrayBuffer`) and
//! the Rust/wasm audio worklet agree on field offsets without any negotiation.
//! The header is three `u32`s (`write`, `read`, `capacity`) followed by an
//! inline byte region of `N` bytes; `N` MUST be a power of two so indices can
//! be masked instead of divided.
//!
//! Two type aliases are provided for the two real uses on the boundary:
//! [`MidiRing`] (worker -> worklet, variable-length MIDI byte runs) and
//! [`CmdRing`] (UI -> engine, `ojproto`-style command bytes). They differ
//! only in capacity; the wire format is identical length-prefixed frames.
//!
//! # Wire format
//! Each [`push`](ByteRing::push) writes a 4-byte little-endian length prefix
//! followed by the payload bytes, all modulo `N`. [`pop`](ByteRing::pop) reads
//! exactly one such frame. This keeps variable-length messages atomic across
//! the SPSC handoff: the consumer never observes a partial frame because the
//! producer publishes the new write index with a single `Release` store only
//! after the whole frame is in the buffer.
//!
//! # Safety of the SPSC contract
//! Exactly one thread (the producer) may call [`push`](ByteRing::push) and
//! exactly one thread (the consumer) may call [`pop`](ByteRing::pop). Both may
//! run concurrently. The producer owns `write`; the consumer owns `read`. The
//! `Acquire`/`Release` pairing on those two indices is what synchronizes the
//! data bytes — there is no lock and no CAS, so both operations are wait-free.

#![cfg_attr(not(any(test, loom)), no_std)]

// Concurrency primitives: the real ones in production, loom's instrumented ones
// under `--cfg loom` so the nightly model checker can exhaustively explore the
// SPSC interleavings. The `cfg(not(loom))` path below is byte-for-byte the shipping
// code, so loom support cannot change production behaviour (verified by the normal
// `cargo test` run, which builds the `not(loom)` path).
#[cfg(not(loom))]
use core::sync::atomic::{AtomicU32, Ordering};
#[cfg(loom)]
use loom::sync::atomic::{AtomicU32, Ordering};

/// Size of the length prefix prepended to every frame, in bytes.
const LEN_PREFIX: usize = 4;

/// Byte offsets of every field in the `#[repr(C)]` header + storage, so the JS
/// side can be generated or asserted against. Values are in bytes from the
/// start of a [`ByteRing`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct HeaderOffsets {
    /// Offset of the `write` atomic index (producer-owned).
    pub write: usize,
    /// Offset of the `read` atomic index (consumer-owned).
    pub read: usize,
    /// Offset of the `capacity` field (number of data bytes, == `N`).
    pub capacity: usize,
    /// Offset of the first byte of the inline data region.
    pub data: usize,
}

/// Returns the frozen byte offsets of the ring header fields and data region.
///
/// `#[repr(C)]` lays out the three `u32` header fields contiguously at 0, 4, 8
/// and the `[u8; N]` data region begins at 12 (the struct's alignment is 4, so
/// no padding is inserted before `data`).
pub const fn header_offsets() -> HeaderOffsets {
    HeaderOffsets {
        write: 0,
        read: 4,
        capacity: 8,
        data: 12,
    }
}

/// A wait-free SPSC byte ring with a frozen `#[repr(C)]` layout.
///
/// `N` is the data capacity in bytes and MUST be a power of two; this is
/// checked at construction. Monotonic `u32` indices are masked by `N - 1`, so
/// the usable payload of a single frame is `N - LEN_PREFIX` bytes (one slot is
/// effectively reserved by the length prefix that must also fit).
#[repr(C)]
pub struct ByteRing<const N: usize> {
    /// Producer-owned write index (monotonic, masked by `N - 1` on access).
    write: AtomicU32,
    /// Consumer-owned read index (monotonic, masked by `N - 1` on access).
    read: AtomicU32,
    /// Constant data capacity in bytes, mirrored into the buffer for JS.
    capacity: u32,
    /// Inline data region. Under `--cfg loom` it is wrapped in loom's tracked cell
    /// so the model checker observes the producer/consumer byte accesses; the
    /// production type is the bare array (the frozen `#[repr(C)]` SAB layout).
    #[cfg(not(loom))]
    data: [u8; N],
    #[cfg(loom)]
    data: loom::cell::UnsafeCell<[u8; N]>,
}

// SAFETY (loom build only): the SPSC contract (one producer owns `write`, one
// consumer owns `read`, synchronized by the Acquire/Release pairing) is exactly
// what loom is asked to verify; loom's `UnsafeCell` is `!Sync`, so we assert it for
// the model. Production is auto-`Sync` (bare array + atomics) and untouched.
#[cfg(loom)]
unsafe impl<const N: usize> Sync for ByteRing<N> {}

impl<const N: usize> Default for ByteRing<N> {
    fn default() -> Self {
        Self::new()
    }
}

impl<const N: usize> ByteRing<N> {
    /// Creates an empty ring.
    ///
    /// # Panics
    /// Panics if `N` is not a power of two, is zero, or does not fit in a
    /// `u32`. These are programming errors fixed at compile-time-chosen `N`.
    pub fn new() -> Self {
        assert!(N.is_power_of_two(), "capacity N must be a power of two");
        assert!(N <= u32::MAX as usize, "capacity N must fit in u32");
        Self {
            write: AtomicU32::new(0),
            read: AtomicU32::new(0),
            capacity: N as u32,
            #[cfg(not(loom))]
            data: [0u8; N],
            #[cfg(loom)]
            data: loom::cell::UnsafeCell::new([0u8; N]),
        }
    }

    /// Number of bytes currently occupied (length prefixes included).
    #[inline]
    fn used(&self, write: u32, read: u32) -> usize {
        write.wrapping_sub(read) as usize
    }

    /// Copies `src` into the data region starting at masked index `at`,
    /// wrapping around the end of the buffer.
    #[inline]
    fn write_wrapping(&self, at: u32, src: &[u8]) {
        let mask = (N - 1) as u32;
        let start = (at & mask) as usize;
        let first = core::cmp::min(src.len(), N - start);
        // SAFETY: producer is the sole writer of these bytes; the consumer
        // cannot read them until `write` is published with a Release store.
        #[cfg(not(loom))]
        {
            let cell = self.data.as_ptr() as *mut u8;
            unsafe {
                core::ptr::copy_nonoverlapping(src.as_ptr(), cell.add(start), first);
                if first < src.len() {
                    core::ptr::copy_nonoverlapping(
                        src.as_ptr().add(first),
                        cell,
                        src.len() - first,
                    );
                }
            }
        }
        #[cfg(loom)]
        self.data.with_mut(|p| {
            let cell = p as *mut u8;
            unsafe {
                core::ptr::copy_nonoverlapping(src.as_ptr(), cell.add(start), first);
                if first < src.len() {
                    core::ptr::copy_nonoverlapping(
                        src.as_ptr().add(first),
                        cell,
                        src.len() - first,
                    );
                }
            }
        });
    }

    /// Copies `len` bytes out of the data region starting at masked index `at`,
    /// wrapping around the end of the buffer, into `dst`.
    #[inline]
    fn read_wrapping(&self, at: u32, dst: &mut [u8]) {
        let mask = (N - 1) as u32;
        let start = (at & mask) as usize;
        let first = core::cmp::min(dst.len(), N - start);
        // SAFETY: these bytes were published by the producer's Release store on
        // `write`, observed via this consumer's Acquire load; they are stable
        // until the consumer advances `read`.
        #[cfg(not(loom))]
        {
            let cell = self.data.as_ptr();
            unsafe {
                core::ptr::copy_nonoverlapping(cell.add(start), dst.as_mut_ptr(), first);
                if first < dst.len() {
                    core::ptr::copy_nonoverlapping(
                        cell,
                        dst.as_mut_ptr().add(first),
                        dst.len() - first,
                    );
                }
            }
        }
        #[cfg(loom)]
        self.data.with(|p| {
            let cell = p as *const u8;
            unsafe {
                core::ptr::copy_nonoverlapping(cell.add(start), dst.as_mut_ptr(), first);
                if first < dst.len() {
                    core::ptr::copy_nonoverlapping(
                        cell,
                        dst.as_mut_ptr().add(first),
                        dst.len() - first,
                    );
                }
            }
        });
    }

    /// Pushes one length-prefixed frame. Single producer only.
    ///
    /// Returns `false` (rejecting the whole frame) if `bytes` is larger than
    /// `N - LEN_PREFIX` or if there is insufficient free space right now. The
    /// frame is published atomically: a reader never sees a partial frame.
    pub fn push(&self, bytes: &[u8]) -> bool {
        let frame = LEN_PREFIX + bytes.len();
        if frame > N - LEN_PREFIX {
            return false;
        }
        // Only the producer mutates `write`, so Relaxed is fine for our own
        // copy; `read` must be Acquired to see the consumer's freed space.
        let write = self.write.load(Ordering::Relaxed);
        let read = self.read.load(Ordering::Acquire);
        let free = N - self.used(write, read);
        if frame > free {
            return false;
        }
        let len = bytes.len() as u32;
        self.write_wrapping(write, &len.to_le_bytes());
        self.write_wrapping(write.wrapping_add(LEN_PREFIX as u32), bytes);
        // Publish: the Release store makes all the above byte writes visible to
        // a consumer that Acquire-loads this same `write` value.
        self.write
            .store(write.wrapping_add(frame as u32), Ordering::Release);
        true
    }

    /// Pops one length-prefixed frame into `out`. Single consumer only.
    ///
    /// Returns `None` if the ring is empty. Returns `Some(len)` with the frame
    /// length on success. If `out` is too small to hold the frame, the frame is
    /// left in place and `Some(len)` is still returned so the caller can resize
    /// and retry; in that case `out` is not written.
    pub fn pop(&self, out: &mut [u8]) -> Option<usize> {
        let read = self.read.load(Ordering::Relaxed);
        // Acquire to observe bytes published by the producer's Release store.
        let write = self.write.load(Ordering::Acquire);
        if read == write {
            return None;
        }
        let mut len_buf = [0u8; LEN_PREFIX];
        self.read_wrapping(read, &mut len_buf);
        let len = u32::from_le_bytes(len_buf) as usize;
        if out.len() < len {
            // Caller's buffer too small; leave the frame queued.
            return Some(len);
        }
        self.read_wrapping(read.wrapping_add(LEN_PREFIX as u32), &mut out[..len]);
        // Free the slot: Release so the producer (Acquire-loading `read`) sees
        // the space as available only after we have copied the bytes out.
        self.read.store(
            read.wrapping_add((LEN_PREFIX + len) as u32),
            Ordering::Release,
        );
        Some(len)
    }

    /// Returns `true` if no frames are queued (best-effort snapshot).
    #[inline]
    pub fn is_empty(&self) -> bool {
        self.read.load(Ordering::Relaxed) == self.write.load(Ordering::Acquire)
    }

    /// Data capacity in bytes (`N`).
    #[inline]
    pub const fn capacity(&self) -> usize {
        N
    }
}

/// Worker -> worklet MIDI byte stream (variable-length runs of MIDI bytes).
pub type MidiRing = ByteRing<4096>;

/// UI -> engine command stream (`ojproto`-style command bytes).
pub type CmdRing = ByteRing<8192>;

#[cfg(test)]
mod tests {
    use super::*;
    use core::mem::offset_of;

    #[test]
    fn repr_c_offsets_are_frozen() {
        type R = ByteRing<64>;
        assert_eq!(offset_of!(R, write), 0);
        assert_eq!(offset_of!(R, read), 4);
        assert_eq!(offset_of!(R, capacity), 8);
        assert_eq!(offset_of!(R, data), 12);
        let o = header_offsets();
        assert_eq!(o.write, offset_of!(R, write));
        assert_eq!(o.read, offset_of!(R, read));
        assert_eq!(o.capacity, offset_of!(R, capacity));
        assert_eq!(o.data, offset_of!(R, data));
    }

    #[test]
    fn capacity_mirrored_into_struct() {
        let r = ByteRing::<128>::new();
        assert_eq!(r.capacity(), 128);
        assert_eq!(r.capacity, 128u32);
    }

    #[test]
    fn byte_roundtrip() {
        let r = ByteRing::<64>::new();
        assert!(r.push(&[1, 2, 3, 4, 5]));
        let mut out = [0u8; 16];
        assert_eq!(r.pop(&mut out), Some(5));
        assert_eq!(&out[..5], &[1, 2, 3, 4, 5]);
        assert!(r.is_empty());
    }

    #[test]
    fn empty_pop_returns_none() {
        let r = ByteRing::<32>::new();
        let mut out = [0u8; 8];
        assert_eq!(r.pop(&mut out), None);
    }

    #[test]
    fn full_push_rejects() {
        let r = ByteRing::<16>::new();
        // Max payload is N - 2*LEN_PREFIX = 16 - 8 = 8 once the prefix fits in
        // free space; a 9-byte payload (13-byte frame) must be rejected.
        assert!(!r.push(&[0u8; 9]));
        // An 8-byte payload (12-byte frame) fits.
        assert!(r.push(&[0u8; 8]));
        // Now full: any further frame is rejected.
        assert!(!r.push(&[0u8; 1]));
    }

    #[test]
    fn oversized_frame_rejected_when_empty() {
        let r = ByteRing::<16>::new();
        // payload larger than N - LEN_PREFIX is always rejected.
        assert!(!r.push(&[0u8; 13]));
    }

    #[test]
    fn wraparound_across_capacity_boundary() {
        let r = ByteRing::<16>::new();
        let mut out = [0u8; 16];
        // Drive write/read indices around the buffer many times with frames
        // whose total size does not evenly divide N, forcing split copies.
        for i in 0..1000u32 {
            let payload = [(i & 0xff) as u8, ((i >> 8) & 0xff) as u8, 0xAB];
            assert!(
                r.push(&payload),
                "push {i} should fit (ring is drained each iter)"
            );
            let n = r.pop(&mut out).expect("frame present");
            assert_eq!(n, 3);
            assert_eq!(&out[..3], &payload);
        }
        assert!(r.is_empty());
    }

    #[test]
    fn multiple_queued_frames_fifo() {
        let r = ByteRing::<64>::new();
        assert!(r.push(b"abc"));
        assert!(r.push(b"de"));
        assert!(r.push(b"fghi"));
        let mut out = [0u8; 8];
        assert_eq!(r.pop(&mut out), Some(3));
        assert_eq!(&out[..3], b"abc");
        assert_eq!(r.pop(&mut out), Some(2));
        assert_eq!(&out[..2], b"de");
        assert_eq!(r.pop(&mut out), Some(4));
        assert_eq!(&out[..4], b"fghi");
        assert_eq!(r.pop(&mut out), None);
    }

    #[test]
    fn empty_payload_roundtrip() {
        let r = ByteRing::<32>::new();
        assert!(r.push(&[]));
        let mut out = [0u8; 4];
        assert_eq!(r.pop(&mut out), Some(0));
    }

    #[test]
    fn small_out_buffer_leaves_frame_queued() {
        let r = ByteRing::<32>::new();
        assert!(r.push(&[7, 8, 9, 10]));
        let mut tiny = [0u8; 2];
        // Report the needed size without consuming.
        assert_eq!(r.pop(&mut tiny), Some(4));
        let mut ok = [0u8; 4];
        assert_eq!(r.pop(&mut ok), Some(4));
        assert_eq!(&ok, &[7, 8, 9, 10]);
    }

    #[test]
    fn producer_consumer_interleave_sanity() {
        use std::sync::atomic::{AtomicBool, Ordering as O};
        use std::sync::Arc;
        use std::thread;

        let ring: Arc<ByteRing<256>> = Arc::new(ByteRing::new());
        let done = Arc::new(AtomicBool::new(false));
        const COUNT: u32 = 50_000;

        let prod_ring = Arc::clone(&ring);
        let prod_done = Arc::clone(&done);
        let producer = thread::spawn(move || {
            let mut sent = 0u32;
            while sent < COUNT {
                // Frame = 4-byte counter payload; retry until space frees up.
                let payload = sent.to_le_bytes();
                if prod_ring.push(&payload) {
                    sent += 1;
                } else {
                    std::thread::yield_now();
                }
            }
            prod_done.store(true, O::Release);
        });

        let cons_ring = Arc::clone(&ring);
        let consumer = thread::spawn(move || {
            let mut expect = 0u32;
            let mut out = [0u8; 8];
            loop {
                match cons_ring.pop(&mut out) {
                    Some(n) => {
                        assert_eq!(n, 4);
                        let got = u32::from_le_bytes([out[0], out[1], out[2], out[3]]);
                        assert_eq!(got, expect, "FIFO order / no corruption");
                        expect += 1;
                    }
                    None => {
                        if done.load(O::Acquire) && cons_ring.is_empty() {
                            break;
                        }
                        std::thread::yield_now();
                    }
                }
            }
            expect
        });

        producer.join().unwrap();
        let received = consumer.join().unwrap();
        assert_eq!(received, COUNT);
    }
}
