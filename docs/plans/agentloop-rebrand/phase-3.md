# Phase 3: Public API — `/api/home` + `/api/must-read`

> **Status:** pending

## Overview

Two public, unauthenticated GET endpoints. `/api/home` is the composite home-page payload; `/api/must-read` is the flat reverse-chronological list.

## Implementation

**Files:**

- Create: `packages/api/src/routes/home.ts`
  - Mounts `GET /` at `/api/home`
  - Returns `HomePagePayload = { todaysIssue, featuredCanon, recentIssues }`
- Create: `packages/api/src/routes/must-read.ts`
  - Mounts `GET /` at `/api/must-read`
  - Returns `PublicMustReadEntry[]` (no `updatedAt`)
- Modify: `packages/api/src/app.ts` — register both new routers as public
- Modify: `packages/api/src/index.ts` — wire dependencies (repo factories)
- Create: `packages/api/tests/e2e/home.test.ts`
- Create: `packages/api/tests/e2e/must-read-public.test.ts`

**Tests (REQ traceability):**

- **REQ-010 / EDGE-001:** `GET /api/home` with no archives returns `{ todaysIssue: null, featuredCanon: null|MustReadEntry, recentIssues: [] }`
- **REQ-010 + EDGE-011:** reviewed archive `completed_at` 30h ago → `todaysIssue` populated; 49h ago → `todaysIssue: null`, that archive appears in `recentIssues[0]`
- **REQ-010 (exclusion):** when `todaysIssue` is non-null, that row's `id` does NOT appear in `recentIssues`
- **REQ-010 (limit):** `recentIssues.length` is ≤ 10 in all cases
- **REQ-004 / EDGE-002:** `GET /api/home` with zero must_read_entries → `featuredCanon: null`
- **NF-003 / EDGE-013:** with 5 distinct entries, 50 sequential calls each return one of them; over the run all 5 IDs appear at least once
- **REQ-014 / REQ-015:** `GET /api/must-read` returns `[]` when empty; returns reverse-chron array otherwise
- **NF-004:** every element in `GET /api/must-read` response lacks the `updatedAt` key (assert via `expect(entry).not.toHaveProperty("updatedAt")`)

**Pattern to follow:** `packages/api/src/routes/archives.ts` for the public GET pattern; `packages/api/tests/e2e/archives.test.ts` for the test pattern (Hono test client + real DB).

**Traces to:** REQ-010, REQ-014, REQ-015, NF-003, NF-004, EDGE-001, EDGE-002, EDGE-011, EDGE-013

**What to build (composite query):**

The composite endpoint runs three independent queries; do them in parallel via `Promise.all` to keep p50 low:

```ts
app.get("/", async (c) => {
  const fortyEightHoursAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);
  const [todaysIssueRow, featuredCanon, recentReviewedAll] = await Promise.all([
    runArchivesRepo.findLatestReviewedSince(fortyEightHoursAgo),
    mustReadRepo.findRandom(),
    runArchivesRepo.listReviewed({ rawItemsRepo, limit: 11 }),  // 11 so we can exclude today and still return 10
  ]);

  const todaysIssue = todaysIssueRow
    ? hydrateAsArchiveListItem(todaysIssueRow, /* deps */)
    : null;

  const recentIssues = todaysIssue
    ? recentReviewedAll.filter((a) => a.runId !== todaysIssue.runId).slice(0, 10)
    : recentReviewedAll.slice(0, 10);

  return c.json({ todaysIssue, featuredCanon, recentIssues });
});
```

**New repo method needed:** `runArchivesRepo.findLatestReviewedSince(date): Promise<RunArchiveRow | null>` — add this to `packages/api/src/repositories/run-archives.ts` and its tests in Phase 3 (not Phase 2, to avoid touching Phase 2's scope creep).

**Public must-read endpoint** is trivial — call `mustReadRepo.listPublic()`, JSON-encode, done.

**Commit:** `feat(api): public /api/home composite + /api/must-read list endpoints`

## Done When

- [ ] Both endpoints reachable via `curl http://localhost:3000/api/home` etc.
- [ ] All listed REQs covered by passing e2e tests
- [ ] `pnpm --filter @newsletter/api test:e2e` green
- [ ] `pnpm typecheck` green
- [ ] `pnpm lint` green
