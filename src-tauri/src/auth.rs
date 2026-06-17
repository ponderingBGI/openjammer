//! Provider auth (D6, M7) — WHO PAYS for the Ctrl/Cmd+K AI agent.
//!
//! This module is the NATIVE half of the auth onboarding the frontend
//! ([`src/auth/authStore.ts`] + [`AuthChooser`]) drives. It resolves only WHO
//! PAYS — it grants the agent no new power (tool calls still apply-with-undo
//! behind Approve / Reject), and OpenJammer NEVER writes the provider key to its
//! own config: the key belongs in the OS keychain (founder-gated) and is forwarded
//! transiently to Pi via the existing [`crate::ai::stripped_env`] seam.
//!
//! # What is VERIFIABLE here (and tested)
//!
//! * [`auth_status`]'s **conflict-by-outcome** logic (D6-A1): parse Pi's own
//!   `~/.pi/agent/auth.json`, resolve each provider key the way Pi would (expand
//!   `$VAR`, treat `!shellcmd` as unresolved HERE, require non-empty), and report
//!   `conflict = true` ONLY when Pi would resolve a WORKING key — so the UI can
//!   warn the user that two key sources disagree. When auth.json's key is
//!   unresolvable, prefer the keychain/env key (no conflict).
//! * The provider → env-var mapping ([`provider_env_var`]) — the var name a
//!   provider's key is forwarded under (reused by [`crate::ai`] at spawn).
//! * The PKCE S256 challenge ([`pkce_challenge`]) — pure SHA-256 + base64url, no
//!   new crates, ready for the loopback OAuth the founder build wires up.
//!
//! # FOUNDER-GATED BOUNDARY — read before extending
//!
//! The COMMANDS that touch live providers / the OS / the network are SCAFFOLDS:
//! [`auth_store_key`] / [`auth_get_key`] / [`auth_clear`] (OS keychain via
//! `tauri-plugin-keyring`), [`auth_begin_oauth`] (loopback PKCE via
//! `tauri-plugin-oauth`), and [`auth_validate_key`] (an HTTP round-trip) each
//! return a typed `notConfigured: true` result rather than pulling in those heavy
//! deps. Their SIGNATURES are real so the frontend compiles + tests with mocks,
//! and the pure logic above is the part that ships green today. See
//! `docs/agent-tools.md` § "Founder-gated next steps" for what remains.

use serde::{Deserialize, Serialize};

// ============================================================================
// Wire types (mirror src/auth/authStore.ts)
// ============================================================================

/// The `auth_status` reply. `conflict` is the conflict-by-OUTCOME flag (D6-A1).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct AuthState {
    /// A working key is available for the active provider.
    pub configured: bool,
    /// The provider the user / native side reports as active, if any.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active_provider: Option<String>,
    /// The pinned model id, if any.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model_id: Option<String>,
    /// True only when Pi's auth.json would resolve a conflicting WORKING key.
    pub conflict: bool,
}

/// The result of a key-store / validate / oauth action. The founder-gated bodies
/// return `{ ok:false, not_configured:true }` until enabled.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct AuthActionResult {
    pub ok: bool,
    /// True when this is the founder-gated stub body (not configured in this build).
    #[serde(skip_serializing_if = "is_false")]
    pub not_configured: bool,
    /// Human-readable detail for the chooser.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

fn is_false(b: &bool) -> bool {
    !*b
}

impl AuthActionResult {
    /// The founder-gated "this build does not implement live auth" result.
    fn not_configured(message: impl Into<String>) -> Self {
        Self {
            ok: false,
            not_configured: true,
            message: Some(message.into()),
        }
    }
}

// ============================================================================
// provider -> env-var mapping (pure, tested)
// ============================================================================

/// The environment-variable name a provider's API key is forwarded under (to Pi
/// via [`crate::ai::stripped_env`]). Unknown providers fall back to the generic
/// `OPENJAMMER_PROVIDER_KEY` so a BYO endpoint still resolves.
pub fn provider_env_var(provider: &str) -> &'static str {
    match provider {
        "opencode" => "OPENCODE_API_KEY",
        "openai" => "OPENAI_API_KEY",
        "anthropic" => "ANTHROPIC_API_KEY",
        _ => "OPENJAMMER_PROVIDER_KEY",
    }
}

// ============================================================================
// conflict-by-outcome (D6-A1) — pure, tested
// ============================================================================

