# W6-CLEAN — cross-lane cleanup round

Seven findings carried out of the `W4-P9-REVIEW.md` cross-lane list and the
`W5-P6-REPORT.md` §P6b note. Every one is pinned by a test that fails on the code
as it stood; the three that could be proved by reverting were reverted and
re-run to confirm red.

**Path correction:** the brief named `src/components/Toolbar/Topbar.css` and
`src/components/Toolbar/AppMenuBar.tsx`. Both live in `src/components/Shell/`
(`Toolbar/` holds `DropdownMenu`, `Breadcrumbs`, `HelpPanel`). The Shell files
are the ones edited; the UI-021 grep gate covers **both** directories.

Nothing was staged, committed or stashed.

---

## 1 — `Topbar.css` no longer cancels the collab popover's anchor

`.oj-topbar .collab-control { position: static }` was not dead: it overrode the
control's own `position: relative`, so the popover's `absolute` anchor fell back
to `.oj-topbar` (full window width) and the paired `right: 0` pinned the panel
flush to the window edge with no gap under the trigger. Both blocks had to go
together — deleting either alone leaves it misplaced.

| | |
|---|---|
| Change | `src/components/Shell/Topbar.css` — the two blocks (was `:107-114`) deleted; a `NOTE` at `:131` says why they must not come back |
| Test | `src/components/Shell/__tests__/w6CleanCollabAnchor.test.ts` — mounts the shipped `CollabControl.css` + `Topbar.css` as real stylesheets in jsdom, builds `.oj-topbar > .collab-control`, and asserts `getComputedStyle(control).position === 'relative'`; plus a source guard that the topbar declares nothing about `.collab-control` / `.collab-panel` outside prose |
| Proved red | yes — re-appending the old rule fails both tests |

## 2 — `AppMenuBar`'s two native `confirm()`s are gone

Both now use the in-UI grammar P9 established: a `Callout` carrying
`role="alertdialog"`, two real Buttons, Escape to dismiss, anchored under the
menu bar that asked so the answer never arrives detached from the question.

| | |
|---|---|
| Change | `src/components/Shell/AppMenuBar.tsx:36` new `MenuConfirm` shape; `:154` New Canvas (danger, "Clear canvas", body names the node count); `:216` open-project-in-empty-folder (info, "Create project" — the click on that button *is* the gesture the folder picker needs, so nothing is lost); `:430-460` the dialog |
| | `src/components/Shell/Topbar.css:75` `.oj-topbar__menus` becomes the containing block; `:87-108` `.oj-menu-confirm` + `__body` + `__actions` |
| Test | `src/components/Shell/__tests__/w6CleanMenuConfirm.test.tsx` — a stubbed global `confirm` is asserted *never called*; the dialog appears, the canvas is untouched until answered, Cancel keeps the patch, "Clear canvas" clears it, an empty canvas asks nothing, Escape dismisses; plus a recursive UI-021 grep over **`src/components/Toolbar` and `src/components/Shell`** proving zero `confirm(`/`alert(`/`prompt(` outside comments |

## 3 — `role="alertdialog"` confirms take focus and give it back; capture keeps focus

`data-autofocus` is honoured by `Modal` on **open**, not when new content appears
inside an already-open dialog — so P9's in-panel confirms announced into nothing.
And activating a keycap unmounted the `Button` and mounted a plain `<span>`, so
`document.activeElement` was `<body>` for the whole capture.

One shared rule, one place: **new** `src/components/Shell/confirmFocus.ts`
(`useConfirmFocus`) — focus the confirm's *first, safe* action on open; on close
put focus back where it came from, or on the element the caller names when the
opener is gone or has been disabled by the very action just taken. It only fires
on a real open/close while mounted, so a `Modal` closing over it keeps its own
restore.

| | |
|---|---|
| Change | `src/components/Shell/confirmFocus.ts` (new, 68 lines) |
| | `src/components/Settings/KeybindingsPanel.tsx:280-284` both confirms wired; `:402` capture box is `tabIndex={-1}`; `:255-266` focus it on mount and hand focus back to its keycap when the gesture ends (skipped when a conflict Callout takes over — it returns focus itself); `:412` `data-keycap={action.id}` is the marker the restore looks up; `data-autofocus` moved from "Reset all" onto "Keep mine", so the marker names the element that actually receives focus |
| | `src/components/Shell/AppMenuBar.tsx:59` same hook; restore target is the File trigger, because `DropdownMenu` closes on activation **without** restoring focus |
| Test | `src/components/Settings/__tests__/w6CleanConfirmFocus.test.tsx` — capture box is `activeElement` for the whole gesture and hands focus back on both land and Escape; reset-all focuses "Keep mine" (not "Reset all") and restores to the trigger; when "Reset all" disables its own trigger focus goes to the panel's search field, never `<body>`; the conflict dialog focuses Cancel and returns focus to the row after **both** Cancel and Replace |
| | `src/components/Shell/__tests__/w6CleanMenuConfirm.test.tsx` — the menu confirm focuses Cancel on open and restores to the File trigger on close |

## 4 — "Replace" wears the danger tint

Unbinding someone else's shortcut is the consequential choice inside a
danger-toned card; it was painted `variant="primary"`, the most inviting colour
in the system. Now one grammar with the reset-all confirm: secondary / danger.

