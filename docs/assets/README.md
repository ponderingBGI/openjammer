# Visual Assets for OpenJammer

This directory contains visual assets used in the README and documentation.

## Demo GIF (`demo.gif`)

**Status**: ⚠️ Needs to be created

### How to Create

Use **OBS Studio** or similar screen recording software to capture a workflow demonstration:

**Recommended workflow to capture:**
1. Start the app (show "Start Audio" button click)
2. Right-click canvas → Add Keyboard Node
3. Right-click canvas → Instruments → Keyboard → Classic Piano
4. Connect Keyboard output to Piano input
5. Press a few keys (Q-W-E-R-T) to play notes
6. Add a Speaker node
7. Connect Piano to Speaker
8. Optionally: Add a Looper and demonstrate layer stacking

**Recording Settings:**
- Resolution: 1920x1080 or 1280x720
- Frame rate: 30 FPS
- Format: MP4 (convert to GIF after)

**Convert MP4 to GIF:**

Using `ffmpeg`:
```bash
ffmpeg -i demo.mp4 -vf "fps=15,scale=1000:-1:flags=lanczos" -loop 0 demo.gif
```

Using online tools:
- https://ezgif.com/video-to-gif
- https://cloudconvert.com/mp4-to-gif

**Optimization:**
- Keep file size < 5MB for fast README loading
- Duration: 10-20 seconds max
- Focus on key features (don't show everything)

## Hero Screenshot (`hero-screenshot.png`)

**Status**: ⚠️ Optional

A polished screenshot of the app with:
- Multiple nodes connected
- Professional-looking workflow
- No console errors visible
- Clean, aesthetic composition

**How to create:**
1. Build an impressive-looking workflow
2. Hide browser UI (F11 fullscreen)
3. Take screenshot (Win+Shift+S on Windows, Cmd+Shift+4 on macOS)
4. Crop and optimize with PNG compression

## Logo (`logo.png`)

**Status**: ⚠️ Optional

Future: A custom logo for OpenJammer in the hand-drawn aesthetic style.

---

These assets are not yet produced, and no README references them. When you create
`demo.gif`, add a `![OpenJammer demo](docs/assets/demo.gif)` reference to the README to
display it.
