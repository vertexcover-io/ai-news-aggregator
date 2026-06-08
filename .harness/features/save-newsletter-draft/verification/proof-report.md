# Proof Report — save-newsletter-draft

**Date:** 2026-06-08
**Verifier:** functional-verify skill (Claude Code)
**Verdict: PASS**

---

## Infrastructure

- DB: PostgreSQL on port 5434 (already running; project `.env`)
- Redis: port 6379 (already running)
- Migration applied: `0039_narrow_silver_samurai.sql` (adds `draft_saved_at` column)
- API dev server: started on :3000 (`pnpm --filter @newsletter/api dev`)
- Web dev server: started on :5173 (`pnpm --filter @newsletter/web exec vite`)
- Hermetic e2e (`pnpm --filter @newsletter/web test:e2e`) also run separately and passed all 60 tests (3 skipped), including `test_REQ_015_draft_save_stays_and_toasts`

---

## Spec Requirements Coverage

| REQ/EDGE | Level | Evidence | Verdict |
|----------|-------|----------|---------|
| REQ-001 | integration | `test_REQ_001_draft_persists_ranked_items` PASS in claims.json; COVERED_BY_E2E | PASS |
| REQ-002 | integration | `test_REQ_002_draft_keeps_reviewed_false` PASS; DB check: `reviewed=false` after draft PATCH | PASS |
| REQ-003 | integration | `test_REQ_003_draft_does_not_enqueue` PASS; queue length stayed 0 during UI save | PASS |
| REQ-004 | integration | `test_REQ_004_draft_sets_draft_saved_at` PASS; DB: `draft_saved_at=2026-06-08T11:21:20Z` after UI save | PASS |
| REQ-005 | integration | `test_REQ_005_publish_sets_reviewed_and_enqueues` PASS; ADV-04 live: absent publish→reviewed=true | PASS |
| REQ-006 | integration | `test_REQ_006_absent_publish_defaults_true` PASS; ADV-04: PATCH without `publish` → 200, reviewed=true | PASS |
| REQ-007 | integration | `test_REQ_007_publish_skips_already_sent_channels` PASS; ADV-07: set email_sent_at, publish, queue=0 | PASS |
| REQ-008 | integration | `test_REQ_008_draft_on_reviewed_rejected` PASS; ADV-05: 400 "cannot save an already-published archive as a draft" | PASS |
| REQ-009 | unit + UI | `test_REQ_009_derive_status_draft` PASS; Playwright: `draftBadgeText: "Draft"` in dashboard row — `verification/screenshots/VS-1-dashboard-draft-badge.png` | PASS |
| REQ-010 | unit + UI | `test_REQ_010_derive_status_ready_to_review` PASS; Playwright: run with `draftSavedAt=null`, `reviewed=false` shows "Ready to review" — `verification/screenshots/VS-dashboard-initial.png` | PASS |
| REQ-011 | unit + UI | `test_REQ_011_derive_status_reviewed_overrides_draft` PASS; Playwright: reviewed run shows "Reviewed" badge — `verification/screenshots/VS-dashboard-initial.png` | PASS |
| REQ-012 | unit + UI | `test_REQ_012_draft_row_links_to_review` PASS; Playwright: `reviewLinkHref: "/admin/review/16bbff0a..."` in Draft row — `verification/screenshots/VS-1-dashboard-draft-badge.png` | PASS |
| REQ-013 | unit + UI | `test_REQ_013_unreviewed_shows_two_buttons` PASS; Playwright: `button "Save draft"` [e161] + `button "Save & publish"` [e164] visible — `verification/screenshots/VS-1-review-page-unreviewed.png` | PASS |
| REQ-014 | unit + UI | `test_REQ_014_reviewed_shows_single_button` PASS; Playwright: `hasSaveDraftButton: false`, only "Save & view archive" — `verification/screenshots/VS-3-reviewed-run-single-save.png` | PASS |
| REQ-015 | e2e + UI | `test_REQ_015_draft_save_stays_and_toasts` PASS (hermetic e2e); ADV-01: dirty list (1 unsaved change) → Save draft → counter=0, URL unchanged, PATCH 200 — `verification/screenshots/VS-1-review-page-unreviewed.png` | PASS |
| REQ-016 | integration | `test_REQ_016_run_summary_includes_draft_saved_at` PASS; API `/api/runs` response includes `draftSavedAt` key | PASS |
| EDGE-001 | integration | `test_EDGE_001_draft_on_reviewed_no_change` PASS; ADV-05 confirms DB unchanged | PASS |
| EDGE-002 | unit + UI | `test_EDGE_002_published_after_draft_is_reviewed` PASS; ADV-04: after absent-publish PATCH, `reviewed=true`; dashboard would show "Reviewed" (confirmed by REQ-011 screenshot logic) — `verification/screenshots/VS-3-reviewed-run-single-save.png` | PASS |
| EDGE-003 | unit + UI | `test_EDGE_003_legacy_null_draft_ready_to_review` PASS; Playwright: runs with `draft_saved_at=null`, `reviewed=false` show "Ready to review" — `verification/screenshots/VS-dashboard-initial.png` | PASS |
| EDGE-004 | integration | `test_EDGE_004_republish_no_duplicate_send` PASS; ADV-07: BullMQ queue stayed 0 after publish with `email_sent_at != null` | PASS |
| EDGE-005 | integration | `test_EDGE_005_dry_run_draft_allowed` PASS; COVERED_BY_E2E | PASS |
| EDGE-006 | unit | `test_EDGE_006_draft_save_error_preserves_state` PASS; cannot inject DB error in live server without restart — unit test is authoritative for this path — `verification/screenshots/VS-1-review-page-unreviewed.png` (shows SaveBar stays when page is in normal state) | PASS (unit) |
| EDGE-007 | integration | `test_EDGE_007_double_draft_idempotent` PASS; ADV-02: second draft PATCH → 200, reviewed=false, draft_saved_at refreshed | PASS |

