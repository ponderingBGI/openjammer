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
    // CMake commonly ships INSIDE Visual Studio / Build Tools but is NOT on PATH —
    // so before demanding it, try to discover that copy and point `$CMAKE` at it.
    // (Without this, `bun native` panics for anyone who has the VS "C++ CMake tools"
    // but no standalone CMake on PATH.)
    ensure_cmake();
    if !cmake_available() {
        panic!(
            "ojhost/juce requires CMake, but none was found on PATH, in $CMAKE, or in a \
             Visual Studio / Build Tools install. Install CMake (or the VS \"C++ CMake \
             tools\" component), or build with `--no-default-features` / `plugin-host-scaffold`."
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
    // MSVC CRT match: rustc links the NON-debug CRT (`/MD`, msvcrt) even in a debug
    // build, so JUCE must use the same. Left at the cargo profile, a debug build
    // compiles JUCE in Debug config (`_DEBUG` + `/MDd`) and fails to link into the
    // Rust binary with `__imp__calloc_dbg` / `_CrtDbgReport` unresolved. Pin the C++
    // to Release so its runtime + `_DEBUG`-gating match rustc's. (We don't step
    // through JUCE internals; this also builds it faster.) No effect off-Windows.
    #[cfg(target_os = "windows")]
    cfg.profile("Release");
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
    // Bound the parallel C++ compile. cmake-rs derives its `--parallel` from cargo's
    // `NUM_JOBS` (= core count, often 16); a `/O2` Release build of JUCE's large TUs
    // at that width can exhaust the compiler's heap (`C1060 out of heap space`) on a
    // RAM-constrained machine. Cap it (override `OJHOST_JUCE_JOBS` to tune) just for
    // this build so it fits in memory; the build is a little slower but doesn't OOM.
    let juce_jobs = std::env::var("OJHOST_JUCE_JOBS")
        .ok()
        .and_then(|j| j.parse::<usize>().ok())
        .or_else(|| {
            std::env::var("NUM_JOBS")
                .ok()
                .and_then(|j| j.parse::<usize>().ok())
                .map(|j| j.min(4))
        })
        .unwrap_or(4)
        .max(1);
    println!("cargo:rerun-if-env-changed=OJHOST_JUCE_JOBS");
    std::env::set_var("NUM_JOBS", juce_jobs.to_string());
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

/// If CMake is not already invokable (on PATH or via `$CMAKE`), try to locate the
/// copy that ships inside Visual Studio / Build Tools — Windows devs commonly have
/// it there but not on PATH — and point `$CMAKE` at it so both [`cmake_available`]
/// and the `cmake` crate pick it up. No-op when CMake already works or off-Windows.
#[cfg(feature = "juce")]
fn ensure_cmake() {
    // Windows devs often have CMake only inside VS / Build Tools, not on PATH; if so,
    // point $CMAKE at it. Off-Windows, CMake is expected on PATH, so this is a no-op
    // (the whole block is compiled out — keeping it out of the early-return shape that
    // tripped clippy's needless_return once the Windows arm is stripped).
    #[cfg(target_os = "windows")]
    if !cmake_available() {
        if let Some(path) = discover_windows_cmake() {
            println!(
                "cargo:warning=ojhost: CMake not on PATH; using {}",
                path.display()
            );
            std::env::set_var("CMAKE", path);
        }
    }
}

/// Find a usable `cmake.exe` bundled in a VS / Build Tools install (enumerated via
/// `vswhere`), or at a standard standalone install path. Returns the first found.
#[cfg(all(feature = "juce", target_os = "windows"))]
fn discover_windows_cmake() -> Option<std::path::PathBuf> {
    use std::path::PathBuf;
    const VS_CMAKE_SUBPATH: &str =
        r"Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe";

    // 1. Every VS / Build Tools install vswhere knows about (covers non-default
    //    install roots like `C:\BuildTools`).
    let pf86 =
        std::env::var("ProgramFiles(x86)").unwrap_or_else(|_| r"C:\Program Files (x86)".into());
    let vswhere = PathBuf::from(&pf86).join(r"Microsoft Visual Studio\Installer\vswhere.exe");
    if vswhere.is_file() {
        if let Ok(out) = std::process::Command::new(&vswhere)
            .args(["-all", "-products", "*", "-property", "installationPath"])
            .output()
        {
            for line in String::from_utf8_lossy(&out.stdout).lines() {
                let cand = PathBuf::from(line.trim()).join(VS_CMAKE_SUBPATH);
                if cand.is_file() {
                    return Some(cand);
                }
            }
        }
    }

    // 2. Common standalone / known-non-default install dirs.
    for p in [
        r"C:\BuildTools\Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe",
        r"C:\Program Files\CMake\bin\cmake.exe",
        r"C:\Program Files (x86)\CMake\bin\cmake.exe",
    ] {
        let cand = PathBuf::from(p);
        if cand.is_file() {
            return Some(cand);
        }
    }
    None
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
        "CoreAudioKit",
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

    // Objective-C availability checks in JUCE's macOS modules call compiler-rt
    // helpers such as `__isPlatformVersionAtLeast`. Cargo's final C/C++ link
    // uses `-nodefaultlibs`, so clang cannot add its runtime archive for us.
    // Resolve it from the active Apple toolchain instead of assuming an Xcode
    // installation path (Command Line Tools use a different root).
    let output = std::process::Command::new("clang")
        .arg("--print-resource-dir")
        .output()
        .expect("ojhost/juce: failed to run `clang --print-resource-dir`");
    assert!(
        output.status.success(),
        "ojhost/juce: `clang --print-resource-dir` failed with {}",
        output.status
    );
    let resource_dir = String::from_utf8(output.stdout)
        .expect("ojhost/juce: clang resource directory was not UTF-8");
    let runtime_dir = std::path::PathBuf::from(resource_dir.trim())
        .join("lib")
        .join("darwin");
    let runtime = runtime_dir.join("libclang_rt.osx.a");
    assert!(
        runtime.is_file(),
        "ojhost/juce: missing Apple clang runtime at {}",
        runtime.display()
    );
    println!("cargo:rustc-link-search=native={}", runtime_dir.display());
    println!("cargo:rustc-link-lib=static=clang_rt.osx");
}

#[cfg(all(feature = "juce", target_os = "windows"))]
fn link_platform_libs() {
    // Windows SDK libs used by JUCE modules and plugin hosting/editor windows.
    // MSVC's C/C++ runtime is selected by the toolchain flags and does not need a
    // manual cargo link line.
    for lib in [
        "advapi32", "comctl32", "comdlg32", "gdi32", "imm32", "kernel32", "ole32", "oleaut32",
        "rpcrt4", "shell32", "shlwapi", "user32", "uuid", "version", "wininet", "winmm", "ws2_32",
    ] {
        println!("cargo:rustc-link-lib=dylib={lib}");
    }
}

#[cfg(all(
    feature = "juce",
    not(any(target_os = "linux", target_os = "macos", target_os = "windows"))
))]
fn link_platform_libs() {}
