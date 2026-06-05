---
governs: packages/web/src/pages/
last_verified_sha: 3ad3477b859f71536aeca7cae4436ef4b490aabf
key_files: [DashboardPage.tsx, ReviewPage.tsx, SettingsPage.tsx, settingsSchema.ts, HomePage.tsx, ArchivePage.tsx, RunObservabilityPage.tsx, EvalIndexPage.tsx, SourcesPage.tsx, AdminLoginPage.tsx, EvalGradePage.tsx, EvalManualFixturePage.tsx, EvalRunsPage.tsx, SourcesPreviewPage.tsx, AnalyticsPage.tsx]
flow_fns: [ReviewPage.tsx::ReviewPage, DashboardPage.tsx::DashboardPage, EvalIndexPage.tsx::EvalIndexPage, SettingsPage.tsx::SettingsPage]
decisions: [D-022, D-023]
status: active
---

# pages/ — route-level page components

## Purpose

One component per route. Pages are thin — they compose hooks and components, handle URL params, and manage top-level page state (saving, navigation guards, SSE streams). Business logic lives in hooks, rendering in components.

## Public surface (key pages)

| Page (route) | Effect |
|---|---|
| `DashboardPage` (`/admin`) | Runs list (RunsTable/RunsCardList) + ScheduleBanner + Run Now split button + EmptyState for no settings |
| `ReviewPage` (`/admin/review/:runId`) | Curation UI: ReviewList (DnD) + AddPostPanel + DigestMetaPanel + PoolSection + SaveBar with useBlocker navigation guard. When `archive.reviewed === true`, heading switches to "Edit · <date>" and a published-channels banner appears listing channels with non-null sent timestamps (email/linkedin/twitter). |
| `SettingsPage` (`/admin/settings`) | react-hook-form with zodResolver: SourcesSection, ScheduleSection, AnalyticsSection, Shortlist, RankingPrompt, SocialCredentialsPanel + SaveBar |
| `HomePage` (`/`) | Public: Hero + TodaysIssueBlock + FromTheCanonBlock + recent issues ArchiveRow list + InlineSubscribeCard + ElsewhereStrip |
| `ArchivePage` (`/archive/:runId`) | Public: BackToArchive + ArchivePageHeader + ArchiveShareRow + ArchiveStoryCard list + SubscribeInline interlude |
| `RunObservabilityPage` (`/admin/runs/:runId`) | Admin: RunFunnel + StageTimingRail + CostStrip + SourceTelemetryTable + EnrichmentStrip + FailuresList + DebugTimeline |
| `EvalIndexPage` (`/admin/eval`) | Admin: Prompt editor + Mode A/B toggle + fixture selector + SSE-driven eval run with per-fixture results table |
| `EvalRunsPage` (`/admin/eval/runs`) | Past eval runs with filter bar + pagination |
| `EvalManualFixturePage` (`/admin/eval/fixtures/new`) | URL list input + pipeline/source-mix panels + create fixture |
| `EvalGradePage` (`/admin/eval/grade/:fixtureId`) | Keyboard-driven grading UI: cluster rows with tier toggle, progress ring, ground truth save |
| `AdminLoginPage` (`/admin/login`) | Password input + login mutation + redirect to `?next=` |
| `SourcesPage` (`/sources`) | Public: SourceCatalog with configured sources grouped by type + "How we pick" section |
| `SourcesPreviewPage` (`/admin/sources/:runId`) | Admin: per-run source preview |
| `AnalyticsPage` (`/admin/analytics`) | PostHog-powered analytics: DeliverabilityTab + SourcesTab |
| `settingsSchema.ts` | Zod validation schema for the settings form (consumed by `SettingsPage` via `zodResolver`) |
| `MustReadPage` (`/must-read`) | Public: list of Must Read entries |
| `BuiltPage` (`/built`) | Public: static "How AgentLoop is built" page |
| `NotFoundPage`, `PrivacyPolicyPage`, `TermsPage`, `UnsubscribePage`, `ConfirmPage` | Thin static/confirmation pages |

## Depends on / used by

- **Uses:** `hooks/`, `components/`, `api/`, `lib/`, `api/settings` + `pages/settingsSchema`
- **Used by:** `App.tsx` (route definitions)

## Data flows

