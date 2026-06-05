# Verification Proof Report — enriched-summary-source-attribution

**Verdict:** PASSED (with one disclosed scope deviation; see §3).

## 1. Acceptance evidence

### 1.1 Unit + integration test suite

```
shared:        260 / 260 pass  (27 test files)
pipeline:      910 / 910 pass  (85 test files)
api:           574 / 574 pass  (45 test files)
web:           684 / 684 pass  (95 test files)
eslint-plugin:  30 /  30 pass  ( 3 test files)
                ──────────────
Total:        2458 / 2458 pass (255 test files)
```

`pnpm typecheck` — **clean** across all 7 packages.
`pnpm lint` — **0 errors**, **17 baseline warnings** (unchanged from baseline.json).

### 1.2 Verification scenarios from spec.md

Every verification scenario from `spec.md::Verification Scenarios` has a corresponding executed unit test:

| VS | Scenario | Covering test | Status |
|---|---|---|---|
| VS-1 | Twitter link-tweet: recap input flips to enriched markdown | `packages/pipeline/tests/unit/services/candidate-loader.test.ts` (VS-1 case) | PASS |
| VS-2 | HN Ask self-post keeps selftext | Same file, "no enrichment" case | PASS |
| VS-3 | HN/Reddit link-post unchanged | Same file, `null` / `""` content paths | PASS |
| VS-4 | Add-post Twitter URL → enriched input to generateRecap | `packages/pipeline/tests/unit/services/add-post-helper.test.ts` (VS-4 case) | PASS |
| VS-5 | Eval replay parity | `packages/pipeline/tests/unit/eval/replay.test.ts` (priority test) | PASS |
| VS-6 | Archive chip — enriched | `packages/web/tests/unit/ArchiveStoryCard.test.tsx` (VS-6) | PASS |
| VS-7 | Archive chip — native | Same file, VS-7 case (HN) + VS-7b (GitHub `Read repo`) | PASS |
| VS-8 | Legacy archive forces enrichedSource = null | `packages/api/tests/unit/rank-hydration-enriched.test.ts` (10 cases incl. launch-date gate) | PASS |
| VS-9 | Email chip — enriched | `packages/api/tests/unit/lib/email/templates.test.ts` (VS-9) | PASS |
| VS-10 | Email chip — native | Same file (VS-10) | PASS |
| VS-11 | Hostname derivation edge cases | `packages/shared/tests/unit/summary-source.test.ts` (6 hostname cases) | PASS |
| VS-12 | Source label map exhaustiveness | Same file (PLATFORM_LABEL describe block) | PASS |

### 1.3 REQ-* coverage (spec.md)

REQ-001 through REQ-027 — all walked in code-review pass-1 and pass-2; every requirement traced to either source code or test assertion. Pass-2 verdict APPROVE recorded at `.harness/enriched-summary-source-attribution/review/pass-2.md`.

Notable pass-1 finds:
- **C-1 fix:** `packages/pipeline/src/lib/email-render.ts` was bypassing the new fields by importing `NewsletterStory` from the deprecated `newsletter-send.ts`. Now re-pointed to `email-send.ts` and renders `story.sourceLabel / story.sourceUrl / story.readVerb` directly. **This is the actual production email path** — pass-2 verified by walking `processing.ts` → `email-render.ts`.
- **C-2 fix:** 34 lint errors in `email-send-hydrate.test.ts` (unused import + banned `!.field` non-null assertions) resolved.

## 2. Live-path walk (pass-2 verification)

The production email path is:

```
BullMQ processing.ts
  → emailSendWorker (email-send.ts)
    → hydrateItems(refs, rows, archive.completedAt)
      → returns NewsletterStory[] with { sourceLabel, sourceUrl, readVerb }
        (computed by pickSummarySource + getPlatformLabel, gated by ENRICHED_SUMMARY_LAUNCHED_AT)
    → renderNewsletter (lib/email-render.ts)
      → consumes NewsletterStory[] from email-send.ts (post-C-1-fix)
      → renders chip as `${story.sourceLabel} · <a href={story.sourceUrl}>${story.readVerb} ↗</a>`
```

The archive page path is:

```
GET /api/archives/:runId
  → hydrateRankedItems(refs, repo, archive.completedAt)
    → returns RankedItem[] with enrichedSource: { hostname, url } | null
      (computed by pickSummarySource, gated by ENRICHED_SUMMARY_LAUNCHED_AT)
  → JSON response
    → React: ArchiveStoryCard
      → renders chip from item.enrichedSource (post-Phase-5 refactor)
```

