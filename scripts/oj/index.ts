#!/usr/bin/env bun
// scripts/oj/index.ts — the merged `oj` developer CLI arg router.
//
// One binary, six entry points:
//   oj doctor     [--json] [--fix] [--from-files [<files...>]] [--check <id>]
//   oj preflight  [--json] [--affected] [--plan] [--base <ref>]
//   oj plan       [--json] [--base <ref>]
//   oj scaffold   <node|dsp-kernel> ...     (planned — exits 2)
//   oj dev        [--engine] [tauri-flags…]  (native dev loop; --engine = bacon inner-loop)
//   oj design     <map|status> [--json]      (design-system bridge: component-map + sync health)
//
// Shared lib/ (git, cache, ssot, report) means version-sync logic lives ONCE.
// Exit code: non-zero only when a hard failure occurs (any check status `fail`,
// a preflight recipe failure, or a not-yet-implemented subcommand).

import { doctor } from './doctor';
import { preflight } from './preflight';
import { plan } from './plan';
import { scaffold } from './scaffold';
import { dev } from './dev';
import { design } from './design';
import { setup } from './setup';
import { render } from './render';
import { author } from './author';
import { song } from './song';

interface ParsedFlags {
  json: boolean;
  fix: boolean;
  affected: boolean;
  plan: boolean;
  fromFiles: boolean;
  install: boolean;
  yes: boolean;
  dryRun: boolean;
  wasm: boolean;
  check?: string;
  base?: string;
  /** Positional / passthrough args after flags are consumed. */
  rest: string[];
}

function parseFlags(argv: string[]): ParsedFlags {
  const f: ParsedFlags = {
    json: false,
    fix: false,
    affected: false,
    plan: false,
    fromFiles: false,
    install: false,
    yes: false,
    dryRun: false,
    wasm: false,
    rest: [],
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    switch (a) {
      case '--json':
        f.json = true;
        break;
      case '--fix':
        f.fix = true;
        break;
      case '--affected':
        f.affected = true;
        break;
      case '--plan':
        f.plan = true;
        break;
      case '--from-files':
        f.fromFiles = true;
        break;
      case '--install':
        f.install = true;
        break;
      case '--yes':
      case '-y':
        f.yes = true;
        break;
      case '--dry-run':
        f.dryRun = true;
        break;
      case '--wasm':
        f.wasm = true;
        break;
      case '--check': {
        const v = argv[i + 1];
        if (v === undefined || v.startsWith('--')) throw new Error('missing value for --check');
        f.check = v;
        i += 1;
        break;
      }
      case '--base': {
        const v = argv[i + 1];
        if (v === undefined || v.startsWith('--')) throw new Error('missing value for --base');
        f.base = v;
        i += 1;
        break;
      }
      default:
        f.rest.push(a);
    }
  }
  return f;
}

function usage(): void {
  process.stdout.write(
    [
      'oj — the OpenJammer developer CLI',
      '',
      'Usage:',
      '  oj doctor    [--json] [--fix] [--from-files [<files...>]] [--check <id>]',
      '  oj preflight [--json] [--affected] [--plan] [--base <ref>]',
      '  oj plan      [--json] [--base <ref>]',
      '  oj scaffold  <node|dsp-kernel> ...   (not yet implemented)',
      '  oj dev       [--engine] [tauri-flags...]',
      '  oj setup     [--install] [--yes] [--dry-run] [--wasm] [--json]',
      '  oj render    [--graph g.json] [--schedule s.json] [--secs n] [--out w.wav]',
      '               [--report r.json] [--assert expr]...   (device-free audition)',
      '  oj author    <patch.json> [--out g.json] [--render <render-flags...>]',
      '               (friendly node/wire spec -> OjGraph via emitOjGraph)',
      '',
      'oj dev: one-command native loop (Vite HMR + ojcore-native engine, unified',
      '        logs, clean Ctrl+C). --engine runs the windowless bacon inner-loop.',
      'oj setup: detect + install the native build prerequisites (Rust, MSVC/WebView2,',
      '          Linux system libs). Confirms before installing; --dry-run to preview.',
      '',
      'doctor checks: version-sync, credentials, coi-headers, docs-accuracy, toolchain,',
      '               native-readiness, protocol-mirror, node-registry, ssot-set-equality,',
      '               fault-pipe-connectivity',
      '',
    ].join('\n'),
  );
}

async function main(): Promise<number> {
  const [, , sub, ...rest] = process.argv;

  if (!sub || sub === '--help' || sub === '-h' || sub === 'help') {
    usage();
    return sub ? 0 : 2;
  }

  // `render` passes ALL its args straight to the offline audition bin (so its
  // `--graph/--schedule/--assert/--report` flags reach cargo unmangled by parseFlags).
  if (sub === 'render') return render(rest);
  // `author` lowers a friendly patch spec to an OjGraph via the headless emitOjGraph.
  if (sub === 'author') return author(rest);
  // `song` authors a whole Arrangement (the timeline feature), conducts it, renders
  // it device-free, self-grades, and exports a human-openable project. Passthrough
  // args (extra --assert/--secs) reach the render bin unmangled, like render/author.
  if (sub === 'song' || sub === 'arrange') return song(rest);

  let flags: ReturnType<typeof parseFlags>;
  try {
    flags = parseFlags(rest);
  } catch (e) {
    process.stderr.write(`oj: ${(e as Error).message}\n\n`);
    usage();
    return 2;
  }

  switch (sub) {
    case 'doctor':
      return doctor({
        json: flags.json,
        fix: flags.fix,
        check: flags.check,
        fromFiles: flags.fromFiles,
        // When --from-files is given trailing paths, use them; else read staged.
        files: flags.fromFiles ? flags.rest : undefined,
      });

    case 'preflight':
      return preflight({ json: flags.json, plan: flags.plan, base: flags.base });

    case 'plan':
      return plan({ json: flags.json, base: flags.base });

    case 'scaffold':
      return scaffold(flags.rest);

    case 'dev':
      return dev(flags.rest);

    case 'setup':
      return setup(flags.rest, {
        install: flags.install,
        yes: flags.yes,
        dryRun: flags.dryRun,
        wasm: flags.wasm,
        json: flags.json,
      });

    case 'design':
      return design(flags.rest, flags.json);

    default:
      process.stderr.write(`unknown subcommand: ${sub}\n\n`);
      usage();
      return 2;
  }
}

main()
  .then((code) => {
    process.exit(code);
  })
  .catch((e) => {
    process.stderr.write(`oj: fatal: ${(e as Error).stack ?? (e as Error).message}\n`);
    process.exit(1);
  });
