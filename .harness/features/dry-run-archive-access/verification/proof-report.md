# Functional Verification — Proof Report

**Spec:** dry-run-archive-access
**Date:** 2026-05-25
**Verdict:** PASSED

## Infrastructure

Started by the verifier (cleaned up in the cleanup step):
- PostgreSQL 16 (podman, `fix-dry-run-archive-access_postgres_1`, host port 5433) — migrations applied via
  `pnpm --filter @newsletter/shared db:migrate`.
- Redis 7 (podman, host port 6379).
- API dev server (`@newsletter/api`, `tsx watch src/index.ts`, port 3000, PID 74644).
- Web dev server (Vite, port 5173, proxies `/api` → 127.0.0.1:3000).
- Playwright MCP Chrome (no `admin_session` cookie — fresh public context).

## Seed data

- `raw_items` id=1 — HN item with a `metadata.recap` (title/summary/bullets/bottomLine).
- `run_archives` `11111111-…-111111111111` — `status=completed`, `reviewed=true`, **`is_dry_run=true`**,
  `rankedItems=[{rawItemId:1,…}]`, digest headline + summary. (The reviewed dry run under test.)
- `run_archives` `22222222-…-222222222222` — `status=completed`, `reviewed=false`, `is_dry_run=true`
  (the un-reviewed dry run, must still 404).

## Scenario results

| Scenario | Claim | Method | Expected | Actual | Result |
|----------|-------|--------|----------|--------|--------|
| VS-1: public detail route, reviewed dry run, no auth | PHASE1-C1 / REQ-001 | `curl GET /api/archives/<id>` | 200 + hydrated body | 200, full digest body (recap title, summary, bullets, bottomLine, rankedItems[0].id=1) | PASS |
| VS-2: public listing omits dry run | PHASE1-C4 / REQ-003 | `curl GET /api/archives` | dry run absent | `{"archives":[]}` | PASS |
| EDGE-002: missing runId | PHASE1-C3 | `curl GET /api/archives/9999…` | 404 `{error:"not found"}` | 404 `{error:"not found"}` | PASS |
| REQ-002/EDGE-005: un-reviewed dry run | PHASE1-C2 | `curl GET /api/archives/2222…` | 404 | 404 `{error:"not found"}` | PASS |
| REQ-004: search excludes dry run | (search) | `curl GET /api/archives/search?q=Dry` | empty | `{"archives":[],"total":0,"q":"Dry"}` | PASS |

## UI proof (Playwright MCP — independent browser reproof)

**PHASE1-C6** (REQ-006 / VS-1 / VS-2) — PROVEN by driving a real Chrome with no auth cookie:

- Navigated to `/archive/11111111-1111-1111-1111-111111111111`. The page rendered the full digest: page
  title "Dry Run Story Renders Correctly", the recap headline, the dek "A reviewed dry-run digest accessible
  by direct link without auth.", the "Unpacked" bullet list, and the "Bottom line" pull-quote. It did **not**
  show the "Couldn't load this issue" error state nor the "isn't ready yet" state. 0 console errors.
  Screenshot: `verification/screenshots/PHASE1-C6-dry-run-archive-renders.png`
- Navigated to `/`. The public listing showed no archive rows — the reviewed dry run is absent from the
  listing. Screenshot: `verification/screenshots/PHASE1-C6-listing-omits-dry-run.png`

Both screenshots are independent browser evidence for claim **PHASE1-C6**; a passing `.spec.ts` was not relied on.

## Conclusion

All spec scenarios pass against live PostgreSQL + Redis + API + web. The bug ("View Archive page Fails" for a
dry run) is fixed: a reviewed dry-run archive is publicly viewable by its direct link with no auth, while it
remains excluded from the public listing and search. Missing and un-reviewed archives still 404.
