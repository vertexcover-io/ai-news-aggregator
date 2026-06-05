---
governs: packages/web/src/components/dashboard/
last_verified_sha: ad0153a
key_files: [RunsTable.tsx, RunsCardList.tsx, CostDialog.tsx, CostButton.tsx, SocialOverflowMenu.tsx, ScheduleBanner.tsx, EmptyState.tsx, cost-format.ts, run-status.tsx]
flow_fns: [RunsTable.tsx::RunsTable, SocialOverflowMenu.tsx::SocialOverflowMenu]
decisions: [D-017, D-018]
status: active
---

# components/dashboard/ — admin dashboard (runs list, cost, social actions)

## Purpose

Components for the admin dashboard (`/admin`): runs table with dual responsive representation (table >= 640px, cards < 640px), per-row cost dialog, social post overflow menu, schedule status banner, and empty state.

## Public surface

| Component | Effect |
|---|---|
| `RunsTable({ runs, onRetry, retrying, onCancel, onDelete })` | Tabular runs list (≥640px): Date, Publish date, Digest headline, Status badge, Item count, Review link, Details link, Cost button, Social menu, Cancel/Delete actions |
| `RunsCardList({ runs, onRetry, retrying, onCancel, onDelete })` | Card-based runs list (<640px): stacked cards with same info, shorter format |
| `CostButton({ costBreakdown, runId })` | Button showing `Cost: $X.XXX`, `Cost: ?` (null breakdown), or plain `Cost` (pre-feature null). Opens `CostDialog` on click. |
| `CostDialog({ costBreakdown, open, onClose })` | Table: Stage / Calls / In tok / Out tok / Cached / Thinking / Model / Cost columns with stage-aggregate + per-model sub-rows |
| `SocialOverflowMenu({ run, onLinkedInPost, onTwitterPost })` | ⋮ overflow menu per run row: enabled trigger for unposted eligible runs, "View post ↗" link for posted runs, "✓ Posted" non-link for posted-without-permalink, disabled items for ineligible runs. Confirm dialog on trigger click. |
| `ScheduleBanner({ scheduleTime, scheduleTimezone })` | Info banner showing next scheduled run time |
| `EmptyState()` | "No settings yet — configure your newsletter to get started" CTA |
| `cost-format.ts` | `formatCostUsd(n)`, `formatTokens(n)` — pure formatting |
| `run-status.tsx` | `RunStatusBadge({ status, stage? })` — extracted from RunsTable; renders colored status pill with optional stage annotation. Tested independently. |

## Depends on / used by

- **Uses:** `hooks/useTriggerSocialPost`, `@newsletter/shared/types` (RunSummary, RunCostBreakdown)
- **Used by:** `pages/DashboardPage.tsx`

## Data flows

```
RunsTable → renders tabular run list:
  deriveStatus(run): running/cancelling/cancelled → status badge
    | reviewed → "Reviewed" | otherwise → "Ready to review"
  Row structure:
    ├─ Date column: run.startedAt formatted
    ├─ Publish date column: run.issueDate (which is publishedAt ?? completedAt)         (D-017)
    ├─ Digest headline: run.digestHeadline ?? run.topItems[0]?.title
    ├─ Status badge: coloured pill from deriveStatus
    ├─ Item count: run.itemCount (0 if null)
    ├─ Review link: "/admin/review/:runId" (shown when reviewed OR ready-to-review and status==completed)
    ├─ Details link: "/admin/runs/:runId" (observability page)
    ├─ Cost button: opens CostDialog
    ├─ Social overflow menu: per-channel LinkedIn/X items
    └─ Cancel (running/cancelling) / Delete (terminal) action

SocialOverflowMenu → per-row social actions:
  Eligibility: run.status === "completed" && run.reviewed && !run.isDryRun
    ├─ Per channel (linkedin, twitter):
    │    ├─ channelPostedAt set → "View post ↗" (if permalink) or "✓ Posted" (if no permalink)  (D-018)
    │    ├─ eligible && !channelPostedAt → enabled trigger → confirm dialog → useTriggerSocialPost mutation
    │    └─ !eligible → disabled item with reason text
    └─ Menu: ⋮ button → dropdown (Portal to body for z-index)
```

## Gotchas / landmines

- **Cost button null-vs-null-breakdown distinction** (D-017): Three states: `costBreakdown === null` (pre-feature run, shows plain "Cost"), `costBreakdown !== null && totalCostUsd === null` (post-feature run with partial cost, shows "Cost: ?" + warning), `totalCostUsd !== null` (normal, shows `Cost: $X.XXX`). The middle state is rare (e.g., cost tracked but rank failed before finalize).
- **SocialOverflowMenu uses Portal**: The dropdown is portaled to `document.body` to avoid clipping by table row overflow. This means z-index management is critical.
- **RunsCardList is the mobile fallback**: Shown at `<640px` (`sm:hidden` on the table, `block sm:hidden` on the card list). Both receive the same `runs` prop but render different HTML structures.
- **Delete is always available on terminal runs**: No confirmation dialog — the button directly calls `onDelete`. The operator is expected to know this is destructive.

## Decisions

### D-017: Dual publish/start date columns

**Why:** The dashboard shows both when the run was started (`startedAt`) and its effective publish date (`issueDate = publishedAt ?? completedAt ?? startedAt`). The publish date is the date the reader sees on the archive page.

**Tradeoff:** Two date columns take space. Collapsed on mobile to "Started" / "Publish date" lines. Acceptable.

**Governs:** `components/dashboard/RunsTable.tsx`, `components/dashboard/RunsCardList.tsx`

### D-018: SocialOverflowMenu "✓ Posted" without permalink

**Why:** When `linkedinPostedAt` or `twitterPostedAt` is set but no `linkedinPermalink`/`twitterPermalink` is stored (e.g., post succeeded but permalink extraction failed), the menu shows a non-link "✓ Posted" indicator instead of a "View post" link. This distinguishes "definitely posted" from "maybe posted, no proof."

**Tradeoff:** The operator can't verify the post without checking the platform directly. Acceptable — the timestamp is proof enough that the worker considered it done.

**Governs:** `components/dashboard/SocialOverflowMenu.tsx`
