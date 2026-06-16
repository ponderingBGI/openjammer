# Contributing to OpenJammer

Thank you for your interest in contributing to OpenJammer! This document provides guidelines for contributing to the project.

> **Before you start, read the philosophy.** OpenJammer is an instrument people play
> live, and that sets the bar for every change. For design, read
> [PRODUCT.md](PRODUCT.md) (who plays this and why, plus the design principles) and
> [DESIGN.md](DESIGN.md) (the visual system). For the engine and the working covenant —
> the perception beliefs, the nine code values, and the playbook — read
> [.agent/workflows/agents.md](.agent/workflows/agents.md). The best contributions can name
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

The app will be available at `http://localhost:3000`

## Project Structure

```
openjammer/
├── src/
│   ├── components/      # React components
│   │   ├── Canvas/      # Node canvas system
│   │   └── Nodes/       # Individual node types
│   ├── audio/           # Web Audio API engine
│   │   ├── samplers/    # Instrument samplers
│   │   └── effects/     # Audio effects
│   ├── store/           # Zustand state management
│   ├── engine/          # Node system types & registry
│   └── lib/             # Utility functions
└── public/              # Static assets
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

### Web Audio API
- Always disconnect nodes properly to prevent memory leaks
- Use `useEffect` cleanup functions for audio nodes
- Test with different sample rates and buffer sizes

### State Management
- Use Zustand for global state
- Keep state minimal and normalized
- Document store slices with comments

### Styling
- Use Tailwind CSS utility classes
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

- Web Audio API runs on a separate thread - avoid blocking main thread
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

## License

By contributing, you agree that your contributions will be licensed under the AGPL-3.0 license.

---

**Questions?** Open a GitHub Issue or discussion. We're happy to help!
