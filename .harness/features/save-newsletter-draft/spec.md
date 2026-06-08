# SPEC: Save newsletter review as draft

**Source:** .harness/features/save-newsletter-draft/design.md
**Generated:** 2026-06-08

## Requirements

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|---------------------|----------|
| REQ-001 | Event-driven | When the admin saves a review with `publish=false`, the system shall persist `rankedItems` and all provided digest-meta fields. | After the PATCH, a re-fetch returns the saved `rankedItems` order/content and digest fields. | Must |
| REQ-002 | Event-driven | When the admin saves a review with `publish=false`, the system shall leave `run_archives.reviewed = false`. | DB row for the run has `reviewed = false` after the request. | Must |
| REQ-003 | Event-driven | When the admin saves a review with `publish=false`, the system shall not enqueue any publish channel job (email-send, linkedin-post, twitter-post). | No job is added to the processing queue during the draft PATCH (queue `add` not called). | Must |
| REQ-004 | Event-driven | When the admin saves a review with `publish=false`, the system shall set `run_archives.draft_saved_at` to the current time. | DB row for the run has non-null `draft_saved_at` after the request. | Must |
| REQ-005 | Event-driven | When the admin saves a not-yet-reviewed run with `publish=true`, the system shall set `reviewed = true` and enqueue the immediate publish channels. | DB row has `reviewed = true`; the channels returned by `selectImmediatePublishChannels` that are not already sent are enqueued. | Must |
| REQ-006 | Ubiquitous | The PATCH archive endpoint shall treat an absent `publish` field as `publish=true`. | A PATCH body omitting `publish` produces `reviewed = true` and enqueues channels (current behavior unchanged). | Must |
| REQ-007 | Event-driven | When a publish save enqueues channels, the system shall skip any channel whose send timestamp is already set. | A channel with non-null `emailSentAt`/`linkedinPostedAt`/`twitterPostedAt` is not re-enqueued. | Must |
| REQ-008 | Unwanted | If a draft save (`publish=false`) targets an archive that is already `reviewed=true`, then the system shall reject the request with a 4xx error and make no state change. | Response status is 4xx; DB row `reviewed` and `draft_saved_at` are unchanged. | Must |
| REQ-009 | State-driven | While a completed run is `reviewed=false` with non-null `draft_saved_at`, the dashboard shall derive its status as `"draft"`. | `deriveStatus` returns `"draft"` for such a run and renders a Draft badge. | Must |
| REQ-010 | State-driven | While a completed run is `reviewed=false` with null `draft_saved_at`, the dashboard shall derive its status as `"ready-to-review"`. | `deriveStatus` returns `"ready-to-review"` (unchanged legacy behavior). | Must |
| REQ-011 | State-driven | While a run is `reviewed=true`, the dashboard shall derive its status as `"reviewed"` regardless of `draft_saved_at`. | `deriveStatus` returns `"reviewed"` even when `draft_saved_at` is non-null. | Must |
| REQ-012 | State-driven | While a run is in `"draft"` status, the dashboard shall present a CTA linking to `/admin/review/:runId`. | The Draft row/card renders a link to the review page. | Must |
| REQ-013 | State-driven | While the review page shows a not-yet-reviewed run, it shall present both a "Save draft" and a "Save & publish" action. | Both buttons are rendered when `reviewed=false`. | Must |
| REQ-014 | State-driven | While the review page shows an already-reviewed run, it shall present only the single existing Save action. | Only one save button is rendered when `reviewed=true`; no "Save draft" button. | Must |
| REQ-015 | Event-driven | When a draft save succeeds, the review page shall keep the admin on the review page, show a "Draft saved" confirmation, and reset the unsaved-changes counter. | After draft save: route unchanged, toast shown, unsaved count = 0. | Must |
| REQ-016 | Event-driven | When the `RunSummary` for a completed run is serialized, the system shall include `draftSavedAt`. | The runs-list API response includes `draftSavedAt` (ISO string or null). | Must |

## Edge Cases

| ID | Scenario | Expected Behavior | Derived From |
|----|----------|-------------------|-------------|
| EDGE-001 | Draft save against an already-`reviewed` run | 400/409 error, no change to `reviewed` or `draft_saved_at` | REQ-008 |
| EDGE-002 | Publish a run that was previously drafted (`draft_saved_at` set) | `reviewed=true`; dashboard derives `"reviewed"`; `draft_saved_at` ignored | REQ-005, REQ-011 |
| EDGE-003 | Legacy/unopened completed run (`draft_saved_at=null`, `reviewed=false`) | Dashboard derives `"ready-to-review"` | REQ-010 |
| EDGE-004 | Publish re-edit where some channels already sent | Already-sent channels skipped, no duplicate send | REQ-007 |
| EDGE-005 | Dry-run draft save | Allowed; `reviewed=false`, `draft_saved_at` set; publish remains a no-op for dry runs | REQ-002, REQ-004 |
| EDGE-006 | Draft save fails (DB error) | Error toast shown; unsaved/dirty state preserved; admin stays on page | REQ-015 |
| EDGE-007 | Draft save with same payload twice | Idempotent: edits re-persisted, `reviewed` stays false, `draft_saved_at` refreshed | REQ-001, REQ-004 |

