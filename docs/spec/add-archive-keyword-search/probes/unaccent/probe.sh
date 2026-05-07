#!/usr/bin/env bash
# Probe: verify Postgres unaccent extension is available + accent-stripping works
# + websearch_to_tsquery is usable for our planned FTS pattern, with the
# IMMUTABLE wrapper required for use in GENERATED ALWAYS STORED columns.
set -euo pipefail

COMMON_DIR=$(git rev-parse --git-common-dir)
MAIN_REPO=$(dirname "$COMMON_DIR")
set -a; source "$MAIN_REPO/.env.harness" 2>/dev/null || true; set +a
if [[ -z "${DATABASE_URL:-}" ]]; then
  set -a; source "$MAIN_REPO/.env"; set +a
fi
echo "DATABASE_URL=$(echo "$DATABASE_URL" | sed 's/:[^@]*@/:***@/')"

CID=$(podman ps --format '{{.ID}} {{.Image}}' | awk '$2 ~ /postgres/{print $1; exit}')
if [[ -z "$CID" ]]; then
  echo "FAIL: postgres container not running" >&2
  exit 2
fi

run_sql() {
  podman exec -i "$CID" psql -U newsletter -d newsletter -tA -c "$1"
}

echo "=== 1. unaccent extension can be created ==="
run_sql "CREATE EXTENSION IF NOT EXISTS unaccent;"

echo "=== 2. unaccent() strips accents ==="
out=$(run_sql "SELECT unaccent('Côté');")
echo "input='Côté' output='$out'"
[[ "$out" == "Cote" ]] || { echo "FAIL: expected Cote got $out" >&2; exit 1; }

echo "=== 3. immutable_unaccent wrapper compiles ==="
run_sql "CREATE OR REPLACE FUNCTION immutable_unaccent(text) RETURNS text AS \$body\$ SELECT unaccent('unaccent', \$1) \$body\$ LANGUAGE SQL IMMUTABLE PARALLEL SAFE;"

echo "=== 4. generated tsvector column with wrapper ==="
run_sql "DROP TABLE IF EXISTS probe_fts;"
run_sql "CREATE TABLE probe_fts (id serial PRIMARY KEY, body text, body_tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', immutable_unaccent(coalesce(body, '')))) STORED);"
run_sql "CREATE INDEX probe_fts_tsv_idx ON probe_fts USING GIN (body_tsv);"
run_sql "INSERT INTO probe_fts (body) VALUES ('OpenAI launches Côté model with agentic features'), ('Anthropic ships Claude 4.7 with 1M context'), ('Quantum entanglement breakfast');"

echo "=== 5. query 'agentic' should match row 1 ==="
hit=$(run_sql "SELECT id FROM probe_fts WHERE body_tsv @@ websearch_to_tsquery('english', immutable_unaccent('agentic')) ORDER BY id;")
echo "matches: $hit"
[[ "$hit" == "1" ]] || { echo "FAIL: 'agentic' did not match row 1" >&2; exit 1; }

echo "=== 6. query 'cote' (no accent) matches accented row ==="
hit=$(run_sql "SELECT id FROM probe_fts WHERE body_tsv @@ websearch_to_tsquery('english', immutable_unaccent('cote'));")
echo "matches: $hit"
[[ "$hit" == "1" ]] || { echo "FAIL: 'cote' did not match accented row" >&2; exit 1; }

echo "=== 7. websearch operators: 'claude -agentic' excludes row 1, includes row 2 ==="
hit=$(run_sql "SELECT id FROM probe_fts WHERE body_tsv @@ websearch_to_tsquery('english', immutable_unaccent('claude -agentic'));")
echo "matches: $hit"
[[ "$hit" == "2" ]] || { echo "FAIL: websearch operators not supported as expected" >&2; exit 1; }

echo "=== 8. plan uses GIN index ==="
plan=$(run_sql "EXPLAIN SELECT id FROM probe_fts WHERE body_tsv @@ websearch_to_tsquery('english', immutable_unaccent('agentic'));")
echo "$plan"
echo "$plan" | grep -qi "index" && echo "PLAN: index used (good)" || echo "PLAN: WARNING — no index in plan (corpus may be too small for planner to choose GIN)"

echo "=== 9. cleanup ==="
run_sql "DROP TABLE probe_fts;"

echo "ALL OK"
