---
governs: packages/web/src/components/settings/
last_verified_sha: 5a2ff20
key_files: [SourcesSection.tsx, ScheduleSection.tsx, RankingPromptSection.tsx, ShortlistPromptSection.tsx, ShortlistSizeField.tsx, AnalyticsSection.tsx, SaveBar.tsx]
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
| `SourcesSection({ control, register, setValue })` | Source config: HN toggle + keywords/threshold, Reddit toggle + subreddits/sort, Web toggle + source URLs, Twitter toggle + users/lists, Web Search toggle + queries |
| `ScheduleSection({ register, control, errors })` | Schedule config: timezone, pipeline/email/linkedin/twitter times, schedule enabled toggle, email/LinkedIn/Twitter post enabled toggles, auto-review toggle |
| `RankingPromptSection()` | Large textarea for the ranking prompt, uses form context |
| `ShortlistPromptSection()` | Textarea for the shortlist prompt, uses form context |
| `ShortlistSizeField()` | Number input for shortlist size (5-100) |
| `AnalyticsSection({ register, control })` | PostHog config: enabled toggle, project token, host URL |
| `SaveBar({ formId, saving, runNowDisabled, onRunNow, lastSavedLabel })` | Fixed bottom bar: "All changes saved" status or Save + Run Now buttons |

## Depends on / used by

- **Uses:** `react-hook-form` context (via `FormProvider`), `@newsletter/shared/constants` (DEFAULT_SHORTLIST_PROMPT)
- **Used by:** `pages/SettingsPage.tsx`

## Gotchas / landmines

- **All sections are form-context consumers**: They use `useFormContext()` internally. They cannot render outside a `FormProvider`. The settings page wraps everything in `<FormProvider {...form}>`.
- **RankingPromptSection validates 20k char limit**: Zod schema enforces `max(20000)`. The textarea itself has no character counter — violating this shows a validation error toast on save.
