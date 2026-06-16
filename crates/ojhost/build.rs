//! Build script for `ojhost`.
//!
//! In the DEFAULT (scaffold) and `clap-host` builds this is a NO-OP: it pulls no
//! native toolchain and runs no CMake, so `cargo build -p ojhost` (and
//! `cargo test`) work with nothing installed.
//!
//! With `--features juce` it drives CMake (via the `cmake` crate) to fetch JUCE 8
//! (FetchContent) and compile the C++ host shim in `cpp/` into a static library,
//! then links it. This needs `cmake` + a C++ toolchain (and, for VST3, the
//! Steinberg VST3 SDK headers) — see `crates/ojhost/README.md`.

fn main() {
    // Rebuild if the C ABI / C++ shim / CMake config changes (relevant only for
    // the `juce` build, but cheap + harmless to always declare).
    println!("cargo:rerun-if-changed=cpp/ojhost_juce.h");
    println!("cargo:rerun-if-changed=cpp/ojhost_juce.cpp");
    println!("cargo:rerun-if-changed=cpp/CMakeLists.txt");

    #[cfg(feature = "juce")]
    build_juce();
}

#[cfg(feature = "juce")]
fn build_juce() {
    // The `cmake` crate runs configure + build + install and returns the install
    // prefix. CMakeLists.txt pulls JUCE via FetchContent and emits the static
    // lib `libojhost_juce.a`.
    let dst = cmake::Config::new("cpp")
        // CLAP hosting in JUCE needs the clap-juce-extensions; opt in here. VST3
        // is built in. AU is auto-enabled on macOS by the CMakeLists.
        .define("OJHOST_WITH_CLAP", "ON")
        .build();

    // Link the produced static library + JUCE's transitive deps.
    println!("cargo:rustc-link-search=native={}/lib", dst.display());
    println!("cargo:rustc-link-lib=static=ojhost_juce");

    // JUCE links against a handful of system libraries; the exact set is
    // platform-specific. These are the common Linux ones; macOS/Windows add
    // their own frameworks (documented in the README). A real `juce` build in
    // the founder's environment may need to extend this list.
    #[cfg(target_os = "linux")]
    {
        for lib in ["stdc++", "pthread", "dl", "m", "asound", "freetype", "X11"] {
            println!("cargo:rustc-link-lib=dylib={lib}");
        }
    }
    #[cfg(target_os = "macos")]
    {
        for fw in ["CoreAudio", "CoreFoundation", "Accelerate", "AudioToolbox"] {
            println!("cargo:rustc-link-lib=framework={fw}");
        }
        println!("cargo:rustc-link-lib=dylib=c++");
    }
}
