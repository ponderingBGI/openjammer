# W4-P5 — Command bar (Ctrl+K palette + AI panel) + context menu → oj-ui Menu

Builder: Opus 5. Branch `t3code/openjammer-redesign-timeline`. Nothing committed.

**Gates (all green, run last after every change):**
`bunx tsc --noEmit -p tsconfig.app.json` ✅ · `bunx eslint src` ✅ (0 problems) ·
`bun run test:run` ✅ **194 files / 2096 tests** (lane subset: 6 files / 68 tests) ·
`bun run build` ✅.

Browser verification ran under `node` against **one** Chromium on **port 5208**
(vite preview of the production build for the palette/menu pass, vite dev for the
AI pass — see "Deviations"). Both harnesses report **zero console errors and zero
page errors** in both themes. The dev server is stopped and port 5208 is free.

---

## 1. What changed

### Palette shell — `src/components/CommandBar/CommandBar.css` (rewritten, 1274 lines)

The whole file is new. It is built to the handoff's menu physics rather than
rethemed:

| Where | What |
|---|---|
| `CommandBar.css:16-27` | `.command-bar-overlay` — top-aligned (`12vh`), flat `--overlay-scrim`, **no glass**; `z-index: var(--z-top)` (was `3000`/`--z-toast`, which the new shell chrome and the docked help panel sat *above* — the palette was being covered). |
| `CommandBar.css:31-65` | `.command-bar-container` — 640px, `--bg-node`, 12px radius, 1px `--border-subtle`, `--shadow-overlay`, `padding: 6px` (`.nj-menu`). Entrance = `command-bar-rise` on `var(--motion-spring)` (transform only) + `command-bar-fade` 120ms (opacity only). |
| `CommandBar.css:99-128` | `.command-bar-input` — `.nj-input` construction: surface fill, 1px `--border-strong`, `--radius-md`, `500 14px`, accent border + `--focus-ring` on focus. It stays a styled **cmdk** `Command.Input` slot (never replaced with oj-ui `Input`). |
| `CommandBar.css:132-233` | Results with oj-ui `ListRow` physics: `500 14px`, 8px radius, 8/10px padding, hover **and** selected fill `--bg-tertiary`, selected ink `--accent-ink`. Feedback is **colour only** — no border, transform or padding change, so nothing shifts under the pointer. |
| `CommandBar.css:139-161` | Category headers `600 10.5px` uppercase `.1em` `--text-muted`; inset hairline separators between groups (`::before`, `inset: 0 8px auto`). |
| `CommandBar.css:213-233` | Mono type `Chip` on node rows + right-aligned `Kbd` keycaps; both step onto `--bg-node` on a filled row so their edge survives the selection fill. |
| `CommandBar.css:237-258` | Empty state (teaching, centred). |
| `CommandBar.css:262-322` | Footer: `↑↓ navigate · ↵ run · Esc close` keycaps left, the agent affordance right. |

### Palette behaviour — `src/components/CommandBar/CommandBar.tsx` (414 → 535)

- **UI-028, exact-first.** `ranking.ts:20` `exactnessBoost()` adds `1_000_000` for an
  exact title match (with or without the `Add ` verb) and `10_000` for a word-prefix
  match; applied at `CommandBar.tsx:283`. The exact tier sits **above** the learned
  prefix-win boost (`100_000`), so what you typed beats what you usually type.
- **UI-028, no disabled default.** `CommandBar.tsx:305` — the controlled cmdk
  highlight is now `ranked.find(r => !r.action.disabledReason)`, so a disabled row can
  never be the default selection.
- **UI-028, the "Ask AI" pseudo-item is gone from the results.** It was a
  `Command.Item` that ranked, could be highlighted, and (in the browser) was a
  *disabled* row that searches fell through to. It is now a **footer affordance**
  (`CommandBar.tsx:499-517`) carrying the `Tab` keycap, with an honest
  "The agent runs in the desktop app" in its place when the platform has no agent.
  The one-key path survives without a fake row: **Enter on an empty result set**
  hands the query to the agent (`CommandBar.tsx:406-414`).
- **"Reset Ranking" is now a real ranked row** (`CommandBar.tsx:266-276`) injected into
  the candidate list instead of a pinned pseudo-item, so it matches, scores and
  disappears like everything else — and `ranked.length === 0` genuinely means empty.
