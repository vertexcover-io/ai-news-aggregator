# Learnings — save-newsletter-draft

## L1 (carried forward — confirmed by this implementation)

`handleSaveDraft` must reset ALL three derived-state baselines on success: `reset(state.current)` (react-hook-form), `setRegenSignature(newSig)`, and `setDigestBaseline(digestMeta)`. Resetting only one leaves the unsaved counter non-zero. See global lesson: `.harness/knowledge/lessons/gotchas/discard-must-clear-all-derived-state-not-just-visible-fields-20260606.md` (evidence_count now 2).

## L2 (carried forward — confirmed by this implementation)

`review-save.spec.ts` asserts the review heading with `page.getByRole("heading", { level: 2 })` — the ReviewPage renders its heading as `<h2>`, not `<h1>`. See global lesson: `.harness/knowledge/lessons/gotchas/playwright-getbyrole-heading-level-must-match-component-20260605.md` (evidence_count now 2).

## L3 (carried forward — non-issue confirmed)

`handleSaveDraft` is a plain `async function` following the same pattern as `handleSave`; no `useCallback` wrapping was needed. The `useCallback`-defeats-memoization gotcha was not triggered here.

## New: selectImmediatePublishChannels mock requirements

`selectImmediatePublishChannels` silently returns `[]` when `scheduleEnabled` or `pipelineTime` is absent from the settings mock. See global lesson: `.harness/knowledge/lessons/gotchas/select-immediate-publish-channels-requires-schedule-enabled-in-mock-20260608.md`.

## New: UpdateRankedItemsContext backward-compat defaults

When extending `UpdateRankedItemsContext` (or any repo context interface) with new fields, make them optional with `??` backward-compat defaults inside the method body. See global lesson: `.harness/knowledge/lessons/gotchas/repo-context-new-fields-must-be-optional-with-backward-compat-defaults-20260608.md`.

## Minor open items (from code review, not blocking)

- `handleSaveDraft` and `handleSave` both duplicate the 15-line `rankedItems` payload-building block verbatim. A shared `buildRankedItemsPayload` helper would eliminate future drift risk — not urgent, no production defect.
- The e2e `test_REQ_015_draft_save_stays_and_toasts` asserts "0 unsaved changes" on a run that was never edited — the counter is already 0 before the click, so the L1 (dirty-reset) path is not exercised at e2e level. The success-resets-from-dirty path is covered by `ReviewPage.test.tsx` unit tests only.
