# Verification Proof Report — late-review-publish-trigger

**Date:** 2026-05-26
**Spec:** docs/spec/late-review-publish-trigger/spec.md
**Verdict:** PASSED

---

## Summary

All 29 test claims (13 unit, 14 integration, 2 e2e) passed. Typecheck, lint, and all
targeted test suites are green. No UI claims exist; the UI-proof gate is trivially
satisfied. The feature adds zero schema changes and no new dependencies.

---

## Test Evidence

### Unit Tests — @newsletter/shared

Command: `pnpm --filter @newsletter/shared test:unit`

```
Test Files  28 passed (28)
Tests       273 passed (273)
Duration    1.34s
```

The 13 new unit tests in `packages/shared/tests/unit/scheduling/immediate-publish.test.ts`
cover claims PHASE1-C1 through PHASE1-C9:

| Claim | Scenario | Result |
|-------|----------|--------|
| PHASE1-C1 | All enabled channels past-due → all three returned | PASS |
| PHASE1-C2 | scheduleEnabled=false → [] | PASS |
| PHASE1-C3 | One disabled channel, two enabled past-due → two returned | PASS |
| PHASE1-C4 | One future channel, one past-due → only past-due returned | PASS |
| PHASE1-C5 | now === scheduledMoment (strict boundary) → NOT included | PASS |
| PHASE1-C6 | Malformed channelTime (24:00, empty, 9:5) → omitted, no throw | PASS |
| PHASE1-C7 | channelTime === pipelineTime → omitted, sibling still evaluated | PASS |
| PHASE1-C8 | Day-rollover (channelTime < pipelineTime) → next-day moment | PASS |
| PHASE1-C9 | VS-3 cross-check: past-due decision matches publishDateForWindow directly | PASS |

### Integration Tests — @newsletter/api (unit suite)

Command: `pnpm --filter @newsletter/api test:unit`

```
Test Files  46 passed (46)
Tests       587 passed (587)
Duration    6.76s
```

The 13 integration tests in `packages/api/tests/unit/routes/archives-immediate-publish.test.ts`
cover claims PHASE2-C1 through PHASE2-C9 plus edge cases:

| Claim | Scenario | Result |
|-------|----------|--------|
| PHASE2-C1 | All past-due → email-send, linkedin-post, twitter-post enqueued (delay:0, jobId) | PASS |
| PHASE2-C2 | Only email past-due → only email enqueued; others deferred | PASS |
| PHASE2-C3 | emailSentAt set → email-send skipped even when past-due | PASS |
| PHASE2-C4 | No processingQueue dep → no-op, 200 returned | PASS |
| PHASE2-C5 | No getSettingsRepo / settings=null → no-op, 200 returned | PASS |
| PHASE2-C6 | twitterPostEnabled=false → twitter-post not enqueued | PASS |
| PHASE2-C7 | Logs info event archive.immediate_publish_enqueued with runId + channels | PASS |
| PHASE2-C8 | autoReview=true does not suppress immediate block on manual PATCH | PASS |
| PHASE2-C9 | All sentAt fields set → zero enqueue calls | PASS |

### E2E Tests — @newsletter/api (e2e suite, live DB + Redis)

Command: `pnpm --filter @newsletter/api test:e2e tests/e2e/archives.e2e.test.ts`

```
Test Files  1 passed (1)
Tests       16 passed (16)
Duration    1.36s
```

The 2 new e2e tests (plus 14 pre-existing archive/publish-date tests all green):

| Claim | Scenario | Result |
|-------|----------|--------|
| PHASE2-C10 (VS-1/EDGE-006) | Late PATCH against live DB: all 3 past-due channels enqueued with correct runId and delay:0 | PASS |
| PHASE2-C11 (VS-2/REQ-011/EDGE-004) | emailSentAt set in DB → email-send NOT re-enqueued; linkedin + twitter still enqueued | PASS |

---

## Quality Checks

| Check | Command | Result |
|-------|---------|--------|
| Typecheck | `pnpm typecheck` | PASS (0 errors, 7/7 tasks cached) |
| Lint | `pnpm lint` | PASS (0 warnings, 5/5 tasks cached) |
| Shared unit tests | `pnpm --filter @newsletter/shared test:unit` | 273/273 PASS |
| API unit tests | `pnpm --filter @newsletter/api test:unit` | 587/587 PASS |
| Archives e2e | `pnpm --filter @newsletter/api test:e2e tests/e2e/archives.e2e.test.ts` | 16/16 PASS |

### Pre-existing Unrelated E2E Failures

The following e2e suites fail on the base commit (`b94cb26`) due to a
`user_settings.shortlist_size NOT NULL constraint` / scheduler-count assertion mismatch in
the test DB. They are not caused by this feature and are explicitly out-of-scope:

- `tests/e2e/settings.e2e.test.ts` — DATABASE_URL not set when run without `.env`
- `tests/e2e/sources.e2e.test.ts` — pre-existing shortlist_size constraint
- `tests/e2e/admin-must-read.e2e.test.ts` — pre-existing test DB schema issue

---

## Requirement Coverage

| REQ ID | Status | Evidence |
|--------|--------|---------|
| REQ-001 | COVERED | PHASE2-C1 + VS-1: selectImmediatePublishChannels called on PATCH |
| REQ-002 | COVERED | PHASE1-C1, PHASE2-C1, PHASE2-C10 (VS-1) |
| REQ-003 | COVERED | PHASE1-C4, PHASE2-C2 |
| REQ-004 | COVERED | PHASE1-C2, PHASE1-C3, PHASE2-C6 |
| REQ-005 | COVERED | PHASE1-C9 (VS-3 cross-check against publishDateForWindow) |
| REQ-006 | COVERED | PHASE1-C6, PHASE1-C7 |
| REQ-007 | COVERED | Existing scheduler tests unaffected (273/273 shared pass) |
| REQ-008 | COVERED | PHASE2-C3, PHASE2-C9, PHASE2-C11 (VS-2) |
| REQ-009 | COVERED | PHASE2-C7 (log event archive.immediate_publish_enqueued) |
| REQ-010 | COVERED | PHASE2-C4 |
| REQ-011 | COVERED | PHASE2-C11 (VS-2/EDGE-004): re-PATCH of already-sent channel not re-enqueued |

---

## Files Changed (vs origin/main)

- `packages/shared/src/scheduling/immediate-publish.ts` — new pure helper
- `packages/shared/src/scheduling/index.ts` — re-exports `selectImmediatePublishChannels`
- `packages/api/src/routes/archives.ts` — enqueue block after patchArchive on PATCH route
- `packages/shared/tests/unit/scheduling/immediate-publish.test.ts` — 13 unit tests
- `packages/api/tests/unit/routes/archives-immediate-publish.test.ts` — 13 integration tests
- `packages/api/tests/e2e/archives.e2e.test.ts` — 2 e2e test cases added
