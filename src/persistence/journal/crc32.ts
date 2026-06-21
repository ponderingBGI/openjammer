/**
 * CRC-32 (IEEE 802.3) — a tiny, dependency-free checksum for the durable journal
 * (Track B P1). Each appended record carries a CRC so a torn / byte-flipped tail
 * is DETECTED on recovery and truncated, rather than fed to Loro as a corrupt
 * blob. Table-based + deterministic; the value is the standard reflected CRC-32.
 */

const TABLE: Uint32Array = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) {
            c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        }
        t[n] = c >>> 0;
    }
    return t;
})();

/** The reflected CRC-32 of `bytes` as an unsigned 32-bit number. */
export function crc32(bytes: Uint8Array): number {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) {
        c = TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    }
    return (c ^ 0xffffffff) >>> 0;
}