/// Resolve a raw value the way Pi's `auth.json` would, returning the effective key
/// or `None` when it is UNRESOLVABLE here:
///
/// * `$VAR` / `${VAR}` → the value of that env var (empty/unset → `None`);
/// * `!shellcmd`       → UNRESOLVED here (we never run a shell to discover a key);
/// * a plain literal   → itself (when non-empty).
///
/// A resolved-but-empty value is `None` (an empty `$VAR` does NOT count as a
/// working key — the empty-`$VAR` case the tests pin).
fn resolve_auth_value(raw: &str, lookup: &dyn Fn(&str) -> Option<String>) -> Option<String> {
    let raw = raw.trim();
    if raw.is_empty() {
        return None;
    }
    // `!shellcmd` is intentionally unresolved (no shell-out in this check).
    if let Some(rest) = raw.strip_prefix('!') {
        let _ = rest;
        return None;
    }
    // `${VAR}` or `$VAR` env expansion.
    if let Some(var) = raw.strip_prefix("${").and_then(|s| s.strip_suffix('}')) {
        return lookup(var).filter(|v| !v.is_empty());
    }
    if let Some(var) = raw.strip_prefix('$') {
        return lookup(var).filter(|v| !v.is_empty());
    }
    Some(raw.to_string())
}

/// Whether Pi's `auth.json` (already parsed to JSON) would resolve a WORKING key
/// for `provider`. The shape Pi uses is `{ "<provider>": { "apiKey": "<raw>" } }`
/// (also accepts a bare `"<provider>": "<raw>"`). Returns true only when the
/// resolved key is non-empty — the conflict-by-OUTCOME signal (D6-A1).
fn pi_auth_resolves_key(
    auth_json: &serde_json::Value,
    provider: &str,
    lookup: &dyn Fn(&str) -> Option<String>,
) -> bool {
    let Some(entry) = auth_json.get(provider) else {
        return false;
    };
    // Accept either `{ "apiKey": ... }` (or `key`) or a bare string.
    let raw = entry
        .get("apiKey")
        .and_then(|v| v.as_str())
        .or_else(|| entry.get("key").and_then(|v| v.as_str()))
        .or_else(|| entry.as_str());
    match raw {
        Some(s) => resolve_auth_value(s, lookup).is_some(),
        None => false,
    }
}

/// Compute the conflict-by-OUTCOME flag (D6-A1) given Pi's parsed `auth.json`
/// (or `None` when it is absent / unparseable), the active `provider`, whether
/// OpenJammer's OWN store (keychain/env) holds a working key, and an env lookup.
///
/// `conflict` is true ONLY when BOTH sides would resolve a WORKING key (they
/// disagree on who pays). When auth.json is unresolvable, there is no conflict —
/// the keychain/env key is simply preferred.
fn compute_conflict(
    pi_auth: Option<&serde_json::Value>,
    provider: &str,
    own_has_key: bool,
    lookup: &dyn Fn(&str) -> Option<String>,
) -> bool {
    if !own_has_key {
        return false;
    }
    match pi_auth {
        Some(json) => pi_auth_resolves_key(json, provider, lookup),
        None => false,
    }
}

// ============================================================================
// PKCE S256 (pure SHA-256 + base64url, no new crates) — tested
// ============================================================================

/// The PKCE S256 code challenge for a verifier: base64url(SHA-256(verifier)),
/// unpadded (RFC 7636 §4.2). Pure + deterministic — the loopback OAuth the
/// founder build wires up uses this exact value.
///
/// FOUNDER-GATED: `#[allow(dead_code)]` because the loopback-OAuth call site is
/// founder-gated (it needs `tauri-plugin-oauth`); this is the VERIFIED, tested
/// challenge function it will call. Kept in the default build so it ships green +
/// proven by the RFC test vector below.
#[allow(dead_code)]
pub fn pkce_challenge(verifier: &str) -> String {
    base64url_nopad(&sha256(verifier.as_bytes()))
}

