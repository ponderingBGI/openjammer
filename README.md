<div align="center">

# OpenJammer

**Node-driven music creation for live performance — a low-latency Rust core (`ojcore`), as a native desktop app or zero-install in the browser**

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-0.1.0--alpha-orange.svg)](package.json)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)
[![Made with React](https://img.shields.io/badge/Made%20with-React-61dafb.svg)](https://reactjs.org/)
[![Web Audio API](https://img.shields.io/badge/Web%20Audio%20API-ready-purple.svg)](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API)

</div>

> **⚙️ In active rewrite to a minimal, real-time-safe Rust core (`ojcore`)** that compiles to **native** (targeting sub-5ms MIDI→audio with VST3/AU/CLAP plugin hosting) **and** **WebAssembly** (the zero-install PWA), driven by one shared React control plane.
> See **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** for the crate map, build/run/test commands, and the cross-platform release setup.

---

## Table of Contents

- [Features](#features)
- [Quick Start](#quick-start)
- [Browser Compatibility](#browser-compatibility)
- [Audio Setup & USB Interfaces](#audio-setup--usb-interfaces)
- [Vision](#vision)
- [Node System](#node-system)
- [Node Categories](#node-categories)
- [Ghost Mode](#ghost-mode-w-key)
- [Technical Details](#technical-details)
- [Contributing](#contributing)
- [License](#license)

---

## Features

🎹 **Real-time Keyboard Routing** - Bank switching (1-9) for controlling multiple instruments simultaneously

🔁 **Layer-Based Looping** - Stack loops as layers instead of overdubbing, with individual mute/delete/effects per layer

🎛️ **Node-Based Interface** - Visual audio routing inspired by ComfyUI with right-click context menu

🔌 **USB Audio Interface Support** - Professional low-latency audio (3-10ms with optimized setup)

🎨 **Hand-Drawn Aesthetic** - Scribble/organic style with customizable theming (inspired by Cyberpunk 2077 UI)

⚡ **Zero-Latency Editing** - Modify parameters, add effects, and reroute nodes without audio dropouts

📴 **Offline Capability** - Full PWA support, works offline after first visit

🎚️ **Live Performance Focused** - Ghost mode (W key), laptop-first design, screen real estate optimization

---

## Quick Start

```bash
# Install dependencies
bun install

# Start development server
bun dev
```

Open `http://localhost:3000` and click "Start Audio" to begin.

**First workflow:**
1. Right-click canvas → Keyboard → Add Keyboard Node
2. Right-click canvas → Instruments → Keyboard → Classic Piano
3. Connect Keyboard output to Piano input
4. Press keys (Q-P row) to play!

---

## Browser Compatibility

| Browser | Version | Status | Notes |
|---------|---------|--------|-------|
| Chrome | 110+ | ✅ **Recommended** | Full support, `setSinkId()` for device selection |
| Edge | 110+ | ✅ **Recommended** | Chromium-based, same as Chrome |
| Firefox | Latest | ⚠️ Partial | Web Audio API supported, no device selection |
| Safari | 15+ | ⚠️ Limited | macOS Core Audio excellent, iOS limited |

**Required APIs:**
- Web Audio API (all modern browsers)
- AudioWorklet (custom audio processing)
- Service Workers (offline functionality)

---

## Audio Setup & USB Interfaces

### Latency Optimization

OpenJammer includes comprehensive latency optimizations that work immediately:

- **Web Audio API latency tuning**: Interactive mode for lowest latency
- **Low-latency microphone input**: Disable processing for 20-50ms improvement
- **Direct output device routing**: Select specific audio interfaces (Chrome 110+)
- **Real-time latency monitoring**: View actual latency metrics in settings

**Access audio settings**: Open Settings (gear icon) → Audio tab

### Recommended USB Audio Interfaces

For the best jamming experience, use a USB audio interface instead of built-in audio:

| Tier | Model | Price | Latency | Inputs | Notes |
|------|-------|-------|---------|--------|-------|
| **Budget** | PreSonus AudioBox USB 96 | ~$100 | 5-8ms | 2 | Great starter interface, MIDI I/O |
| **Budget+** | Behringer UMC404HD | ~$170 | 6-10ms | 4 | 4 inputs, MIDAS preamps |
| **Mid-Range** | MOTU M4 | ~$250 | **2.4ms** | 4 | Best value: ESS Sabre32 DAC, class-compliant |
| **Mid-Range** | Focusrite Scarlett 4i4 | ~$280 | 4ms | 4 | Industry standard, excellent preamps |
| **Guitar/Bass** | Audient iD4 MKII | ~$200 | 4ms | 2 | Class-A JFET instrument input |
| **Professional** | RME Babyface Pro FS | ~$850 | **3ms** | 4 | Reference-quality, TotalMix FX routing |
| **Professional** | Universal Audio Apollo Twin | ~$900 | 3-5ms | 2 | Built-in DSP for effects processing |

**Recommendation**: The **MOTU M4** offers exceptional value with 2.4ms round-trip latency, professional-grade converters, and class-compliant USB (works without drivers on all platforms).

### Browser Limitations

**Important**: Web browsers cannot access ASIO drivers. They use:
- **Windows**: WASAPI (10-30ms typical latency)
- **macOS**: Core Audio (3-5ms typical latency)
- **Linux**: ALSA/JACK (varies by configuration)

This is a browser limitation, not an OpenJammer limitation. USB audio interfaces significantly reduce latency by providing better hardware buffering and drivers optimized for low-latency operation.

### Setup Instructions

#### 1. Connect Your USB Audio Interface

- **USB 2.0/3.0**: Most interfaces work with standard USB ports
- **USB-C**: Direct connection to modern laptops (no adapter needed for USB-C interfaces)
- **Power**: Most bus-powered interfaces work without external power

#### 2. Configure Browser Permissions

1. Open OpenJammer
2. Click "Start Audio" when prompted
3. Grant microphone permissions when browser asks
4. Open Settings → Audio tab
5. Select your USB interface from the device dropdown

#### 3. Enable Optimizations

In Settings → Audio:

1. **Low Latency Mode**: Enable (disables echo cancellation - safe with USB interface in quiet room)
2. **Sample Rate**: 48 kHz (recommended) or 96 kHz if your interface supports it
3. **Latency Mode**: Interactive (lowest latency)

**Expected Latency**:
- Built-in audio: 30-80ms
- USB interface (basic): 10-20ms
- USB interface (optimized): 3-10ms

You can see your actual latency in the Audio Settings panel.

### Troubleshooting

**Device not detected**:
- Ensure interface is powered on and connected
- Refresh the browser page
- Check that interface drivers are installed (Windows may need manual drivers)
- Try a different USB port

**Audio crackling/dropouts**:
- Increase browser buffer size (Settings → Audio → Latency Mode → Balanced)
- Close other audio applications
- Reduce CPU load (fewer effects/instruments)
- Check USB cable quality (use shorter, high-quality cable)

**High latency despite USB interface**:
- Verify "Low Latency Mode" is enabled
- Check that you selected the correct input/output devices
- Some interfaces require configuration software (check manufacturer docs)
- Windows: Ensure exclusive mode is enabled in Windows Sound settings

**Microphone sounds echoey with Low Latency Mode**:
- Low Latency Mode disables echo cancellation
- Use headphones instead of speakers for monitoring
- Or disable Low Latency Mode if jamming in acoustically treated room

### OS-Specific Notes

**macOS**: Generally provides the best latency performance due to Core Audio. Most interfaces work class-compliant (no drivers needed).

**Windows**: WASAPI adds latency vs ASIO. USB interfaces help significantly. Some interfaces require manufacturer drivers - check support page.

**Linux**: Audio setup varies by distro. JACK provides best latency but requires configuration. PulseAudio works but has higher latency. PipeWire offers good balance.

### Verification

After setup, check Audio Settings to verify:
- ✅ USB interface detected (banner appears)
- ✅ Total latency < 15ms (excellent)
- ✅ Low Latency Mode enabled (if in quiet room)
- ✅ Correct input/output devices selected

---

## Vision

OpenJammer is a visual node-based audio workstation inspired by ComfyUI's interface paradigm. Right-click on empty canvas space to open the context menu with all node categories. The tool prioritizes screen real estate (laptop-first design) and live editability—all parameters remain editable while audio plays without dropouts. Every transformation is lossless.

## Design Aesthetic

**Scribble/hand-drawn style** with cream/beige backgrounds, black hand-drawn outlines, and rounded organic shapes (see design mockups). Theming is user-customizable via a settings panel inspired by Cyberpunk 2077's in-game menu.

---

## Node System

### Connections
- **Blue ports**: Music/audio signals (directional)
- **Grey ports**: Numbers/triggers/parameters (bidirectional)

Keyboard outputs are grey (they send numbers). Instrument outputs are blue (they make sound).

### Multi-Select & Undo
- Drag to select multiple nodes → Backspace/Delete removes them
- Ctrl+Z = Undo, Ctrl+Y = Redo

### Batch Connecting
Select a node and press **A** to grab all free output ports at once. They follow your cursor as a bundle and can be connected to a target node, which dynamically expands its inputs to receive them all.

---

## Node Categories

### 1. Keyboard Node
Routes physical keyboard input to instruments.

- **3 outputs** (one per keyboard row: upper Q-P, middle A-L, lower Z-M)
- **Number row (1-9)** switches the active bank:
  - Bank **1** = reserved for global shortcuts/building mode
  - Banks **2-9** = assignable to Keyboard nodes
- When spawned, auto-claims the next free bank number (displayed in node header)
- When a bank is active, the three keyboard rows trigger notes on connected instruments

### 2. Instruments
Sound generators. Access via right-click menu categories: *Strings*, *Keyboard*, *Drums*, etc. Click the node header to open a popup with specific instrument options (Classic Piano, Cello, Saxophone, etc.).

**Structure:**
- Dynamic inputs: starts with 1, grows as connections arrive (if holding multiple connections, that many inputs appear)
- Each input row displays: Note letter (SPN) + Offset value
- Use +/- buttons or type directly to adjust pitch
- 1 audio output

**Special: Microphone**
- Active by default with Mute button
- Under Instruments category

### 3. Looper
The live performance core. Stacks layers rather than overdubbing.

- **Default duration**: 10 seconds (customizable)
- **Auto-start**: Recording begins when input signal exceeds threshold
- **Auto-stop**: Stops if no input detected for one full loop cycle; empty loops are discarded
- **Progress bar**: Shows current position in loop
- **Stacking**: Each cycle creates a new row/layer
  - Rows can be individually muted, deleted, have effects applied
  - Rows can be dragged to other Loopers
- **Global sync**: Loopers at same BPM/duration align perfectly regardless of start time
- **Beat correction**: Snaps loop end to nearest beat to prevent drift

### 4. Effects
Modify audio signals. Place between Instruments→Looper or apply to specific Looper rows.

Types: Distortion, Pitch Shift, Reverb, etc.

Hot-swappable during playback without audio engine interruption.

### 5. Amplifier
Linear volume control.
- 1.0 = original, 2.0 = double, 0.5 = half, 0.0 = mute

### 6. Speaker
Final output node.
- Click "output device" label to open dropdown for selecting system audio devices
- Speaker symbol in node body

### 7. Recorder
Captures session for post-production.
- Records final mix or individual stems
- Exports as .wav
- Allows separate export of loops/instruments for DAW editing

---

## Ghost Mode (W key)
Toggle for live performance view:
- All nodes fade to 10% opacity
- Node interactions disabled (buttons/sliders)
- Connections remain fully visible and editable
- Input ports "glow" for easy rerouting during play

---

## Technical Details

- **Runtime**: Bun
- **Framework**: React 19 with TypeScript
- **Audio**: Web Audio API with AudioWorklet
- **State Management**: Zustand
- **Storage**: Local browser storage + JSON import/export
- **Hosting**: Vercel (static deployment)
- **Offline**: Full PWA functionality with Service Workers

### Architecture Goals

- Clean, well-documented codebase
- Easy community contributions
- Scalable for future MIDI and custom node integration
- Theming system for user-created themes

### Export/Import

Workflows saved as JSON files for sharing and backup.

---

## Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for:
- Development setup
- Code guidelines
- Pull request process
- Testing requirements

---

## License

OpenJammer is licensed under the [AGPL-3.0 License](LICENSE).

This means:
- ✅ Free to use, modify, and distribute
- ✅ Open source, community-driven
- ⚠️ If you run a modified version as a web service, you must share your source code

---

<div align="center">

**Made with ❤️ for musicians who code and coders who make music**

[Report Bug](https://github.com/PonderingBGI/openjammer/issues) · [Request Feature](https://github.com/PonderingBGI/openjammer/issues) · [Discussions](https://github.com/PonderingBGI/openjammer/discussions)

</div>
