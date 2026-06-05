# SPEC: Edit a newsletter after review is done

**Source:** .harness/features/admin-edit-after-review/design.md
**Generated:** 2026-06-05

## Requirements

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|---------------------|----------|
| REQ-001 | Event-driven | When a dashboard run row has `status === "completed"` and `reviewed === true` (dry-run included), the kebab (⋮) menu shall render an enabled "Edit newsletter" item that navigates to `/admin/review/:runId` | Menu item present, not `aria-disabled`, click closes the menu and routes to `/admin/review/<runId>` | Must |
| REQ-002 | State-driven | While a run row is in any other state (`ready-to-review`, `running`, `failed`, `cancelling`, `cancelled`), the kebab menu shall render the "Edit newsletter" item disabled | Item rendered with `disabled` + `aria-disabled="true"`; click does not navigate | Must |
| REQ-003 | Ubiquitous | `GET /api/admin/archives/:runId` shall include `reviewed: boolean`, `emailSentAt`, `linkedinPostedAt`, `twitterPostedAt` (each ISO-8601 string or null) in its response body | Response JSON contains all four keys with correct values for a seeded archive | Must |
| REQ-004 | Unwanted behavior | If the public `GET /api/archives/:runId` route serves an archive, then the response shall NOT contain `reviewed`, `emailSentAt`, `linkedinPostedAt`, or `twitterPostedAt` keys | Response JSON has none of the four keys | Must |
| REQ-005 | State-driven | While the review page's loaded archive has `reviewed === true`, the page heading shall read `Edit · <date>` and the subtitle shall describe edit mode | Heading text matches `/^Edit · /` for a reviewed archive; `/^Review · /` for an unreviewed one | Must |
| REQ-006 | Event-driven | When the review page loads a reviewed archive with at least one non-null sent timestamp, the page shall render a notice banner naming each already-published channel (Email / LinkedIn / X) and stating that edits do not change those channels | Banner present; lists exactly the channels whose timestamps are non-null | Must |
| REQ-007 | Unwanted behavior | If a publish channel's sent timestamp is non-null when an edit is saved via `PATCH /api/admin/archives/:runId`, then the system shall not enqueue that channel's publish job | Queue stub records zero `add` calls for that channel | Must |
| REQ-008 | Event-driven | When `PATCH /api/admin/archives/:runId` is called for an already-reviewed archive, the system shall respond 200 and persist the updated `rankedItems` and digest fields | Re-PATCH returns 200; subsequent GET reflects the edited values | Must |

## Edge Cases

| ID | Scenario | Expected Behavior | Derived From |
|----|----------|-------------------|-------------|
| EDGE-001 | Edit saved when email, LinkedIn, and Twitter timestamps are all non-null | Archive updates; zero publish jobs enqueued | REQ-007, REQ-008 |
| EDGE-002 | Edit saved when email is past-due and unsent, LinkedIn already posted | `email-send` enqueued with `delay: 0`; `linkedin-post` not enqueued | REQ-007 |
| EDGE-003 | Reviewed dry-run archive | "Edit newsletter" item enabled (dry runs never publish; archive-only update) | REQ-001 |
| EDGE-004 | Each non-eligible state: ready-to-review, running, failed, cancelling, cancelled | Edit item disabled in all five states | REQ-002 |
| EDGE-005 | Reviewed archive with all three sent timestamps null | Heading is `Edit · <date>`; no published-channels banner rendered | REQ-005, REQ-006 |
| EDGE-006 | Unreviewed completed archive loaded directly at `/admin/review/:runId` | Heading stays `Review · <date>`; no banner; existing review flow unchanged | REQ-005 |

## Verification Matrix

Each REQ/EDGE gets exactly ONE test at the LOWEST sufficient level. This matrix is the test budget.

| REQ/EDGE ID | Test Level | Test Name | Rationale for Level | Notes |
|-------------|-----------|-----------|---------------------|-------|
| REQ-001 | unit | test_REQ_001_edit_item_enabled_for_reviewed_run | component render + router assertion, jsdom suffices | extend existing SocialOverflowMenu tests |
| REQ-002 | unit | test_REQ_002_edit_item_disabled_when_not_reviewed | pure render-state logic | |
| REQ-003 | integration | test_REQ_003_admin_get_exposes_review_publish_fields | crosses route+repo boundary | extend existing admin archives route test |
| REQ-004 | integration | test_REQ_004_public_get_omits_publish_fields | guards public serialization contract | |
| REQ-005 | unit | test_REQ_005_review_page_heading_edit_mode | render logic on query data | |
| REQ-006 | unit | test_REQ_006_published_channels_banner_lists_sent_channels | render logic on query data | |
| REQ-007 | integration | test_REQ_007_repatch_skips_sent_channel | route + queue-stub boundary | |
| REQ-008 | integration | test_REQ_008_repatch_reviewed_archive_returns_200_and_updates | route + DB boundary | |
| EDGE-001 | integration | test_EDGE_001_all_channels_sent_enqueues_nothing | queue-stub assertion across all 3 channels | |
| EDGE-002 | integration | test_EDGE_002_unsent_pastdue_email_enqueued_sent_linkedin_skipped | mixed-state enqueue decision | |
| EDGE-003 | unit | test_EDGE_003_dryrun_reviewed_edit_enabled | render-state logic | |
| EDGE-004 | unit | test_EDGE_004_edit_disabled_across_ineligible_states | parameterized over 5 states, one test | |
| EDGE-005 | unit | test_EDGE_005_edit_heading_without_banner_when_unsent | render logic | |
| EDGE-006 | unit | test_EDGE_006_unreviewed_archive_keeps_review_heading | render logic | |

## Verification Scenarios

### VS-1: Edit an already-reviewed newsletter from the dashboard
1. Log in at `/admin/login`, land on `/admin` with at least one reviewed completed run. → Run row shows "View archive" primary action.
2. Open the row's ⋮ kebab menu. → "Edit newsletter" item is visible and enabled.
3. Click "Edit newsletter". → Browser navigates to `/admin/review/<runId>`; heading reads `Edit · <date>`.
4. If the run has already been emailed/posted, a banner lists those channels; otherwise no banner.
5. Change a story title, then Save. → Navigates to `/archive/<runId>`; the public archive shows the edited title.

### VS-2: Edit is disabled for non-reviewed runs
1. On `/admin`, locate a completed-but-unreviewed run (primary action "Review").
2. Open its ⋮ kebab menu. → "Edit newsletter" item is visible but disabled (`aria-disabled`).
3. Click it. → Nothing happens; no navigation.

### VS-3: Already-sent channels are untouched by an edit
1. Seed/identify a reviewed archive with `emailSentAt` non-null.
2. Save an edit from the review page. → PATCH returns 200; archive content updates.
3. Inspect the processing queue. → No new `email-send` job was enqueued for that run.

## Out of Scope

- Re-sending or reverting channels that have already published (`emailSentAt`/`linkedinPostedAt`/`twitterPostedAt` non-null) — explicitly ignored per requirements.
- Any "unreview" operation or reviewed-flag toggle.
- Editing failed, cancelled, running, or unreviewed runs via the kebab entry (the unreviewed case keeps its existing "Review" primary button).
- Exposing the four new fields on any public route (NF2).
- Concurrency control between an in-flight publish worker and a simultaneous edit save (accepted race, design EC6).
- Renaming `SocialOverflowMenu`; DB migrations; new endpoints; new env vars.
