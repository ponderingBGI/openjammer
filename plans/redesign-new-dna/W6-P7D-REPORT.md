# W6-P7D — the follow-ups that were blocked on other lanes

**Lane:** W6-P7D. **Date:** 2026-08-31 · Branch `t3code/openjammer-redesign-timeline`
(worktree `t3code-2faff191`) · Windows 11 · `bun` only · Playwright under `node`, one
Chromium, dev on `:5234` (stopped after the run).

**Method.** Every item is closed by a change *plus* a test that fails on the code that was
there before, and then re-measured in a real browser in both themes. To prove the tests are
pins rather than decorations, the pre-fix files were pulled out of `HEAD` with `git show`
(no checkout, no stash), dropped into the working tree, the suites re-run, and the files put
back. Raw evidence: `plans/redesign-new-dna/.scratch/w6-p7d/` — `check.json`,
`contrast.json`, the two probe scripts, and 8 screenshots (`{keytile, library-missing,
relink-dialog, faceplates}-{light,dark}.png`).

**Gates**

| Command | Result |
|---|---|
| `bun run test:run -- src/components/Nodes src/store packages/oj-ui` | **933 passed / 83 files**, exit 0. No flakes. |
| `bunx tsc --noEmit -p tsconfig.app.json` | exit 0, no output |
| `bunx eslint src/components/Nodes src/store src/components/Dialogs packages/oj-ui/src/components/KeyTile` | exit 0, no output |
| `bunx figma connect parse` | exit 0 — parses, `KeyTile.figma.tsx` included |
| `git diff --check` on the lane's files | exit 0 (only the repo's usual LF→CRLF warnings) |
| app console + page errors, both themes | **0** |

---

## 1. `agentPending` on the four P7 faceplates

**Was:** `NodeShell` renders `.is-agent-pending`, but only when its owner passes
`agentPending`. W6-FIX wired seven components and left the four P7 faceplates as follow-up
F11 because P7c was editing them. So an agent that minted a Looper, a Sampler, a Sampler
key-map or a Library showed the player nothing — on the four cards an agent is *most* likely
to mint, since they are the ones a "make me a beat" request produces.

**Changed** — `useIsAgentPending(node.id)` (the hook `NodeWrapper` already uses; no new
state, no new prop shape), exactly the shape of the seven that landed:

| File | import | hook | `agentPending` |
|---|---:|---:|---:|
| `src/components/Nodes/LooperNode.tsx` | `:92` | `:314` | `:1023` |
| `src/components/Nodes/SamplerNode.tsx` | `:30` | `:130` | `:534` |
| `src/components/Nodes/SamplerVisualNode.tsx` | `:35` | `:129` | `:164` |
| `src/components/Nodes/LibraryNode.tsx` | `:73` | `:147` | `:1530` |

**Pin:** `src/components/Nodes/__tests__/agentPendingRing.test.tsx` — the four types joined
`OWNED`, so the file now covers **every** node component that renders its own `NodeShell`
(14 types × mid-run + after-run, plus the baseline row): **29 tests**. Verified as a pin by
stripping the four `agentPending={…}` lines back out: **4 failed / 25 passed**, one per new
type; restoring them turned all 29 green again.

**Verified live** (`check.json`, both themes), driving the real `agentSessionStore` into
`phase: 'running'` with an empty `runBaseline` and adding the four types through the real
graph store:

```
light AND dark — 4 added cards, 4 wearing the ring:
  oj-node is-agent-pending schematic-node looper-node
  oj-node is-agent-pending schematic-node sampler-node
  oj-node is-agent-pending schematic-node sampler-visual-node
  oj-node is-agent-pending schematic-node library-node
after the run: 0 cards pending
```

---

## 2. `RelinkSamplesDialog` — the loop is closed

**Was:** the *state* was real and rendered — `libraryStore.ts:53` declares
`status: 'missing'`, `LibraryNode.tsx` puts `.is-missing` on the row, `LibraryNode.css:573`
paints it `--danger-ink` and strikes the name — but the **producer** was dead.
`checkMissingItems()` had no caller a player could reach (transitively dead behind
`relinkLibrary`, itself dead behind a dialog nothing imported). The app shipped a red
struck-through row for a state it could never enter, and a recovery nothing could open.

### The three points, wired

**MISSING-1 — the producer.** `src/components/Nodes/LibraryNode.tsx:236–262`: an effect runs
`checkMissingItems(effectiveLibraryId)` when the card's library is `ready` and has been
scanned at least once. It keys off a **scan stamp** (`status:lastScanAt`,
`LibraryNode.tsx:206`), not the `libraries` object — `libraries` gets a new identity on every
store write, including every per-file tick of a scan, and this effect touches the filesystem.