- **Real keycaps.** `SHORTCUT_FOR` (`CommandBar.tsx:96`) maps four palette actions onto
  the keybinding actions they actually run; the cap is read live from
  `useKeybindingsStore` and rendered `<Kbd custom>` when remapped. Rows with no real
  binding get no cap — the palette never advertises a shortcut that does nothing.
- **Focus restore.** `CommandBar.tsx:190-200, 246-252` — the element focused before the
  palette opened is captured once per opening and refocused on close.
- **Escape backstop.** `CommandBar.tsx:268-283` — a document-level `keydown` that only
  fires when nothing inside already handled Escape (`defaultPrevented`). Without it
  Escape was **dead** wherever the panel had no text field to hang it on (the browser
  tier's desktop-only state, most obviously); this was reproduced in the browser
  before the fix and re-verified after.
- Placeholder is now `Search commands…` (the `(Tab to ask AI)` parenthetical moved to
  the footer where the key actually lives).

### AI panel

- `AiPanel.tsx:697-742` — header is oj-ui `PanelHeader`: back affordance, "Ask the
  agent", a session `Chip`, a **model chip that is a real button** (state shown once,
  at its point of control), then Rewind / New.
- `AiPanel.tsx:848-880` — composer row: `↵ send · ⇧↵ newline · Ctrl+Z undoes anything`
  as `Kbd` caps, primary `Send`, and a three-dot pulse while working. The composer
  itself keeps Textarea's construction in CSS (see Deviations).
- `AiPanel.tsx:800-840` — slash items are `List`/`ListRow` with the source label in the
  row's `actions` slot and a two-column grid inside the body.
- `AiPanel.tsx:1002-1052` — rewind rows are `ListRow`s under a `PanelHeader` with the
  `↑↓ / ↵ / Esc` caps.
- `AiPanel.tsx:1105-1134` — the browser tier is a `PanelHeader` + oj-ui `Callout`
  ("AI requires the desktop app"), a primary **Get the desktop app** (opens
  `/download`) and a ghost **Back to search**. No dead input anywhere; the panel hugs
  its content instead of reserving a half-screen of empty chat box.
- `AiPanel.tsx:606-621` + the per-view wrappers — the Escape cascade: composer/slash →
  picker → chat → search → closed.
- `ChatMessage.tsx:19-27, 47-52` — the blinking caret is replaced by `StreamingDots`
  (three mono-scale dots), static under reduced motion.
- `Markdown.tsx:37-42` — fenced blocks render through oj-ui `CodeBlock`, so an exact
  tool/verb payload is the same mono, hairline-bounded block it is everywhere else.
- `ActionChip.tsx:23-45` — the bespoke pill is now an oj-ui `Chip` (`tone="danger"` on
  failure, dashed accent edge for a self-edit).
- `ModelPicker.tsx` — `PanelHeader` + `List`/`ListRow` + `Chip` metadata + `Spinner`
  while loading; the `↑↓ / ↵ / Esc` hints moved into the header.
- `SessionPicker.tsx` — `PanelHeader` + the same hint caps.
- `AuthChooser.tsx` — `PanelHeader`; the non-dismissible data-training notice is a
  `Callout variant="danger"` (still `role="note"`, still no dismiss control); the key
  and base-URL inputs are `Field` + mono `Input` with a description; primary `Button`
  with `loading` while storing.
- Message cards: user = `--bg-node` + hairline, agent = `--bg-tertiary`
  (`CommandBar.css:437-476`).

### Context menu → oj-ui `Menu` — `ContextMenu.tsx` (233 → 436), `ContextMenu.css` (102 → 95)

`ContextMenu.css`'s bespoke engine is **deleted**. The menu is now
`Menu`/`MenuItem`/`MenuCategory`/`MenuSeparator`; the CSS only positions the panel and
replaces oj-ui's `:hover` disclosure with a state-driven one.

