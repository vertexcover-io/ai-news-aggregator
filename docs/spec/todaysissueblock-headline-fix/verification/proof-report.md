# Functional Verification — `todaysissueblock-headline-fix`

**Verdict: PASS**

Date: 2026-05-25
Spec: `docs/spec/todaysissueblock-headline-fix/spec.md`
Change under verification: `packages/web/src/components/home/TodaysIssueBlock.tsx` line 24 now
derives the home "Today's Issue" headline via the shared
`pickHeadline(issue.topItems[0]?.title ?? null, issue.digestHeadline)` (imported from
`ArchivePageHeader`), so the home headline uses the SAME precedence as the linked
`/archive/:runId` page (top-story title preferred over digest headline).

## Claims

| Claim | Type | Surface | Status | Evidence |
|-------|------|---------|--------|----------|
| PHASE1-C1 | ui | `/` | PASS (re-proven via Playwright MCP, real browser) | see below + screenshots |
| PHASE1-C2 | unit | `/` | COVERED_BY unit tests (`TodaysIssueBlock.test.tsx`) | digest-only / top-only / neither cases; also re-confirmed live in adversarial pass |

## PHASE1-C1 — independent browser re-proof (REQ-001, REQ-004)

Behavior: on the home page the Today's Issue block headline matches the headline on the
linked `/archive/:runId` page; when an issue has both a top-story title and a digest
headline that differ, the **top-story title** is shown.

### Data condition (test DB, mutation later restored)

The local DB had 30 archives but all with empty `ranked_items` and zero `raw_items`, so no
issue naturally exercised the "both present & differ" case. I produced the condition by
scoping a single reviewed, non-dry archive
(`f39dff04-3b2f-4535-963f-610364437a5e`) to be the unique latest reviewed archive in the
home page's 48-hour window:

- Inserted a backing `raw_items` row (id 186) so the ranked ref hydrates.
- Set `ranked_items = [{ rawItemId: 186, score, rationale, title: "TOPSTORY OpenAI ships GPT-X model" }]`
  (the `title` override resolves identically on both surfaces:
  home `topItems[0].title = ref.title ?? recap.title ?? raw.title`;
  archive `rankedItems[0].title = ref.title ?? recap.title ?? row.title`).
- Set `digest_headline = "DIGEST: the week agents got cheaper"` (DIFFERENT from the top-story title).
- Bumped `completed_at` to `2026-05-25 23:59:00` so `findLatestReviewedSince(now-48h)` picks it as `todaysIssue`.

API confirmation:
- `GET /api/home` → `todaysIssue.topItems[0].title = "TOPSTORY OpenAI ships GPT-X model"`,
  `todaysIssue.digestHeadline = "DIGEST: the week agents got cheaper"`,
  `runId = f39dff04-3b2f-4535-963f-610364437a5e`.
- `GET /api/archives/f39dff04-3b2f-4535-963f-610364437a5e` →
  `rankedItems[0].title = "TOPSTORY OpenAI ships GPT-X model"`,
  `digestHeadline = "DIGEST: the week agents got cheaper"`.

### Browser steps (Playwright MCP, Chromium)

1. Navigate `http://localhost:5173/`. Read `[data-section="todays-issue"] h2`:
   **`TOPSTORY OpenAI ships GPT-X model`** — the top-story title, NOT the digest headline.
   This is the bug fix (previous reversed precedence would have shown the digest headline).
   Screenshot: `screenshots/PHASE1-C1-home.png`.
2. The Read-today link href is `/archive/f39dff04-3b2f-4535-963f-610364437a5e` (correct target).
3. Click "Read today" → navigated to `/archive/f39dff04-3b2f-4535-963f-610364437a5e`.
   Read `h1`: **`TOPSTORY OpenAI ships GPT-X model`**. Page `<title>` also resolved to the
   same string. Screenshot: `screenshots/PHASE1-C1-archive.png`.
4. **ASSERTION**: home `<h2>` (`"TOPSTORY OpenAI ships GPT-X model"`) ===
   archive `<h1>` (`"TOPSTORY OpenAI ships GPT-X model"`). **EQUAL** → mismatch is fixed.

Console: 0 errors during the proof.

**PHASE1-C1: PASS.**

## Restore

After the proof + adversarial pass, the target archive was restored to its captured original
state (`completed_at = 2026-05-25 17:30:00`, `digest_headline = ''`, `digest_summary = ''`,
`ranked_items = []`) and the test `raw_items` row (id 186) was deleted (raw_items back to 0).
Verified via psql.

## Artifacts

- `screenshots/PHASE1-C1-home.png` — home Today's Issue block, h2 = top-story title.
- `screenshots/PHASE1-C1-archive.png` — archive page, h1 = same top-story title.
- `adversarial-findings.md` — attempts to make the two surfaces diverge.
