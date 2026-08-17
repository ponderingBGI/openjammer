//! Out-of-process probe helper for `ojhost`.
//!
//! Parent process enumerates candidates and invokes this helper for exactly one
//! plugin path. If the plugin crashes during library load/scan, only this helper
//! dies; the parent marks the candidate blacklisted/quarantined and keeps running.

use std::path::PathBuf;

fn main() {
    let mut args = std::env::args_os().skip(1);
    if args.next().as_deref() != Some(std::ffi::OsStr::new("--ojhost-scan-helper")) {
        respond(false, Vec::new(), Some("missing scan-helper mode".into()));
        std::process::exit(2);
    }
    let Some(path) = args.next().map(PathBuf::from) else {
        respond(false, Vec::new(), Some("missing plugin path".into()));
        std::process::exit(2);
    };

    match ojhost::probe_candidate(&path) {
        Ok(descriptors) => respond(true, descriptors, None),
        Err(e) => {
            respond(false, Vec::new(), Some(e.to_string()));
            std::process::exit(1);
        }
    }
}

fn respond(ok: bool, descriptors: Vec<ojhost::PluginDescriptor>, error: Option<String>) {
    let response = ojhost::ProbeHelperResponse {
        ok,
        descriptors,
        error,
    };
    match serde_json::to_string(&response) {
        Ok(json) => println!("{json}"),
        Err(e) => {
            eprintln!("failed to serialize probe response: {e}");
            std::process::exit(3);
        }
    }
}