## Verification Matrix

| REQ/EDGE ID | Test Level | Test Name | Rationale for Level | Notes |
|-------------|-----------|-----------|---------------------|-------|
| REQ-001 | integration | test_REQ_001_draft_persists_ranked_items | crosses DB boundary | api route+repo |
| REQ-002 | integration | test_REQ_002_draft_keeps_reviewed_false | crosses DB boundary | |
| REQ-003 | integration | test_REQ_003_draft_does_not_enqueue | asserts queue stub not called | mock processingQueue |
| REQ-004 | integration | test_REQ_004_draft_sets_draft_saved_at | crosses DB boundary | |
| REQ-005 | integration | test_REQ_005_publish_sets_reviewed_and_enqueues | crosses DB + queue | |
| REQ-006 | integration | test_REQ_006_absent_publish_defaults_true | route default behavior | backward compat |
| REQ-007 | integration | test_REQ_007_publish_skips_already_sent_channels | queue dedup logic | |
| REQ-008 | integration | test_REQ_008_draft_on_reviewed_rejected | route guard + DB unchanged | |
| REQ-009 | unit | test_REQ_009_derive_status_draft | pure logic | deriveStatus |
| REQ-010 | unit | test_REQ_010_derive_status_ready_to_review | pure logic | deriveStatus |
| REQ-011 | unit | test_REQ_011_derive_status_reviewed_overrides_draft | pure logic | deriveStatus |
| REQ-012 | unit | test_REQ_012_draft_row_links_to_review | component render | RunsTable/CardList |
| REQ-013 | unit | test_REQ_013_unreviewed_shows_two_buttons | component render | ReviewPage/SaveBar |
| REQ-014 | unit | test_REQ_014_reviewed_shows_single_button | component render | ReviewPage/SaveBar |
| REQ-015 | e2e | test_REQ_015_draft_save_stays_and_toasts | critical user journey | Playwright |
| REQ-016 | integration | test_REQ_016_run_summary_includes_draft_saved_at | crosses DB boundary | runs route |
| EDGE-001 | integration | test_EDGE_001_draft_on_reviewed_no_change | covered with REQ-008 assertions | may merge w/ REQ-008 |
| EDGE-002 | unit | test_EDGE_002_published_after_draft_is_reviewed | pure logic | deriveStatus |
| EDGE-003 | unit | test_EDGE_003_legacy_null_draft_ready_to_review | pure logic | deriveStatus |
| EDGE-004 | integration | test_EDGE_004_republish_no_duplicate_send | queue dedup | |
| EDGE-005 | integration | test_EDGE_005_dry_run_draft_allowed | DB boundary | |
| EDGE-006 | unit | test_EDGE_006_draft_save_error_preserves_state | component error path | mock failing client |
| EDGE-007 | integration | test_EDGE_007_double_draft_idempotent | DB boundary | |

## Verification Scenarios

### VS-1: Save draft and resume
1. Open the review page for a completed, not-yet-reviewed run → both "Save draft" and "Save & publish" buttons are visible.
2. Reorder/edit some items and digest copy, then click **Save draft** → a "Draft saved" toast appears, the unsaved-changes counter resets to 0, and the page stays on `/admin/review/:runId`.
3. Navigate to `/admin` → the run shows a **Draft** badge (not "Ready to review") with a Review CTA.
4. Confirm the run does NOT appear in the public archive listing (`/`) and `/archive/:runId` returns not-found.
5. Click **Review** to reopen → the previously saved order/content and digest copy are rehydrated.

### VS-2: Save & publish (unchanged behavior)
1. From the resumed draft (or a fresh run), click **Save & publish** → the admin is taken to `/archive/:runId`.
2. The run now appears in the public archive listing and the dashboard shows the **Reviewed** badge.
3. Publish channels enabled in settings (and past-due) are enqueued; already-sent channels are not re-enqueued.

### VS-3: Edit a published archive (no duplicate sends)
1. Open an already-published archive (`reviewed=true`) for editing → only the single Save action is shown (no "Save draft").
2. Edit and save → the archive updates; channels already sent (non-null send timestamps) are not re-enqueued, preventing duplicate email/LinkedIn/X posts.

## Out of Scope

- Auto-save, draft versioning, or draft history — a single mutable draft state per run.
- A draft lifecycle for runs that never completed — drafts apply only to completed runs (the set reviewable today).
- Un-publishing: an already-published archive (`reviewed=true`) cannot be reverted to a draft.
- Any change to pipeline publish workers, scheduling, or queue semantics — they are untouched and already gate on `reviewed`.
- Public-facing surface changes — drafts remain invisible to all public routes via existing `reviewed` filters.
