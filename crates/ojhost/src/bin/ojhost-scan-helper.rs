//! Out-of-process probe helper for `ojhost`.
//!
//! Parent process enumerates candidates and invokes this helper for exactly one
//! plugin path. If the plugin crashes during library load/scan, only this helper
//! dies; the parent marks the candidate blacklisted/quarantined and keeps running.

use std::path::PathBuf;

fn main() {
    let Some(path) = std::env::args_os().nth(1).map(PathBuf::from) else {
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
