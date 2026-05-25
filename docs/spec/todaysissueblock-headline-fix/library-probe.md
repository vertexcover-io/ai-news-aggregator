# Library Probe — todaysissueblock-headline-fix

## Verdict

<!-- LP:VERDICT:PASS -->

**NOT_APPLICABLE** — no external libraries, APIs, or services are introduced by this change.

## Analysis

The design (`design.md` → "External Dependencies & Fallback Chain") declares no
external dependencies. The fix is a pure frontend change that:

- Reuses the already-exported, pure in-repo function `pickHeadline` from
  `packages/web/src/components/ArchivePageHeader.tsx`.
- Operates on data (`topItems`, `digestHeadline`) already present on the
  `ArchiveListItem` type and already populated by the existing `/api/home` route.

No new dependency to health-check or smoke-test. The trust gate passes vacuously.
