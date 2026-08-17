// Prevents an extra console window on Windows in release builds. DO NOT REMOVE.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    let mut args = std::env::args_os().skip(1);
    if args.next().as_deref() == Some(std::ffi::OsStr::new("--ojhost-scan-helper")) {
        let Some(path) = args.next().map(std::path::PathBuf::from) else {
            std::process::exit(2);
        };
        let response = match ojhost::probe_candidate(&path) {
            Ok(descriptors) => ojhost::ProbeHelperResponse {
                ok: true,
                descriptors,
                error: None,
            },
            Err(error) => ojhost::ProbeHelperResponse {
                ok: false,
                descriptors: Vec::new(),
                error: Some(error.to_string()),
            },
        };
        match serde_json::to_string(&response) {
            Ok(json) => println!("{json}"),
            Err(_) => std::process::exit(3),
        }
        if !response.ok {
            std::process::exit(1);
        }
        return;
    }
    oj_tauri_lib::run();
}
