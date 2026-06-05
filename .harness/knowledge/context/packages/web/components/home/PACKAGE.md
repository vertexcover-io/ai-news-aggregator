---
governs: packages/web/src/components/home/
last_verified_sha: 5a2ff20
key_files: [TodaysIssueBlock.tsx, FromTheCanonBlock.tsx, ElsewhereStrip.tsx]
flow_fns: []
decisions: []
status: active
---

# components/home/ — home page hero blocks

## Purpose

Display-only components for the home page hero section: today's issue feature block, featured "From the Canon" entry, and an "Elsewhere" links strip.

## Public surface

| Component | Effect |
|---|---|
| `TodaysIssueBlock({ issue })` | Hero block: date eyebrow (DOW · MONTH DAY), digest headline (48px serif), digest summary (19px italic), "Read today →" button, cover plate (rust rectangle with date + section-mark §) |
| `FromTheCanonBlock({ entry })` | Featured canon entry: "From the canon" eyebrow, title + "Read →" link |
| `ElsewhereStrip()` | Links strip: "Elsewhere" label + "Newsletter ↗", "Vertexcover ↗", "X / Twitter ↗" |

## Depends on / used by

- **Uses:** `react-router-dom` (Link), `@newsletter/shared/types` (ArchiveListItem, PublicMustReadEntry)
- **Used by:** `pages/HomePage.tsx`
