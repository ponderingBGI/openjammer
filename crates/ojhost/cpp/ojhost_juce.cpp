/*
 * ojhost_juce.cpp — implementation of the `extern "C"` ABI in ojhost_juce.h,
 * built on JUCE 8's audio plugin hosting classes. Confines ALL of OpenJammer's
 * C++ to this single translation unit.
 *
 * This file is compiled ONLY when the crate's `juce` feature is on (build.rs
 * drives CMake + JUCE FetchContent). It is written against the stable JUCE 8
 * hosting API but is NOT compiled/verified in the scaffold sandbox (no CMake /
 * no JUCE checkout there); see crates/ojhost/README.md for the build steps and
 * the few remaining founder actions (VST3 SDK, plugin dirs).
 *
 * Real-time contract: only `ojhost_process` / `ojhost_set_param` /
 * `ojhost_note_*` may run on the audio thread, and they avoid allocation —
 * `ojhost_prepare` sizes the `AudioBuffer`, the channel-pointer arrays, and the
 * MidiBuffer up front; the hot path only fills and processes them.
 */
#include "ojhost_juce.h"

#include <juce_audio_processors/juce_audio_processors.h>
#include <juce_audio_basics/juce_audio_basics.h>

#include <cstdlib>
#include <cstring>
#include <memory>
#include <string>
#include <vector>

// Per-OS crash-fault boundary for the foreign `processBlock` call (see
// `ojhost_process_guarded`). Windows uses SEH (`__try`/`__except`, in <excpt.h>
// via <windows.h>); POSIX uses a `sigsetjmp` target + chained signal handlers.
#if defined(_WIN32)
#include <windows.h>
#else
#include <csetjmp>
#include <csignal>
#include <mutex>
#endif

// DEV/TEST ONLY: the in-guard fault injector needs a lock-free cross-thread flag.
#if defined(OJHOST_FAULT_INJECT)
#include <atomic>
#endif

using namespace juce;

namespace {

// Duplicate a std::string into a C string the caller frees via ojhost_free_scan.
char* dupString(const String& s) {
    auto utf8 = s.toStdString();
    char* out = static_cast<char*>(std::malloc(utf8.size() + 1));
    if (out != nullptr) {
        std::memcpy(out, utf8.c_str(), utf8.size() + 1);
    }
    return out;
}

OjHostedParam* copyParams(AudioPluginInstance& inst) {
    auto& params = inst.getParameters();
    if (params.isEmpty()) return nullptr;
    auto* out = static_cast<OjHostedParam*>(std::calloc(static_cast<size_t>(params.size()), sizeof(OjHostedParam)));
    if (out == nullptr) return nullptr;
    for (int i = 0; i < params.size(); ++i) {
        auto* p = params[i];
        out[i].id = static_cast<uint32_t>(i);
        out[i].name = dupString(p != nullptr ? p->getName(96) : String("param") + String(i));
        out[i].min = 0.0;
        out[i].max = 1.0;
        out[i].default_value = p != nullptr ? static_cast<double>(p->getDefaultValue()) : 0.0;
    }
    return out;
}

AudioPluginFormat* formatFor(AudioPluginFormatManager& mgr, OjPluginFormat fmt) {
    const char* wanted = nullptr;
    switch (fmt) {
        case OJ_FORMAT_VST2: wanted = "VST"; break;
        case OJ_FORMAT_VST3: wanted = "VST3"; break;
        case OJ_FORMAT_CLAP: wanted = "CLAP"; break;
        case OJ_FORMAT_AU:   wanted = "AudioUnit"; break;
    }
    if (wanted == nullptr) return nullptr;
    for (auto* f : mgr.getFormats()) {
        if (f->getName().equalsIgnoreCase(wanted)) return f;
    }
    return nullptr;
}

} // namespace

// ---------------------------------------------------------------------------
// Host context: owns the format manager (VST3 + CLAP, + AU on macOS).
// ---------------------------------------------------------------------------
struct OjHost {
    ScopedJuceInitialiser_GUI gui;
    AudioPluginFormatManager formats;
    String lastError;

