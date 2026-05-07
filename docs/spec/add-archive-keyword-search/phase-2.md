# Phase 2: DB migration — search_text + tsvector + GIN + backfill

> **Status:** pending

## Overview

Add the FTS infrastructure to `run_archives`: an `unaccent` extension, an `immutable_unaccent` SQL wrapper (required because `unaccent()` is STABLE not IMMUTABLE — proven during library-probe), a `search_text TEXT` column, a generated `search_tsv tsvector` column, and a GIN index on it. Backfill existing reviewed archives via a single SQL UPDATE that mirrors the JS serializer's precedence rules using jsonb extraction with COALESCE.

## Implementation

**Files:**
- Create: `packages/shared/src/db/migrations/0014_<adj>_<noun>.sql` (let drizzle-kit pick the suffix when generating, or hand-write a sequential file — see `0013_curly_stellaris.sql` for format).
- Modify: `packages/shared/src/db/schema.ts` — add `searchText` and `searchTsv` columns to `runArchives` table.
- Modify: `packages/shared/src/db/migrations/meta/_journal.json` if drizzle-kit doesn't auto-update it.
- Test: `packages/api/tests/e2e/archives-search-migration.test.ts` — integration test that applies the migration to a fresh test DB and asserts: column exists, index exists, function exists, sample backfill row contains expected tokens.

**Pattern to follow:** existing migrations under `packages/shared/src/db/migrations/` (e.g. `0011_cute_ben_grimm.sql` for multi-statement migrations).

**What to test (integration):**
- After `pnpm --filter @newsletter/shared db:migrate`, the function `immutable_unaccent` exists and is IMMUTABLE.
- `run_archives.search_tsv` is a tsvector and is GIN-indexed (`pg_indexes` introspection).
- A pre-seeded reviewed archive has `search_text` populated post-migration (backfill ran).
- Override precedence holds in SQL backfill: a seeded `RankedItemRef.summary='OVERRIDE'` over `metadata.recap.summary='ORIGINAL'` ends up with `'OVERRIDE'` in `search_text` and not `'ORIGINAL'`.
- Migration is idempotent: running twice doesn't error.

**Traces to:** REQ-009, REQ-012, REQ-029, EDGE-013.

**Migration body (the non-obvious part — ~70 lines of SQL):**

```sql
-- 1. Extension + immutable wrapper
CREATE EXTENSION IF NOT EXISTS unaccent;

CREATE OR REPLACE FUNCTION immutable_unaccent(text) RETURNS text AS $$
  SELECT unaccent('unaccent', $1)
$$ LANGUAGE SQL IMMUTABLE PARALLEL SAFE;

-- 2. Add search_text column (nullable; NULL means "not yet computed")
ALTER TABLE run_archives ADD COLUMN IF NOT EXISTS search_text TEXT;

-- 3. Generated tsvector + GIN index
ALTER TABLE run_archives ADD COLUMN IF NOT EXISTS search_tsv TSVECTOR
  GENERATED ALWAYS AS (
    to_tsvector('english', immutable_unaccent(coalesce(search_text, '')))
  ) STORED;

CREATE INDEX IF NOT EXISTS idx_run_archives_search_tsv
  ON run_archives USING GIN (search_tsv);

-- 4. Helper index for date-range filter on reviewed archives
CREATE INDEX IF NOT EXISTS idx_run_archives_reviewed_completed
  ON run_archives (reviewed, completed_at DESC) WHERE reviewed = true;

-- 5. Backfill existing reviewed archives in one shot.
-- Mirrors serializeArchiveSearchText():
--   digest_headline + digest_summary + per-ranked-item (title, host, sourceType,
--   author, override→recap summary, override→recap bullets, override→recap bottomLine).
WITH expanded AS (
  SELECT
    ra.id AS run_archive_id,
    coalesce(ra.digest_headline, '') AS dh,
    coalesce(ra.digest_summary, '')  AS ds,
    item.value->>'rawItemId' AS raw_item_id_str,
    item.value->>'summary'    AS override_summary,
    item.value->'bullets'      AS override_bullets,
    item.value->>'bottomLine' AS override_bottom
  FROM run_archives ra,
       LATERAL jsonb_array_elements(coalesce(ra.ranked_items, '[]'::jsonb)) AS item
  WHERE ra.reviewed = true
),
joined AS (
  SELECT
    e.run_archive_id, e.dh, e.ds,
    ri.title, ri.url, ri.source_type, coalesce(ri.author, '') AS author,
    coalesce(e.override_summary, ri.metadata->'recap'->>'summary', '') AS summary,
    coalesce(
      e.override_bullets,
      ri.metadata->'recap'->'bullets',
      '[]'::jsonb
    ) AS bullets_jsonb,
    coalesce(e.override_bottom, ri.metadata->'recap'->>'bottomLine', '') AS bottom
  FROM expanded e
  JOIN raw_items ri ON ri.id = e.raw_item_id_str::int
),
per_archive AS (
  SELECT
    run_archive_id,
    -- digest comes from any single row (same for all rows in archive)
    max(dh) AS dh, max(ds) AS ds,
    string_agg(
      title || E'\n' ||
      coalesce(substring(url FROM '://([^/]+)'), '') || E'\n' ||
      source_type || E'\n' ||
      author || E'\n' ||
      summary || E'\n' ||
      coalesce((SELECT string_agg(b::text, E'\n') FROM jsonb_array_elements_text(bullets_jsonb) b), '') || E'\n' ||
      bottom,
      E'\n\n'
    ) AS items_blob
  FROM joined
  GROUP BY run_archive_id
)
UPDATE run_archives ra
SET search_text = btrim(
  per_archive.dh || E'\n\n' ||
  per_archive.ds || E'\n\n' ||
  per_archive.items_blob
)
FROM per_archive
WHERE ra.id = per_archive.run_archive_id;

-- 6. Archives with no rankedItems (rare: reviewed=true but empty) get just the digest text
UPDATE run_archives
SET search_text = btrim(coalesce(digest_headline, '') || E'\n\n' || coalesce(digest_summary, ''))
WHERE reviewed = true AND search_text IS NULL;
```

**Notes:**
- The `WITH expanded AS …, joined AS …, per_archive AS …` chain mirrors the JS serializer step-by-step. The integration test verifies parity.
- `string_agg` produces non-deterministic ordering — for the *content* of `search_text` this is harmless (FTS doesn't care about token order); rankedItems order doesn't affect what tokens get indexed. If we need deterministic order later, add `ORDER BY` inside `string_agg`.
- `substring(url FROM '://([^/]+)')` is a cheap host extractor; matches `safeHost` closely enough for backfill purposes.
- `EXISTS / NOT EXISTS` guards keep migration idempotent across reruns in dev.

**Schema.ts changes:**

```ts
// packages/shared/src/db/schema.ts (inside runArchives table)
searchText: text("search_text"),
// search_tsv is generated by Postgres — Drizzle still needs to know about it
// to avoid surprises in select * queries; declare as `customType` with a comment.
// (In practice, we never SELECT search_tsv in app code, so we may omit it from
// the Drizzle schema. Decide at TDD time based on whether typecheck flags missing column.)
```

**Done when:**
- [ ] Migration file created and `_journal.json` updated
- [ ] `pnpm --filter @newsletter/shared db:migrate` runs cleanly twice (idempotent)
- [ ] Integration test passes: column + index + function exist; backfill correctness for override precedence
- [ ] `pnpm typecheck` passes (schema.ts change typechecks)

**Commit:** `feat(VER-XX): add fts columns + backfill to run_archives`