- **UI-003.** Roving focus + Home/End come from oj-ui `Menu`. This lane adds:
  ArrowRight/Enter/Space to disclose (`ContextMenu.tsx:349-354`), ArrowLeft to close
  and return focus to the category row (`:356-361`, and inside the submenu `:390-395`),
  **typeahead** on the row *label* (`:364-385` — matching `textContent` would have made
  every row start with its category emoji), an Escape **cascade** (`:186-195`), and
  focus restore to the pre-open element (`:170-176`). Disclosure is driven by
  `data-open`, never `:hover`, so touch and keyboard reach a submenu exactly the way a
  mouse does; `ContextMenu.css:47-59` turns oj-ui's hover engine off for this surface.
- **UI-004.** One layout effect measures, flips and clamps **both** panels
  (`ContextMenu.tsx:221-283`), re-running on resize and on a `ResizeObserver` (the panel
  settles late — webfonts and the emoji glyphs changed its height by 46px, and clamping
  once against the stale height is exactly how it hung off the screen).
- Two real positioning bugs found in the browser and fixed:
  1. The menu rendered **inside `.node-canvas`**, whose ancestor carries a transform —
     so `position: fixed` was not viewport-relative and the clamp missed by the height
     of the topbar (measured: root bottom 843px in an 800px viewport). It is now
     **portalled to `document.body`** (`ContextMenu.tsx:402-408`), with the
     containing-block offset subtracted as a belt-and-braces (`:239-244`). React events
     still bubble through NodeCanvas's tree, so its props and handlers are untouched.
  2. Clicking a category **toggled** it, and since hover had already opened it, the
     click shut the submenu the player was reaching for. A click now always discloses
     (`ContextMenu.tsx:419-424`).
- **UI-031.** `ContextMenu.css:88-93` — explicit `animation: none` under
  `prefers-reduced-motion` (on top of the blanket rule in `global.css`).
- The submenu abuts the parent **panel** edge, not the row's (`ContextMenu.css:61-71`)
  — oj-ui's default overlapped the panel by its own 6px padding.

---

## 2. Decisions

1. **The palette is not oj-ui `Modal`.** `Modal` blurs its scrim (the brief says *no
   glass*), traps `Tab` (which is the palette's agent handoff, not focus traversal),
   and sits at `--z-modal` — below the settings panel the palette must cover. The
   bespoke portal + scrim is kept and documented.
2. **The "Ask AI" row is removed, not fixed in place.** The audit (UI-028) is about a
   pseudo-item that ranks and steals selection; keeping it as a row and merely
   demoting it would leave the same failure mode one ranking change away. Enter on an
   empty result set preserves the D2-A2 intent (one key from a failed search to the
   agent) without a fake result.
3. **Result rows are ListRow *physics*, not the `ListRow` component.** cmdk's
   `Command.Item` owns its own element and `data-selected`; wrapping it would fight
   cmdk's selection model. Every list the palette does *not* own (slash, rewind,
   models) uses the real component.
4. **Keycaps only where a binding exists.** Four palette actions map to real
   keybindings; the rest show none.
5. **Escape is handled twice on purpose** — in-tree per sub-view (precise target) and
   at the document as a backstop (never dead). The backstop bails on
   `defaultPrevented`, so they can't both fire.

---

## 3. Tests

`bun run test:run -- src/components/CommandBar src/components/Canvas/__tests__` →
**6 files / 68 tests, all passing** (was 5 / 49).

New / rewritten:

- `CommandBar.test.tsx` — empty state teaches Tab and there is **no** `[cmdk-item]` at
  all (UI-028); Enter on empty hands off to the agent; an **exact** title match ranks
  first *above* a learned prefix win; a **disabled** row is never the default
  selection; the agent affordance is a footer button carrying the `Tab` cap and is not
  inside a `[cmdk-item]`; focus returns to the pre-open element on Escape; node rows
  carry a mono type chip; the reduced-motion block covers the container and the dots.
- `ranking.test.ts` (new) — the two boost tiers, including that the word-prefix tier
  stays *below* and the exact tier *above* the palette's `100_000` prefix-win boost.
- `ContextMenu.test.tsx` — first row focused on open; ArrowDown/Home/End; ArrowRight
  discloses and focuses the submenu's first item; ArrowLeft closes and returns focus;
  Escape cascades (submenu, then menu); typeahead; focus restore on unmount; a submenu
  that would clip the right edge **flips** (`data-flipped`, `right: 100%`) under a
  stubbed geometry; reduced-motion block present.