/// Minimal SHA-256 (FIPS 180-4) of `data`. Self-contained so PKCE needs no new
/// crate. Returns the 32-byte digest. (Reachable only via the founder-gated
/// [`pkce_challenge`] + tests, hence `#[allow(dead_code)]`.)
#[allow(dead_code)]
fn sha256(data: &[u8]) -> [u8; 32] {
    const K: [u32; 64] = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4,
        0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe,
        0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f,
        0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
        0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc,
        0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
        0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116,
        0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
        0xc67178f2,
    ];

    let mut h: [u32; 8] = [
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab,
        0x5be0cd19,
    ];

    // Pre-processing: pad to a multiple of 64 bytes (512 bits).
    let bit_len = (data.len() as u64).wrapping_mul(8);
    let mut msg = data.to_vec();
    msg.push(0x80);
    while msg.len() % 64 != 56 {
        msg.push(0);
    }
    msg.extend_from_slice(&bit_len.to_be_bytes());

    for chunk in msg.chunks_exact(64) {
        let mut w = [0u32; 64];
        for (i, word) in chunk.chunks_exact(4).enumerate() {
            w[i] = u32::from_be_bytes([word[0], word[1], word[2], word[3]]);
        }
        for i in 16..64 {
            let s0 = w[i - 15].rotate_right(7) ^ w[i - 15].rotate_right(18) ^ (w[i - 15] >> 3);
            let s1 = w[i - 2].rotate_right(17) ^ w[i - 2].rotate_right(19) ^ (w[i - 2] >> 10);
            w[i] = w[i - 16]
                .wrapping_add(s0)
                .wrapping_add(w[i - 7])
                .wrapping_add(s1);
        }

        let mut v = h;
        for i in 0..64 {
            let s1 = v[4].rotate_right(6) ^ v[4].rotate_right(11) ^ v[4].rotate_right(25);
            let ch = (v[4] & v[5]) ^ ((!v[4]) & v[6]);
            let t1 = v[7]
                .wrapping_add(s1)
                .wrapping_add(ch)
                .wrapping_add(K[i])
                .wrapping_add(w[i]);
            let s0 = v[0].rotate_right(2) ^ v[0].rotate_right(13) ^ v[0].rotate_right(22);
            let maj = (v[0] & v[1]) ^ (v[0] & v[2]) ^ (v[1] & v[2]);
            let t2 = s0.wrapping_add(maj);
            v[7] = v[6];
            v[6] = v[5];
            v[5] = v[4];
            v[4] = v[3].wrapping_add(t1);
            v[3] = v[2];
            v[2] = v[1];
            v[1] = v[0];
            v[0] = t1.wrapping_add(t2);
        }
        for i in 0..8 {
            h[i] = h[i].wrapping_add(v[i]);
        }
    }

    let mut out = [0u8; 32];
    for (i, word) in h.iter().enumerate() {
        out[i * 4..i * 4 + 4].copy_from_slice(&word.to_be_bytes());
    }
    out
}

/// base64url encode WITHOUT padding (RFC 4648 §5), as PKCE requires. (Reachable
/// only via the founder-gated [`pkce_challenge`] + tests, hence `#[allow(dead_code)]`.)
#[allow(dead_code)]
fn base64url_nopad(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = chunk.get(1).copied().unwrap_or(0) as u32;
        let b2 = chunk.get(2).copied().unwrap_or(0) as u32;
        let triple = (b0 << 16) | (b1 << 8) | b2;
        out.push(ALPHABET[((triple >> 18) & 0x3f) as usize] as char);
        out.push(ALPHABET[((triple >> 12) & 0x3f) as usize] as char);
        if chunk.len() > 1 {
            out.push(ALPHABET[((triple >> 6) & 0x3f) as usize] as char);
        }
        if chunk.len() > 2 {
            out.push(ALPHABET[(triple & 0x3f) as usize] as char);
        }
    }
    out
}

// ============================================================================
// Tauri commands
// ============================================================================

/// Report the current auth status. Reads Pi's `~/.pi/agent/auth.json` for the
/// conflict-by-OUTCOME flag (HOME-forwarded). The keychain key SOURCE is
/// founder-gated, so `configured` reflects only what we can verify in this build
/// (a key present in the env under the provider's var). The frontend overlays its
/// persisted provider/model choice.
#[tauri::command]
pub fn auth_status(provider: Option<String>) -> Result<AuthState, String> {
    let provider = provider.unwrap_or_default();
    let env_lookup = |var: &str| std::env::var(var).ok();

    // VERIFIABLE configured signal: a non-empty key under the provider's env var.
    let configured = if provider.is_empty() {
        false
    } else {
        std::env::var(provider_env_var(&provider))
            .ok()
            .filter(|v| !v.is_empty())
            .is_some()
    };

    let pi_auth = read_pi_auth_json();
    let conflict = compute_conflict(pi_auth.as_ref(), &provider, configured, &env_lookup);

    Ok(AuthState {
        configured,
        active_provider: (!provider.is_empty()).then_some(provider),
        model_id: None,
        conflict,
    })
}

