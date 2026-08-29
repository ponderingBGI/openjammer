# W4-P9 — REVIEW GATE (panels, dialogs, secondary surfaces)

Reviewer: Opus 5, product-design gatekeeper. Read-only pass — nothing was edited, staged or committed.
Artifacts: `plans/redesign-new-dna/.scratch/w4-p9-gate/` (35 gate screenshots light+dark, `gate.mjs`,
`probe2.mjs`, `gate-results.json`, `probe2.json`). Browser: one Chromium, `node`, dev server on 5225,
stopped after the run.

## Verdict: **COMMIT**

Every gate is green, every load-bearing claim in `W4-P9-REPORT.md` reproduced independently, and the
must-fix list for P9-owned code is **empty**. Three findings below belong to other lanes or to the
follow-up queue.

---

## Gates (re-run, not taken on report)

| Gate | Result |
|---|---|
| `bunx tsc --noEmit -p tsconfig.app.json` | ✅ clean — **zero errors, including from other lanes** |
| `bunx eslint src` | ✅ clean |
| owned vitest scope + `keybindingsCatalogue` + `tokenLiteralGate` | ✅ **16 files / 122 tests** (matches the claim exactly) |
| `bun run build` | ✅ built in 3.98s (dev server stopped first, as the lane warned) |
| browser sweep, light + dark | ✅ 35 shots, **0 console errors, 0 page errors** |

## Scope correction (record this in the commit message)

`src/store/keybindingsStore.ts` has **zero uncommitted changes**. The 169-action catalogue, the
`KeybindingAction.mode` field and the `Escape → Esc` naming the report claims in §3 are already in
`HEAD` (landed with `7781c5e`, the W3-TA2 timeline lane). Verified: 131 inline ids + 9 marker slots +
29 keybed letters = **169**, of which 57 `arrangement.*` and 48 `pianoroll.*`; the panel's own
"169 shown" chip agrees. P9's real contribution here is the **test** —
`src/store/__tests__/keybindingsCatalogue.test.ts`, new and untracked. The commit should say
"catalogue test", not "catalogue + 101 actions".

---

## Per-surface verdicts