Two guards went into the store so the producer cannot lie, both in
`src/store/libraryStore.ts`:

- `:837` — after restoring the root handle, `if (!(await verifyPermission(handle, false)))
  return []`. On a reload the directory handle survives in IndexedDB but the permission does
  not always survive with it, and every `getFileHandle` in the walk then throws
  `NotAllowedError` — which the existing `catch` reads as *file missing* and would strike
  through the player's entire folder. "I am not allowed to look right now" is not "they are
  gone". `requestIfNeeded: false`, because an effect has no user gesture to spend on a prompt.
- `:808` — `if (!library.handleKey) return []`. A library with no handle key was never linked
  to a folder; that is malformed state, not lost files.

The walk stays **out of history** by construction (it writes through the store's own `set`,
and `libraryVerbs`' design note is that a directory scan must never push an undo entry).

**MISSING-2 — the affordance.** `LibraryNode.tsx:1560–1581`: a `danger` Callout above the
panels, `library-missing`, titled *"N samples moved or went missing"*, with one control —
*"Relink N missing samples…"*. A banner, not a modal: a folder that moved is not an
emergency, and a live instrument never has focus taken from it to be told about one. It is
`danger` to match the `--danger-ink` the struck rows already carry, so the banner and the
rows are one statement. Styles: `LibraryNode.css` `.library-missing{,__body,__cta}`, built
the same way as the existing confirm strip.

**MISSING-3 — the recovery.** `LibraryNode.tsx:1904–1915` mounts the dialog; its `onClose`
re-runs the walk, so the count after the sheet closes is the answer to what the player just
did (relink three of five and the card says two, no reload, no second gesture).

A fourth thing had to exist for any of this to repaint at all: `LibraryNode` read its items
through `getItemsByLibrary()`, a store **action** — a read with no subscription — so nothing
re-rendered when an item's `status` flipped. `LibraryNode.tsx:166` subscribes `s.items`;
`:273` derives `allLibraryItems` from it (the same one-line filter the action did) and
`:441` feeds the file list from that. One source, and the struck-through row can now actually
appear.

### The dialog, audited against DESIGN.md

It was already Modal-based and mostly New DNA (W4-P9). What changed:

| `RelinkSamplesDialog.tsx` | Change | Why |
|---|---|---|
| `:109`, `:143`, `:206` | every mutation through `recordSealedLibraryEditAsync` | undo — see below |
| `:174–223` | **new** "Relink the whole folder" route, calling `relinkLibrary` | the commonest way to reach this sheet is *the folder moved*, and then every row is missing at once. Matching 400 files one at a time is not a recovery, and the auto-locate walks the whole tree once **per file**. `relinkLibrary` re-points the library root in one gesture and every item resolves by the relative path it already stores. It existed for exactly this and had no caller — this is that caller, so a dead production line is now used. |
| row action | `loading={…}` instead of swapping the label `Browse… → Browsing…` | the Button owns the busy treatment; a control whose word changes under the pointer moves the row |
| `isBusy` | one picker at a time, footer included | two native pickers open at once is not a state |
| copy | *"File System Access API not supported. Please use Chrome or Edge."* → *"This browser cannot open a folder. Chrome or Edge can."*; *"No matching files found…"* → *"Nothing in that folder matches these names."*; title `Missing Samples` → `Missing samples` | the app's own voice (`LibraryNode`'s onboarding says the first one verbatim); sentence case like every other panel title |
| `handleClose` | deleted (a wrapper that only called `onClose`) | |
| `RelinkSamplesDialog.css` `.relink-actions` | `flex: 1 1 200px` on the two routes | they shared a row unevenly and wrapped into two differently-sized centred pills; now they line up either way |

Type: `.relink-sample-path` is 11px **mono** (a path is an exact value — legal, and the
Mono-Means-Exact rule's own example); everything else is ≥13px. One focus ring (the Modal's
own); one accent fill in the view.

### The undo decision — **sealed**, with reasoning

A relink is a library mutation, so it goes on the stack. It goes on **sealed** (inverse :=
forward), the same recorder `emptyTrash` and `permanentlyDeleteItem` use, because its payload
is destroyed **outside** the store: `relinkItem` writes the new `FileSystemFileHandle` into
IndexedDB and then `idbDel`s the old key; `relinkLibrary` overwrites the root handle with
`persistHandle`. A plain reversible step would restore a record whose `handleKey` points at
nothing — a row that says *available* and plays silence, which is precisely the lie
`libraryVerbs`' sealed recorder was written to prevent.

