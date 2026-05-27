# Functional Verification — Proof Report: regenerate-digest-meta

**Verdict: PASS.** All Must requirements verified; all six `type:"ui"` claims independently re-proven via
Playwright MCP with committed screenshots; adversarial pass clean across 15 scenarios (0 defects).

Date: 2026-05-27 · Branch: `feat/regenerate-digest-meta` · Claims: `.harness/regenerate-digest-meta/claims.json` (111/111 passed, 0 failed → no blocker).

---

## 1. Summary table

| Scenario | Type | Description | Verdict |
|----------|------|-------------|---------|
| PHASE4-C1 | ui | DigestMetaPanel renders below Add-a-post with 4 seeded fields | PASS |
| PHASE4-C2 | ui | Regenerate overwrites all four fields | PASS |
| PHASE4-C5 | ui | Twitter Summary >180 shows red over-limit counter, typing not blocked | PASS |
| PHASE4-C6 | ui | Regenerate disabled at zero ranked items | PASS |
| PHASE4-C7 | ui | Edit + Save persists; reload shows persisted values (+ FTS recompute) | PASS |
| PHASE4-C9 | ui | CostDialog renders Digest stage row + 8 headers | PASS |
| REQ-005 (api) | api | Regenerate 200, does NOT persist | PASS (A-NOPERSIST) |
| REQ-006/007/008/009 | api | 404 / 409 dry-run / 502 / admin-gate | PASS (live re-probe) |
| REQ-010/011, EDGE-004/009 | db | PATCH write/preserve/null/empty digest cols + FTS | PASS (live re-probe) |
| REQ-013 / REQ-014 | api | admin detail HAS twitterSummary; public does NOT | PASS (live cross-check) |

## 2. API evidence

Live API (`http://localhost:3000`), admin cookie via `POST /api/admin/login`. Summary saved to
`verification/api/adversarial-summary.txt`. Key results:

- **REQ-005 / A-NOPERSIST:** `POST .../regenerate-digest-meta` with valid ids → `200`, body keys
  `['headline','hook','summary','twitterSummary']`. DB `digest_headline` identical before
  (`PERSIST-CHECK-HEADLINE-7Q2`) and after the call. Does NOT persist. PASS.
- **REQ-013:** admin `GET /api/admin/archives/:runId` top-level JSON includes `twitterSummary` (string). PASS.
- **REQ-014:** public `GET /api/archives/:runId` top-level keys =
  `[completedAt, digestHeadline, digestSummary, error, hook, id, issueDate, rankedItems, sourceTypes, sources, stage, startedAt, status, topN, updatedAt, warnings]` — **no `twitterSummary`**. PASS.
- **REQ-006:** random uuid → `404 {"error":"archive not found: …"}`.
- **REQ-007:** dry-run archive → `409 {"reason":"cannot regenerate digest for a dry-run archive"}`.
- **REQ-009:** no cookie → `401 {"error":"unauthorized"}` (admin gate, no LLM).
- **Validation:** empty items → `400 "items cannot be empty"`; unknown id → `400 {"missingIds":[999999]}`; malformed body → `400 "invalid json"`.

## 3. UI evidence (Playwright MCP, viewport ~1200px, route `/admin/review/:runId` and `/admin`)

