#!/usr/bin/env bash
# Live Merge gate watcher.
#
# The final aggregate gate used to depend on every CI leg, which meant GitHub did
# not create the required "Merge gate" check run until the slowest leg finished.
# This job starts immediately, waits for the affected-selection artifact, then
# polls the current workflow run so the required check is clickable and useful
# while CI is still running.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"

repo="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"
run_id="${GITHUB_RUN_ID:?GITHUB_RUN_ID is required}"
token="${GH_TOKEN:-${GITHUB_TOKEN:-}}"
gate_job="${GATE_WATCH_JOB_NAME:-Merge gate}"
artifact_name="${GATE_WATCH_SELECTION_ARTIFACT:-ci-gate-selection}"
poll_seconds="${GATE_WATCH_POLL_SECONDS:-15}"
timeout_seconds="${GATE_WATCH_TIMEOUT_SECONDS:-5400}"
selection_file="${GATE_WATCH_SELECTION_FILE:-}"
summary_file="${GITHUB_STEP_SUMMARY:-}"

if [ -z "$token" ] && [ -z "$selection_file" ]; then
  echo "::error::GH_TOKEN or GITHUB_TOKEN is required to read workflow jobs/artifacts."
  exit 1
fi

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

log_progress() {
  local jobs_json="$1"
  echo
  echo "Current CI job progress:"
  jq -r --arg gate "$gate_job" '
    .jobs[]
    | select(.name != $gate)
    | [
        .name,
        .status,
        (.conclusion // "-"),
        (.started_at // "-"),
        (.completed_at // "-"),
        (.html_url // "-")
      ]
    | @tsv
  ' <<<"$jobs_json" | while IFS=$'\t' read -r name status conclusion started completed url; do
    printf '  - %-44s %-12s %-16s %s\n' "$name" "$status" "$conclusion" "$url"
    printf '    started: %s  completed: %s\n' "$started" "$completed"
  done
}

write_summary() {
  local title="$1"
  local jobs_json="$2"
  [ -n "$summary_file" ] || return 0
  {
    echo "## $title"
    echo
    echo "| Job | Status | Conclusion | Details |"
    echo "| --- | --- | --- | --- |"
    jq -r --arg gate "$gate_job" '
      .jobs[]
      | select(.name != $gate)
      | "| \(.name) | \(.status) | \(.conclusion // "-") | [open](\(.html_url // "")) |"
    ' <<<"$jobs_json"
  } >> "$summary_file"
}

fetch_jobs() {
  gh api "repos/$repo/actions/runs/$run_id/jobs?per_page=100"
}

first_bad_step() {
  local jobs_json="$1"
  local job_name="$2"
  jq -r --arg job "$job_name" '
    first(
      .jobs[]
      | select(.name == $job)
      | .steps[]?
      | select(
          .conclusion == "failure"
          or .conclusion == "cancelled"
          or .conclusion == "timed_out"
          or .conclusion == "startup_failure"
          or .conclusion == "action_required"
        )
      | .name
    ) // ""
  ' <<<"$jobs_json"
}

load_selection_from_file() {
  sed '/^[[:space:]]*$/d' "$1"
}

load_selection_from_artifact() {
  local artifacts_json archive_url zip out
  artifacts_json="$(gh api "repos/$repo/actions/runs/$run_id/artifacts?per_page=100")"
  archive_url="$(
    jq -r --arg name "$artifact_name" '
      first(
        .artifacts[]
        | select(.name == $name and (.expired | not))
        | .archive_download_url
      ) // ""
    ' <<<"$artifacts_json"
  )"
  [ -n "$archive_url" ] || return 1

  zip="$tmpdir/selection.zip"
  out="$tmpdir/selection"
  rm -rf "$out"
  mkdir -p "$out"
  curl -fsSL \
    -H "Authorization: Bearer $token" \
    -H "Accept: application/vnd.github+json" \
    "$archive_url" \
    -o "$zip"
  unzip -q "$zip" -d "$out"
  load_selection_from_file "$out/expected-jobs.txt"
}

wait_for_selection() {
  local start now jobs_json changed_conclusion
  start="$(date +%s)"
  if [ -n "$selection_file" ]; then
    load_selection_from_file "$selection_file"
    return 0
  fi

  while true; do
    if load_selection_from_artifact; then
      return 0
    fi

    jobs_json="$(fetch_jobs)"
    changed_conclusion="$(
      jq -r 'first(.jobs[] | select(.name == "Affected selection") | .conclusion) // ""' <<<"$jobs_json"
    )"
    case "$changed_conclusion" in
      failure|cancelled|timed_out|startup_failure|action_required)
        log_progress "$jobs_json" >&2
        write_summary "Merge gate failed before selection artifact was available" "$jobs_json"
        echo "::error::Affected selection ended with conclusion '$changed_conclusion' before publishing $artifact_name."
        exit 1
        ;;
    esac

    now="$(date +%s)"
    if [ $((now - start)) -ge "$timeout_seconds" ]; then
      log_progress "$jobs_json" >&2
      write_summary "Merge gate timed out waiting for selection" "$jobs_json"
      echo "::error::Timed out waiting for $artifact_name after ${timeout_seconds}s."
      exit 1
    fi
    echo "Waiting for $artifact_name from Affected selection..." >&2
    sleep "$poll_seconds"
  done
}

mapfile -t expected_jobs < <(wait_for_selection)
if [ "${#expected_jobs[@]}" -eq 0 ]; then
  echo "::error::Merge gate selection was empty."
  exit 1
fi

echo "Merge gate expected jobs:"
printf '  - %s\n' "${expected_jobs[@]}"

start="$(date +%s)"
last_log=0
while true; do
  jobs_json="$(fetch_jobs)"
  now="$(date +%s)"

  if [ $((now - last_log)) -ge "$poll_seconds" ]; then
    log_progress "$jobs_json"
    last_log="$now"
  fi

  failed_job="$(
    jq -r --arg gate "$gate_job" '
      first(
        .jobs[]
        | select(.name != $gate)
        | select(
            .conclusion == "failure"
            or .conclusion == "cancelled"
            or .conclusion == "timed_out"
            or .conclusion == "startup_failure"
            or .conclusion == "action_required"
        )
        | .name
      ) // ""
    ' <<<"$jobs_json"
  )"
  if [ -n "$failed_job" ]; then
    bad_step="$(first_bad_step "$jobs_json" "$failed_job")"
    write_summary "Merge gate failed" "$jobs_json"
    if [ -n "$bad_step" ]; then
      echo "::error::Required CI job failed: $failed_job -> $bad_step"
    else
      echo "::error::Required CI job failed: $failed_job"
    fi
    exit 1
  fi

  missing=()
  pending=()
  conclusions=()
  for job in "${expected_jobs[@]}"; do
    conclusion="$(
      jq -r --arg job "$job" '
        [.jobs[] | select(.name == $job) | (.conclusion // "")]
        | if length == 0 then "__missing__" else .[0] end
      ' <<<"$jobs_json"
    )"
    status="$(
      jq -r --arg job "$job" '
        [.jobs[] | select(.name == $job) | .status]
        | if length == 0 then "__missing__" else .[0] end
      ' <<<"$jobs_json"
    )"
    if [ "$conclusion" = "__missing__" ]; then
      missing+=("$job")
    elif [ "$status" != "completed" ]; then
      pending+=("$job")
    else
      conclusions+=("$conclusion")
    fi
  done

  if [ "${#missing[@]}" -eq 0 ] && [ "${#pending[@]}" -eq 0 ]; then
    result_csv="$(IFS=','; echo "${conclusions[*]}")"
    if bash "$here/gate-eval.sh" --strict-success "$result_csv"; then
      write_summary "Merge gate passed" "$jobs_json"
      echo "Merge gate GREEN."
      exit 0
    fi
    write_summary "Merge gate failed" "$jobs_json"
    exit 1
  fi

  if [ $((now - start)) -ge "$timeout_seconds" ]; then
    write_summary "Merge gate timed out" "$jobs_json"
    printf 'Missing selected jobs: %s\n' "${missing[*]:-none}"
    printf 'Pending selected jobs: %s\n' "${pending[*]:-none}"
    echo "::error::Timed out waiting for selected CI jobs after ${timeout_seconds}s."
    exit 1
  fi

  sleep "$poll_seconds"
done