`e2e/journeys/J6-agent-session.spec.ts` is **unchanged** — it drives the agent entirely
through `window.__openjammerE2E` and asserts on the arrangement/history, never on AI
panel selectors, so nothing in this lane touches it. (Read in full to confirm.)

---

## 4. Measured contrast (both themes, computed from the token sources)

`bun plans/redesign-new-dna/.scratch/w4-p5/contrast.mjs` — every text pair clears AA
(4.5:1) in **both** themes. Worst cases:

| Pair | Where | light | dark |
|---|---|---:|---:|
| `accentInk` on `bgTertiary` | selected result row, markdown link, self-edit chip | 5.33 | 5.96 |
| `textMuted` on `bgTertiary` | `Kbd` keycap glyph on a rest row, streaming dots | **4.57** | **4.50** |
| `textMuted` on `bgNode` | category headers, footer hints, keycap on a filled row | 5.49 | 5.05 |
| `textSecondary` on `bgTertiary` | mono type chip, reasoning pill, YOLO toggle | 5.92 | 6.18 |
| `textSecondary` on `bgNode` | type chip on a filled row, auth hints | 7.13 | 6.93 |
| `textPrimary` on `bgTertiary` / `bgNode` | row label, agent bubble / user bubble | 14.17 / 17.05 | 12.81 / 14.36 |
| `dangerInk` on `bgNode` / `bgTertiary` | error text, YOLO, failed chip | 6.73 / 5.59 | 6.39 / 5.70 |
| `successInk` on `bgTertiary` | current-model chip | 5.29 | 6.06 |
| `textOnAccent` on `accentPrimary` | primary Send / Get the desktop app | 5.07 | 6.26 |

The keycap glyph is the tightest at 4.50:1 in dark — it passes, and the rule that puts
a keycap on `--bg-node` inside a filled row lifts it to 5.05 exactly where the row fill
would otherwise squeeze it.

**One non-text ratio recorded, not fixed here:** `--border-strong` on `--bg-node` is
1.73:1 (light) / 1.78:1 (dark) — the search field's boundary. This is the design
system's own input construction (D5: *"inputs/toggles keep `--border-strong` + focus
ring"*, and `--border-control` is reserved for rings with no fill delta). It is
mitigated in practice: **the palette's search field is always focused while the palette
is open**, so it always wears the accent border + `--focus-ring`. Changing it would
diverge this one field from every other input in the app; flagged for the orchestrator
rather than relitigated here.

---

## 5. Screenshots — `plans/redesign-new-dna/.scratch/w4-p5/`

Every file exists in `--light` and `--dark`.

| File | State |
|---|---|
| `01-palette-open` | palette on open, learned "top picks", mono type chips |
| `02-palette-results` | `speak` → **Add Speaker ranks first and is selected** |
| `03-canvas-after-add` | Enter added the Speaker node |
| `04-palette-empty` | `zzz` → teaching empty state |
| `05-ai-panel` | browser tier: the honest `Callout` + download + back |
| `06-context-menu-root` | right-click menu, root panel |
| `07-context-menu-submenu` | submenu disclosed by **ArrowRight**, keyboard focus inside |
| `08-context-menu-corner` | opened at the bottom-right corner: root clamped, submenu **flipped left** |
| `10-auth-chooser` | provider chooser |
| `11-auth-detail` | Zen detail: Callout notice + Field + mono Input + primary |
| `12-chat-welcome` | chat: PanelHeader + session/model chips, starters, composer, footer |
| `13-slash-menu` | slash commands (three columns, ListRow selection) |
| `14-model-picker` | model picker header/hints/input + honest empty state |
| `15-chat-conversation` | a real scripted turn: user bubble, agent card, **markdown + CodeBlock + inline code**, action chips |

Harnesses (kept, re-runnable): `shots.mjs` (palette + context menu, production build),
`ai-shots.mjs` (AI panel), `contrast.mjs`.

Machine assertions inside `shots.mjs`, all passing in both themes: `speak` ranks
Speaker first *and* selects it; Enter adds a node; the empty state renders; the Esc
cascade leaves **0** palette containers; ArrowRight discloses exactly one submenu;
ArrowLeft closes it; Escape closes the menu; at the corner the root box is
`(1068, 476.25, 200×311.75)` → bottom **788 ≤ 800**, right **1268 ≤ 1280**, and the
submenu is `(889, 692, 180×88)` → flipped left of the root and inside the viewport.

