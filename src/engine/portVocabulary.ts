import type { PortDefinition } from './types';

/**
 * The one place the generic signal ports are named — and the one place their
 * retired spellings are listed.
 *
 * **The vocabulary.** A generic signal port is called `In` or `Out`. It used to be
 * called three different things on cards visible at the same time — `IN`/`AUDIO`
 * on Instrument, `AUDIO IN`/`AUDIO OUT` on Effect and Speaker, `INPUT`/`AUDIO` on
 * the Sampler — and the word "audio" was carrying information the SOCKET already
 * carries: colour is the type legend (teal audio, grey control, violet universal;
 * AGENTS.md's port law). A label repeating it is redundant at 9.5px and, at three
 * spellings, actively misleading. `In`/`Out` is the tersest pair that stays true.
 *
 * A port with a real name of its own — `Keys`, `Pedal`, `Sample`, `Row 1`,
 * `Pitch Bend` — keeps it. Only the generic pair is governed here. Accessible
 * names stay verbose ("Audio output"): the label is for the eye, the aria string
 * is for the ear.
 *
 * **Why one module.** The rename has to reach four seams that would otherwise
 * each carry their own list:
 *
 *  1. `registry.ts` / `nodeStandards.ts` / `dynamicRegistry.ts` — what a NEW node
 *     is born with (built-in, hosted VST3/AU/CLAP, AI-authored);
 *  2. `nodeInternals.ts` / `portSync.ts` — what a CONTAINER card derives from its
 *     internal children (this is where the Sampler's `Input`/`Audio` came from,
 *     and why renaming the registry alone left the screen unchanged);
 *  3. `graphStore.migrateNodePorts` — what a SAVED project comes back as;
 *  4. `ai/plan.ts` `resolvePlanPort` — what an AGENT is allowed to say.
 *
 * (3) and (4) are the two that need the retired names to keep RESOLVING rather
 * than merely being replaced, and they must never drift apart: a saved plan that
 * still says `"Audio Out"` has to reach the same port the loader renames. So they
 * read one map, here, not two lists in two files (code-value #2: extend the
 * pillar, never fork a parallel version).
 */

/**
 * The four port ids that are the generic pair.
 *
 * The rename is keyed on the ID, not on the name alone: a port a player typed
 * "Output" into by hand on a panel node is THEIR word, and renaming it would be
 * this system overwriting a person.
 */
export const GENERIC_PORT_IDS: ReadonlySet<string> = new Set(['audio-in', 'audio-out', 'in', 'out']);

/**
 * Retired spelling → current name, **per direction**.
 *
 * Direction matters and the first version of this map ignored it, which was a real
 * bug rather than a tidiness point: `'Audio'` means `Out` on a node's audio output
 * but `In` on the receiving side of an `output-panel`, and `nodeInternals` produces
 * exactly the pair `{ id: 'audio-out', name: 'Audio', direction: 'input' }`. A
 * direction-blind map migrated that saved port to `Out` — the wrong word, on a real
 * shape that exists in this tree.
 */
const RETIRED_BY_DIRECTION: Readonly<Record<'input' | 'output', ReadonlyMap<string, string>>> = {
    input: new Map([
        ['Audio In', 'In'],
        ['Audio', 'In'],
        ['Input', 'In'],
        ['In', 'In'],
    ]),
    output: new Map([
        ['Audio Out', 'Out'],
        ['Audio', 'Out'],
        ['Output', 'Out'],
        ['Out', 'Out'],
    ]),
};

/**
 * The current name for a generic port, given what a saved project (or an agent)
 * called it. Returns `undefined` when the name is not a governed spelling — the
 * caller then keeps whatever it already had.
 */
export function currentPortName(
    portId: string,
    portName: string,
    direction: 'input' | 'output',
): string | undefined {
    if (!GENERIC_PORT_IDS.has(portId)) return undefined;
    return RETIRED_BY_DIRECTION[direction].get(portName);
}

/**
 * Spellings that mean DIFFERENT ports depending on direction, and are therefore
 * unusable where direction is not known.
 *
 * Computed, not listed, so it cannot drift from the map above: `Audio` is the one
 * — it means `Out` on an output and `In` on an input, which is exactly the
 * container-panel shape that made the migration direction-aware in the first place.
 */
const AMBIGUOUS_SPELLINGS: ReadonlySet<string> = new Set(
    [...RETIRED_BY_DIRECTION.input.keys()].filter((name) => RETIRED_BY_DIRECTION.output.has(name)),
);

/**
 * Does `spoken` name `port`, allowing every retired spelling?
 *
 * This is the AGENT's half of the same map. `resolvePlanPort` used to compare
 * names with `===`, so the moment the vocabulary changed, every plan an agent had
 * already learned — including the worked example in `docs/agent-tools.md` — failed
 * `validate_plan`'s "ports exist" check. An agent is an untrusted GENERATOR, not a
 * trusted runner, and breaking the names it was taught is a contract break we own,
 * not a mistake it made. Matching the id is allowed too, because that is the one
 * spelling that never moves.
 *
 * **Ambiguous spellings are refused here even though the migration accepts them.**
 * A plan endpoint carries a `ref` and a port name and NOT a direction, so `Audio`
 * would match a node's input and its output equally — and `find()` would silently
 * take whichever the registry happens to list first, wiring a cable backwards from
 * a name the agent thought was precise. The loader has the direction (it is
 * reading a real port) and so it can honour `Audio`; the agent path does not, so
 * it must not guess. No agent was ever taught `Audio` anyway: it is a container
 * panel's internal name, never a name in `agent-tools.md`.
 */
export function portNameMatches(port: PortDefinition, spoken: string): boolean {
    if (port.name === spoken || port.id === spoken) return true;
    if (!GENERIC_PORT_IDS.has(port.id)) return false;
    if (AMBIGUOUS_SPELLINGS.has(spoken)) return false;
    const direction = port.direction === 'output' ? 'output' : 'input';
    return RETIRED_BY_DIRECTION[direction].get(spoken) === port.name;
}
