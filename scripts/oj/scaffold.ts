// scripts/oj/scaffold.ts — planned (Phase 3).
//
// `oj scaffold node|dsp-kernel` will write the coupled files from templates/ and
// AST-insert (via ts-morph, anchored on stable marker comments) the registry
// entry + NodeType union member + BOTH NodeWrapper `switch (node.type)` blocks,
// then run `oj doctor --from-files <written>` to prove coupling. This requires
// ts-morph AST splicing which is deferred to Phase 3.
//
// TODO(phase-3): implement ts-morph AST splicing against the @@oj-scaffold:*@@
// anchor comments in types.ts / registry.ts / NodeWrapper.tsx.

export async function scaffold(_args: string[]): Promise<number> {
  process.stderr.write(
    'scaffold: not yet implemented (Phase 3 needs ts-morph AST splicing)\n',
  );
  return 2;
}