/// Read + parse Pi's `~/.pi/agent/auth.json` (HOME-forwarded). Returns `None` when
/// absent / unreadable / unparseable (no conflict can be asserted then).
fn read_pi_auth_json() -> Option<serde_json::Value> {
    let home = std::env::var("HOME")
        .ok()
        .or_else(|| std::env::var("USERPROFILE").ok())?;
    let path = std::path::Path::new(&home)
        .join(".pi")
        .join("agent")
        .join("auth.json");
    let text = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&text).ok()
}

/// FOUNDER-GATED: store a key in the OS keychain. Real body needs
/// `tauri-plugin-keyring` (a heavy dep we do not add here). `base_url` carries a
/// BYO OpenAI-compatible endpoint the frontend collected; it is forwarded here so
/// the founder build persists it alongside the key (never on the OpenJammer side).
#[tauri::command]
pub fn auth_store_key(
    provider: String,
    key: String,
    base_url: Option<String>,
) -> Result<AuthActionResult, String> {
    let _ = (provider, key, base_url);
    Ok(AuthActionResult::not_configured(
        "key storage is founder-gated in this build (needs the OS keychain plugin)",
    ))
}

/// FOUNDER-GATED: fetch a stored key from the OS keychain.
#[tauri::command]
pub fn auth_get_key(provider: String) -> Result<Option<String>, String> {
    let _ = provider;
    Ok(None)
}

/// FOUNDER-GATED: clear a stored key. The local store still resets either way.
#[tauri::command]
pub fn auth_clear(provider: Option<String>) -> Result<AuthActionResult, String> {
    let _ = provider;
    Ok(AuthActionResult {
        ok: true,
        not_configured: true,
        message: Some("nothing to clear in this build (keychain is founder-gated)".to_string()),
    })
}

/// FOUNDER-GATED: begin a loopback-PKCE OAuth flow (e.g. Codex). Real body needs
/// `tauri-plugin-oauth` (a heavy dep we do not add here). The pure
/// [`pkce_challenge`] is ready for that wiring.
#[tauri::command]
pub fn auth_begin_oauth(provider: String) -> Result<AuthActionResult, String> {
    let _ = provider;
    Ok(AuthActionResult::not_configured(
        "OAuth is founder-gated in this build (needs the loopback-OAuth plugin)",
    ))
}