| Surface | Verdict | Notes |
|---|---|---|
| **Settings shell** | ✅ | Modal + PanelHeader (title, per-tab subtitle, version Chip) + vertical Tabs. Selection RISES; the `SettingsPanel.css:97` inked-edge rule is gone (grepped — no `inset 0 -1px` anywhere). Escape closes, focus trapped, focus **restored to the gear** (`openerBefore: Settings` → `focusRestoredTo: Settings`). Initial focus lands on Close. |
| Appearance | ✅ | Theme `radiogroup` of `Swatch`es with roving tabindex + arrow selection (UI-024 closed), Density `SegmentedControl`, "Redo setup". Tab cycle = 5 stops, all inside the dialog, cycling cleanly. |
| Audio | ✅ | Honest latency hero: `132 ms · Too much delay for live playing` with a danger dot and `Browser` / `48.0 kHz` chips — no sub-5ms marketing anywhere. Toggle + tips Callout + Advanced disclosure. Native halves remain founder-verify. |
| Keybindings | ✅ | 169 actions, grouped by category with a surface Chip; search works; surface filter works; capture box replaces the cap in-place; conflict is a danger `Callout` **inside the row**; reset-all is an in-panel `role="alertdialog"`. |
| Updates / About | ✅ | Both speak the shared `.oj-set-*` grammar. |
| **Guides** | ✅ | **UI-026 closed**: `stepStatusClass()` maps `in_progress → in-progress` and `Guide.css` has both `.guide-step.in-progress` and `.guide-step-status.in-progress`, plus an `sr-only` status word so state is never colour alone. Sections are real `<button aria-expanded>`. The collapsed "Completed" section renders at full height (the 8.8px squash is fixed). `.guide-latency-value.good` in `--success-ink` is a **verdict**, not decoration — correct. |
| **DevLog** | ✅ | Dialog measures **962px, zero clipped children** — the "Ask AI to fix this" button is fully visible. Filter chips carry counts, no dots. |
| **Plugins** | ✅ | Search + `All/Built-in/Installed` + family chips + `Add` rows with no "● Ready" decoration; honest footer *"This build doesn't host plugins — built-in only."* in warning ink. `tokenLiteralGate` green. |
| **Export** | ✅ | Browser tier **states** format/bit-depth as Chips with the reason beside them instead of showing unreadable disabled controls — the right call. 4-up rate, tail segmented, mono preflight chip, honest tier Callout. |
| **Dialogs (Relink)** | ⚠️ unverified | CSS + copy only (hairline rows, `--border-subtle` footer). Needs a real broken library — honestly declared. |
| **MIDI** | ✅ (1 taste flag) | Browser is one scroller, cards are real buttons, keycap footer `Tab / Enter / Esc`. Emoji device glyphs are the only saturated non-brand colour on the panel (declared deviation #5). |
| **Collab** | ✅ code / ⚠️ render | `position: fixed` island gone; control is `relative`, panel `absolute; top: calc(100% + --space-sm); right: 0`. No `0 0 Npx` glow anywhere. Peer colour is a dot beside `--text-primary`. **But the rendered popover is flush to the window edge with no gap** — see finding 1. |
| **AudioHealth / IssueReporter / Bench** | ✅ | Verdict Callout above the table; mono tabular rows; `CodeBlock`; hairlines. |
| **Clips / waveform editor** | ✅ (1 follow-up) | Modal + PanelHeader + selection Chip; `readWavePalette()` reads live tokens once per render pass, DSP untouched, no literals. Theme-follow caveat → finding 2. Dead-rule removal claim verified (the 7 names survive only inside the explanatory comment). |
| **common** | ✅ | `PanelSeparator` / `ResizeHandles`: the "dead" direction classes are template-generated (`resize-handle-${handle}`, `panel-separator-${orientation}`) and `ALL_HANDLES` is the component default — keep-on-doubt is correct, and documented in the file header. `ScrollContainer.css` is 8 lines of `scrollbar-width`/`scrollbar-color` only; no WebKit duplication. |
| **AppErrorBoundary** | ✅ | Literal-only by design, with the reasoning at the top of both files, a `prefers-color-scheme: dark` block and a `prefers-reduced-motion` block. **Every selector maps to a class used in the TSX and vice versa** — no dead rules. Verified by reading (forcing a throw is too invasive for a read-only gate). |

## Impeccable bar

- **Contrast — reproduced exactly.** Independent canvas-byte measurement gives the identical numbers:
  tightest pair `--text-muted` on `--bg-tertiary` = **4.57 light / 4.50 dark**. Every token pair clears
  AA in both themes. On-accent/accent 5.08 / 6.27; danger-ink 5.59 / 5.70 on inset.
- **Rendered-element sweep** (every visible text node in every dialog measured against its *actual
  painted* background, both themes, ~20 surfaces): **one** sub-4.5 result — the `Reset All to Defaults`
  button at 4.05 / 3.97 — and it is measured in its **disabled** state, which WCAG 1.4.3 exempts. No
  enabled text anywhere in P9's surfaces falls below its floor.
- **Focus ring:** every `:focus-visible` rule in all 13 owned directories resolves to `var(--focus-ring)`.
  Zero bespoke rings.
- **Reduced motion:** with `reducedMotion: 'reduce'`, **zero** elements inside the Settings dialog report
  a running animation or a transition > 50ms.
- **Keyboard-only traversal:** Settings opens with Enter on the gear, initial focus in-dialog, Tab cycles
  5 stops on Appearance without escaping, `ArrowDown ×2` moves *and* selects to Keybindings, Tab then
  walks search → surface filter → every keycap in order, Escape closes, focus returns to the gear.
- **Hygiene:** zero hex/rgb/hsl literals in any owned `.css` or `.tsx` outside `AppErrorBoundary`; three
  inline colours, all `peer.color` (data). **Zero retired tokens.** **Zero `confirm(`/`alert(`/`prompt(`
  in P9's files** — UI-021 closed for this lane (the survivors are `Nodes/LibraryNode.tsx:980,1155,1367`
  and `Shell/AppMenuBar.tsx:113,169`, other lanes' — see follow-ups).

---

## Ranked findings

**Must-fix (P9-owned): none.**

**Must-fix (cross-lane, before Wave 6 closes)**

1. **`Topbar.css:107-114` is NOT dead — it is live and actively wrong.** The lane read it correctly in
   spirit but the wording matters for whoever does the cleanup. `.oj-topbar .collab-control { position:
   static }` cancels P9's `position: relative`, so the popover's `absolute` anchor falls back to
   `.oj-topbar` (full window width) and the compensating `right: 0` pins it to the **viewport edge with
   no gap under the trigger** — visible in `dark-collab.png`: the panel spans x=1140→1440 while the
   "Collaborate" button sits at x≈1296, and there is no rule/shadow separating it from the topbar. The
   two blocks must be deleted **together** (deleting either alone breaks it); doing so restores
   trigger-anchored placement with an 8px gap. P9 was right not to touch a file it does not own.

**Should-fix (P9, not blocking)**

2. **Keyboard capture drops focus to `<body>`.** Activating a keycap with Enter unmounts the `Button` and
   mounts a `<span>` in its place, so `document.activeElement` becomes `body` for the whole capture
   (measured twice, filtered and unfiltered list). It recovers — the live region announces, Escape
   cancels, Tab returns to the same row, the pane keeps its scroll — but for the duration of the gesture
   there is no focus ring and no focused control. Making the capture box a `tabIndex={-1}` element that
   is `.focus()`ed on mount, and restoring focus to the keycap button on completion, closes it.
3. **The in-panel confirm never takes focus.** `data-autofocus="true"` on "Reset all" is not honoured —
   the Modal applies autofocus on open, not when new content appears (`confirmFocusAfterOpen` = still
   `Reset All to Defaults`). A `role="alertdialog"` that does not receive focus is an ARIA smell. Same
   applies to the conflict Callout.
4. **Waveform-editor canvas does not repaint on a theme change.** `readWavePalette()` is called inside
   two `useEffect`s keyed on `[audioBuffer, zoom, scrollOffset, startHandle, endHandle]`; nothing listens
   for `openjammer:theme-change`, so a theme switch with the editor open leaves the canvas in the old
   palette until the user zooms or drags. Low exposure today (the Modal's scrim and `useModalKeymap`
   put every theme control out of reach while it is open), so this is a latent bug, not a live one — but
   it is three lines: bump a `paletteVersion` state on the event and add it to both dep arrays.
5. **Tone: "Replace" is `variant="primary"`.** In the conflict Callout the consequential choice —
   unbinding someone else's shortcut, e.g. Undo — is painted in the most inviting colour, inside a
   danger-toned card. The reset-all confirm gets this right (`Keep mine` secondary / `Reset all` danger).
   Make them one grammar.
6. **Three genuinely dead rules in `Guide.css`:** `.guide-code`, `.guide-code-block`,
   `.guide-latency-unit` — no reference anywhere in the repo (not template-generated, unlike the
   `ResizeHandles` family). Minor against a 651→440-line cleanup, but they should go with it.

**Taste follow-ups (no action required to commit)**

7. Emoji device glyphs on `MIDIDeviceCard` are the only saturated non-brand colour in that panel
   (declared deviation #5). Candidate for the oj-ui icon set.
8. Scrolling panes (Settings pane, Plugins results) cut the last row mid-height with no fade or edge cue —
   correct behaviour, slightly unfinished read next to Linear/Figma.
9. The empty DevLog leaves ~500px of blank surface below "No log entries yet." Consider sizing to content
   or centring a calmer empty state.

**For other lanes' queues**

10. UI-021 survivors outside P9: `Nodes/LibraryNode.tsx:980,1155,1367` (three native `confirm()`s on
    destructive library deletes) and `Shell/AppMenuBar.tsx:113,169`. Neither is P9's; both still steal
    focus from a live instrument.

## Standing UNVERIFIED (accepted, correctly declared by the lane)

`RelinkSamplesDialog` (needs a library with files missing on disk) · `PluginWindowShell` (Tauri-only) ·
the native halves of Settings → Audio and Updates · the catalogue test is a source scan that under-reports ·
**no audio was played** — nothing in this lane touches the audio path, but the founder listening pass
still owes this commit a sign-off with sound running.
