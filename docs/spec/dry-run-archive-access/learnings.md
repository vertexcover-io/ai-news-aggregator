# Learnings — dry-run-archive-access

## 1. Pre-existing e2e failures must be proven against a clean tree before blaming (or absolving) the change

The quality gate's e2e run surfaced 10 failures (`sources`/`settings`/`admin-must-read`), all with
`null value in column "shortlist_size" of relation "user_settings" violates not-null constraint`. Rather than
assume they were mine or assume they were pre-existing, I stashed the entire diff and re-ran the failing suite
on the base commit — the identical 10 failures reproduced. That turned "maybe my change broke e2e" into a
provable "the `newsletter_test` DB has a `shortlist_size NOT NULL`-with-no-default column the e2e seed helpers
don't populate." **The stash-and-reproduce step is the cheapest way to attribute a test failure.** Do it before
writing a verdict, not after.

**Action item (separate from this PR):** the `newsletter_test` database is drifted — either add a default to
`shortlist_size` in a migration or update the settings/sources e2e seed helpers to set it. This blocks the api
e2e suite for everyone, unrelated to archives.

## 2. The "leaking existence" 404 was a deliberate guard — flipping it is a product decision, not a bug fix

`GET /api/archives/:runId` 404'd dry runs on purpose (test R-14: "avoids leaking existence"). The user's request
("accessible via direct link, no auth") directly contradicted that guard. The right move was to surface the
conflict via AskUserQuestion (allow-public vs keep-404) rather than silently delete the guard — the deletion
overrides an intentional, tested security choice, and the accepted trade-off (UUID-as-secret) belongs in the
design doc and Out of Scope, which it now is.

## 3. Seed SQL: a subquery inside a JSON array literal silently aborts under ON_ERROR_STOP

`'[{"rawItemId":(SELECT id FROM …)}]'::jsonb` is not valid — the subquery is text inside the literal, the cast
fails, and under `-v ON_ERROR_STOP=1` the whole statement aborts, leaving the row uninserted. This produced a
spurious REQ-001 "404" during gate Check 8 that looked like a code failure but was a seed failure. Resolve the
id in a separate query first, then interpolate the integer. (Functional-verify had already proven REQ-001=200
with a correct two-step seed — the gate's 404 was purely the bad literal.)
