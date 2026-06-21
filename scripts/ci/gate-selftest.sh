#!/usr/bin/env bash
# Adversarial self-test for the aggregate-gate predicate (plan §1.3 must-fix):
# prove the gate red-walls on failure/cancelled and only passes when every result
# is success/skipped. Run locally and as a CI job feeding the gate, so a
# regression in gate-eval.sh fails the merge instead of silently passing.
#
# NOTE: deliberately NO `set -e` — we invoke a script that exits non-zero on
# purpose and must capture its code rather than abort.
here="$(cd "$(dirname "$0")" && pwd)"
fail=0

check() { # $1=results input  $2=expected exit code  $3=description
  if bash "$here/gate-eval.sh" "$1" >/dev/null 2>&1; then got=0; else got=$?; fi
  if [ "$got" != "$2" ]; then
    echo "FAIL [$3]: input='$1' expected exit $2, got $got"
    fail=1
  else
    echo "ok   [$3]: '$1' -> exit $2"
  fi
}

check_strict() { # $1=results input  $2=expected exit code  $3=description
  if bash "$here/gate-eval.sh" --strict-success "$1" >/dev/null 2>&1; then got=0; else got=$?; fi
  if [ "$got" != "$2" ]; then
    echo "FAIL [$3]: input='$1' expected exit $2, got $got"
    fail=1
  else
    echo "ok   [$3]: '$1' -> exit $2"
  fi
}

# Passing shapes: everything success, or a legitimately-conditional skip.
check "success,success,success" 0 "all green"
check "success,skipped,success" 0 "a conditional job skipped"
check "skipped,skipped"         0 "all skipped"
check ""                        0 "no needs"

# Red-wall shapes: any failure or cancellation anywhere in the list.
check "success,failure,success"   1 "a job failed (middle)"
check "failure,success,success"   1 "a job failed (first)"
check "success,success,failure"   1 "a job failed (last)"
check "success,cancelled,success" 1 "a job was cancelled"
check "failure"                   1 "single failure"
check "cancelled"                 1 "single cancellation"
check "timed_out"                 1 "single timeout"
check "neutral"                   1 "unexpected terminal result"

# Adversarial: a job that was skipped because an upstream errored shows up with a
# failure/cancelled in the chain — must NOT pass as "success-or-skipped".
check "success,failure,skipped"   1 "skip-due-to-error still red-walls"

# The live watcher uses strict mode for the selected jobs: a selected leg must
# complete successfully, never merely skip.
check_strict "success,success" 0 "strict all green"
check_strict "success,skipped" 1 "strict selected skip is red"

if [ "$fail" -ne 0 ]; then
  echo "::error::gate predicate self-test FAILED — gate-eval.sh does not red-wall correctly"
  exit 1
fi
echo "gate predicate self-test passed: red-walls on failure/cancelled, passes on success/skipped."
