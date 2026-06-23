//! Build script for `ojhost`.
//!
//! In the DEFAULT (scaffold) and `clap-host` builds this is a NO-OP: it pulls no
//! native toolchain and runs no CMake, so `cargo build -p ojhost` (and
//! `cargo test`) work with nothing installed.
//!
//! With `--features juce` it drives CMake (via the `cmake` crate) to fetch JUCE 8
//! (FetchContent) and compile the C++ host shim in `cpp/` into a static library,
//! then links it. This needs `cmake` + a C++ toolchain. VST2 is intentionally
//! owner-provisioned only (`OJHOST_ENABLE_VST2=1` + `VST2_SDK_DIR`) because the
//! discontinued Steinberg headers must not be vendored or downloaded by CI.

fn main() {
    // Rebuild if the C ABI / C++ shim / CMake config changes (relevant only for
    // the `juce` build, but cheap + harmless to always declare).
    println!("cargo:rerun-if-changed=cpp/ojhost_juce.h");
    println!("cargo:rerun-if-changed=cpp/ojhost_juce.cpp");
    println!("cargo:rerun-if-changed=cpp/CMakeLists.txt");
    println!("cargo:rerun-if-env-changed=OJHOST_WITH_CLAP");
    println!("cargo:rerun-if-env-changed=OJHOST_ENABLE_VST2");
    println!("cargo:rerun-if-env-changed=VST2_SDK_DIR");
    println!("cargo:rerun-if-env-changed=VST3_SDK_DIR");
    // DEV/TEST crash-boundary harness: env-gated (NOT a cargo feature) so flipping
    // it reuses the existing `{juce}` build dir instead of forcing a second full
    // JUCE clone+rebuild. Declare the cfg name unconditionally so Rust 1.80+
    // cfg-checking doesn't warn even in non-juce builds (the cfg appears in lib.rs).
    println!("cargo:rerun-if-env-changed=OJHOST_FAULT_INJECT");
    println!("cargo:rustc-check-cfg=cfg(oj_fault_inject)");

    #[cfg(feature = "juce")]
    build_juce();
}

#[cfg(feature = "juce")]
fn build_juce() {
    if !cmake_available() {
        panic!(
            "ojhost/juce requires CMake on PATH. Install CMake (and a C++ toolchain) or build with `--no-default-features` / `plugin-host-scaffold`."
        );
    }

    let with_clap = env_flag("OJHOST_WITH_CLAP").unwrap_or(true);
    let with_vst2 = env_flag("OJHOST_ENABLE_VST2").unwrap_or(false);
    let vst2_sdk = std::env::var("VST2_SDK_DIR").ok();
    let vst3_sdk = std::env::var("VST3_SDK_DIR").ok();

    if with_vst2 && vst2_sdk.as_deref().unwrap_or_default().is_empty() {
        panic!(
            "OJHOST_ENABLE_VST2=1 requires VST2_SDK_DIR to point at a legally obtained VST2 SDK/header checkout"
        );
    }

    // The `cmake` crate runs configure + build + install and returns the install
    // prefix. CMakeLists.txt pulls JUCE via FetchContent and emits the static
    // lib `ojhost_juce`.
    let mut cfg = cmake::Config::new("cpp");
    cfg.define("OJHOST_WITH_CLAP", if with_clap { "ON" } else { "OFF" })
        .define("OJHOST_WITH_VST2", if with_vst2 { "ON" } else { "OFF" });
    // Dev/test: when `OJHOST_FAULT_INJECT` is set, compile the in-guard fault
    // injector so the crash boundary can be PROVEN on a live machine (see
    // `cpp/ojhost_juce.cpp`), and emit `--cfg oj_fault_inject` so the Rust FFI +
    // `arm_fault` chain matches the compiled C++ symbol. OFF (absent) otherwise.
    if env_flag("OJHOST_FAULT_INJECT").unwrap_or(false) {
        cfg.define("OJHOST_FAULT_INJECT", "ON");
        println!("cargo:rustc-cfg=oj_fault_inject");
    }
    if let Some(path) = vst2_sdk.as_deref() {
        cfg.define("OJHOST_VST2_SDK_DIR", path);
    }
    if let Some(path) = vst3_sdk.as_deref() {
        cfg.define("OJHOST_VST3_SDK_DIR", path);
    }
    let dst = cfg.build();

    // Link the produced static library + JUCE's transitive system deps. JUCE's
    // CMake module code is compiled into the static lib; platform SDK libs still
    // need to be named for rustc.
    println!("cargo:rustc-link-search=native={}/lib", dst.display());
    println!("cargo:rustc-link-lib=static=ojhost_juce");

    link_platform_libs();
}

#[cfg(feature = "juce")]
fn cmake_available() -> bool {
    let cmake = std::env::var_os("CMAKE").unwrap_or_else(|| "cmake".into());
    std::process::Command::new(cmake)
        .arg("--version")
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .is_ok_and(|s| s.success())
}

#[cfg(feature = "juce")]
fn env_flag(name: &str) -> Option<bool> {
    std::env::var(name).ok().map(|v| {
        let v = v.trim().to_ascii_lowercase();
        matches!(v.as_str(), "1" | "true" | "yes" | "on")
    })
}

#[cfg(all(feature = "juce", target_os = "linux"))]
fn link_platform_libs() {
    // JUCE audio/plugin hosting + native editor windows on Linux. Keep this list
    // explicit so CI failures name a missing dev package rather than surfacing as
    // unresolved symbols deep in link output.
    for lib in [
        "stdc++",
        "pthread",
        "dl",
        "m",
        "rt",
        "asound",
        "freetype",
        "fontconfig",
        "X11",
        "Xext",
        "Xinerama",
        "Xrandr",
        "Xcursor",
        "GL",
    ] {
        println!("cargo:rustc-link-lib=dylib={lib}");
    }
}

#[cfg(all(feature = "juce", target_os = "macos"))]
fn link_platform_libs() {
    for fw in [
        "Accelerate",
        "AppKit",
        "AudioToolbox",
        "AudioUnit",
        "Carbon",
        "Cocoa",
        "CoreAudio",
        "CoreFoundation",
        "CoreMIDI",
        "CoreServices",
        "DiscRecording",
        "IOKit",
        "QuartzCore",
        "Security",
        "WebKit",
    ] {
        println!("cargo:rustc-link-lib=framework={fw}");
    }
    println!("cargo:rustc-link-lib=dylib=c++");
}

#[cfg(all(feature = "juce", target_os = "windows"))]
fn link_platform_libs() {
    // Windows SDK libs used by JUCE modules and plugin hosting/editor windows.
    // MSVC's C/C++ runtime is selected by the toolchain flags and does not need a
    // manual cargo link line.
    for lib in [
        "advapi32",
        "comctl32",
        "comdlg32",
        "gdi32",
        "imm32",
        "kernel32",
        "ole32",
        "oleaut32",
        "rpcrt4",
        "shell32",
        "shlwapi",
        "user32",
        "uuid",
        "version",
        "wininet",
        "winmm",
        "ws2_32",
    ] {
        println!("cargo:rustc-link-lib=dylib={lib}");
    }
}

#[cfg(all(
    feature = "juce",
    not(any(target_os = "linux", target_os = "macos", target_os = "windows"))
))]
fn link_platform_libs() {}
