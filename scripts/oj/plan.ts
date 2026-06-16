// scripts/oj/plan.ts — `oj plan` prints the selected `just` recipes without
// running anything. It delegates entirely to the preflight planner (so the
// selection logic lives once) by forcing --plan.

import { preflight } from './preflight';

export interface PlanArgs {
  json: boolean;
  base?: string;
}

export async function plan(args: PlanArgs): Promise<number> {
  return preflight({ json: args.json, plan: true, base: args.base });
}
