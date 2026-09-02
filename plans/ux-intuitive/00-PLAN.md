# Intuitive UX programme — plan

Written 2026-09-02 by the orchestrator. The redesign (`plans/redesign-new-dna/`) is one part of
this; it made every surface speak one language and every timeline gesture behave to spec. What
it could not do is prove the instrument is *obvious* — every check so far was written by the
people who built the thing. "Intuitive" is measured by a stranger's hands, not by the spec's
author. This plan closes that gap.

## Premise

PRODUCT.md sets the bar: *a novice is making sound in seconds and is never overwhelmed; the
tool disappears into the play; cables carry signal, a node is a box that does one thing.* The
capstone review (`plans/redesign-new-dna/FINAL-REVIEW.md` §2) already found seams that only
show when the lanes meet: palette adds stacking on one point, the starter clip opening in drum
mode, an uncarded step sequencer, three names for one port. Each lane was fine alone. The
programme therefore works app-wide and task-first, never surface-by-surface.

## Tracks

### Track 1 — LAND the redesign (today)

1. Resume `W6-SHIP` (Opus limit killed it mid-item; partial edits intact in the tree). Items 1–13:
   the four `{ record: false }` blockers, `#4A90C2`, palette spawn cascade, port vocabulary,
   drum heuristic, roll roving tabindex, `returnArmed` tests, doc truth, W6-BASE's B1–B3.
2. Orchestrator gates: `tsc`, lint, `test:run`, build, `test:cli`, `figma connect parse`. Commit
   by pathspec.
3. Resume `W6-BASE` for the baseline re-capture (spec + 18 snapshots + COVERAGE.md + reports).
4. PR → **`canari`** (not main) from `PR-DESCRIPTION.md`. Babysit: triage every review comment
   and check, fix valid findings, re-validate, merge only green. Founder listening pass with audio
   playing is a merge gate — nothing on this branch has been heard.

### Track 2 — FRESH HANDS (starts today, parallel, read-only)

Naive-user studies run by agents that are given **only** a persona, a musical goal and the
running app — no docs, no code, no hints. They think aloud, log *expected vs happened*, time
to first sound, dead ends, and whether they recovered. Each study is one Opus lane against its
own `vite preview` build (a frozen snapshot, so live edits in the tree cannot confuse it).

Personas (from PRODUCT.md §Users):

| id | persona | goals, in order |
|---|---|---|
| FH-1 | bedroom producer, first launch, laptop + trackpad | hear a sound · play a chord · put reverb on it · make a loop of it · save · reopen |
| FH-2 | laptop performer, dark stage, keyboard-only, mid-set | swap an instrument while the loop plays · undo a wrong move · mute one track · stop cleanly and return to the top · recover from "sound degraded" |
| FH-3 | sound designer, modular mental model | wire a generative rig from scratch · automate a parameter · rename/colour tracks · use Ctrl+K to do the same faster · find where latency/engine state is shown |
| FH-4 | coder who makes music | find how to author a node · install a plugin · open the docs from inside the app · understand what the agent will and won't do |

Output per study: `plans/ux-intuitive/FH-n-LOG.md` — numbered friction items, each with
expected / happened / seconds lost / recovered? / screenshot path / severity (S1 blocked,
S2 wrong model formed, S3 slowed, S4 cosmetic).

### Track 3 — HEURISTIC AUDIT (taste-tier, code-aware, parallel)

One Opus lane walks the app against PRODUCT.md's decision framework plus the instrument
heuristics that the specs never asked about:

- **Discoverability of hidden gestures** — drag-to-connect, double-click, Alt+double-click,
  right-click, `E`/`Q`, marquee, Tab between surfaces. Every hidden gesture needs a visible
  path too (menu item, palette entry, or contextual hint), or it is a secret.
- **Feedback for every verb** — does each action produce a visible (and where it should, an
  audible) confirmation within the frame? Silence after a click is the #1 "did that work?".
- **State honesty** — transport, engine health, latency tier, unsaved changes, what Space does
  right now.
- **Recoverability** — undo reach, Esc reach, a way back from every surface, no modal mid-set.
- **Vocabulary** — one word per concept across cards, menus, palette, docs.
- **Empty states and first-run** — what the paper says when there is nothing on it.
- **Keyboard-only session** — end to end, no mouse, both themes, reduced motion.

Output: `plans/ux-intuitive/HEURISTIC-AUDIT.md`, findings ranked, each with file:line.

### Track 4 — FIX WAVES (`UX-1`, `UX-2`, …)

Sourced from Tracks 2 + 3 plus the review's accepted follow-ups: beat-rig step sequencer as a
real card, the transport pill losing its `space` keycap the instant a rig lands, the arrangement
tool column speaking letters on one side and words on the other, the Library's lone solid accent
button, the faceplate type-chip contrast, keyboard port wiring, `abort()`/`undo()` selection
asymmetry. Each wave: builder lane with strict file ownership → adversarial gate that
**re-runs the exact fresh-hands task that surfaced the friction** → orchestrator gates → commit.
Second PR → `canari`.

## Ranking rule for fixes

`score = severity × personas hit × proximity to first run`. Anything an FH-1 persona hits in
the first two minutes outranks everything else. Correct-but-undiscoverable beats
discoverable-but-slightly-off.

## Done means

- Every persona reaches first sound in under 30 s with no hints.
- Every listed goal completed without docs by at least three of the four personas.
- No S1/S2 friction left on the first-run path; every S3 has a named owner or a written reason.
- Every hidden gesture has a discoverable twin.
- Founder has heard it with audio playing and signed the checklist.

## Constraints carried over

bun only · builders never `git add/commit/stash/checkout` · orchestrator commits by pathspec
after an adversarial gate · Playwright under `node` · private ports per lane (5240+) ·
≤3 concurrent Chromium lanes · codex quota returns 2026-09-03 18:26 (use it for bounded grind
and second-opinion review after that; never for feel).
