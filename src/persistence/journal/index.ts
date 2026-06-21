/**
 * Durable journal substrate (Track B P1) — snapshot + CRC-framed append log with
 * crash-safe recovery and compaction. Substrate-agnostic logic; the OPFS (browser)
 * and fsync'd-Rust (native) backends are thin {@link JournalStore} adapters.
 */

export { crc32 } from './crc32';
export { frameRecord, parseLog, concatFrames, type ParsedLog } from './frame';
export {
    Journal,
    MemoryJournalStore,
    type JournalStore,
    type Recovered,
} from './journal';
export { LoroPersistence } from './loroPersistence';
export { OpfsJournalStore, openOpfsJournalStore, type SyncAccessHandle } from './opfsStore';
