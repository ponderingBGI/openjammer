# CMakeLists.txt — builds the bundled JUCE 8 plugin-host shim as a static
# library that the Rust crate links. Driven by `build.rs` (the `cmake` crate)
# ONLY when ojhost is built with `--features juce`.
#
# JUCE 8 is pulled via FetchContent so no system install is required. JUCE is
# used here under AGPL-3.0 (OpenJammer is AGPL-3.0). The VST3 hosting path also
# needs the Steinberg VST3 SDK (its own license); CLAP hosting is MIT.
cmake_minimum_required(VERSION 3.22)
project(ojhost_juce LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)

include(FetchContent)

# --- JUCE 8 ----------------------------------------------------------------
FetchContent_Declare(
    JUCE
    GIT_REPOSITORY https://github.com/juce-framework/JUCE.git
    GIT_TAG 8.0.4            # pin a known-good JUCE 8 release
    GIT_SHALLOW ON)
FetchContent_MakeAvailable(JUCE)

# --- CLAP hosting extension for JUCE (optional but recommended) -------------
# JUCE does not host CLAP out of the box; the community `clap-juce-extensions`
# adds a CLAP AudioPluginFormat. Enable by setting -DOJHOST_WITH_CLAP=ON.
option(OJHOST_WITH_CLAP "Build the JUCE CLAP hosting format" OFF)
if(OJHOST_WITH_CLAP)
    FetchContent_Declare(
        clap_juce_extensions
        GIT_REPOSITORY https://github.com/free-audio/clap-juce-extensions.git
        GIT_TAG main)
    FetchContent_MakeAvailable(clap_juce_extensions)
endif()

# --- the host shim static library ------------------------------------------
add_library(ojhost_juce STATIC ojhost_juce.cpp)
target_include_directories(ojhost_juce PUBLIC ${CMAKE_CURRENT_SOURCE_DIR})

# JUCE module targets we need for hosting third-party plugins.
target_link_libraries(ojhost_juce
    PRIVATE
        juce::juce_audio_processors
        juce::juce_audio_basics
        juce::juce_core
    PUBLIC
        juce::juce_recommended_config_flags
        juce::juce_recommended_warning_flags)

# JUCE hosting feature flags. VST3 + (macOS) AU are built in; CLAP is gated on
# the extension above. Set JUCE_PLUGINHOST_VST3 / _AU / the VST3 SDK path as the
# founder's environment requires (see crates/ojhost/README.md).
target_compile_definitions(ojhost_juce
    PRIVATE
        JUCE_PLUGINHOST_VST3=1
        $<$<PLATFORM_ID:Darwin>:JUCE_PLUGINHOST_AU=1>
        JUCE_MODULE_AVAILABLE_juce_audio_processors=1)

if(OJHOST_WITH_CLAP)
    target_compile_definitions(ojhost_juce PRIVATE JUCE_PLUGINHOST_CLAP=1)
    target_link_libraries(ojhost_juce PRIVATE clap_juce_extensions::clap_juce_extensions_host)
endif()

# Install so the `cmake` Rust crate can find the .a in the build output dir.
install(TARGETS ojhost_juce ARCHIVE DESTINATION lib)
