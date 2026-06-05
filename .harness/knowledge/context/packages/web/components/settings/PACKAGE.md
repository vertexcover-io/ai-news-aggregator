---
governs: packages/web/src/components/settings/
last_verified_sha: ad0153a
key_files: [SourcesSection.tsx, CollectorHealthModal.tsx, ScheduleSection.tsx, RankingPromptSection.tsx, ShortlistPromptSection.tsx, ShortlistSizeField.tsx, AnalyticsSection.tsx, SaveBar.tsx]
flow_fns: []
decisions: []
status: active
---

# components/settings/ — admin settings form sections

## Purpose

Form sections for the admin settings page (`/admin/settings`). Each section is a group of form fields rendered within a `react-hook-form` `FormProvider`. Fields are thin — they use `register`, `control`, and `setValue` from the form context.

## Public surface

| Component | Effect |
|---|---|
| `SourcesSection({ control, register, setValue })` | Source config rows (HN, Reddit, Web, Twitter, Web Search) + per-row health "Check" button + a "Check all" button in the section header. Calls `useCollectorHealth()` (poll) + `useCollectorHealthTrigger()` (`{ trigger, isPending }`). Per-row Check → `handleCheckCollector(collector)` fires `triggerCheck(collector)` AND `setModalCollector(collector)` (opens the modal); "Check all" → `handleCheckAll()` fires `triggerCheck(undefined)` (no modal). The modal opens whenever `modalCollector !== null` and is passed `result = getHealthResult(modalCollector)`. The **Web row maps to collector id `"blog"`** (REQ-017). |
| `CollectorHealthModal({ open, onOpenChange, result })` | Radix `Dialog`. **Returns `null` when `result === null`** (renders nothing until a collector is selected). Title = `${collectorLabel} — Health check` where `collectorLabel` special-cases `blog`→"Web (blog listings)", `web_search`→"Web Search", else capitalizes the first char of the raw collector id (e.g. "Hn", "Reddit", "Twitter"). Body shows: status pill (`never`→"Never checked"; `running`→spinner; `healthy`→green "Healthy"; `failed`→red + reason), Reason (only on `failed` with non-null reason), Checked (relative, only when `checkedAt !== null`), Duration (`<1000`→`Nms`, else `N.Ns`, only when `durationMs !== null`), Detail (only when `detail !== null`). Close button calls `onOpenChange(false)` (REQ-018, EDGE-006). |
| `ScheduleSection({ register, control, errors })` | Schedule config: timezone, pipeline/email/linkedin/twitter times, schedule enabled toggle, email/LinkedIn/Twitter post enabled toggles, auto-review toggle |
| `RankingPromptSection()` | Large textarea for the ranking prompt, uses form context |
| `ShortlistPromptSection()` | Textarea for the shortlist prompt, uses form context |
| `ShortlistSizeField()` | Number input for shortlist size (5-100) |
| `AnalyticsSection({ register, control })` | PostHog config: enabled toggle, project token, host URL |
| `SaveBar({ formId, saving, runNowDisabled, onRunNow, lastSavedLabel })` | Fixed bottom bar: "All changes saved" status or Save + Run Now buttons |

## Depends on / used by

- **Uses:** `react-hook-form` context (via `FormProvider`), `@newsletter/shared/constants` (DEFAULT_SHORTLIST_PROMPT), `hooks/useCollectorHealth` (`useCollectorHealth` returns `{ data: snapshot }` + `useCollectorHealthTrigger` returns `{ trigger, isPending }`), `@newsletter/shared/types` (`HealthCheckCollector`, `CollectorHealthResult`)
- **Used by:** `pages/SettingsPage.tsx`

## Gotchas / landmines

- **All sections are form-context consumers**: They use `useFormContext()` internally. They cannot render outside a `FormProvider`. The settings page wraps everything in `<FormProvider {...form}>`.
- **RankingPromptSection validates 20k char limit**: Zod schema enforces `max(20000)`. The textarea itself has no character counter — violating this shows a validation error toast on save.
- **Web row → "blog" collector id**: the SourcesSection "Web (blog listings)" row's Check button triggers collector id `"blog"`, not `"web"` — the UI does this mapping (REQ-017). The modal label special-cases `blog`/`web_search` to friendly names and capitalizes the first char for the rest (`hn`→"Hn", `reddit`→"Reddit", `twitter`→"Twitter"); the per-row label in the form is the friendly source name.
- **Modal label is derived from `result.collector`, not a `collector` prop**: the modal takes no collector prop — it reads `result.collector` for its title. The parent (`SourcesSection`) controls visibility via `open={modalCollector !== null}` and supplies `result` from the polled snapshot, so the modal re-renders live as the snapshot transitions `running`→`healthy`/`failed`.
- **"Never checked" is fleeting after a Check click**: opening the modal reads the cached snapshot, but the trigger sets `running` on refetch within ~1s. The `never` state is visible only before the first check of a collector (verified via live snapshot API + unit test in functional-verify).