/// FOUNDER-GATED: validate a key with the provider over HTTP. Real body needs an
/// HTTP client (a heavy dep we do not add here). `base_url` is the optional BYO
/// OpenAI-compatible endpoint to validate against (forwarded, never persisted here).
#[tauri::command]
pub fn auth_validate_key(
    provider: String,
    key: String,
    base_url: Option<String>,
) -> Result<AuthActionResult, String> {
    let _ = (provider, key, base_url);
    Ok(AuthActionResult::not_configured(
        "key validation is founder-gated in this build (needs an HTTP client)",
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    // ---- provider -> env-var mapping --------------------------------------

    #[test]
    fn provider_env_var_maps_known_providers() {
        assert_eq!(provider_env_var("opencode"), "OPENCODE_API_KEY");
        assert_eq!(provider_env_var("openai"), "OPENAI_API_KEY");
        assert_eq!(provider_env_var("anthropic"), "ANTHROPIC_API_KEY");
        // Unknown → the generic fallback so a BYO endpoint still resolves.
        assert_eq!(provider_env_var("byo"), "OPENJAMMER_PROVIDER_KEY");
    }

    // ---- conflict-by-outcome (D6-A1) --------------------------------------

    fn auth(provider: &str, raw: &str) -> serde_json::Value {
        serde_json::json!({ provider: { "apiKey": raw } })
    }

    #[test]
    fn conflict_true_when_both_sides_resolve_a_working_key() {
        // Pi's auth.json holds a literal key AND our own store has one → conflict.
        let pi = auth("anthropic", "sk-pi-literal");
        let lookup = |_: &str| None;
        assert!(compute_conflict(Some(&pi), "anthropic", true, &lookup));
    }

    #[test]
    fn no_conflict_when_pi_key_is_an_empty_env_var() {
        // The empty-$VAR case: auth.json points at $EMPTY which resolves to "" →
        // Pi would NOT get a working key → no conflict (prefer keychain/env).
        let pi = auth("anthropic", "$EMPTY_KEY_VAR");
        let lookup = |var: &str| {
            if var == "EMPTY_KEY_VAR" {
                Some(String::new()) // present but EMPTY
            } else {
                None
            }
        };
        assert!(!compute_conflict(Some(&pi), "anthropic", true, &lookup));
    }

    #[test]
    fn conflict_true_when_pi_env_var_resolves_non_empty() {
        let pi = auth("anthropic", "${SOME_KEY}");
        let lookup = |var: &str| (var == "SOME_KEY").then(|| "sk-resolved".to_string());
        assert!(compute_conflict(Some(&pi), "anthropic", true, &lookup));
    }

    #[test]
    fn no_conflict_when_pi_key_is_a_shellcmd() {
        // `!shellcmd` is unresolved here → Pi's key is unknown → prefer ours.
        let pi = auth("anthropic", "!op read op://vault/key");
        let lookup = |_: &str| None;
        assert!(!compute_conflict(Some(&pi), "anthropic", true, &lookup));
    }

    #[test]
    fn no_conflict_when_own_store_has_no_key() {
        let pi = auth("anthropic", "sk-pi-literal");
        let lookup = |_: &str| None;
        // Even though Pi resolves a key, we have none → nothing to conflict with.
        assert!(!compute_conflict(Some(&pi), "anthropic", false, &lookup));
    }

    #[test]
    fn no_conflict_when_pi_auth_absent_or_other_provider() {
        let lookup = |_: &str| None;
        assert!(!compute_conflict(None, "anthropic", true, &lookup));
        // auth.json has a DIFFERENT provider → no conflict for `anthropic`.
        let pi = auth("openai", "sk-other");
        assert!(!compute_conflict(Some(&pi), "anthropic", true, &lookup));
    }

    #[test]
    fn resolve_auth_value_handles_literal_env_and_shellcmd() {
        let lookup = |var: &str| (var == "K").then(|| "v".to_string());
        assert_eq!(
            resolve_auth_value("literal", &lookup).as_deref(),
            Some("literal")
        );
        assert_eq!(resolve_auth_value("$K", &lookup).as_deref(), Some("v"));
        assert_eq!(resolve_auth_value("${K}", &lookup).as_deref(), Some("v"));
        assert_eq!(resolve_auth_value("$MISSING", &lookup), None);
        assert_eq!(resolve_auth_value("!cmd", &lookup), None);
        assert_eq!(resolve_auth_value("", &lookup), None);
    }

    #[test]
    fn pi_auth_accepts_bare_string_entry() {
        // `{ "anthropic": "sk-..." }` (bare string, not an object) also resolves.
        let pi = serde_json::json!({ "anthropic": "sk-bare" });
        let lookup = |_: &str| None;
        assert!(pi_auth_resolves_key(&pi, "anthropic", &lookup));
    }

    // ---- PKCE S256 (pure) -------------------------------------------------

    #[test]
    fn pkce_challenge_matches_rfc7636_test_vector() {
        // RFC 7636 Appendix B: the canonical verifier → challenge vector.
        let verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
        let challenge = pkce_challenge(verifier);
        assert_eq!(challenge, "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    }

    #[test]
    fn sha256_matches_known_vectors() {
        // "abc" → ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad
        let d = sha256(b"abc");
        assert_eq!(
            base64url_nopad(&d),
            // base64url(no pad) of the known "abc" digest.
            "ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0"
        );
        // Empty input digest is well-known too.
        let e = sha256(b"");
        assert_eq!(
            base64url_nopad(&e),
            "47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU"
        );
    }

    #[test]
    fn base64url_is_url_safe_and_unpadded() {
        // Bytes that would produce '+' and '/' in standard base64 must use '-'/'_'.
        let s = base64url_nopad(&[0xfb, 0xff, 0xfe]);
        assert!(!s.contains('+') && !s.contains('/') && !s.contains('='));
    }

    // ---- founder-gated commands accept the BYO base_url -------------------

    #[test]
    fn store_and_validate_accept_optional_base_url() {
        // The BYO OpenAI-compatible base URL is forwarded from the frontend; the
        // founder-gated stubs accept it (Some or None) and still report
        // not_configured rather than dropping the call.
        let stored =
            auth_store_key("openai".into(), "sk".into(), Some("https://x/v1".into())).unwrap();
        assert!(!stored.ok && stored.not_configured);

        let validated =
            auth_validate_key("openai".into(), "sk".into(), Some("https://x/v1".into())).unwrap();
        assert!(!validated.ok && validated.not_configured);

        // Absent base_url is equally accepted (the non-BYO providers' path).
        let no_url = auth_store_key("anthropic".into(), "sk".into(), None).unwrap();
        assert!(!no_url.ok && no_url.not_configured);
    }
}