### Things I changed *after* looking at the captures

1. Palette was **underneath** the shell chrome and the first-run toast → raised to
   `--z-top`.
2. Context menu hung 34px **off the bottom** of the viewport at the corner → the
   transform/containing-block bug; portalled + offset-compensated.
3. Clicking a hovered category **closed** its submenu → click always discloses.
4. Submenu **overlapped** the parent panel by 6px → abuts the panel edge (both sides).
5. Slash rows collapsed into a stack (the grid was on the row, whose children are
   ListRow's own slots) → grid moved onto `.oj-list-row__body`, source into `actions`.
6. Browser-tier empty state taught **nothing** (the Tab line is correctly hidden with
   no agent) → it now says "Try a node name — Speaker, Looper, Effect."
7. Desktop-only and auth panels reserved a half-screen of empty box → they hug.
8. AuthChooser rows ran full-bleed to the panel edge and the free-key link stretched
   full width → inset list/field, `align-self: flex-start` on bare buttons.
9. Doubled focus ring on menu rows (`global.css`'s blanket `:focus-visible` outline
   ties oj-ui's `outline: none` on specificity) → settled at the surface that owns the
   roving focus.

---

## 6. Deviations (with reasons)

| # | Deviation | Reason |
|---|---|---|
| D1 | Palette shell is not oj-ui `Modal` | no glass; `Tab` must not be trapped; needs to sit above `--z-modal`. Decision 1 above. |
| D2 | Result rows are ListRow *physics* in CSS, not the component | cmdk owns the item element + `data-selected`. Every non-cmdk list uses the real `List`/`ListRow`. |
| D3 | Composer is a native `<textarea>` styled to oj-ui `Textarea` | the composer needs a `ref` (focus, caret placement) and `Textarea` is not `forwardRef`. Same for the rewind list container, which needs a ref to own its arrow keys. |
| D4 | `--border-strong` on `--bg-node` measures 1.73/1.78:1 | D5's sanctioned input construction; the field is always focused in the palette. Flagged, not silently changed. §4. |
| D5 | Palette `z-index` `--z-toast` → `--z-top` | it was being covered by the new shell chrome and the help panel. Sonner toasts still float above (a notification over a palette is correct). |
| D6 | Panel-hug uses `:has()` | Chromium/Safari/Firefox all support it; without it the panel simply keeps the fixed height (graceful). |
| D7 | AI-panel screenshots came from the **dev** server | `page.route` had to rewrite `src/engine/capabilities.ts` to lift the browser row to the desktop one; the production bundle is served through a service worker + HTTP cache that bypass interception. The palette/context-menu pass ran against the **production build**. Both on port 5208, one Chromium each. |

---

## 7. UNVERIFIED

1. **Anything that needs a live Pi subprocess.** The model picker's *populated* rows
   (Chips for provider / session / reasoning / current), `/resume`'s session list, the
   rewind picker with real turns, streaming, and the YOLO confirm sheet were exercised
   only as far as the browser tier + the e2e mock reach. Their empty/loading states are
   captured and correct; the populated rows are **visually unverified** and need a
   native run.
2. **Saving a provider key** cannot complete in a browser (OS keychain). The chat was
   reached via the `Configure AI provider` → back path instead; the *success* handoff
   after `storeKey` is unverified here (it is covered by `AuthChooser.test.tsx` at the
   unit level).
3. **Audio.** This lane touches no audio path, so there is no listening pass to report.
   Per the covenant, a founder pass with sound playing is still the gate for the wave.
4. **macOS/Windows-native keycap glyphs** (`⌘` vs `Ctrl`) were only seen on Windows.
5. **Reduced motion** is asserted structurally (the CSS blocks exist and the blanket
   `global.css` rule covers the rest); it was not re-screenshotted under emulation.
6. **Other lanes were editing the app throughout** (S4's topbar/onboarding/help panel,
   P3's oj-ui components). The screenshots include their in-flight chrome. The `.oj-help`
   panel and the first-run toast were removed in the harness so this lane's surfaces
   could be judged on their own.
