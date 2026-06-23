# Contributing to OpenJammer

Thank you for your interest in contributing to OpenJammer! This document provides guidelines for contributing to the project.

> **Before you start, read the philosophy.** OpenJammer is an instrument people play
> live, and that sets the bar for every change. For design, read
> [PRODUCT.md](PRODUCT.md) (who plays this and why, plus the design principles) and
> [DESIGN.md](DESIGN.md) (the visual system). For the engine and the working covenant —
> the perception beliefs, the nine code values, and the playbook — read
> [agents.md](agents.md). The best contributions can name
> which value they honor: perception you can feel, and a core kept minimal so the community
> can make it their own.

## Development Setup

### Prerequisites
- [Bun](https://bun.sh) runtime installed

### Getting Started
```bash
# Clone the repository
git clone https://github.com/YOUR_USERNAME/openjammer.git
cd openjammer

# Install dependencies
bun install

# Start development server
bun dev
```

The app will be available at `http://localhost:5173` (Vite's default).

### Native desktop (Tauri)

This is the canonical reference for running the native low-latency app. Two commands:

```bash
bun run oj setup   # one-time: install the native prerequisites (first run only)
bun native         # run the desktop app — opens the window, streams logs live
```

`bun native` is the desktop counterpart to `bun dev`. The window opens on its own once the
engine builds; **edit `src/**`** and it hot-reloads, **edit Rust (`crates/**`, `src-tauri/**`)**
and it rebuilds + restarts the window, **Ctrl+C** stops everything. (There's no Vite-style
keypress menu: the loop hands its whole lifecycle and clean Ctrl+C teardown to the Tauri CLI,
so it behaves identically on Windows/macOS/Linux — see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).)

`oj setup` detects every native prerequisite (Rust; **Win:** MSVC "Desktop development with C++"
\+ WebView2; **macOS:** Xcode CLT; **Linux:** the `libwebkit2gtk-4.1`/`gtk-3`/`libsoup-3` set) and
installs the missing ones after a confirm. Its set is derived from CI, so local matches CI;
`--dry-run` previews, `--wasm` adds the browser-worklet nightly, and `bun run oj doctor --check
native-readiness` reports without installing.

<sub>Power-user extras: `bun native --engine` is a windowless Rust/DSP inner-loop (bacon over the
`render`/`nextest` harnesses — `cargo install --locked bacon`); `OJ_DEV_SKIP_PI=1` skips the
Ctrl+K AI sidecar build. `bun native` is also reachable as `just dev` / `bun run dev:native`.</sub>

### Design system

The look lives in two workspace packages, not in the app:

- **Tokens** (color, spacing, radius, type) are authored as DTCG JSON in
  `packages/oj-tokens/tokens` and compiled with `bun run tokens`.
- **Components** live in `packages/oj-ui`; preview them in isolation with `bun run ladle`.

Token and component changes target the **`canari`** branch like any other contribution.

> **Fork PRs:** run `bun run tokens` and commit the result. CI auto-rebuilds the token
> artifacts on same-repo PRs, but it can't push to forks — so a fork PR with stale generated
> files fails. Running it locally and committing the output keeps the PR green.

## Project Structure

OpenJammer is a Bun workspace: the web app in `src/`, the design-system and protocol
packages under `packages/`, and the Rust audio core in `crates/`.

```
openjammer/
├── src/                       # The web app
│   ├── components/            # React components (the canvas + chrome)
│   │   └── Nodes/             # Individual node types
│   ├── audio/                 # ojcore executor seam: graph emit, worklet/native host, voice synth
│   ├── engine/                # Node system types & registry
│   ├── store/                 # Zustand state management
│   ├── midi/  ai/  collab/    # MIDI, the Ctrl+K agent, multiplayer
│   └── utils/                 # Utility functions
├── packages/
│   ├── oj-tokens/             # DTCG design tokens (Style Dictionary)
│   ├── oj-ui/                 # React component library (@openjammer/oj-ui)
│   └── oj-protocol-ts/        # The TypeScript wire contract (@openjammer/oj-protocol)
├── crates/                    # The Rust audio core
│   ├── ojcore* / ojproto      # The real-time engine + wire contract
│   └── ojhost / ojfaust / …   # Host backends, DSP, plugin hosting
└── public/                    # Static assets
```

## How to Contribute

### Reporting Bugs
- Check if the issue already exists in GitHub Issues
- Include browser version, OS, and steps to reproduce
- For audio issues, include your audio interface details

### Suggesting Features
- Open a GitHub Issue with the "enhancement" label
- Describe the use case and how it benefits live performance
- Consider how it fits with the node-based paradigm

### Pull Request Process

> **Target `canari`, not `main`.** `canari` is the integration branch — open every
> PR against it. GitHub still defaults the base to `main`, so change it when you open
> the PR. `main` is the stable release branch, advanced only by promoting
> `canari` → `main` (a maintainer merge commit). Each merge into `canari` can build a
> numbered canari prerelease such as `v0.0.2-canari.1`.

1. **Fork the repository** and create a feature branch
   ```bash
   git checkout -b feat/your-feature-name
   ```

2. **Make your changes**
   - Write clean, commented code
   - Follow existing code style
   - Test thoroughly, especially audio functionality

3. **Test audio behavior**
   - Test with keyboard input
   - Test with USB audio interface if applicable
   - Ensure no audio dropouts or glitches
   - Verify low-latency performance

4. **Commit your changes**
   ```bash
   git commit -m "feat: add amazing feature"
   ```
   Use conventional commit messages:
   - `feat:` for new features
   - `fix:` for bug fixes
   - `docs:` for documentation
   - `refactor:` for code improvements
   - `perf:` for performance improvements

5. **Push and create a Pull Request**
   ```bash
   git push origin feat/your-feature-name
   ```
   - Include screenshots or GIFs of visual changes
   - Describe what you changed and why
   - Reference any related issues

## Code Guidelines

### React Components
- Use functional components with hooks
- Keep components focused and single-purpose
- Extract reusable logic into custom hooks

### Audio (the ojcore engine)
- You author/patch an `OjGraph` via `graphStore`; `emit.ts` lowers it and the
  selected ojcore executor (native `cpal`, or wasm in an AudioWorklet) renders it.
  React components never build or tear down a Web Audio node graph by hand.
- The audio thread is real-time-safe — it never allocates, locks, or blocks
  (enforced by `assert_no_alloc` + the compile-time `RtCommand` size guard). Drive
  the engine with control-rate `RtCommand`s; never add work to the audio thread.
- Test with audio actually playing, across sample rates and output devices. Direct
  Web Audio survives only at the edges we don't own (e.g. microphone capture).

### State Management
- Use Zustand for global state
- Keep state minimal and normalized
- Document store slices with comments

### Styling
- Use the oj-tokens CSS variables and oj-ui components (no Tailwind in this project)
- Follow the hand-drawn aesthetic theme
- Ensure responsive design (laptop-first)

## Testing

Before submitting a PR:
- [ ] Test on Chrome (primary target browser)
- [ ] Test keyboard routing and bank switching
- [ ] Test audio playback without glitches
- [ ] Verify nodes connect/disconnect properly
- [ ] Test undo/redo functionality
- [ ] Check console for errors/warnings

## Adding New Node Types

1. Create node component in `src/components/Nodes/`
2. Register in `src/engine/registry.ts`
3. Add audio implementation if applicable
4. Update context menu categories
5. Document in README.md

## Performance Considerations

- The ojcore engine renders on its own real-time thread (native `cpal` / browser AudioWorklet) — never block it, and keep the main thread free for the UI
- Minimize re-renders in canvas components
- Use React.memo for expensive components
- Profile with Chrome DevTools Performance tab

## Browser Compatibility

Primary target: **Chrome/Edge (Chromium) 110+**

We use:
- Web Audio API with `setSinkId()` for device selection
- AudioWorklet for custom audio processing
- Service Workers for offline functionality

## Community

- Be respectful and constructive in discussions
- Help others in GitHub Issues when possible
- Share your workflows and creative uses

## License & sign-off (the contributor agreement)

OpenJammer is **AGPL-3.0-only WITH the OpenJammer Plugin Exception** ([LICENSE](LICENSE) +
[LICENSE-EXCEPTION.md](LICENSE-EXCEPTION.md)). Two lightweight things are asked of every contribution.

**1. The grant.** By contributing, you agree:

> By contributing you certify the Developer Certificate of Origin (DCO 1.1, see [.github/DCO](.github/DCO))
> and agree your contributions are licensed under **AGPL-3.0-only WITH the OpenJammer Plugin Exception**
> ([LICENSE](LICENSE) + [LICENSE-EXCEPTION.md](LICENSE-EXCEPTION.md)), and you grant the project steward
> permission to license your contribution under that Exception and under **future versions of that
> Exception** adopted by the steward.

The "future versions" clause lets a revised Exception ship without chasing every contributor for consent.
It grants the steward **no** right to take the project proprietary — it is relicensing latitude for the
Exception only. (Why this matters: [LICENSING.md](LICENSING.md) §6.)

**2. Sign your work (DCO).** Add a `Signed-off-by` line to every commit by committing with `-s`:

```bash
git commit -s -m "feat: add amazing feature"
```

This appends `Signed-off-by: Your Name <your@email>` (use a real name + email). It certifies you wrote
the patch or otherwise have the right to submit it under the license above — including **AI-assisted**
work, so long as you have the right to contribute it. A CI check
([.github/workflows/dco.yml](.github/workflows/dco.yml)) fails any PR with an unsigned commit; fix it
with `git commit --amend -s` (or `git rebase --signoff` for several commits).

---

**Questions?** Open a GitHub Issue or discussion. We're happy to help!
