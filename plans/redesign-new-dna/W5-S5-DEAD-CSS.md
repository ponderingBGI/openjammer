# W5-S5 — dead-CSS candidates in the former `SchematicNodes.css`

Collected (not deleted) while splitting `src/components/Nodes/SchematicNodes.css`
into one stylesheet per node family. **Keep-on-doubt applies**: nothing here has
been removed. The faceplate lanes own the judgment call — most of this will be
rewritten by the redesign anyway, so the only reason to act now is if a lane
wants a smaller surface to retheme.

## Method

- Every class selector in the split files was extracted (218 distinct class
  names) and searched across **all** `.ts` / `.tsx` under `src/` and
  `packages/oj-ui/src/`.
- Two passes, deliberately generous (the brief's "quote-agnostic substring
  match, classes only"):
  1. **loose** — plain substring anywhere in any source file;
  2. **whole-token** — the name bounded by non-`[\w-]` characters, so
     `looper-duration` does not count as a hit for `looper-duration-input`.
- Keyframe names were checked separately (they are global, so a keyframe can
  only be dead if nothing in CSS *or* TS animates it).
- Scripts: `.scratch/w5-s5/dead.mjs`, `.scratch/w5-s5/weak.mjs`.

## Result: the file is essentially clean

**Zero** of the 218 classes are unreferenced under either pass. S3's socket
extraction appears to have already taken the obvious slack. Three candidates
survive on a stricter reading:

| Candidate | Now lives in | Evidence | Confidence |
|---|---|---|---|
| `@keyframes ghost-fade-in` | `InstrumentNode.css:130` | Defined once; **no** `animation` / `animation-name` in any stylesheet and no reference in any `.ts`/`.tsx` names it. Nothing can ever play it. | **High — dead** |
| `.looper-record-btn.armed` | `LooperNode.css:303` | `LooperNode.tsx:808` is the only place the class list is built: `` `looper-record-btn ${isRecording ? 'recording' : ''}` ``. There is no code path that adds `armed`. The word "armed" does occur elsewhere in `src/` (arrangement + AI code), which is why the loose pass keeps it alive. | **High — dead**, but see note |
| `@keyframes looper-armed-blink` | `LooperNode.css:312` | Referenced only by `.looper-record-btn.armed` above. Dies with it, survives with it. | Follows the row above |

### Note on `armed`

The Looper *engine* has a real armed state (`LooperState`, the "Armed state —
waiting for signal" comment the CSS still carries). The blink rule looks like
UI that was designed for it and never wired — i.e. code-value #8 ("every
production line is used") points at **wiring it**, not deleting it, if the lane
wants the armed affordance back. Deleting it silently would remove the only
design record of that state. That is exactly the judgment this list is handing
over.

## Explicitly *not* flagged

These read as dead to a naive scan but are not:

- State modifiers that are composed in template literals or shared across the
  app — `.selected`, `.active`, `.live`, `.muted`, `.playing`, `.recording`,
  `.disabled`, `.hover-connecting`. All are produced somewhere; several are also
  styled by more than one stylesheet (see the report's coupling table).
- Everything under the Library two-panel browser: it renders only after a folder
  is linked, so the W5-S5 computed-style proof never exercised it, but every one
  of its classes is emitted by `LibraryNode.tsx`.