There is also nothing to go back **to**. Undoing a relink means restoring the broken pointer
that sent the player here; the state it would return is the failure, not a version of their
work. So: the step is recorded, `Ctrl+Z` consumes it and changes nothing, and — the part that
matters on stage — it does **not** fall through into the previous graph entry, which on a
fresh canvas is still "add the Library node" and would take the card off the screen.

**One gesture, one undo:** a row's *Browse…* is one step; *Search a folder by name* is ONE
step for the whole sweep however many files it matches (the bracket wraps the loop,
`:143–166`); *Relink the whole folder* is one step.

### SPIN-1 — a real bug this work uncovered

`LibraryNode`'s auto-scan effect depended on the whole `libraries` object and retried on any
status but `scanning`. A scan that **fails** (`restoreHandle` empty, or permission refused)
writes `status: 'error'` into `libraries` → new object identity → the effect re-runs →
retries the same doomed scan. Nothing changes between attempts, so it never recovers and
never stops: a card on the canvas pinning the main thread with IndexedDB reads while the
player is trying to play. It is not hypothetical — it hung a vitest worker until the pool
killed it, which is the same thing the player's tab does.

Fixed at `LibraryNode.tsx:213–234`: the effect keys off the same scan stamp, and `error` /
`permission_needed` are terminal until the player acts. They are not dead ends — `addLibrary`
and `relinkLibrary` both put the library back to `ready`, which moves the stamp and lets the
effect fire again. No capability is lost; an automatic retry that cannot succeed is removed.

### Pin

`src/components/Nodes/__tests__/libraryMissingSamples.test.tsx` — **14 tests**, the loop in
the order it runs: the walk marks the right item and only that one; marks nothing on a lapsed
permission (and never prompts); marks nothing for an unlinked library; marks everything when
the root itself is gone; never touches the undo stack; the card calls it; the card does *not*
call it for an unscanned library; **a failed scan is not retried**; the banner states the
count, strikes the row and offers one control; it stays quiet when nothing is missing; the
banner opens the sheet with the same items and both folder routes; a successful relink clears
the banner; a relink is one **sealed** step that `Ctrl+Z` consumes without moving anything;
and the dialog uses the sealed recorder for all three routes with the sweep's bracket around
the loop.

