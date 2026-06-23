// scripts/oj/render.ts — `oj render`: the device-free AUDITION wrapper.
//
// "Play this graph and tell me what it sounds like" — for an agent, CI, or a human,
// with NO audio device. A thin pass-through to the `ojcore-native` `render` bin (the
// offline "second clock"); every arg after `oj render` goes straight to it:
//
//   oj render                                   # the built-in demo arpeggio
//   oj render --graph patch.json --schedule notes.json --secs 2 \
//             --out take.wav --report verdict.json --assert is_stereo --assert 'rms>0.02'
//   oj render --dump-graph demo.json            # a worked OjGraph example
//
// Exit code is the bin's: 0 when every assertion (or the default non-silent band)
// holds, else 1 — so it is a real, scriptable test gate.

import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dir, '..', '..');

export async function render(args: string[]): Promise<number> {
  // `-q` so cargo's compile chatter doesn't muddy the render summary; `--features
  // demo` pulls the instrument loaders + serde the audition tool needs.
  const cmd = [
    'cargo',
    'run',
    '-q',
    '-p',
    'ojcore-native',
    '--bin',
    'render',
    '--features',
    'demo',
    '--',
    ...args,
  ];
  try {
    const proc = Bun.spawn(cmd, { cwd: ROOT, stdio: ['inherit', 'inherit', 'inherit'] });
    return await proc.exited;
  } catch (e) {
    process.stderr.write(`oj render: could not run cargo — is the Rust toolchain installed?\n`);
    process.stderr.write(`  (${(e as Error).message})\n`);
    return 127;
  }
}
