# CMakeLists.txt — builds the bundled JUCE 8 plugin-host shim as a static
# library that the Rust crate links. Driven by `build.rs` (the `cmake` crate)
# ONLY when ojhost is built with `--features juce`.
#
# JUCE 8 is pulled via FetchContent so no system install is required. JUCE is
# used here under AGPL-3.0 (OpenJammer is AGPL-3.0). VST3 uses Steinberg's VST3
# SDK/license. VST2 is discontinued and must be owner-provisioned via
# OJHOST_VST2_SDK_DIR; this file never fetches or vendors VST2 headers.
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
option(OJHOST_WITH_CLAP "Build the JUCE CLAP hosting format" ON)
if(OJHOST_WITH_CLAP)
    FetchContent_Declare(
        clap_juce_extensions
        GIT_REPOSITORY https://github.com/free-audio/clap-juce-extensions.git
        GIT_TAG main)
    FetchContent_MakeAvailable(clap_juce_extensions)
endif()

# --- owner-provisioned SDK paths -------------------------------------------
option(OJHOST_WITH_VST2 "Build VST2 hosting; requires owner-provisioned VST2 SDK headers" OFF)
set(OJHOST_VST2_SDK_DIR "" CACHE PATH "Path to a legally obtained VST2 SDK/header checkout")
set(OJHOST_VST3_SDK_DIR "" CACHE PATH "Optional local Steinberg VST3 SDK checkout")

if(OJHOST_WITH_VST2 AND NOT OJHOST_VST2_SDK_DIR)
    message(FATAL_ERROR "OJHOST_WITH_VST2=ON requires OJHOST_VST2_SDK_DIR")
endif()

# --- the host shim static library ------------------------------------------
add_library(ojhost_juce STATIC ojhost_juce.cpp)
target_include_directories(ojhost_juce PUBLIC ${CMAKE_CURRENT_SOURCE_DIR})

# JUCE module targets we need for hosting third-party plugins.
target_link_libraries(ojhost_juce
    PRIVATE
        juce::juce_audio_processors
        juce::juce_audio_plugin_client
        juce::juce_audio_utils
        juce::juce_audio_devices
        juce::juce_audio_formats
        juce::juce_audio_basics
        juce::juce_gui_extra
        juce::juce_gui_basics
        juce::juce_events
        juce::juce_core
    PUBLIC
        juce::juce_recommended_config_flags
        juce::juce_recommended_warning_flags)

# JUCE hosting feature flags. VST3 + (macOS) AU are built in; CLAP is gated on
# the extension above. VST2 is gated on owner-provisioned SDK headers.
target_compile_definitions(ojhost_juce
    PRIVATE
        JUCE_PLUGINHOST_VST3=1
        $<$<PLATFORM_ID:Darwin>:JUCE_PLUGINHOST_AU=1>
        JUCE_MODAL_LOOPS_PERMITTED=1
        JUCE_WEB_BROWSER=0
        JUCE_USE_CURL=0
        JUCE_MODULE_AVAILABLE_juce_audio_processors=1)

if(OJHOST_VST3_SDK_DIR)
    target_include_directories(ojhost_juce PRIVATE ${OJHOST_VST3_SDK_DIR})
endif()

if(OJHOST_WITH_VST2)
    target_compile_definitions(ojhost_juce PRIVATE JUCE_PLUGINHOST_VST=1)
    # VST2 SDK layouts vary. Include the root and the common Steinberg subdirs so
    # JUCE can find aeffect.h / aeffectx.h without copying headers into the repo.
    target_include_directories(ojhost_juce PRIVATE
        ${OJHOST_VST2_SDK_DIR}
        ${OJHOST_VST2_SDK_DIR}/pluginterfaces/vst2.x
        ${OJHOST_VST2_SDK_DIR}/public.sdk/source/vst2.x
        ${OJHOST_VST2_SDK_DIR}/VST2_SDK
        ${OJHOST_VST2_SDK_DIR}/VST2_SDK/pluginterfaces/vst2.x)
endif()

if(OJHOST_WITH_CLAP)
    target_compile_definitions(ojhost_juce PRIVATE JUCE_PLUGINHOST_CLAP=1)
    target_link_libraries(ojhost_juce PRIVATE clap_juce_extensions)
endif()

# Install so the `cmake` Rust crate can find the archive in the build output dir.
install(TARGETS ojhost_juce ARCHIVE DESTINATION lib)
