# SPEC: Manual LinkedIn / X (Twitter) Post Trigger

**Source:** docs/spec/manual-social-post-trigger/design.md
**Generated:** 2026-05-26

## Requirements

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|---------------------|----------|
| REQ-001 | Event-driven | When an admin POSTs to `/api/runs/:runId/post/:channel` with `channel ∈ {linkedin, twitter}` for an eligible archive, the system shall enqueue the matching post job (`linkedin-post` / `twitter-post`) onto the processing queue with `{ runId }` and respond 202. | A `Queue.add` is invoked with the correct job name and `data.runId === :runId`; response status is 202. | Must |
| REQ-002 | Unwanted | If the target archive is missing, then the system shall respond 404 without enqueuing a job. | `findById` returns null → 404, `Queue.add` not called. | Must |
| REQ-003 | Unwanted | If the target archive is ineligible (not reviewed, OR is a dry-run, OR is already posted on the requested channel), then the system shall respond 409 with a reason and not enqueue a job. | Each ineligible condition → 409 with a `reason` field; `Queue.add` not called. | Must |
| REQ-004 | Unwanted | If `:channel` is not one of `linkedin` / `twitter`, then the system shall respond 400 without enqueuing a job. | Invalid channel → 400; `Queue.add` not called. | Must |
| REQ-005 | Ubiquitous | The `/api/runs/:runId/post/:channel` route shall be admin-gated by `requireAdmin`. | An unauthenticated request is rejected by the admin gate (redirect/401), never reaching the handler. | Must |
| REQ-006 | Event-driven | When the post worker runs a job carrying `data.runId`, the system shall resolve and post that specific archive (via the existing `resolvePublishTarget({ runId })`), independent of which archive is latest. | Worker posts the archive identified by `runId`, not `findLatestTerminal()`. | Must |
| REQ-007 | Ubiquitous | The system shall serialize `linkedinPostedAt`, `twitterPostedAt`, `linkedinPermalink`, and `twitterPermalink` onto each `RunSummary` returned by `GET /api/runs`. | A posted archive's `RunSummary` carries the non-null timestamp + permalink; an unposted one carries null. | Must |
| REQ-008 | Event-driven | When a dashboard run row is rendered, the system shall present an overflow (⋮) menu containing a LinkedIn action and an X action. | Each row exposes a ⋮ trigger; opening it shows both channel items. | Must |
| REQ-009 | State-driven | While a run row's channel is not yet posted AND the archive is eligible, the system shall present that channel's menu item as an actionable "Post to <platform>" control. | Eligible+unposted → enabled trigger item. | Must |
| REQ-010 | State-driven | While a run row's channel is already posted, the system shall present that channel's menu item as a non-trigger posted indicator linking to the stored permalink. | Posted → "<platform> ✓" item whose link href equals the permalink; no re-trigger fired. | Must |
| REQ-011 | State-driven | While a run row's archive is ineligible for a channel (not reviewed, dry-run, running/failed/cancelled), the system shall present that channel's menu item as disabled. | Ineligible → disabled item (no enqueue on click). | Should |
| REQ-012 | Event-driven | When an admin activates an enabled channel menu item, the system shall open a confirm dialog and fire the POST only on confirmation. | Activating the item shows the dialog; Cancel fires no request; Confirm fires exactly one POST. | Must |
| REQ-013 | Event-driven | When the post POST returns 202, the system shall invalidate/refetch the run list so the posted state appears once the worker completes. | The run-list query is invalidated after a 202 response. | Must |
| REQ-014 | State-driven | While a channel's trigger mutation is in flight, the system shall disable that channel's menu item to prevent a duplicate enqueue. | The item is disabled between submit and settle. | Should |

## Edge Cases

| ID | Scenario | Expected Behavior | Derived From |
|----|----------|-------------------|-------------|
| EDGE-001 | Archive posted on LinkedIn but not X | LinkedIn item = posted indicator (link); X item = enabled trigger | REQ-009, REQ-010 |
| EDGE-002 | Manual trigger races the scheduled job | Second runner sees `*_posted_at` set and no-ops; no duplicate post | REQ-006 |
| EDGE-003 | Admin double-clicks the trigger before worker finishes | In-flight disable prevents second click; worst case a redundant no-op job | REQ-014, REQ-002 |
| EDGE-004 | Archive is a reviewed dry-run | 409 (dry-run ineligible); UI item disabled | REQ-003, REQ-011 |
| EDGE-005 | Archive exists but `reviewed = false` | 409 (not reviewed); UI item disabled | REQ-003, REQ-011 |
| EDGE-006 | `runId` is not a UUID | 400 (or 404) without enqueue | REQ-002, REQ-004 |
| EDGE-007 | Legacy archive posted before this feature | Its existing `*_posted_at` + permalink serialize and render as posted state | REQ-007, REQ-010 |
| EDGE-008 | Platform credentials unset at post time | Worker notifier returns skipped; timestamp stays null; menu item stays in trigger state (no crash) | REQ-006, REQ-009 |
| EDGE-009 | `social_metadata` null but `*_posted_at` set (permalink missing) | Posted indicator renders without a link (or with a non-link "✓ posted") rather than crashing | REQ-007, REQ-010 |

