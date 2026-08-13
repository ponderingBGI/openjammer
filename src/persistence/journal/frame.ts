/**
 * Length-prefixed, CRC-framed log records (Track B P1 — the durable substrate).
 *
 * The crash-durable store is a periodic full SNAPSHOT baseline plus an append-only
 * LOG of incremental updates. Each log record is framed so recovery can read the
 * LONGEST VALID PREFIX and stop at the first torn or corrupt record — the property
 * that lets an append-only log survive a crash mid-write (only the final,
 * never-acknowledged record can be damaged, and it is detected + dropped).
 *
 * Record layout (little-endian): MAGIC(4) | len(4) | crc32(payload)(4) | payload.
 */

import { crc32 } from './crc32';

const MAGIC = 0x314c4a4f; // "OJL1"
const HEADER = 12; // magic(4) + len(4) + crc(4)

/** Frame one payload into a self-describing, checksummed record. */
export function frameRecord(payload: Uint8Array): Uint8Array {
    const out = new Uint8Array(HEADER + payload.length);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, MAGIC, true);
    dv.setUint32(4, payload.length, true);
    dv.setUint32(8, crc32(payload), true);
    out.set(payload, HEADER);
    return out;
}

export interface ParsedLog {
    /** The payloads of every valid record, in order. */
    records: Uint8Array[];
    /** Byte length of the valid prefix (where a compaction would safely truncate). */
    validBytes: number;
    /** True if parsing stopped early on a torn/corrupt record (bytes were dropped). */
    truncated: boolean;
}

/**
 * Parse the longest valid prefix of framed records from `log`. Stops — WITHOUT
 * throwing — at the first record whose magic is wrong, whose payload is
 * incomplete (a torn tail), or whose CRC does not match (a flipped byte). Trailing
 * garbage after a clean crash is therefore ignored, not fatal.
 */
export function parseLog(log: Uint8Array): ParsedLog {
    const records: Uint8Array[] = [];
    const dv = new DataView(log.buffer, log.byteOffset, log.byteLength);
    let off = 0;
    while (off + HEADER <= log.length) {
        if (dv.getUint32(off, true) !== MAGIC) break; // garbage / not a record boundary
        const len = dv.getUint32(off + 4, true);
        const crc = dv.getUint32(off + 8, true);
        const start = off + HEADER;
        if (start + len > log.length) break; // torn tail: incomplete payload
        const payload = log.subarray(start, start + len);
        if (crc32(payload) !== crc) break; // corrupt record: truncate here
        records.push(payload);
        off = start + len;
    }
    return { records, validBytes: off, truncated: off < log.length };
}

/** Concatenate framed records (e.g. to seed a log from a batch of updates). */
export function concatFrames(payloads: Uint8Array[]): Uint8Array {
    const frames = payloads.map(frameRecord);
    const total = frames.reduce((n, f) => n + f.length, 0);
    const out = new Uint8Array(total);
    let off = 0;
    for (const f of frames) {
        out.set(f, off);
        off += f.length;
    }
    return out;
}