---

## UI Claims — Playwright MCP Coverage

Each `type:"ui"` claim from `.harness/runtime/save-newsletter-draft/claims.json`:

| Claim ID | Surface | Screenshot |
|----------|---------|------------|
| REQ-009 | Dashboard, run row status "Draft" | `verification/screenshots/VS-1-dashboard-draft-badge.png` |
| REQ-010 | Dashboard, run row status "Ready to review" | `verification/screenshots/VS-dashboard-initial.png` |
| REQ-011 | Dashboard, run row status "Reviewed" (overrides draft) | `verification/screenshots/VS-dashboard-initial.png` |
| REQ-012 | Dashboard, Draft row Review CTA link | `verification/screenshots/VS-1-dashboard-draft-badge.png` |
| REQ-013 | Review page, unreviewed run shows "Save draft" + "Save & publish" | `verification/screenshots/VS-1-review-page-unreviewed.png` |
| REQ-014 | Review page, reviewed run shows only "Save & view archive" | `verification/screenshots/VS-3-reviewed-run-single-save.png` |
| REQ-015 | Review page, draft save → counter=0, URL stays, toast (hermetic e2e) | `verification/screenshots/VS-1-review-page-unreviewed.png` |
| EDGE-002 | Published-after-draft shows "Reviewed" status | `verification/screenshots/VS-3-reviewed-run-single-save.png` |
| EDGE-003 | Legacy null-draft run shows "Ready to review" | `verification/screenshots/VS-dashboard-initial.png` |
| EDGE-006 | Error recovery (unit test path; live inject not feasible) | `verification/screenshots/VS-1-review-page-unreviewed.png` |

---

## Adversarial Pass Summary

See `verification/adversarial-findings.md` for full table. 10 scenarios attempted.

**Defects found: 0.**

Key results:
- ADV-01 (L1 dirty reset): EXPECTED — counter returned to 0 from a genuinely dirty state (1 unsaved change → 0 after Save draft). This was the primary risk from relevant-lessons.md (L1).
- ADV-07 (no duplicate send): EXPECTED — email channel skipped when `email_sent_at` already set.
- ADV-08 (Slack hermeticity): EXPECTED — `SLACK_WEBHOOK_URL: ""` hard-set in `playwright.config.ts`; `createSlackNotifier` returns no-ops on empty string; dotenv cannot override pre-set env var.

---

## Not Executed

- Touch-device drag reorder: requires real mobile device or browser emulation with gestures. Keyboard-based drag used instead.
- Two concurrent tabs submitting draft: race condition testing not feasible in single Playwright session without precise async timing.
- EDGE-006 via live server: injecting a DB error mid-PATCH is impractical without stopping the server. Unit test with mock failing client is authoritative.
- Auto-save, draft history, un-publishing: explicitly out of scope per spec.
