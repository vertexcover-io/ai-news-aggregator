CREATE EXTENSION IF NOT EXISTS unaccent;--> statement-breakpoint
CREATE OR REPLACE FUNCTION immutable_unaccent(text) RETURNS text AS $$
  SELECT unaccent('unaccent', $1)
$$ LANGUAGE SQL IMMUTABLE PARALLEL SAFE;--> statement-breakpoint
ALTER TABLE "run_archives" ADD COLUMN IF NOT EXISTS "search_text" text;--> statement-breakpoint
ALTER TABLE "run_archives" ADD COLUMN IF NOT EXISTS "search_tsv" tsvector
  GENERATED ALWAYS AS (
    to_tsvector('english', immutable_unaccent(coalesce(search_text, '')))
  ) STORED;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_run_archives_search_tsv"
  ON "run_archives" USING GIN ("search_tsv");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_run_archives_reviewed_completed"
  ON "run_archives" ("reviewed", "completed_at" DESC) WHERE "reviewed" = true;--> statement-breakpoint
WITH expanded AS (
  SELECT
    ra.id AS run_archive_id,
    coalesce(ra.digest_headline, '') AS dh,
    coalesce(ra.digest_summary, '')  AS ds,
    item.value->>'rawItemId'  AS raw_item_id_str,
    item.value->>'summary'    AS override_summary,
    item.value->'bullets'     AS override_bullets,
    item.value->>'bottomLine' AS override_bottom
  FROM run_archives ra,
       LATERAL jsonb_array_elements(coalesce(ra.ranked_items, '[]'::jsonb)) AS item
  WHERE ra.reviewed = true AND ra.search_text IS NULL
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
  JOIN raw_items ri ON ri.id = (e.raw_item_id_str)::int
),
per_archive AS (
  SELECT
    run_archive_id,
    max(dh) AS dh,
    max(ds) AS ds,
    string_agg(
      title || E'\n' ||
      coalesce(substring(url FROM '://([^/]+)'), '') || E'\n' ||
      source_type || E'\n' ||
      author || E'\n' ||
      summary || E'\n' ||
      coalesce((SELECT string_agg(b, E'\n') FROM jsonb_array_elements_text(bullets_jsonb) b), '') || E'\n' ||
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
WHERE ra.id = per_archive.run_archive_id;--> statement-breakpoint
UPDATE run_archives
SET search_text = btrim(coalesce(digest_headline, '') || E'\n\n' || coalesce(digest_summary, ''))
WHERE reviewed = true AND search_text IS NULL;
