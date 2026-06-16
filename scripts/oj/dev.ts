// scripts/oj/dev.ts — STUB.
//
// `oj dev` will orchestrate the concurrent dev processes (vite + tauri) with
// cross-platform Ctrl+C / signal forwarding via Bun.$. This is the riskiest
// runtime surface (Windows signal handling), so it is built last and kept thin.
//
// TODO: implement concurrent child-process orchestration with signal forwarding.

export async function dev(_args: string[]): Promise<number> {
  process.stderr.write('dev: not yet implemented\n');
  return 2;
}