## Verification Matrix

| REQ ID | Unit Test | Integration Test | E2E Test | Manual Test | Notes |
|--------|-----------|-----------------|----------|-------------|-------|
| REQ-001 | Yes | Yes | No | No | API handler enqueues correct job+runId, 202 |
| REQ-002 | Yes | Yes | No | No | 404 path |
| REQ-003 | Yes | Yes | No | No | three ineligibility branches → 409 |
| REQ-004 | Yes | No | No | No | zod channel validation → 400 |
| REQ-005 | No | Yes | No | No | admin-gate middleware coverage |
| REQ-006 | Yes | Yes | No | No | worker targeted-runId path (resolvePublishTarget) |
| REQ-007 | Yes | Yes | No | No | run-list serialization |
| REQ-008 | Yes | No | Yes | No | RunsTable overflow menu render (UI) |
| REQ-009 | Yes | No | Yes | No | enabled trigger state (UI) |
| REQ-010 | Yes | No | Yes | No | posted indicator + permalink link (UI) |
| REQ-011 | Yes | No | Yes | No | disabled item for ineligible (UI) |
| REQ-012 | Yes | No | Yes | No | confirm dialog gates the POST (UI) |
| REQ-013 | Yes | No | No | No | query invalidation after 202 |
| REQ-014 | Yes | No | No | No | in-flight disable |
| EDGE-001 | Yes | No | Yes | No | per-channel independence (UI) |
| EDGE-002 | Yes | Yes | No | No | idempotency under race (worker) |
| EDGE-003 | Yes | No | No | No | in-flight disable |
| EDGE-004 | Yes | Yes | No | No | dry-run 409 |
| EDGE-005 | Yes | Yes | No | No | unreviewed 409 |
| EDGE-006 | Yes | No | No | No | bad runId |
| EDGE-007 | Yes | No | Yes | No | legacy posted archive renders posted (UI) |
| EDGE-008 | Yes | No | No | No | credentials-unset skip, no crash |
| EDGE-009 | Yes | No | Yes | No | null permalink graceful render (UI) |

## Verification Scenarios

(No library-probe VS-0 scenarios — feature is pure-internal, library-probe NOT_APPLICABLE.)

- **VS-1 (UI):** Load `/admin` with a seeded reviewed, unposted archive → open the row's ⋮ menu → both "Post to LinkedIn" and "Post to X" appear enabled. Click "Post to LinkedIn" → confirm dialog appears → confirm → a `POST /api/runs/:id/post/linkedin` fires and returns 202. (Covers REQ-008, REQ-009, REQ-012, REQ-001.)
- **VS-2 (UI):** Load `/admin` with a seeded archive already posted on LinkedIn → the LinkedIn menu item is a posted indicator whose link points at the stored permalink; the X item remains an enabled trigger. (Covers REQ-010, EDGE-001, EDGE-007.)
- **VS-3 (API):** `POST /api/runs/<unreviewed-id>/post/linkedin` → 409 with reason; no job enqueued. (Covers REQ-003, EDGE-005.)
- **VS-4 (worker):** Enqueue `linkedin-post` with `{ runId }` for a specific (non-latest) reviewed archive → worker posts THAT archive; a second enqueue no-ops because `linkedinPostedAt` is set. (Covers REQ-006, EDGE-002.)

## Out of Scope

- **Re-posting** an already-posted run (the posted indicator links out; no re-trigger control).
- **Triggering from the review page, observability page, or public archive page** — dashboard rows only (per the user's explicit placement choice).
- **Synchronous posting** — the API enqueues and returns 202; it does not await the platform call or return the permalink in the response.
- **A new dashboard-level Slack notification for manual triggers** — the existing worker-fired `linkedin-post` / `twitter-post` Slack messages cover success signalling.
- **Surfacing precise "credentials missing" state on the dashboard** — handled by existing Slack skip/unavailable signalling; the menu item simply stays in trigger state.
- **Changing the scheduled auto-post behavior** — the schedule path (empty `runId` → `findLatestTerminal`) is unchanged.
- **New DB column or migration** — posted-at + permalink columns already exist; only read-side serialization is added.