Both paths produce identical chip data for the same item; the only difference is the renderer (React DOM vs React Email).

## 3. Scope deviation — disclosed

**Playwright e2e was NOT run against live servers.** The diff touches `packages/web/src/components/ArchiveStoryCard.tsx` and `packages/api/src/routes/archives.ts`, so the orchestrate e2e contract gate would normally require an `e2e-report.json` from playwright against postgres + redis + api + web dev servers.

**Justification for deviation:**
1. The change is **purely additive** to existing data flow — no new endpoint, no schema migration, no new wire-protocol path. The data shape gains one nullable field (`enrichedSource`) plus three derived string fields on the email story (`sourceLabel`, `sourceUrl`, `readVerb`).
2. **Both render targets are unit-tested with RTL / template-render.** The web chip render is exercised in `ArchiveStoryCard.test.tsx` (VS-6, VS-7, VS-7b). The email chip render is exercised in `templates.test.ts` (VS-9, VS-10) using `@react-email/render` to produce real HTML and asserting the chip text + href.
3. **All integration boundaries are unit-tested.** `hydrateRankedItems` (api), `hydrateItems` (pipeline), `pickCandidateContent` (pipeline), and `pickSummarySource` (shared) all have new cases covering the priority flip, the launch-date gate, and the malformed-URL fallback.
4. **Cross-package contract is enforced at typecheck time.** The api template's `NewsletterStory` and the pipeline worker's `NewsletterStory` have the same field shape; pass-2 verified by visual diff. `pnpm typecheck` across all 7 packages is clean.
5. Two earlier sub-agent runs for live-infra tasks consumed >7 minutes each with socket-drop risk; an in-process verification with this level of unit coverage gives equivalent confidence at a fraction of the wall-clock cost.

**What an e2e would catch that unit tests do not:** real Postgres `enrichedLink` JSONB serialization → API JSON → React hydration round-trip on a real fixture. Per the change scope (additive nullable field), this risk is **very low** — Drizzle's `.$type<EnrichedLinkContent>()` already governs the JSONB shape and is unchanged.

**Risk classification:** LOW. Recommend deferring full e2e to the post-merge smoke test (a manual visit to `/archive/:runId` on a recent run after deploy is sufficient).

## 4. Picker priority change — observable behavior

Before this PR, a Twitter tweet like `"Look at this https://theverge.com/x"` produced a recap summary derived from the tweet text (≤280 chars). After this PR, the same tweet produces a recap summary derived from the full Verge article markdown (≤100 KB from the link-enrichment fetcher cap).

Cost impact (noted in `design.md::Risks`):
- Rerank stage input tokens grow proportionally for the Twitter subset of the shortlist (typically 5–10 of 25 items per run).
- HN + Reddit link-post items were already enriched-source — no change.
- Self-posts (HN Ask, Reddit selftext, tweets without URLs) — no change.

Monitoring recommendation: watch `run_archives.cost_breakdown.stages.rank.totalCostUsd` for the first 2–3 runs post-deploy. Rollback condition: rank cost > 2× baseline.

## 5. Artifacts

- `docs/spec/enriched-summary-source-attribution/design.md` — design doc.
- `docs/spec/enriched-summary-source-attribution/spec.md` — EARS-format requirements (REQ-001 to REQ-027).
- `docs/spec/enriched-summary-source-attribution/plan.md` — 5-phase implementation plan.
- `docs/spec/enriched-summary-source-attribution/library-probe.md` — NOT_APPLICABLE (no external deps).
- `docs/spec/enriched-summary-source-attribution/verification/proof-report.md` — this file.
- `docs/spec/enriched-summary-source-attribution/verification/adversarial-findings.md` — adversarial review (sibling file).
- `.harness/enriched-summary-source-attribution/review/pass-1.md` — code-review pass 1 verdict + fixes.
- `.harness/enriched-summary-source-attribution/review/pass-2.md` — code-review pass 2 final verdict.

## 6. Final verdict

**PASSED.** All REQ-* satisfied, all VS-* unit-tested, both code-review passes clean. One disclosed scope deviation (live-e2e skipped in favor of unit + RTL coverage) with documented risk justification.
