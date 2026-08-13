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
# Usage:
#   gate-eval.sh "<comma-separated needs.*.result>"
#   gate-eval.sh --strict-success "<comma-separated required job conclusions>"
set -euo pipefail
mode="allow-skipped"
if [ "${1:-}" = "--strict-success" ]; then
  mode="strict-success"
  shift
fi

results="${1:-}"
echo "needs results: $results"
# Comma-wrap so first/last tokens match the same ",token," pattern as the middle.
case ",$results," in
  *",failure,"*)   echo "::error::a required job failed";          exit 1 ;;
  *",cancelled,"*) echo "::error::a required job was cancelled";   exit 1 ;;
  *",timed_out,"*) echo "::error::a required job timed out";       exit 1 ;;
  *",startup_failure,"*) echo "::error::a required job failed to start"; exit 1 ;;
  *",action_required,"*) echo "::error::a required job needs action";    exit 1 ;;
esac

if [ -n "$results" ]; then
  IFS=',' read -r -a tokens <<<"$results"
  for token in "${tokens[@]}"; do
    case "$token" in
      success) ;;
      skipped)
        if [ "$mode" = "strict-success" ]; then
          echo "::error::a selected required job was skipped"
          exit 1
        fi
        ;;
      *)
        echo "::error::unexpected required job result: ${token:-<empty>}"
        exit 1
        ;;
    esac
  done
fi

if [ "$mode" = "strict-success" ]; then
  echo "All selected required jobs passed."
else
  echo "All required jobs passed (success or legitimately skipped)."
fi
