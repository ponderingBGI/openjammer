// scripts/oj/checks/protocol-mirror.ts — verify the oj-protocol-ts TS mirror has
// not drifted from the ojproto Rust wire contract by running the byte-exact
// parity gate `cargo test -p ojproto --test wire_shapes`. If cargo is ABSENT the
// check returns `skip` with a note (never crashes). A raw test failure is
// translated into the human meaning: the TS mirror drifted. Via Bun.$.

import { $ } from 'bun';
import type { CheckResult } from '../lib/report';

export const id = 'protocol-mirror';
export const name = 'ojproto <-> oj-protocol-ts wire parity (wire_shapes)';

async function cargoPresent(): Promise<boolean> {
  try {
    const out = await $`cargo --version`.quiet();
    return out.exitCode === 0;
  } catch {
    return false;
  }
}

export async function run(): Promise<CheckResult> {
  if (!(await cargoPresent())) {
    return {
      id,
      name,
      status: 'skip',
      detail:
        'cargo is not installed on this machine; the wire_shapes parity gate runs in CI / on a Rust-equipped rig.',
      fix: 'install Rust via https://rustup.rs to run this locally.',
    };
  }

  try {
    const out = await $`cargo test -p ojproto --test wire_shapes`.quiet().nothrow();
    if (out.exitCode === 0) {
      return {
        id,
        name,
        status: 'pass',
        detail: 'cargo test -p ojproto --test wire_shapes passed (TS mirror in sync).',
      };
    }
    const tail = lastLines(out.text() + '\n' + out.stderr.toString(), 12);
    return {
      id,
      name,
      status: 'fail',
      detail: [
        'wire_shapes parity gate FAILED: the oj-protocol-ts TS mirror drifted from the ojproto Rust wire contract.',
        '--- cargo output tail ---',
        tail,
      ].join('\n'),
      fix: 'update packages/oj-protocol-ts/src to match the changed ojproto serde wire shapes.',
    };
  } catch (e) {
    // Bun.$ can throw for spawn-level failures; never crash the doctor.
    return {
      id,
      name,
      status: 'skip',
      detail: `could not run the parity gate: ${(e as Error).message}`,
    };
  }
}

function lastLines(text: string, n: number): string {
  const lines = text.split('\n');
  return lines.slice(Math.max(0, lines.length - n)).join('\n');
}