**Pin verified:** the three pre-fix files (`LibraryNode.tsx`, `RelinkSamplesDialog.tsx`,
`libraryStore.ts`) restored from `HEAD` → **8 of 14 fail**. The six that still pass are the
ones asserting behaviour that already existed (the walk itself marks files; the root-gone
branch; `recordSealedLibraryEditAsync` works when called directly) — what those six exist for
is to stop the *new* behaviour regressing, and the seventh test ("is the recorder the dialog
actually uses") is the one that fails on the old dialog.

### Measured live (`check.json`, `contrast.json`)

Seeded a library whose root handle is genuinely absent from IndexedDB — the real "the folder
is gone" state — and let the card's own effect do the walk. No stubs.

```
statuses after the card mounted:  { a: missing, b: missing, c: missing }
banner:  .oj-callout--danger.library-missing  "3 samples moved or went missing"
CTA:     "Relink 3 missing samples..."
rows:    3 × .library-file-row.is-missing, text-decoration: line-through
sheet:   role="dialog"  aria-label="Missing samples"
         buttons: Browse... ×3 · Relink the whole folder · Search a folder by name · Close
         rows:    kick-room.wav · rim-soft.wav · pad-evening.wav
```

Contrast, resolved the way Chromium **paints** it (colours pushed through a 1×1 canvas and
read back, so `oklch()`/`oklab()`/`color-mix()` are exact rather than parsed):

| Run | light | dark |
|---|---:|---:|
| banner title (`--danger-ink`) | 6.72 | 6.39 |
| banner body | 7.13 | 6.93 |
| banner CTA | 14.17 | 12.81 |
| struck row name on the inset | 5.59 | 5.70 |
| **sheet — worst of 7 probes** | **5.08** (primary on accent) | **5.05** (mono path) |
| sheet runs below AA | **0** | **0** |
| sheet ≥2px borders / hard offset shadows | 0 / 0 | 0 / 0 |

Screenshots: `library-missing-{light,dark}.png`, `relink-dialog-{light,dark}.png`.

### The one thing I did NOT do, and why

`LibraryNodeData.missingItemIds` (`engine/types.ts:428`, initialised to `[]` in
`engine/registry.ts:658`) is **still never written**. The W6-FIX plan said to write the walk's
return into it. I deliberately did not, for two reasons:

1. **It would make a background scan undoable.** `graphStore`'s `set` wrapper diffs every
   write and records a `setNodeData` verb, so `updateNodeData(node.id, { missingItemIds })`
   from an effect pushes an undo entry for a filesystem check the player never asked for.
   That is exactly the failure `libraryVerbs`' "opt-in, never a blanket wrapper" note exists
   to prevent, one domain over.
2. **It is a second record of a fact that already has a home.** `LibraryItem.status` is the
   SSOT, it is already written by `checkMissingItems`, and it is already what
   `LibraryNode.tsx:1171` renders. Two records of one fact is the drift this codebase keeps
   deleting. Worse, `node.data` is *persisted project state*: a `.oj` file would carry "these
   were missing last Tuesday on some other machine", which is derived, environment-specific
   and wrong the moment it is opened elsewhere.

So the banner derives from the store (`LibraryNode.tsx:283`). **The field should be deleted**
— one line in `engine/types.ts:428` and one in `engine/registry.ts:658` — but both files are
outside this lane's ownership, so I am reporting it rather than doing it. It is dead today
and it was dead before; nothing regressed.

---

## 3. The redundant `.library-tag .oj-list-row__body` rule

**Was:** `LibraryNode.css` carried a local restatement of `ListRow`'s body layout with its own
removal instruction — *"the day `.oj-list-row__body` is a flex line in the component, DELETE
this rule"*. `ListRow.css` landed that in **06fa8c7** (`display: flex; align-items: center;
gap: var(--space-xs); flex: 1; min-width: 0`).

**Changed:** the rule is gone (`LibraryNode.css`, the comment in its place says why and
records the accepted delta). The sibling `.library-file-row .oj-list-row__body` **stays** —
it is not redundant, it overrides `flex` and carries the filename's 120px floor — but it was
trimmed to only those two declarations instead of restating the component's three.

**The measured delta, accepted:** the dot-to-name gap is now `--space-xs` (**4px**) where the
local copy hard-coded **6px**. The token wins: a tag row's in-row gap is the same gap every
other list row in the app spends, and one consumer holding a private 6px is the drift the
component landing was meant to end.

**Measured live**, both themes:

```
.library-tag__dot        7.63 × 7.63 px   (8px CSS box; 7.63 is the canvas zoom, not a shrink)
.oj-list-row__body       display: flex    column-gap: 4px
```

**Pin:** `w5p7Faceplates.test.tsx` — the F2 test now injects **both** sheets, which is the
real cascade: the flex line has to come from the component. (Injecting only `LibraryNode.css`,
as it did, would pass on the pre-deletion file and fail on this one — it would pin the
duplication in place.) It asserts `display: flex`, `align-items: center`, the dot at 8×8, and
`gap: var(--space-xs)`. A second test asserts the sheet contains no
`.library-tag .oj-list-row__body` at all, and that the file-row rule keeps `min-width: 120px`
and no longer restates `display`/`align-items`. Both fail on the pre-deletion file (the first
one is what caught the change in the first place).

---

## 4. The KeyTile label — the micro mono voice, not 13px

**Was:** `packages/oj-ui/.../KeyTile.css:142` set the `--key` legend
`font: 600 min(11px, …)/1 var(--font-sans)` — a **sans run at 11px on the default canvas**,
the most-looked-at surface in the app, and the live 13px-floor break W6-FIX's gate logged as
follow-up F3. It was also the **only** `var(--font-sans)` in the file: the base tile is
`600 10px/1 mono` and the hint chip `500 9px/1 mono`.

**The choice: move the face, keep the size.** Three things point the same way:

- DESIGN.md §5's own KeyTile entry already specifies *"a bottom-anchored **10px mono**
  legend"*. The sans was the deviation, not the spec.
- §3 assigns `--text-xs` (11px) to JetBrains Mono and names **"Keycaps"** as its first use.
- **13px does not fit.** `KeyTile.test.tsx`'s own geometry model says a `size={34}` key would
  start its label stack at **15.75px** against a socket band that ends at **18.3px** — the
  legend would sit under the well, which is the one thing the file exists to prevent. (The
  sums: axis 34 → `--port-size` 12.75, inset 1.7, gap 2.856 → band 17.3, `contentTop` 18.3;
  base 4.25 → `contentBottom` 28.75; a 13px label ⇒ `stackTop` 15.75.)

**Changed** — `packages/oj-ui/src/components/KeyTile/KeyTile.css`:

- `:153` — `var(--font-sans)` → `var(--font-mono)`. The size-relative `min(11px, axis × 0.23)`
  is untouched, so every P3c geometry case keeps its numbers.
- `:160–163` — **new** `.oj-key-tile--key .oj-key-tile__label { letter-spacing:
  var(--tracking-micro); text-transform: uppercase; }` — the micro-label discipline that buys
  the sub-13px step. Scoped to the legend so the 9px hint chip, which has its own padding on
  a 34px-wide key, keeps its measured width.

**Pin:** `KeyTile.test.tsx` — a new assertion parses every rule in the sheet, finds every
declared size (shorthand `font:` **and** `font-size:`), and fails any block under 13px that
does not name `var(--font-mono)` in the same block — the same strict rule `typeFloor.test.ts`
holds the app sheets to, because "it happens to inherit mono from an ancestor" is exactly how
an 11px sans run ships. It also asserts `var(--font-sans)` appears **nowhere** in the file,
and that the tracking + uppercase are there. Verified as a pin by flipping the face back:

```
AssertionError: expected [ '.oj-key-tile--key → 11px' ] to deeply equal []
```

The 13 KeyTile tests, including the 11-case label-over-socket geometry sweep, are green.

**Measured live** (`contrast.json`), the default canvas, **30** key tiles:

| | light | dark |
|---|---|---|
| legend | `11px JetBrains Mono`, `letter-spacing: 0.88px` (= .08em), `text-transform: uppercase` | same |
| distinct label faces on the canvas | **1** (`11px JetBrains Mono`) | 1 |
| sub-13px **sans** labels | **0** | **0** |
| legend contrast, idle | **17.05** | **14.36** |
| legend contrast, hit (`.is-active` on `--accent-primary`) | **5.43** | **5.16** |
| hint chip, idle / hit | 5.49 / 5.43 | 5.05 / 5.88 |
| label ∩ socket | **false** | false |

Screenshots: `keytile-{light,dark}.png` (and the legends are visible on the Keys card in
`library-missing-{light,dark}.png`).

---

## 5. Sub-13px sans on the four faceplates

Swept with `getComputedStyle` over every visible text run on each card, both themes
(`check.json`):

| Faceplate | runs | sizes present | **sub-13px sans** | worst contrast |
|---|---:|---|---:|---:|
| Library | 26 | 9.5 / 11 / 13 / 14 / 15 | **0** | 4.57 light · 4.50 dark (11px mono `--text-muted` on the inset) |
| Looper | 8 | 9.5 / 11 / 12 / 13 / 14 / 15 | **0** | (12px is the `ValueScrubber` mono value — DESIGN §5) |
| Sampler | 14 | 9.5 / 11 / 13 / 14 / 15 | **0** | 4.57 / 4.50 |
| Sampler key-map | 4 | 9.5 / 11 / 13 / 15 | **0** | 4.57 / 4.50 |
| Relink sheet | — | 11 / 13 / 14 / 22 | **0** | 5.08 / 5.05 |

Two things the sweep could not reach, found by reading the sheets instead:

- `LooperNode.css:287` — `.looper-layer__name .oj-editable-label__text` at `--text-xs`. It is
  **legal**: the card passes `mono` to `EditableLabel` (`LooperNode.tsx:1317`), so it is 11px
  JetBrains Mono. No change; noted so the next reader does not "fix" it.
- `SamplerNode.css:169–170` — `.node-plugin-error-badge`, `font-family: var(--font-sans);
  font-size: 10px`. That is a sub-13px sans **and** a size off the scale entirely. It renders
  only on a *hosted plugin in a degraded state*, so no capture of these four faceplates could
  see it; it is emitted by `NodeWrapper.tsx:554` (a "!" glyph in a 14px circle) but declared
  in a sheet this lane owns. **Left alone and reported**, not fixed: the badge is shared
  chrome for every node type, the file's own comment says it should move to
  `SchematicBase.css`, and changing a marker that appears at the exact moment a plugin has
  crashed is not something to do without seeing it crash. It is 10px sans in a 14px circle;
  the right answer is almost certainly `--font-mono` at `--text-xs`, in whichever lane owns
  the shared node chrome.

---

## 6. What I could NOT verify

- **No audio was playing.** Nothing in this lane touches the audio path — four `agentPending`
  props, one effect pair, one banner, one dialog, three stylesheet edits — but the covenant's
  own test was not run, and a taste-tier human should look at the Library card and the relink
  sheet on a real display.
- **A real relink was never performed.** `showOpenFilePicker` / `showDirectoryPicker` are
  native dialogs that headless Chromium cannot drive, so the browser pass verifies the state,
  the banner, the sheet and its contents — not the picker round-trip. The relink *result* and
  its undo behaviour are covered by the component test against the real store with a fake
  file handle, and the `relinkLibrary` path is covered only by the test, not live.
- **`Ctrl+Z` after a relink was not pressed in the browser** for the same reason. The sealed
  step is asserted through the real `historyStore` in the test (one entry; `undo()` consumes
  it; nothing moves).
- **The permission-lapse guard was tested with a stub**, not with a real revoked File System
  Access grant — that state cannot be produced headlessly.
- **Large libraries.** The card was measured with 3 items. `checkMissingItems` batches 50 and
  `allLibraryItems` is an `Object.values().filter()` per library-store write; neither was
  profiled against the thousands-of-files case the browser is meant to scroll.
- **1440×900 only.** No print styles, mobile widths or forced-colors.
- **Other lanes are editing this worktree live.** Mid-run, `bunx tsc` reported three errors in
  `src/store/arrangementStore.ts` (`Cannot find name 'returnToOriginArmed'`) that were not
  mine and that resolved on their own a minute later. The final gate run is clean, but the
  tree contains uncommitted work from at least the Arrangement/PianoRoll/transport lanes.

## 7. Risks

1. **The producer now runs on every Library card that has a scanned library.** It is async,
   batched and permission-guarded, but it does walk the real folder on mount. On a
   thousands-of-files library that is a real (one-off) IndexedDB + FS cost the card did not
   pay before. It is off the render path and off the audio path; if it ever needs throttling,
   the seam is the scan stamp at `LibraryNode.tsx:206`.
2. **`storeItems` subscribes the card to the whole library store.** Any item write now
   re-renders the Library node. That is what makes the missing state visible at all, and the
   card already re-rendered per file during a scan (`scanProgress` is subscribed), so this is
   not a new class of work — but it is more renders than before for tag edits and renames.
3. **The `--danger-ink` banner is the loudest thing on the card.** It is correct for the
   state, and it disappears the moment nothing is missing, but if a player hits a transient
   permission edge they will see a red banner — which is why the permission guard is in the
   store rather than in the card.
4. **SPIN-1's fix removes an automatic retry.** If some future `scanLibrary` failure is
   genuinely transient and self-healing, it will now wait for the player instead of retrying.
   That is the intended trade (a retry that cannot succeed is a hang), but it is a behaviour
   change to a path nobody had measured.
5. **The KeyTile legend is 11px mono where it was 11px sans.** JetBrains Mono is wider per
   character at the same size; a long legend ("SPACE" on the 34px-wide sustain key) has less
   room than it did. Nothing clipped in either theme at any of the 30 tiles on the default
   canvas, and the geometry model covers 34/48/50/74, but a consumer that passes a longer
   legend has slightly less headroom than before.
6. **`agentPendingRing.test.tsx` is still untracked** in this worktree (W6-FIX created it and
   the branch has not taken it yet). Whoever commits should make sure it lands with the four
   new rows, not without them.

## 8. Loose threads (found, not fixed)

| # | Item | Owner |
|---|---|---|
| **T1** | `LibraryNodeData.missingItemIds` is dead and should be **deleted** — `engine/types.ts:428` and `engine/registry.ts:658`. Reasoning in §2; the state it names lives correctly on `LibraryItem.status`. | whoever owns `src/engine/**` |
| **T2** | `.node-plugin-error-badge` is 10px **sans** and off the type scale (`SamplerNode.css:169`), emitted by `NodeWrapper.tsx:554`. Its own comment says it belongs in `SchematicBase.css`. | the shared node-chrome lane |
| **T3** | `RelinkSamplesDialog`'s per-file auto-locate walks the whole directory tree **once per missing file** (`findFileInDirectory`, depth 50). With the whole-folder route in front of it that is now the fallback rather than the main path, but it is still O(files × tree) and has no progress readout. One pass building a name→handle index would fix both. | a Library lane |
| **T4** | `LibraryNode`'s auto-select effect (`:190`) writes `libraryId` into `node.data` from an effect, which pushes a graph undo entry for something the player did not do — the same class of problem as T1, on a line that predates this lane. | a Library lane |
