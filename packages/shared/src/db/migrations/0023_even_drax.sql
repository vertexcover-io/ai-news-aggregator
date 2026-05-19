-- IF NOT EXISTS guard: prod already had this column from the reverted PR #162
-- (its 0023_living_mikhail_rasputin migration was applied to the prod DB
-- before that PR was reverted in code). Without the guard the deploy fails
-- with "column already exists". On fresh DBs the column is created normally.
ALTER TABLE "run_archives" ADD COLUMN IF NOT EXISTS "cost_breakdown" jsonb;