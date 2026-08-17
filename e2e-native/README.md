# Native end-to-end journeys

`n3-determinism.test.ts` is a device/display-free Bun test. It lowers the committed
First Light arrangement through the production `conduct()` path, builds the release
`render` CLI, and compares two 48 kHz/24-bit WAV bounces and two FLAC bounces byte for
byte.

N1/N2 use a small raw W3C WebDriver client (`webdriver.ts`) instead of WebdriverIO.
The tests need only Bun and `tauri-driver`; avoiding a second package tree keeps the
harness easy to audit. Build the bundled frontend/app, then run:

```sh
OJ_DEV_SKIP_PI=1 bun run build
mkdir -p src-tauri/binaries
cargo build -p oj-tauri --features custom-protocol
OJ_NATIVE_E2E_RUN=1 bun test e2e-native/native-e2e.test.ts
```

Linux requires `WebKitWebDriver` (usually `webkit2gtk-driver`) and a display such as
`xvfb-run`. Windows requires a matching `msedgedriver.exe` on `PATH`. `tauri-driver`
does not require a Tauri Cargo feature or a `tauri.conf.json` change: it launches the
normal application binary supplied in the `tauri:options.application` capability.

The N2 process is killed by its exact PID (`SIGKILL` on Linux; `taskkill /F` on
Windows). An environment-gated Tauri hook mirrors the keyboard notes into an fsynced
`.reclog`; after relaunch the test checks that file and the UI's recovered take.
