---
governs: packages/web/src/components/dashboard/
last_verified_sha: 226dc6e8b93a852b425cc426ef9dc4a27505bdf4
key_files: [RunsTable.tsx, RunsCardList.tsx, CostDialog.tsx, CostButton.tsx, SocialOverflowMenu.tsx, ScheduleBanner.tsx, EmptyState.tsx, cost-format.ts, run-status.tsx]
flow_fns: [RunsTable.tsx::RunsTable, SocialOverflowMenu.tsx::SocialOverflowMenu]
decisions: [D-017, D-018, D-027, D-116]
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
| `SocialOverflowMenu({ run, onLinkedInPost, onTwitterPost })` | ⋮ overflow menu per run row: "Edit newsletter" link (enabled for completed+reviewed; includes dry-run); per-channel LinkedIn/X items (enabled trigger for unposted eligible runs, "View post ↗" for posted-with-permalink, "✓ Posted" for posted-without-permalink, disabled for ineligible). Confirm dialog on social trigger click. (D-027) |
| `ScheduleBanner({ scheduleTime, scheduleTimezone })` | Info banner showing next scheduled run time |
| `EmptyState()` | "No settings yet — configure your newsletter to get started" CTA |
| `cost-format.ts` | `formatCostUsd(n)`, `formatTokens(n)` — pure formatting |
| `run-status.tsx` | `RunStatusBadge({ status, stage? })` + `deriveStatus(run)` — maps `RunSummary` to `DerivedStatus` ("running" \| "cancelling" \| "cancelled" \| "ready-to-review" \| "draft" \| "reviewed" \| "failed"). Draft: `reviewed=false && draftSavedAt!=null` → violet "Draft" badge; reviewed overrides draftSavedAt (D-116). |

## Depends on / used by

- **Uses:** `hooks/useTriggerSocialPost`, `@newsletter/shared/types` (RunSummary, RunCostBreakdown)
- **Used by:** `pages/DashboardPage.tsx`

## Data flows

```
RunsTable → renders tabular run list:
  deriveStatus(run): reviewed → "Reviewed" | draftSavedAt!=null → "Draft" | else → "Ready to review"  (D-116)
    | running/cancelling/cancelled/failed handled first
  Row structure:
    ├─ Date column: run.startedAt formatted
    ├─ Publish date column: run.issueDate (which is publishedAt ?? completedAt)         (D-017)
    ├─ Digest headline: run.digestHeadline ?? run.topItems[0]?.title
    ├─ Status badge: coloured pill from deriveStatus; "Draft" = violet bg-violet-100
    ├─ Item count: run.itemCount (0 if null)
    ├─ Review link: "/admin/review/:runId" (shown for "ready-to-review" AND "draft" — data-run-id attr for test targeting)
    ├─ Details link: "/admin/runs/:runId" (observability page)
    ├─ Cost button: opens CostDialog
    ├─ Social overflow menu: per-channel LinkedIn/X items
    └─ Cancel (running/cancelling) / Delete (terminal) action

SocialOverflowMenu → per-row social actions:
  editEligible: run.status === "completed" && run.reviewed (includes dry-run)  (D-027)
    ├─ editEligible → "Edit newsletter" as enabled <a href="/admin/review/:runId">
    └─ !editEligible → "Edit newsletter" as disabled menuitem (aria-disabled="true", no href)
  socialEligible: run.status === "completed" && run.reviewed && !run.isDryRun
    ├─ Per channel (linkedin, twitter):
    │    ├─ channelPostedAt set → "View post ↗" (if permalink) or "✓ Posted" (if no permalink)  (D-018)
    │    ├─ socialEligible && !channelPostedAt → enabled trigger → confirm dialog → useTriggerSocialPost mutation
    │    └─ !socialEligible → disabled item with reason text
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

### D-027: Edit newsletter gate includes dry-run; social gate excludes it

**Why:** Editing a dry-run archive (correcting copy, reordering stories) is always safe — the pipeline never sends email or posts social for dry runs. Excluding dry-run from Edit would make the operator manually navigate to the review URL. Social post triggers (LinkedIn, X) are excluded from dry-run by design since the workers check `is_dry_run` before posting.

**Tradeoff:** The "Edit newsletter" item appears in the same overflow menu as social triggers but uses a different eligibility predicate. The asymmetry is intentional and visible in code: `editEligible` omits `!run.isDryRun`; `socialEligible` includes it.

**Governs:** `components/dashboard/SocialOverflowMenu.tsx`

### D-018: SocialOverflowMenu "✓ Posted" without permalink

**Why:** When `linkedinPostedAt` or `twitterPostedAt` is set but no `linkedinPermalink`/`twitterPermalink` is stored (e.g., post succeeded but permalink extraction failed), the menu shows a non-link "✓ Posted" indicator instead of a "View post" link. This distinguishes "definitely posted" from "maybe posted, no proof."

**Tradeoff:** The operator can't verify the post without checking the platform directly. Acceptable — the timestamp is proof enough that the worker considered it done.

**Governs:** `components/dashboard/SocialOverflowMenu.tsx`
