# SPEC: Fix headline mismatch in `TodaysIssueBlock`

## Summary

The "Today's Issue" block on the public home page (`/`) and the archive detail page
(`/archive/:runId`) derive an issue's headline with reversed fallback precedence,
so the headline shown on the home page can differ from the headline shown on the
linked newsletter page. Align `TodaysIssueBlock` to the canonical archive-page
precedence by reusing the shared `pickHeadline` function.

## Requirements (EARS)

- **REQ-001** — WHEN `TodaysIssueBlock` renders an issue that has a non-empty
  top-story title (`topItems[0].title`), the component SHALL display that top-story
  title as the headline, regardless of whether `digestHeadline` is present.

- **REQ-002** — WHEN `TodaysIssueBlock` renders an issue whose top-story title is
  null or empty AND `digestHeadline` is non-empty, the component SHALL display
  `digestHeadline` as the headline.

- **REQ-003** — WHEN `TodaysIssueBlock` renders an issue with neither a non-empty
  top-story title nor a non-empty `digestHeadline`, the component SHALL display the
  same terminal fallback string as the archive page header (`"An archived issue"`).

- **REQ-004** — For any `(topStoryTitle, digestHeadline)` pair, the headline rendered
  by `TodaysIssueBlock` SHALL equal the value returned by
  `pickHeadline(topStoryTitle, digestHeadline)` — the same function used by
  `ArchivePageHeader` — so the home block and the archive page can never diverge.

- **REQ-005** — The fix SHALL NOT alter any backend route, shared type, or the
  derivation of `topItems`/`digestHeadline`; only the headline-selection logic inside
  `TodaysIssueBlock.tsx` changes.

## Edge cases

| Case | top-story title | digestHeadline | Expected headline |
|------|-----------------|----------------|-------------------|
| Both present, differ | `"OpenAI ships GPT-X"` | `"The week agents got cheaper"` | `"OpenAI ships GPT-X"` (top story) |
| Both present, equal | `"X"` | `"X"` | `"X"` |
| digest only | `null` / `""` | `"Some digest headline"` | `"Some digest headline"` |
| top story only | `"Only story"` | `null` | `"Only story"` |
| neither | `null` / `""` | `null` / `""` | `"An archived issue"` |

## Verification Scenarios

- **VS-001 (REQ-001, component unit):** Render `TodaysIssueBlock` with an `issue`
  where `topItems[0].title = "Top story"` and `digestHeadline = "Digest line"`;
  assert the rendered `<h2>` text is `"Top story"`.

- **VS-002 (REQ-004, cross-surface invariant, unit):** For a table of
  `(topStoryTitle, digestHeadline)` pairs covering the five edge cases above, assert
  the `TodaysIssueBlock` `<h2>` text equals `pickHeadline(topStoryTitle, digestHeadline)`.

- **VS-003 (REQ-002 / REQ-003, fallback unit):** Render with digest-only and with
  neither-present; assert digest headline and `"An archived issue"` respectively.

- **VS-004 (REQ-004, E2E / UI via Playwright):** Seed a reviewed issue whose
  `digestHeadline` differs from its top-story title. Load `/`, capture the Today's
  Issue `<h2>` text and screenshot. Click "Read today". On `/archive/:runId`, capture
  the `<h1>` text and screenshot. Assert the two strings are identical.
