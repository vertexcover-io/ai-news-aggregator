# LLM-Based Shortlisting Rewrite

**Verification verdict:** ✅ PASSED — see [verification/proof-report.md](./verification/proof-report.md)

## Summary

Replaces the stage-1 recency-decay shortlist with an LLM-based shortlister using Claude Haiku 4.5. The system prompt and target N are both admin-editable at `/admin/settings` and live-reloaded per pipeline job (no worker restart). A new `shortlist` stage is recorded in the per-run cost breakdown.

## Artifacts

- [design.md](./design.md) — architecture, file-level changes, risks
- [spec.md](./spec.md) — 25 EARS requirements + 10 verification scenarios
- [library-probe.md](./library-probe.md) — verdict NOT_APPLICABLE (no new external deps)
- [plan.md](./plan.md) — 4-phase implementation plan
- [verification/proof-report.md](./verification/proof-report.md) — final verdict + test counts
- [verification/adversarial-findings.md](./verification/adversarial-findings.md) — role-swap pass; no defects
- [verification/screenshots/](./verification/screenshots/) — UI proof (settings page with new fields)

## Key files changed

- **Pipeline:** `packages/pipeline/src/processors/shortlist.ts` (full rewrite)
- **Shared:** `packages/shared/src/constants/shortlist-prompt.ts` (new) + migration `0029_dapper_power_man.sql`
- **API:** `packages/api/src/lib/validate.ts`, `packages/api/src/routes/settings.ts`
- **Web:** `packages/web/src/components/settings/ShortlistPromptSection.tsx` (new), `packages/web/src/components/settings/ShortlistSizeField.tsx` (new), `packages/web/src/pages/SettingsPage.tsx`, `packages/web/src/components/dashboard/CostDialog.tsx`

## Test counts

- pipeline: 889/889
- api: 529/529
- web: 526/526
- shared: 14/14
- **Total: 1958/1958 passing**

## PR

(filled in by orchestrate at commit-pr stage)
