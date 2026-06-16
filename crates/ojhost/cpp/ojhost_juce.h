/*
 * ojhost_juce.h — the SMALL `extern "C"` ABI between the Rust crate and the
 * bundled JUCE 8 C++ plugin host. This is the ONLY boundary C++ crosses in
 * OpenJammer; everything above it is Rust.
 *
 * Design rules:
 *   - Plain C types only (no C++ in the signatures), so `bindgen` is optional
 *     and the Rust side can declare these by hand.
 *   - Opaque handles for the host context and a loaded plugin instance.
 *   - Scanning fills a caller-owned array of `OjPluginDesc`; strings are owned
 *     by the C++ side and freed via `ojhost_free_scan` (no cross-allocator
 *     free on the Rust side).
 *   - `ojhost_process` is the ONLY function meant to run on the audio thread.
 *     It must be real-time-safe in the C++ implementation: no allocation, no
 *     locks. All buffers it needs are sized by `ojhost_prepare`.
 *
 * Licensing note: JUCE 8 is used under AGPL-3.0 (OpenJammer is AGPL-3.0). The
 * VST3 hosting path additionally requires the Steinberg VST3 SDK (its own
 * license). CLAP is MIT. See crates/ojhost/README.md.
 */
#ifndef OJHOST_JUCE_H
#define OJHOST_JUCE_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/* Binary format tags — kept numerically in sync with Rust `PluginFormat`. */
typedef enum OjPluginFormat {
    OJ_FORMAT_VST3 = 0,
    OJ_FORMAT_CLAP = 1,
    OJ_FORMAT_AU = 2, /* macOS only; never emitted off-macOS */
} OjPluginFormat;

/* One scanned plugin. All `const char*` are NUL-terminated and owned by the
 * C++ side until `ojhost_free_scan` is called on the owning array. */
typedef struct OjPluginDesc {
    const char* uid;            /* stable per-plugin id (CLAP id / VST3 UID)  */
    const char* name;           /* display name                               */
    const char* vendor;         /* manufacturer                               */
    const char* path;           /* binary/bundle path that was scanned        */
    OjPluginFormat format;      /* which format this came from                */
    int32_t is_instrument;      /* 1 if a note consumer, else 0               */
    uint16_t audio_in;          /* main input channel count                   */
    uint16_t audio_out;         /* main output channel count                  */
    uint32_t param_count;       /* number of automatable parameters           */
    uint32_t latency_samples;   /* reported processing latency in samples     */
} OjPluginDesc;

/* Result of a scan: a heap array of descriptors owned by the C++ side. */
typedef struct OjScanResult {
    OjPluginDesc* items;
    size_t count;
} OjScanResult;

/* Opaque handles. */
typedef struct OjHost OjHost;       /* a scanning/format-manager context     */
typedef struct OjPlugin OjPlugin;   /* one loaded, processable plugin        */

/* ----------------------------------------------------------------------------
 * Lifecycle / scanning (all OFF the audio thread).
 * ------------------------------------------------------------------------- */

/* Create a host context (initializes JUCE's AudioPluginFormatManager with the
 * formats compiled in: VST3, CLAP, and AU on macOS). Returns NULL on failure. */
OjHost* ojhost_create(void);

/* Destroy a host context. */
void ojhost_destroy(OjHost* host);

/* Scan `dir_count` directories (UTF-8 paths) for plugins. The returned
 * `OjScanResult` and all its strings are owned by the C++ side; free with
 * `ojhost_free_scan`. On error returns a zeroed result (count == 0).
 *
 * The C++ implementation SHOULD scan out-of-process or with a crash blacklist
 * so a misbehaving plugin cannot kill the host; at minimum it must not throw
 * across this boundary. */
OjScanResult ojhost_scan(OjHost* host, const char* const* dirs, size_t dir_count);

/* Free a scan result returned by `ojhost_scan`. */
void ojhost_free_scan(OjScanResult result);

/* ----------------------------------------------------------------------------
 * Instance lifecycle.
 * ------------------------------------------------------------------------- */

/* Instantiate the plugin identified by (`path`, `uid`) of `format`. Returns
 * NULL on failure. `err`, if non-NULL, receives a borrowed, NUL-terminated
 * diagnostic valid until the next ojhost call on `host`. */
OjPlugin* ojhost_load(OjHost* host,
                      const char* path,
                      const char* uid,
                      OjPluginFormat format,
                      const char** err);

/* Off-RT: bind the instance to a sample rate + max block size. Allocates all
 * processing scratch so `ojhost_process` can be allocation-free. */
void ojhost_prepare(OjPlugin* plugin, double sample_rate, int32_t max_block);

/* RT-thread: render `nframes` frames. `inputs`/`outputs` are arrays of channel
 * pointers (`in_channels`/`out_channels` long), each at least `nframes` f32.
 * MUST be real-time-safe in the implementation. */
void ojhost_process(OjPlugin* plugin,
                    const float* const* inputs, int32_t in_channels,
                    float* const* outputs, int32_t out_channels,
                    int32_t nframes);

/* RT-thread: set parameter `index` to a normalized [0,1] `value`. */
void ojhost_set_param(OjPlugin* plugin, uint32_t index, float value);

/* RT-thread: note on / off (MIDI note + velocity, channel 0). */
void ojhost_note_on(OjPlugin* plugin, uint8_t note, uint8_t velocity);
void ojhost_note_off(OjPlugin* plugin, uint8_t note);

/* Current reported latency in samples (valid after `ojhost_prepare`). */
uint32_t ojhost_latency_samples(const OjPlugin* plugin);

/* Number of parameters the instance exposes. */
uint32_t ojhost_param_count(const OjPlugin* plugin);

/* Destroy a loaded plugin instance. */
void ojhost_unload(OjPlugin* plugin);

#ifdef __cplusplus
} /* extern "C" */
#endif

#endif /* OJHOST_JUCE_H */
