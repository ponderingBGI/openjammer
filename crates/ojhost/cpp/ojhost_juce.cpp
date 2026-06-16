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

#include <cstring>
#include <memory>
#include <string>
#include <vector>

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

AudioPluginFormat* formatFor(AudioPluginFormatManager& mgr, OjPluginFormat fmt) {
    const char* wanted = nullptr;
    switch (fmt) {
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
        if (desc.pluginFormatName.equalsIgnoreCase("VST3")) d.format = OJ_FORMAT_VST3;
        else if (desc.pluginFormatName.equalsIgnoreCase("CLAP")) d.format = OJ_FORMAT_CLAP;
        else d.format = OJ_FORMAT_AU;
        d.is_instrument = desc.isInstrument ? 1 : 0;
        d.audio_in = static_cast<uint16_t>(jmax(0, desc.numInputChannels));
        d.audio_out = static_cast<uint16_t>(jmax(0, desc.numOutputChannels));
        d.param_count = 0;       // refined on load
        d.latency_samples = 0;   // refined on prepare
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
    plugin->midi.ensureSize(256);
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

void ojhost_unload(OjPlugin* plugin) {
    delete plugin;
}

} // extern "C"
