# Lessons — what review keeps finding

Every lane brief carries this file. Each entry is a pattern that cost a review round on this
codebase, with the rule that prevents it. Add one when a finding recurs; delete one when the
codebase makes it impossible.

1. **Something already does this.** Before writing a helper, hook, store or verb, grep for the
   idea, not the name. This branch grew four `generateWaveformPeaks`, two `formatDb`, two
   `ROW_KEYS`, two clipboards, two pan/zoom owners and nine verb catalogues this way.
2. **A change that removes nothing is briefed wrong.** Feature-shaped work still leaves the tree
   smaller somewhere: the shim it replaced, the branch it made unreachable, the test that asserted
   the old shape.
3. **Ids joined by string are a type that has not been written.** `keybindingsCatalogue.test.ts`
   exists only to fail when a registered `actionId` is missing from a catalogue that the type
   system should have carried. Do not add a test where a type would do.
4. **A test that asserts a mock was called tests the wrapper, not the behaviour.** Assert the
   store, the DOM, the emitted graph, the rendered audio. If nothing observable changes, ask why
   the code exists.
5. **Tests are filed by unit, not by wave.** `w5p7Faceplates.test.tsx` is a diary. The next
   person needs `SpeakerNode.test.tsx`.
6. **Re-read the store by id before mutating.** Action contexts and menu snapshots are for
   display and enablement; `run` reads live state.
7. **`{ record: false }` is for environment-driven updates only** (device lists, engine echoes).
   A user gesture that bypasses history is a bug the player finds with Ctrl+Z.
8. **The render thread allocates nothing.** In wasm as in native. `publish_levels` and the drains
   are on the render side; treat them so.
9. **Do not take a key the player is playing.** A bare letter on the canvas belongs to the Keys
   node; canvas verbs take a modifier. Binding-set order is the tiebreaker and it is the only one.
10. **One word per concept.** Delete is "Delete" on the key, in the menu, in the palette, in the
    undo title and in the announcement. Five labels for one verb is how a first-run player formed
    the wrong model.
11. **Private icon and glyph copies are not allowed.** `oj-ui` ships the icons; a faceplate that
    draws its own `IconTrash` forks the visual system.
12. **Never `git stash`, never `git add -A`, never checkout.** Other lanes share the tree. The
    orchestrator commits by pathspec after review.
13. **e2e never hard-codes a port.** Every lane runs its own preview on its own port; a spec that
    assumes 4173 fails the moment two lanes run.
14. **Cargo.lock re-resolves on every cargo run here.** `git checkout -- Cargo.lock` before a
    commit that did not intend to touch it.
15. **A comment that narrates the diff is deleted before commit.** Keep the *why* that a reader
    could not reconstruct; drop the "we changed X to Y because the review said so".
16. **Report what you could not verify.** A green tsc is not a heard note. Say which behaviour
    was seen, which was inferred, and which nobody has checked.
