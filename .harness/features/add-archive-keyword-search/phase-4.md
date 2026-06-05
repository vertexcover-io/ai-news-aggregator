# Phase 4: Search repo + API route

> **Status:** pending

## Overview

Add `searchReviewed` to `RunArchivesRepo` and a public Hono route `GET /api/archives/search`. Validation via zod. Returns the same `ArchiveListItem[]` shape as `listReviewed` so the frontend can swap data sources without code-shape changes.

## Implementation

**Files:**
- Modify: `packages/api/src/repositories/run-archives.ts` — add `searchReviewed({ q, from, to, limit })`.
- Create: `packages/api/src/routes/archives-search.ts` — Hono router exporting a single GET route. Wire into `publicArchivesRouter` in `app.ts`.
- Modify: `packages/api/src/app.ts` — mount the search route under `/api/archives/search`. Public, no admin gate.
- Modify: `packages/web/src/api/archives.ts` — add `searchArchives({ q, from, to })` API client function (used by Phase 5).
- Test (unit, mocks): `packages/api/tests/unit/archives-search-route.test.ts` — covers 400 cases (REQ-024–026), shape (REQ-007), limit cap (REQ-006).
- Test (integration, real DB): `packages/api/tests/e2e/archives-search.e2e.test.ts` — covers REQ-002/003/004/005, EDGE-001/003/006/008/009/010/014/016.

**Pattern to follow:** `packages/api/src/routes/archives.ts` for route shape; `packages/api/tests/unit/runs-route.test.ts` for unit test structure.

**What to test:**
- Empty `q` + no range → identical to `GET /api/archives` (EDGE-001).
- `q="overridden-token"` after a review with that override → 1 archive (REQ-002, EDGE-004 covered indirectly).
- `q="cote"` against accented seed → match (EDGE-008).
- `q="claude -agentic"` excludes archive containing "agentic" (EDGE-003).
- `from > to` → 400 with `{ error: "invalid-range" }` (REQ-025).
- `q.length > 200` → 400 with `{ error: "q-too-long" }` (REQ-024).
- `from=garbage` → 400 (REQ-026).
- `limit=1000` → server caps at 50; `total` reflects true count (REQ-006, EDGE-010).
- `limit=-1` → 400 (EDGE-011).
- Unreviewed archive present in DB never returned (REQ-004, EDGE-006).
- Logging: one structured `info` line per request with `{ q, from, to, count, durationMs }` (REQ-027).

**Traces to:** REQ-001..007, REQ-024..027, EDGE-001/003/006/008/009/010/011/014/016.

**Repo method (the non-obvious bit — the SQL):**

```ts
// run-archives.ts
async searchReviewed({ q, from, to, limit = 50 }: SearchInput): Promise<{ rows: RunArchiveRow[]; total: number }> {
  const cappedLimit = Math.min(Math.max(limit, 1), 50);
  const fromTs = from ?? new Date(0);
  const toTs   = to   ?? new Date();

  if (!q || q.trim() === '') {
    // Date-only filter: just listReviewed bounded by date range.
    const rows = await db.select().from(runArchives)
      .where(and(eq(runArchives.reviewed, true), gte(runArchives.completedAt, fromTs), lte(runArchives.completedAt, toTs)))
      .orderBy(desc(runArchives.completedAt))
      .limit(cappedLimit);
    const total = await db.$count(runArchives, and(eq(runArchives.reviewed, true), gte(runArchives.completedAt, fromTs), lte(runArchives.completedAt, toTs)));
    return { rows, total };
  }

  // Note: must use sql template tag for websearch_to_tsquery + immutable_unaccent + ts_rank_cd.
  const tsq = sql`websearch_to_tsquery('english', immutable_unaccent(${q}))`;
  const rows = await db.execute(sql`
    SELECT *, ts_rank_cd(search_tsv, ${tsq}) AS rank
    FROM run_archives
    WHERE reviewed = true
      AND completed_at BETWEEN ${fromTs} AND ${toTs}
      AND search_tsv @@ ${tsq}
    ORDER BY rank DESC, completed_at DESC
    LIMIT ${cappedLimit}
  `);
  const total = await db.execute(sql`
    SELECT count(*)::int AS c FROM run_archives
    WHERE reviewed = true
      AND completed_at BETWEEN ${fromTs} AND ${toTs}
      AND search_tsv @@ ${tsq}
  `);
  return { rows: rows.rows as RunArchiveRow[], total: (total.rows[0] as { c: number }).c };
}
```

After fetching `RunArchiveRow[]`, transform into `ArchiveListItem[]` using the existing transform logic in `listReviewed`. Either factor out the transform into a private helper or call into a shared `toArchiveListItem(row, rawItems)` utility.

**Route handler:**

```ts
// archives-search.ts
const querySchema = z.object({
  q: z.string().max(200).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

router.get('/', zValidator('query', querySchema, (result, c) => {
  if (!result.success) return c.json({ error: 'bad-request', issues: result.error.issues }, 400);
}), async (c) => {
  const { q, from, to, limit } = c.req.valid('query');
  const fromDate = from ? parseISO(from) : undefined;
  const toDate = to ? parseISO(to) : undefined;
  if (fromDate && toDate && fromDate > toDate) return c.json({ error: 'invalid-range' }, 400);
  if (q && q.length > 200) return c.json({ error: 'q-too-long' }, 400); // belt+suspenders, zod also catches

  const start = Date.now();
  const result = await runArchivesRepo.searchReviewed({ q, from: fromDate, to: toDate, limit });
  const durationMs = Date.now() - start;
  logger.info({ route: 'archives.search', q, from, to, count: result.rows.length, durationMs });

  const archives = await Promise.all(result.rows.map(toArchiveListItem));
  return c.json({ archives, total: result.total, q, from, to });
});
```

**E2E TDD note:** The integration tests in this phase touch real Postgres. Per the testing skill, write the failing tests against e2e infra first (`pnpm infra:up`), then implement until green.

**Done when:**
- [ ] Unit test asserts: 400 cases (24, 25, 26), limit cap (6), shape parity (7).
- [ ] E2E test asserts: REQ-002, 003, 004, 005, EDGE-001, 003, 006, 008, 009, 010, 014, 016.
- [ ] `pnpm test:unit && pnpm test:e2e` green for the new files.
- [ ] No regressions in existing routes.

**Commit:** `feat(VER-XX): add public GET /api/archives/search endpoint`
