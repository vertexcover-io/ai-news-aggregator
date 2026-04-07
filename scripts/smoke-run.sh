#!/usr/bin/env bash
#
# Smoke test for the /run end-to-end flow.
#
# Posts a small HN+Reddit run against a live API at API_URL (default
# http://localhost:3000), then polls GET /api/runs/:runId until it reaches a
# terminal state. Requires:
#
#   - `pnpm dev` (api + pipeline workers + web) running
#   - `pnpm infra:up` (Postgres + Redis)
#   - GEMINI_API_KEY exported in the calling shell
#
# Usage:
#   GEMINI_API_KEY=... ./scripts/smoke-run.sh
#
set -euo pipefail

: "${GEMINI_API_KEY:?GEMINI_API_KEY is required (must be set in pipeline env)}"

API_URL="${API_URL:-http://localhost:3000}"
POLL_ATTEMPTS="${POLL_ATTEMPTS:-30}"
POLL_INTERVAL_SECONDS="${POLL_INTERVAL_SECONDS:-2}"

payload='{
  "topN": 3,
  "hn": { "sinceDays": 2, "pointsThreshold": 20 },
  "reddit": { "subreddits": ["MachineLearning"], "sinceDays": 2 }
}'

echo "POST ${API_URL}/api/runs"
response=$(curl -sf -X POST "${API_URL}/api/runs" \
  -H "Content-Type: application/json" \
  -d "${payload}")

runId=$(printf '%s' "${response}" | jq -r .runId)
if [ -z "${runId}" ] || [ "${runId}" = "null" ]; then
  echo "failed to create run: ${response}" >&2
  exit 1
fi

echo "runId=${runId}"

for attempt in $(seq 1 "${POLL_ATTEMPTS}"); do
  state=$(curl -sf "${API_URL}/api/runs/${runId}")
  status=$(printf '%s' "${state}" | jq -r .status)
  stage=$(printf '%s' "${state}" | jq -r .stage)
  echo "[${attempt}/${POLL_ATTEMPTS}] status=${status} stage=${stage}"

  if [ "${status}" = "completed" ]; then
    echo "run completed:"
    printf '%s' "${state}" | jq .
    exit 0
  fi
  if [ "${status}" = "failed" ]; then
    echo "run failed:" >&2
    printf '%s' "${state}" | jq . >&2
    exit 1
  fi
  sleep "${POLL_INTERVAL_SECONDS}"
done

echo "timed out after ${POLL_ATTEMPTS} polls" >&2
exit 1