| | |
|---|---|
| Change | `src/components/Settings/KeybindingsPanel.tsx:477` `variant="primary"` → `variant="danger"` (with the reason in place) |
| Test | `w6CleanConfirmFocus.test.tsx` — "Replace" has `oj-btn--danger` and **not** `oj-btn--primary`. The menu-bar test asserts the same for "Clear canvas" |

## 5 — three dead rules out of `Guide.css`

`.guide-code`, `.guide-code-block`, `.guide-latency-unit` — no reference anywhere,
and unlike the `ResizeHandles` / `PanelSeparator` families they are not
template-generated, so nothing can reach them.

| | |
|---|---|
| Change | `src/components/Guides/Guide.css` — 460 → 432 lines; the section head at `:363` is now "External links" |
| Test | `src/components/Guides/__tests__/w6CleanGuideCss.test.ts` — two-sided: the rule must be absent from the stylesheet **and** the class absent from the Guides source, so re-adding one without the other fails here rather than in a browser; plus a guard that `.guide-latency-value.good`, `.guide-step.in-progress` and `.guide-external-link` (all live) survived |

## 6 — the waveform editor repaints on a theme change

The canvas is the one surface CSS cannot restyle — its colours are baked into
pixels at draw time — and `readWavePalette()` was only reached from two effects
keyed on `[audioBuffer, zoom, scrollOffset, …]`. A theme switch left the old
palette stranded until the player happened to zoom or drag.

| | |
|---|---|
| Change | `src/components/Clips/WaveformEditorModal.tsx:104` `paletteVersion` state, bumped by `openjammer:theme-change` **and** `storage` (a theme changed in another tab); `:318` and `:386` both draw effects depend on it |
| Test | `src/components/Clips/__tests__/w6CleanWaveformTheme.test.tsx` — a recording 2D context captures every `fillStyle`; dispatching the event repaints with the new token values and none of the old; the storage event does the same; unmounting stops the listening |
| Proved red | yes — dropping `paletteVersion` from the two dep arrays fails 2 of the 3 |

## 7 — the Speaker's meter reads the shared `meterScale`

`SpeakerNode` carried a byte-identical private copy (P6b flagged it while wiring
the Microphone and the Recorder to the shared one). Two definitions of "how loud
does this look" is one too many: the canvas meter and the transport pill's master
meter must agree.

| | |
|---|---|
| Change | `src/components/Nodes/SpeakerNode.tsx:25` imports `meterScale` from `../Shell/masterSignal`; the local copy (was `:74-83`) deleted. `masterSignal.ts` already exported it — no change needed there |
| Test | `src/components/Nodes/__tests__/w6CleanSpeakerMeterScale.test.tsx` — source guard (imports the shared one, defines none of its own) plus a deliberate **no-change** behavioural assertion: the bar is written `meterScale(level).toFixed(3)` for 0.02 / 0.1 / 0.5 / 1, silence stays at the floor, and a muted speaker stays silent |

---

## Verification

| Command | Result |
|---|---|
| `bun run test:run -- src/components/Toolbar src/components/Shell src/components/Nodes/__tests__ src/components/Clips src/components/Settings src/components/Guides` | **149 passed, 0 failed.** 3 suites fail to *import* — see "other lanes" below |
| `bunx tsc --noEmit -p tsconfig.app.json` | clean for every file this round owns |
| `bunx eslint src/components/Toolbar src/components/Clips src/components/Settings src/components/Guides src/components/Nodes/SpeakerNode.tsx src/components/Shell` | clean, 0 errors 0 warnings |
| `bun run test:run -- src/components/Arrangement/__tests__/tokenLiteralGate.test.ts` | 6 passed — the new `.oj-menu-confirm` block introduces no colour literal and no retired token |

New tests added by this round: **35** across 6 files (2 + 8 + 9 + 7 + 3 + 6).

### Other lanes' errors (not this round's, listed separately as asked)

A lane is mid-edit on the Keyboard/Library node files while this ran. As of the
final sweep:

- `src/components/Nodes/KeyboardVisualNode.tsx:37` — `Cannot find module './keyboardAssignment'`; the module does not exist yet. This takes down three suites at **import** time: `NodeWrapper.reconnect.test.tsx`, `portDomContract.test.tsx`, `w5p8Faceplates.test.tsx` (the last also imports `../keyboardAssignment` directly).
- `src/components/Nodes/LibraryNode.tsx` — 15 `tsc` errors: `nodeRef`, `Port`, `IconRestore`, `IconTrash`, `IconStopGlyph`, `IconPlayGlyph` undefined at `:1181-1288`, plus 11 unused imports/locals. Earlier in the run this surfaced as a runtime `ReferenceError: nodeRef is not defined` in `portDomContract.test.tsx`.
- `src/store/graphStore.ts:22` — `'normalizeKeyboardModes' is declared but its value is never read`.

None of these files are touched by W6-CLEAN (`git status` confirms the only
sources changed here are the seven listed above plus the new `confirmFocus.ts`
and the five test files).

### Not verified

- **No audio was played, no browser was opened** (memory-constrained host, jsdom only). Nothing in this round touches the audio path — the Speaker change is a `meterScale` de-duplication whose output is asserted byte-identical — but the *rendered* placement of two new surfaces is unproven: the collab popover's restored 8px gap under its trigger, and `.oj-menu-confirm`'s position under the File menu in both themes. Both want one screenshot pass when a browser is available again.
- The **"No project in that folder"** confirm needs a real File System Access API failure to reach; only the New Canvas confirm is exercised by tests. Its code path is the same `setConfirming` shape.