| Claim | Route | Screenshot | Evidence |
|-------|-------|-----------|----------|
| PHASE4-C1 | /admin/review/:runId | `screenshots/PHASE4-C1-panel-seeded.png` | 4 inputs present; seeded with SEED values; `addPostTop=234px` < `digestPanelTop=453px` (panel below Add-a-post) |
| PHASE4-C2 | /admin/review/:runId | `screenshots/PHASE4-C2-after-regenerate.png` | `POST …/regenerate-digest-meta => 200` (net #224); all 4 fields overwritten with LLM content (no "SEED") |
| PHASE4-C5 | /admin/review/:runId | `screenshots/PHASE4-C5-twitter-over-limit.png` | typed 220 chars not truncated; counter "220/180" `data-over-limit="true"` red `oklch(0.577 0.245 27.325)` |
| PHASE4-C6 | /admin/review/:runId | `screenshots/PHASE4-C6-regenerate-disabled-zero-items.png` | empty-ranked archive: panel renders, Regenerate `disabled=true` |
| PHASE4-C7 | /admin/review/:runId | `screenshots/PHASE4-C7-persisted-after-reload.png` | edited headline → Save → reload shows `PERSIST-CHECK-HEADLINE-7Q2` + persisted summary/hook/twitter |
| PHASE4-C9 | /admin | `screenshots/PHASE4-C9-costdialog-digest-stage.png` | dialog has 8 headers (Stage/Calls/In tok/Out tok/Cached/Thinking/Model/Cost) + Digest row (2 calls, $0.003) |

Per-screenshot spec + open-visual review in `screenshots/observations.md`. Console: 0 errors after navigation.

**UI claims covered at unit level (CANNOT_ASSESS in-browser, rationale below):**
- **PHASE4-C3** (loading affordance): live regenerate resolved faster than any browser poll could observe the `isPending` window across two polling strategies — covered by `DigestMetaPanel.test.tsx::REQ-017`.
- **PHASE4-C4** (error state): live endpoint succeeds; forcing failure not possible against the running server — covered by `DigestMetaPanel.test.tsx::REQ-018`.

## 4. DB evidence (psql against local Postgres `:5433/newsletter`)

- **PHASE4-C7 / REQ-019/020:** after UI Save, `digest_headline='PERSIST-CHECK-HEADLINE-7Q2'`, regenerated summary/hook/twitter persisted, `search_text ILIKE '%PERSIST-CHECK%'` = true (PHASE3-C2 FTS recompute).
- **A-OMIT-PRESERVE (REQ-011):** PATCH with only rankedItems → `digest_headline`/`hook` unchanged.
- **A-NULL-HEADLINE (EDGE-009):** PATCH `digestHeadline:null` → `digest_headline IS NULL`, `search_text` no longer contains the old headline.
- **A-EMPTY-HOOK (EDGE-004):** PATCH `hook:""` → `hook=''` (empty string, distinct from preserve).
- **A-SAVE-OVERLIMIT (EDGE-003):** PATCH 250-char twitterSummary → `200`, `length(twitter_summary)=250` (no hard server cap).

## 5. Visual anomalies & UX observations

Second pass clean across 6 screenshots; per-screenshot notes in `observations.md`. One minor UX note
(not a defect): the review page's bottom-bar "unsaved changes" counter tracks ranked-item edits, not
digest-field edits — after a Regenerate the counter still reads "0 unsaved changes" even though the four
fields changed. Save still includes the current field values (proven by C7 + REQ-019), so there is no
data-loss risk; the counter is purely informational and out of this feature's spec scope.

## 6. Spec coverage table

| REQ/EDGE | Scenario / Evidence | Status |
|----------|---------------------|--------|
| REQ-001..004 (digest-meta gen + retry + empty-throw) | unit `digest-meta-instructions.test.ts`, `digest-meta.test.ts` (claims PHASE1-C1..C7) | COVERED_BY_E2E/unit |
| REQ-005 | A-NOPERSIST live (§2) + e2e `archives.e2e.test.ts::REQ-005` | VERIFIED |
| REQ-006 | live 404 (§2) + e2e | VERIFIED |
| REQ-007 | live 409 dry-run (§2) + e2e | VERIFIED |
| REQ-008 | e2e `archives.e2e.test.ts::REQ-008` (502 on LLM reject) | COVERED_BY_E2E |
| REQ-009 | live 401 no-auth (§2) | VERIFIED |
| REQ-010 | live PATCH (§4) + e2e `REQ-010` | VERIFIED |
| REQ-011 | A-OMIT-PRESERVE (§4) + e2e `REQ-011` | VERIFIED |
| REQ-012 | unit `validate.test.ts` (claim PHASE3-C8) | COVERED_BY_E2E/unit |
| REQ-013 | live admin detail (§2) + e2e `REQ-013` | VERIFIED |
| REQ-014 | live public detail (§2) + e2e `REQ-014` | VERIFIED |
| REQ-015 | C1 screenshot | VERIFIED |
| REQ-016 / EDGE-002 | C2 + A-EDIT-REGEN | VERIFIED |
| REQ-017 | C3 (unit `REQ-017`; CANNOT_ASSESS in-browser) | COVERED_BY_unit |
| REQ-018 | C4 (unit `REQ-018`; CANNOT_ASSESS in-browser) | COVERED_BY_unit |
| REQ-019 | C7 (Save body / DB persist) | VERIFIED |
| REQ-020 | C7 reload | VERIFIED |
| REQ-021 | auto-review unchanged — unit/e2e (rank tests still green) | COVERED_BY_E2E |
| EDGE-001 | C6 / A-EMPTY | VERIFIED |
| EDGE-003 | C5 (UI counter) + A-SAVE-OVERLIMIT (server no cap) | VERIFIED |
| EDGE-004 | A-EMPTY-HOOK (§4) + e2e | VERIFIED |
| EDGE-005 (legacy null fields) | seeded EMPTY ARCHIVE (C6) shows empty seed + unit `EDGE-005` | VERIFIED |
| EDGE-006 (body order) | e2e `archives-route.test.ts::EDGE-006` | COVERED_BY_E2E |
| EDGE-007 (prompt byte-identical) | unit `digest-meta-instructions.test.ts` | COVERED_BY_E2E/unit |
| EDGE-008 (retry budget) | unit `digest-meta.test.ts` | COVERED_BY_E2E/unit |
| EDGE-009 | A-NULL-HEADLINE (§4) + e2e | VERIFIED |

No requirement listed as NOT VERIFIED.

## 7. E2E coverage summary

`type:"api"`/`type:"db"` claims (PHASE1-*, PHASE2-*, PHASE3-*) are `COVERED_BY_E2E` and not re-run here;
proven during coding by `archives.e2e.test.ts` (26 passing), `archives-route.test.ts`, `validate.test.ts`,
`review.test.ts`, `digest-meta*.test.ts`, `rank.test.ts`. See `.harness/regenerate-digest-meta/claims.json`
e2e_runs. Where cheap, the api/db claims were additionally re-probed LIVE as the critic (§2/§4) and agreed.

## 8. Adversarial findings (quoted from `verification/adversarial-findings.md`)

> **No defects found across 15 scenarios attempted.** Categories exercised: permissions/auth, boundary
> inputs (empty/unknown-id/malformed/404), status/conflict (dry-run 409), persistence contracts
> (no-persist on regenerate, no-persist on unsaved reload, omit-preserve, write-null, write-empty,
> no-hard-cap save), UI gating (disabled-at-zero, always-overwrite), and public serialization.

> The most promising attack was **A-NOPERSIST + A-RELOAD-NOSAVE** … attacked it two ways: a direct API
> regenerate followed by a DB re-read (column unchanged), and a browser regenerate followed by a reload
> without saving (UI reverted to the persisted value). … They didn't [write through] — the route returns
> the blob and stops, and the column only moves on an explicit PATCH.

Section 3 of adversarial-findings: **"None."** (no DEFECT-class outcomes).

## 9. Not executed

- PHASE4-C3 in-flight loading affordance and PHASE4-C4 error state — not observable against the live
  Anthropic-backed endpoint (too fast / cannot force failure). Both covered by component tests.
- `auto-review` end-to-end pipeline path (REQ-021) — requires a full pipeline worker run; verified by the
  existing rank/recap test suite remaining green, not re-run live in this gate.

## 10. Infrastructure

- **Postgres + Redis:** already running (podman `admin-linkedin-oauth_postgres_1` + `_redis_1`, healthy). Left running.
- **API (`:3000`) + Web (`:5173`):** a stale instance (lacking the regenerate route — confirmed by a
  plain-text 404) was already running; **I killed it and started fresh** dev servers from this worktree
  (`pnpm --filter @newsletter/api dev`, `pnpm --filter @newsletter/web dev`), after building `@newsletter/shared`.
  Per the cleanup contract these are mine to stop — left running for the downstream quality-gate stage,
  which restarts/uses them; they will be terminated at end of the pipeline. Logs: `/tmp/rdm-api.log`, `/tmp/rdm-web.log`.
- **Seed data:** archives `aaaaaaaa-…-000000000001` (reviewed, 3 ranked → raw_items 304/305/306),
  `…-0000000000d2` (dry-run), `…-0000000000e0` (empty-ranked), plus a minimal `user_settings` row
  (`shortlist_size=40` explicit, to avoid the known NOT-NULL drift). These remain in the DB as evidence.
- **Browser:** one Playwright MCP session; a stale singleton lock from a prior run was cleared; closed at end.