```
ReviewPage (the most complex page):
  useParams() → runId
  useReview(runId) → { query, state, isDirty, reorder, remove, addPending, resolvePending, failPending, promotePending, ...updateItemField }
  useReviewFilters() → { shortlistedOnly, toggleShortlisted, selectedSources, toggleSource, ...isFiltered }
  useSourceFacets(runId) → { facets }

  isEdit = query.data.reviewed === true  →  "Edit · <date>" heading (else "Review · <date>")
  publishedChannels: ["Email" if emailSentAt, "LinkedIn" if linkedinPostedAt, "X" if twitterPostedAt]
    → isEdit && publishedChannels.length > 0 → amber banner (data-testid="published-channels-banner")
      "Already published: <channels> — edits won't change those."

  Render-time hydration (D-004):
    ├─ Ranked items: completedKey !== hydratedId → setInitial/setCurrent from query.data.rankedItems
    └─ Digest meta: digestCompletedKey !== digestHydratedId → setDigestMeta from query.data.digestHeadline/Summary/Hook/TwitterSummary/LinkedinPostBody

  regenSignature: ranked item IDs at last sync → needsRegen = currentSignature !== regenSignature
  canSave = current.length>0 && pending.length===0 && pendingPromotes.length===0 && !saving && !needsRegen

  useBlocker: blocks navigation when isDirty, shows window.confirm
    └─ handleSave → allowSaveNavigation.current = true → navigate("/archive/:runId")

DashboardPage:
  useRunList() → runs[] (polls every 2s while active runs exist)
  useSettings() → settings, settingsLoaded
    ├─ settings === null && settingsLoaded → EmptyState (no settings configured)
    ├─ settings.scheduleEnabled → ScheduleBanner
    └─ runs → RunsTable (sm:) / RunsCardList (sm:hidden)
  RunNowSplitButton: split button with dropdown for normal vs dry run

EvalIndexPage (SSE streaming):
  useEvalFixtures() → fixtures
  State: mode, fixtureId, bypassCache, calendarDate, selectedRunIds, draft prompt
  handleRun → runEval({ mode, fixtureId, date, runIds, draftPrompt, bypassCache })
    → for await (ev of stream.progress)
       ├─ ev.event === "progress" → update rows/calendarRows by id
       ├─ ev.event === "aggregate"/"done" → set totalUsd, final calendarRows, sourcingReport
       └─ ev.event === "error" → set runError
  Save: saveDraftPrompt(draft) → invalidate settings query
```

## Gotchas / landmines

- **ReviewPage digest-linkedIn body seeding** (D-022): When the archive loads, if `linkedinPostBody` is stored and non-empty, it's used as-is. Otherwise, `buildLinkedinPostBody(hook, items)` generates a default. When Regenerate is clicked, the LinkedIn body is REBUILT from `buildLinkedinPostBody(null, items)` — the hook is intentionally omitted so the operator can re-seed it.
- **ReviewPage signature tracking** (D-023): `regenSignature` is the `"id1|id2|..."` string of ranked item IDs at the time the digest meta was last in sync. When the operator reorders/adds/removes items, `currentSignature !== regenSignature` → `needsRegen = true` → Save is disabled until the operator clicks Regenerate. This prevents saving digest meta that references an outdated ranked list.
- **SettingsPage form submit prevention**: The form's `onSubmit` handler explicitly calls `e.preventDefault()` BEFORE `handleSubmit` because if `handleSubmit` throws, the native form POST would fire, causing a full-page reload.
- **EvalIndexPage SSE cleanup**: The `useEffect` cleanup calls `streamRef.current?.abort()` to abort any in-flight SSE stream when the component unmounts.

## Decisions

### D-022: LinkedIn body seeding from stored value or default

**Why:** If the operator has previously saved a custom LinkedIn post body, it should be preserved on re-opening the review page. If they haven't (the field is empty/NULL), a default is generated from the hook + story summaries.

**Tradeoff:** The Regenerate button overwrites the LinkedIn body with a hook-less default. If the operator edited the hook, they need to re-add it after regeneration. The operator is expected to edit the full post body directly.

**Governs:** `pages/ReviewPage.tsx`

### D-023: Digest meta regeneration signature tracking

**Why:** The digest headline/summary/hook/twitterSummary are synthesized from a specific ranked list. If the operator reorders items after regeneration, the digest meta is stale. Tracking the signature prevents saving stale meta.

**Tradeoff:** The operator MUST click Regenerate after every reorder before they can Save. This is a friction point but a necessary correctness guard. Without it, the digest headline could reference items that are no longer in the ranked list.

**Governs:** `pages/ReviewPage.tsx`
