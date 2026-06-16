# Hardware verification runbook

CI proves the code **builds, lints, and passes 245 Rust + 537 web tests + 13
offline golden-render audio assertions** on macOS/Windows/Linux. The checks below
are the ones a device-less CI runner physically cannot do — they need your real
interface (MOTU M4 / Scarlett 4i4), MIDI controller (Arturia MiniLab 3),
plugins, and provider keys. Run them on the **Windows native install**.

## 0. Get a build
- **Local:** `bun install && bun run tauri build` → installer in `target/release/bundle/`.
- **CI:** after PR #10 merges to `main`, run the **“Build installers (on demand)”**
  workflow from the Actions tab → download the `openjammer-windows-latest` artifact.

## 0.5 Hear it — no hardware needed
```bash
cargo run -p ojcore-native --bin render --features demo -- demo.wav 8
```
Renders a real arpeggio (Osc → Biquad → Delay → Speaker) to `demo.wav` and prints an
RMS/peak/**PASS** summary — proof the engine produces correct audio independent of
any device. **Listen to `demo.wav`** to confirm sound quality before the rig test.
(This same render runs as a CI gate on every commit.)

## 1. Latency (<5ms target)  — the headline gate
```bash
cargo run -p ojcore-native --bin loopback 48000 64    # then try 32-sample buffers
```
Plug a physical loopback (an output → an input on the M4), or read the reported
output buffering floor. Expect ~5–8ms on USB-MIDI-1.0 + prosumer interfaces; true
sub-5ms needs 32–64-sample buffers on WASAPI-exclusive/ASIO (Windows) with a low
driver safety offset. **Record the measured number** — it sets the public latency
claim.

## 2. Native audio + instruments + MIDI
```bash
bun run tauri dev      # or launch the installed app
```
- Build `keyboard → instrument → effect → speaker`. Play the Arturia → sound, low latency.
- Verify looper (record/overdub/clear), recorder (capture → WAV), sampler (load a
  WAV → plays at pitch), speaker volume/mute, and the level meters.

## 3. Third-party plugins
```bash
cargo build -p oj-tauri --features ojhost/clap-host   # CLAP (pure Rust, no extra deps)
# JUCE VST3/AU also needs CMake; see crates/ojhost/README.md
```
From the UI, `scan_plugins` your plugin dirs (`~/.clap`, `~/.vst3`, macOS AU
`~/Library/Audio/Plug-Ins/Components`), insert one, confirm it processes audio.

## 4. Live Faust DSP (AI-authored nodes)
Install **libfaust** (+ LLVM), then `cargo build -p ojfaust --features libfaust`.
Without it, AI-authored Faust source is stored against the node for later compile.

## 5. Ctrl+K AI (Pi)
Install Pi (`bun add -g @earendil-works/pi-coding-agent`; `pi --version`), set ONE
provider key (in `~/.pi`, or via the env var the app forwards). Ctrl+K → type a
prompt → **Tab** → the agent builds/edits nodes; review Approve/Reject. Browser
shows “AI requires the desktop app”.

## 6. LAN collaboration
Open two clients, host/join a session (share the code), confirm live patch edits +
presence (cursors/peer list) converge. For peers across NAT, provide STUN/TURN +
a signaling relay (see `src/collab/README.md`); the realtime audio plane is a
documented next step.

---
Found an issue? It’s almost certainly in the thin device/browser layer (cpal stream,
AudioWorklet wiring, plugin quirks) — the engine DSP itself is golden-render-verified.
Report it and it’s a quick fix.