    OjHost() {
        // Register the formats we host. CLAP support requires the JUCE CLAP
        // hosting extension (see CMakeLists.txt). AU only exists on macOS.
        formats.addDefaultFormats();
    }
};

// ---------------------------------------------------------------------------
// A loaded plugin instance + its pre-allocated RT scratch.
// ---------------------------------------------------------------------------
struct OjPlugin {
    std::unique_ptr<AudioPluginInstance> instance;
    AudioBuffer<float> buffer;     // sized in ojhost_prepare
    MidiBuffer midi;               // sized in ojhost_prepare
    std::vector<float*> channelPtrs;
    int maxBlock = 0;
    int preparedChannels = 0;
};

struct OjPluginEditor {
    OjHost* host = nullptr;
    OjPlugin* plugin = nullptr;
    std::unique_ptr<AudioProcessorEditor> editor;
};

extern "C" {

OjHost* ojhost_create(void) {
    return new (std::nothrow) OjHost();
}

void ojhost_destroy(OjHost* host) {
    delete host;
}

OjScanResult ojhost_scan(OjHost* host, const char* const* dirs, size_t dir_count) {
    OjScanResult result{nullptr, 0};
    if (host == nullptr) return result;

    KnownPluginList knownList;
    std::vector<OjPluginDesc> found;

    for (auto* fmt : host->formats.getFormats()) {
        StringArray searchPaths;
        for (size_t i = 0; i < dir_count; ++i) {
            if (dirs[i] != nullptr) searchPaths.add(String::fromUTF8(dirs[i]));
        }
        FileSearchPath path;
        for (const auto& p : searchPaths) path.add(File(p));

        // PluginDirectoryScanner blacklists a plugin that crashes mid-scan via
        // the deadMansPedalFile, giving crash recovery without full OOP.
        File deadMansPedal = File::getSpecialLocation(File::tempDirectory)
                                 .getChildFile("ojhost_dead_mans_pedal.txt");
        PluginDirectoryScanner scanner(knownList, *fmt, path,
                                       /*recursive*/ true, deadMansPedal,
                                       /*allowAsync*/ false);
        String nameOfPluginBeingScanned;
        while (scanner.scanNextFile(/*dontRescanIfAlreadyInList*/ true,
                                    nameOfPluginBeingScanned)) {
            // keep going
        }
    }

    for (const auto& desc : knownList.getTypes()) {
        OjPluginDesc d{};
        d.uid = dupString(desc.createIdentifierString());
        d.name = dupString(desc.name);
        d.vendor = dupString(desc.manufacturerName);
        d.path = dupString(desc.fileOrIdentifier);
        if (desc.pluginFormatName.equalsIgnoreCase("VST") ||
            desc.pluginFormatName.equalsIgnoreCase("VST2")) d.format = OJ_FORMAT_VST2;
        else if (desc.pluginFormatName.equalsIgnoreCase("VST3")) d.format = OJ_FORMAT_VST3;
        else if (desc.pluginFormatName.equalsIgnoreCase("CLAP")) d.format = OJ_FORMAT_CLAP;
        else d.format = OJ_FORMAT_AU;
        d.is_instrument = desc.isInstrument ? 1 : 0;
        d.audio_in = static_cast<uint16_t>(jmax(0, desc.numInputChannels));
        d.audio_out = static_cast<uint16_t>(jmax(0, desc.numOutputChannels));
        d.param_count = 0;
        d.params = nullptr;
        d.latency_samples = 0;
        String loadError;
        auto inst = host->formats.createPluginInstance(desc, 44100.0, 512, loadError);
        if (inst != nullptr) {
            d.param_count = static_cast<uint32_t>(inst->getParameters().size());
            d.params = copyParams(*inst);
            d.latency_samples = static_cast<uint32_t>(jmax(0, inst->getLatencySamples()));
        }
        found.push_back(d);
    }

    if (!found.empty()) {
        result.items = static_cast<OjPluginDesc*>(std::malloc(sizeof(OjPluginDesc) * found.size()));
        if (result.items != nullptr) {
            std::memcpy(result.items, found.data(), sizeof(OjPluginDesc) * found.size());
            result.count = found.size();
        }
    }
    return result;
}

void ojhost_free_scan(OjScanResult result) {
    for (size_t i = 0; i < result.count; ++i) {
        std::free(const_cast<char*>(result.items[i].uid));
        std::free(const_cast<char*>(result.items[i].name));
        std::free(const_cast<char*>(result.items[i].vendor));
        std::free(const_cast<char*>(result.items[i].path));
        if (result.items[i].params != nullptr) {
            for (uint32_t p = 0; p < result.items[i].param_count; ++p) {
                std::free(const_cast<char*>(result.items[i].params[p].name));
            }
            std::free(const_cast<OjHostedParam*>(result.items[i].params));
        }
    }
    std::free(result.items);
}

OjPlugin* ojhost_load(OjHost* host, const char* path, const char* uid,
                      OjPluginFormat format, const char** err) {
    if (host == nullptr) { if (err) *err = "null host"; return nullptr; }

    AudioPluginFormat* fmt = formatFor(host->formats, format);
    if (fmt == nullptr) { if (err) *err = "format not compiled in"; return nullptr; }

    // Re-derive the PluginDescription by re-identifying the file/id; JUCE's
    // findAllTypesForFile fills name/uid/io counts.
    OwnedArray<PluginDescription> types;
    fmt->findAllTypesForFile(types, String::fromUTF8(path));
    PluginDescription* chosen = nullptr;
    const String wantedUid = String::fromUTF8(uid);
    for (auto* t : types) {
        if (t->createIdentifierString() == wantedUid) { chosen = t; break; }
    }
    if (chosen == nullptr && types.size() == 1) chosen = types[0];
    if (chosen == nullptr) { if (err) *err = "plugin uid not found at path"; return nullptr; }

    String loadError;
    auto inst = host->formats.createPluginInstance(*chosen, 48000.0, 512, loadError);
    if (inst == nullptr) {
        host->lastError = loadError;
        if (err) *err = host->lastError.toRawUTF8();
        return nullptr;
    }

    auto* p = new (std::nothrow) OjPlugin();
    if (p == nullptr) { if (err) *err = "out of memory"; return nullptr; }
    p->instance = std::move(inst);
    return p;
}

void ojhost_prepare(OjPlugin* plugin, double sample_rate, int32_t max_block) {
    if (plugin == nullptr || plugin->instance == nullptr) return;
    plugin->maxBlock = max_block;
    const int channels = jmax(plugin->instance->getTotalNumInputChannels(),
                              plugin->instance->getTotalNumOutputChannels());
    plugin->preparedChannels = jmax(1, channels);
    plugin->buffer.setSize(plugin->preparedChannels, max_block, false, true, false);
    plugin->channelPtrs.assign(static_cast<size_t>(plugin->preparedChannels), nullptr);
    // Pre-size MIDI storage generously so note delivery in `ojhost_note_*` does
    // not grow the buffer in normal live use. The Rust/JUCE boundary never
    // allocates channel scratch after this point.
    plugin->midi.ensureSize(4096);
    plugin->instance->setRateAndBufferSizeDetails(sample_rate, max_block);
    plugin->instance->prepareToPlay(sample_rate, max_block);
}

void ojhost_process(OjPlugin* plugin,
                    const float* const* inputs, int32_t in_channels,
                    float* const* outputs, int32_t out_channels,
                    int32_t nframes) {
    if (plugin == nullptr || plugin->instance == nullptr) return;
    const int n = jmin(nframes, plugin->maxBlock);
    const int chans = plugin->preparedChannels;

    // Copy inputs into the pre-sized buffer (no allocation).
    for (int ch = 0; ch < chans; ++ch) {
        float* dst = plugin->buffer.getWritePointer(ch);
        if (ch < in_channels && inputs[ch] != nullptr) {
            std::memcpy(dst, inputs[ch], sizeof(float) * static_cast<size_t>(n));
        } else {
            std::memset(dst, 0, sizeof(float) * static_cast<size_t>(n));
        }
    }
    plugin->buffer.setSize(chans, n, true, false, true); // keep contents, no realloc within capacity

    plugin->instance->processBlock(plugin->buffer, plugin->midi);
    plugin->midi.clear();

    // Copy results back out.
    for (int ch = 0; ch < out_channels; ++ch) {
        if (outputs[ch] == nullptr) continue;
        if (ch < chans) {
            std::memcpy(outputs[ch], plugin->buffer.getReadPointer(ch),
                        sizeof(float) * static_cast<size_t>(n));
        } else {
            std::memset(outputs[ch], 0, sizeof(float) * static_cast<size_t>(n));
        }
    }
    // Restore full block capacity for next call.
    plugin->buffer.setSize(chans, plugin->maxBlock, true, false, true);
}

// ---------------------------------------------------------------------------
// Crash-fault boundary (Phase A: in-process guard + latch).
//
// The single foreign call — `instance->processBlock(...)` — is wrapped so a
// plugin segfault becomes a RETURN VALUE, not a process crash. We LATCH-and-
// QUARANTINE: on a fault the output is silenced and the Rust `PluginHostNode`
// flips to a dry passthrough and never calls us again this session. We do NOT
// resume the plugin — a fault mid-`malloc` may leave the CRT/arena heap lock
// held, so re-entering (or allocating from a faulted thread) could deadlock; the
// audio thread allocates nothing after the latch, and a clean instance comes back
// only via a fresh off-RT `instantiate`. Full malice/stack-overflow containment
// is the future out-of-process worker; Phase-A POSIX limits (macOS Mach
// exceptions; a held global lock) are documented here, not silently ignored.
// ---------------------------------------------------------------------------
namespace {

#if defined(OJHOST_FAULT_INJECT)
// DEV/TEST ONLY: a process-global one-shot arm shared by every hosted instance in
// this process. When > 0, the NEXT guarded processBlock (whichever hosted node is
// scheduled first) performs a deliberate null write so the SEH/signal boundary
// below can be PROVEN to catch a real access violation on a live machine — that
// node faults, the Rust latch flips it to a dry passthrough + crash badge, and
// every sibling node keeps playing. Decremented atomically so exactly one block
// faults per arm. Compiled ONLY with `--features juce,fault-inject`; absent from
// any shipped build. Read inside the guard so the fault is caught, not fatal.
std::atomic<int> ojFaultArm{0};
void ojMaybeInjectFault() {
    int armed = ojFaultArm.load(std::memory_order_relaxed);
    while (armed > 0) {
        if (ojFaultArm.compare_exchange_weak(armed, armed - 1,
                                             std::memory_order_relaxed)) {
            // A VOLATILE pointer (not pointer-to-volatile): each read re-loads, so
            // the optimizer can't prove it's null and -Wnull-dereference (under
            // JUCE's -Werror) won't reject this deliberate access violation.
            int* volatile boom = nullptr;
            *boom = 0xC0FFEE; // deliberate fault, INSIDE the guard
            return;
        }
    }
}
#endif

#if defined(_WIN32)

// MSVC SEH must live in a LEAF function with no C++ objects requiring unwinding.
// This one only derefs a pointer and calls a method (the AudioBuffer / MidiBuffer
// are POD members built in ojhost_prepare), so it qualifies — no `/EHa` needed.
static int ojGuardedProcessBlock(OjPlugin* plugin) {
    __try {
#if defined(OJHOST_FAULT_INJECT)
        ojMaybeInjectFault(); // dev/test: prove __except catches a real fault
#endif
        plugin->instance->processBlock(plugin->buffer, plugin->midi);
        return 0;
    } __except (EXCEPTION_EXECUTE_HANDLER) {
        return 1;
    }
}

#else

// POSIX: a thread-local longjmp target + process-global SIGSEGV/SIGILL/SIGFPE/
// SIGBUS handlers that jump back ONLY when a fault happens inside our guard;
// otherwise they chain to the previously-installed handler so a real crash
// elsewhere is never swallowed.
static thread_local sigjmp_buf ojFaultJmp;
static thread_local volatile sig_atomic_t ojInGuard = 0;
static struct sigaction ojPrev[4]; // [SEGV, ILL, FPE, BUS]

static int ojSigIndex(int sig) {
    switch (sig) {
        case SIGSEGV: return 0;
        case SIGILL:  return 1;
        case SIGFPE:  return 2;
        case SIGBUS:  return 3;
        default:      return -1;
    }
}

static void ojFaultHandler(int sig, siginfo_t* info, void* uc) {
    if (ojInGuard) {
        ojInGuard = 0;
        siglongjmp(ojFaultJmp, 1); // back into ojGuardedProcessBlock
    }
    // Not in our guard -> a genuine fault elsewhere: chain to the prior handler.
    const int idx = ojSigIndex(sig);
    if (idx < 0) { signal(sig, SIG_DFL); raise(sig); return; }
    const struct sigaction& prev = ojPrev[idx];
    if ((prev.sa_flags & SA_SIGINFO) != 0) {
        if (prev.sa_sigaction != nullptr) prev.sa_sigaction(sig, info, uc);
    } else if (prev.sa_handler == SIG_IGN) {
        // ignored upstream — leave it
    } else if (prev.sa_handler == SIG_DFL) {
        signal(sig, SIG_DFL);
        raise(sig);
    } else {
        prev.sa_handler(sig);
    }
}

static void ojInstallHandlersOnce() {
    static std::once_flag once;
    std::call_once(once, []() {
        struct sigaction sa;
        std::memset(&sa, 0, sizeof(sa));
        sa.sa_sigaction = ojFaultHandler;
        // SA_ONSTACK: run on the alt stack (survive a stack-overflow SIGSEGV).
        // SA_NODEFER: allow re-entry so the handler can siglongjmp cleanly.
        sa.sa_flags = SA_SIGINFO | SA_ONSTACK | SA_NODEFER;
        sigemptyset(&sa.sa_mask);
        sigaction(SIGSEGV, &sa, &ojPrev[0]);
        sigaction(SIGILL,  &sa, &ojPrev[1]);
        sigaction(SIGFPE,  &sa, &ojPrev[2]);
        sigaction(SIGBUS,  &sa, &ojPrev[3]);
    });
}

// A per-thread alternate signal stack so a stack-overflow fault on the audio
// thread (which cpal, not us, created) can still be caught. Installed lazily on
// the first guarded call on that thread.
static void ojInstallAltStackOnce() {
    static thread_local bool installed = false;
    static thread_local char altStack[64 * 1024];
    if (installed) return;
    stack_t ss;
    std::memset(&ss, 0, sizeof(ss));
    ss.ss_sp = altStack;
    ss.ss_size = sizeof(altStack);
    ss.ss_flags = 0;
    sigaltstack(&ss, nullptr);
    installed = true;
}

static int ojGuardedProcessBlock(OjPlugin* plugin) {
    ojInstallHandlersOnce();
    ojInstallAltStackOnce();
    if (sigsetjmp(ojFaultJmp, 1) == 0) {
        ojInGuard = 1;
#if defined(OJHOST_FAULT_INJECT)
        ojMaybeInjectFault(); // dev/test: prove the signal guard catches a real fault
#endif
        plugin->instance->processBlock(plugin->buffer, plugin->midi);
        ojInGuard = 0;
        return 0;
    }
    ojInGuard = 0;
    return 1; // returned via siglongjmp: a fault was caught
}

#endif

} // namespace

int32_t ojhost_process_guarded(OjPlugin* plugin,
                               const float* const* inputs, int32_t in_channels,
                               float* const* outputs, int32_t out_channels,
                               int32_t nframes) {
    if (plugin == nullptr || plugin->instance == nullptr) return OJ_PROCESS_OK;
    const int n = jmin(nframes, plugin->maxBlock);
    const int chans = plugin->preparedChannels;

    // Copy inputs into the pre-sized buffer (no allocation) — same as
    // ojhost_process. This is OUTSIDE the guarded leaf (it can't fault).
    for (int ch = 0; ch < chans; ++ch) {
        float* dst = plugin->buffer.getWritePointer(ch);
        if (ch < in_channels && inputs[ch] != nullptr) {
            std::memcpy(dst, inputs[ch], sizeof(float) * static_cast<size_t>(n));
        } else {
            std::memset(dst, 0, sizeof(float) * static_cast<size_t>(n));
        }
    }
    plugin->buffer.setSize(chans, n, true, false, true);

    // The ONLY line that can crash a third-party plugin, behind the fault boundary.
    const int faulted = ojGuardedProcessBlock(plugin);

    if (faulted != 0) {
        // Quarantine transition: silence every output for this block; the Rust
        // latch holds a dry passthrough from here and never calls us again.
        for (int ch = 0; ch < out_channels; ++ch) {
            if (outputs[ch] != nullptr) {
                std::memset(outputs[ch], 0, sizeof(float) * static_cast<size_t>(n));
            }
        }
        plugin->buffer.setSize(chans, plugin->maxBlock, true, false, true);
        return OJ_PROCESS_FAULT;
    }

    plugin->midi.clear();
    for (int ch = 0; ch < out_channels; ++ch) {
        if (outputs[ch] == nullptr) continue;
        if (ch < chans) {
            std::memcpy(outputs[ch], plugin->buffer.getReadPointer(ch),
                        sizeof(float) * static_cast<size_t>(n));
        } else {
            std::memset(outputs[ch], 0, sizeof(float) * static_cast<size_t>(n));
        }
    }
    plugin->buffer.setSize(chans, plugin->maxBlock, true, false, true);
    return OJ_PROCESS_OK;
}

#if defined(OJHOST_FAULT_INJECT)
// DEV/TEST ONLY: arm a one-shot fault in the next guarded processBlock. Control
// thread sets the process-global counter; the audio thread reads + consumes it
// inside the guard (see `ojMaybeInjectFault`). Lock-free; never present in a
// shipped build. Reachable from the dev webview console via the Tauri command
// `debug_arm_plugin_fault`.
void ojhost_arm_fault(void) {
    ojFaultArm.fetch_add(1, std::memory_order_relaxed);
}
#endif

void ojhost_set_param(OjPlugin* plugin, uint32_t index, float value) {
    if (plugin == nullptr || plugin->instance == nullptr) return;
    auto& params = plugin->instance->getParameters();
    if (index < static_cast<uint32_t>(params.size())) {
        params[static_cast<int>(index)]->setValue(value);
    }
}

void ojhost_note_on(OjPlugin* plugin, uint8_t note, uint8_t velocity) {
    if (plugin == nullptr) return;
    plugin->midi.addEvent(MidiMessage::noteOn(1, (int)note, (uint8)velocity), 0);
}

void ojhost_note_off(OjPlugin* plugin, uint8_t note) {
    if (plugin == nullptr) return;
    plugin->midi.addEvent(MidiMessage::noteOff(1, (int)note), 0);
}

uint32_t ojhost_latency_samples(const OjPlugin* plugin) {
    if (plugin == nullptr || plugin->instance == nullptr) return 0;
    return static_cast<uint32_t>(jmax(0, plugin->instance->getLatencySamples()));
}

uint32_t ojhost_param_count(const OjPlugin* plugin) {
    if (plugin == nullptr || plugin->instance == nullptr) return 0;
    return static_cast<uint32_t>(plugin->instance->getParameters().size());
}

uint8_t* ojhost_get_state(OjPlugin* plugin, size_t* out_len) {
    if (out_len != nullptr) *out_len = 0;
    if (plugin == nullptr || plugin->instance == nullptr) return nullptr;
    // OFF-RT: JUCE serializes the plugin's full state (params + internal/opaque
    // state) into a MemoryBlock; copy it onto the C++ allocator so the Rust side
    // frees it via ojhost_free_state (no cross-allocator free — same rule as
    // dupString / ojhost_free_scan).
    MemoryBlock block;
    plugin->instance->getStateInformation(block);
    const size_t n = static_cast<size_t>(block.getSize());
    if (n == 0) return nullptr;
    auto* out = static_cast<uint8_t*>(std::malloc(n));
    if (out == nullptr) return nullptr;
    std::memcpy(out, block.getData(), n);
    if (out_len != nullptr) *out_len = n;
    return out;
}

void ojhost_free_state(uint8_t* data, size_t /*len*/) {
    std::free(data);
}

void ojhost_set_state(OjPlugin* plugin, const uint8_t* data, size_t len) {
    if (plugin == nullptr || plugin->instance == nullptr || data == nullptr || len == 0) return;
    plugin->instance->setStateInformation(data, static_cast<int>(len));
}

void ojhost_unload(OjPlugin* plugin) {
    delete plugin;
}

OjPluginEditor* ojhost_editor_open(const char* path, const char* uid,
                                   OjPluginFormat format, const char** err) {
    auto* host = ojhost_create();
    if (host == nullptr) { if (err) *err = "could not create host"; return nullptr; }
    auto* plugin = ojhost_load(host, path, uid, format, err);
    if (plugin == nullptr || plugin->instance == nullptr) {
        ojhost_destroy(host);
        return nullptr;
    }

    MessageManagerLock mmLock;
    if (!mmLock.lockWasGained()) {
        if (err) *err = "could not lock JUCE message manager";
        ojhost_unload(plugin);
        ojhost_destroy(host);
        return nullptr;
    }

    std::unique_ptr<AudioProcessorEditor> ed(plugin->instance->createEditorIfNeeded());
    if (ed == nullptr) {
        if (err) *err = "plugin has no native editor";
        ojhost_unload(plugin);
        ojhost_destroy(host);
        return nullptr;
    }
    if (ed->getWidth() <= 0 || ed->getHeight() <= 0) ed->setSize(640, 480);
    ed->setName(plugin->instance->getName());
    ed->addToDesktop(ComponentPeer::windowHasTitleBar |
                     ComponentPeer::windowIsResizable |
                     ComponentPeer::windowHasCloseButton);
    ed->centreWithSize(ed->getWidth(), ed->getHeight());
    ed->setVisible(true);
    ed->toFront(true);

    auto* handle = new (std::nothrow) OjPluginEditor();
    if (handle == nullptr) {
        if (err) *err = "out of memory";
        ed->removeFromDesktop();
        ojhost_unload(plugin);
        ojhost_destroy(host);
        return nullptr;
    }
    handle->host = host;
    handle->plugin = plugin;
    handle->editor = std::move(ed);
    return handle;
}

void ojhost_editor_focus(OjPluginEditor* editor) {
    if (editor == nullptr || editor->editor == nullptr) return;
    MessageManagerLock mmLock;
    if (!mmLock.lockWasGained()) return;
    editor->editor->setVisible(true);
    editor->editor->toFront(true);
    if (auto* peer = editor->editor->getPeer()) peer->grabFocus();
}

void ojhost_editor_close(OjPluginEditor* editor) {
    if (editor == nullptr) return;
    {
        MessageManagerLock mmLock;
        if (mmLock.lockWasGained() && editor->editor != nullptr) {
            editor->editor->removeFromDesktop();
            editor->editor.reset();
        }
    }
    if (editor->plugin != nullptr) ojhost_unload(editor->plugin);
    if (editor->host != nullptr) ojhost_destroy(editor->host);
    delete editor;
}

} // extern "C"
