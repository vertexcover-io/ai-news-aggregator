# Design — Tech Debt Fix Pass (2026-06-04 audit)

**Source of truth:** `.harness/tech-debt/2026-06-04/findings.json` (1,085 findings; 97 `auto_fixable`).
**Tracking issues:** #247 (Dependency), #248 (Complexity), #249 (Architecture), #250 (Duplication), #251 (Code Smell); parent #252.
**User scope decision:** "Everything feasible" — auto-fixable findings + dependency CVE/version bumps + targeted refactors. **One PR per issue.**
**Contract:** `tech-debt-finder/references/auto-fix-handoff.md` — every finding reaches a terminal disposition in `.harness/tech-debt/2026-06-04/fix-manifest.json` (`fixed`/`issue`/`suppressed`/`dropped`+reason); reconciliation table in each PR body.

## Strategy — five work streams, one per issue

### WS-1 → PR for #247 (Dependency)
Version bumps in place (exact pins per repo policy), lockfile regen, full gate:
- `drizzle-orm` 0.42.0 → 0.45.2 (shared/api/pipeline; **also bump `drizzle-kit` to the paired version**) — fixes Critical SQLi CVE
- `hono` 4.7.7 → latest 4.12.x; `@hono/node-server` 1.14.1 → ≥1.19.13 (api) — fixes Critical/High CVEs
- `react-router-dom` 7.14.0 → ≥7.15.0 (web) — fixes High RCE/DoS
- `vite` 8.0.1 → ≥8.0.5 (web)
- `vitest` 3.2.1 → 4.x across all packages — **fallback chain: if vitest 4 migration breaks test configs non-trivially, stay on 3.2.1 and leave the finding as `issue` with reason**
- `bullmq` → latest 5.x (shared/api/pipeline); `@tanstack/react-query` → latest 5.x (web)
- root `pnpm.overrides`: `ws>=8.20.1`, `engine.io>=6.6.8`, `uuid>=11.1.1` (transitive CVEs)
- remove unused `react-email` dep from api + pipeline (auto-fixable; `@react-email/components` stays — it IS used)
- fix `await import("drizzle-orm")` lazy-import leftover in `packages/api/src/repositories/subscribers.ts:60`
- **Deferred (stays `issue`):** `ai`@6 + `@ai-sdk/*`@3 coordinated major upgrade — repo learnings require live cost-probe verification per provider (`ai-sdk-inputtokens-includes-cached-non-anthropic.md`, `ai-sdk-provider-version-must-match-ai-major.md`); too risky to fold into a bulk pass.

### WS-2 → PR for #251 (Code Smell / dead code)
- Remove 95 unused exports/types (auto-fixable `remove-export`): keep the *declaration* where still used internally, drop only the `export` keyword / barrel re-export. `is_re_export` entries verified against `packages/shared` public API before removal.
- Unused files (20, NOT auto-fixable): delete only verified-dead ones (web components `MonthHeader`/`PromptEditor`/`form.tsx`/`useRunSources`, legacy `pipeline/src/queues/*`, superseded probe scripts). **Keep**: `deployment/migrate.mjs` (deploy entrypoint), operator CLI scripts under `scripts/` that are run via `tsx` (verify against package.json scripts + docs before any delete). Anything kept → disposition `dropped` with reason "runtime/operator entrypoint not visible to static analysis".

### WS-3 → PR for #249 (Architecture)
- `packages/pipeline/src/workers/run-process.ts` (1,280 lines, `handleRunProcessJob` CC=51): extract cohesive service modules — failed-archive persistence (`writeFailedArchive`), digest derivation (`pickArchiveDigest`), finalize/notify/schedule block — keeping the handler a thin stage sequencer. Behavior-preserving; existing unit + seam e2e tests must stay green unmodified (except import paths).
- `packages/api/src/routes/admin-eval.ts` (861 lines): move `buildActualRanking`/`buildExpectedRanking`/`buildCalendarRanking` + the `/run` orchestration/scoring loop into `packages/api/src/services/` per the repo's route→service pattern.
- Also resolves these files' complexity findings (CC=51/`handleRunProcessJob`, route-level CC entries).

### WS-4 → PR for #248 (Complexity)
Refactor the top CC≥16 functions NOT already covered by WS-3, behavior-preserving (extract helpers / dispatch tables): `EvalIndexPage` (51), `collectWeb` (45), `ReviewPage` (37), `runEvalCli` (36), `RunDetailDrawer` (34), `collectTwitter` (34), `hydrateRankedItems` (30), `ArchivePage` (29). Remaining CC findings stay tracked in #248 (disposition `issue`).

### WS-5 → PR for #250 (Duplication)
Top non-test clone groups, dedup by extraction:
- `RunsCardList.tsx` ↔ `RunsTable.tsx` (148+117 lines) — extract shared row-cell/actions components or hooks
- `email-send.ts` ↔ `newsletter-send.ts` (65+57+45 lines) — extract shared hydrate/send helpers; `newsletter-send.ts` itself stays (kept deliberately per CLAUDE.md `@deprecated` note)
- `api/lib/validate.ts` ↔ `web/pages/settingsSchema.ts` (97 lines, zod schema) — evaluate move to `@newsletter/shared` subpath (web must keep subpath imports)
- `api/lib/email/ses-provider.ts`+`resend-provider.ts` ↔ `pipeline/lib/email-provider.ts` (43+22 lines) — evaluate shared provider module
- `PrivacyPolicyPage` ↔ `TermsPage` (63 lines) — extract static-page layout
- 804 test-file-only clone groups → **suppressed** via generated `.claude/harness/tech-debt-ignore.md` per-file rules (visible, counted, not silently dropped); remaining non-test groups → `issue`.

## External Dependencies & Fallback Chain
No NEW libraries. All changes bump existing pinned deps:
| Dep | From → To | Fallback |
|-----|----------|----------|
| drizzle-orm (+drizzle-kit) | 0.42.0 → 0.45.2 | none — security fix, must land; if API breaks, fix call sites |
| hono / @hono/node-server | 4.7.7 → 4.12.x / 1.14.1 → 1.19.x | none — security fix; minor-version semver |
| react-router-dom | 7.14.0 → 7.16.x | 7.15.0 (minimum CVE patch) |
| vite | 8.0.1 → 8.0.16 | 8.0.5 (minimum CVE patch) |
| vitest | 3.2.1 → 4.x | stay 3.2.1, finding → `issue` |
| bullmq / @tanstack/react-query | minor bumps | skip individually if regressions |
| ai / @ai-sdk/* | **deferred** | n/a — tracked in #247 |

Probe = the repo's own gates (build/typecheck/lint/unit/e2e) — these deps are already integrated; the risk surface is regression, not integration.

## Constraints
- No feature behavior changes anywhere; refactors are behavior-preserving.
- Disjoint file ownership between work streams (so per-issue branches cherry-pick cleanly): `run-process.ts`/`admin-eval.ts` → WS-3 only; `newsletter-send.ts`/`email-send.ts` source dupes → WS-5; package.json/lockfile → WS-1 only.
- Repo rules upheld: exact version pins, pnpm only, no `any`, web→shared subpath imports, package boundaries.
