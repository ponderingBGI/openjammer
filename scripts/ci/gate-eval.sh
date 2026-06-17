#!/usr/bin/env bash
# The aggregate "Merge gate" predicate (plan §1.3 / doc 05 §5), as ONE script so
# the gate job and its self-test share a single source of truth.
#
# Contract: FAIL unless every aggregated `needs` result is in {success, skipped}.
# A `skipped` need is a legitimately-conditional job (e.g. a path-filtered leg);
# any `failure` or `cancelled` red-walls the merge. Crucially this does NOT treat
# a job that was skipped *because an upstream errored* as a pass — GitHub reports
# that as `cancelled`/`failure` on the chain, which this catches.
#
# Usage: gate-eval.sh "<comma-separated needs.*.result>"
set -euo pipefail
results="${1:-}"
echo "needs results: $results"
# Comma-wrap so first/last tokens match the same ",token," pattern as the middle.
case ",$results," in
  *",failure,"*)   echo "::error::a required job failed";          exit 1 ;;
  *",cancelled,"*) echo "::error::a required job was cancelled";   exit 1 ;;
esac
echo "All required jobs passed (success or legitimately skipped)."
