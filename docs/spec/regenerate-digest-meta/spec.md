# SPEC: Regenerate Digest Meta on Review Page

**Source:** docs/spec/regenerate-digest-meta/design.md
**Generated:** 2026-05-27

## Summary

Add a one-click "Regenerate" control on the manual review page (`/admin/review/:runId`) that synthesizes the
four digest-level fields — `headline`, `summary`, `hook`, `twitterSummary` — from the **current** curated
ranked items, makes all four editable, and persists them with the review save. Auto-review behavior (rank-time
generation + immediate save) is unchanged.

## Requirements

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|---------------------|----------|
| REQ-001 | Ubiquitous | The shared package shall export a `DIGEST_META_INSTRUCTIONS` constant containing the digest-field instruction block (headline/summary/hook/twitterSummary) and a `digestSchema` zod schema for the 4-field object. | `DEFAULT_RANKING_PROMPT` composes `DIGEST_META_INSTRUCTIONS` and the rendered ranking prompt string is byte-identical to the prior inline version; `digestSchema` parses `{headline,summary,hook,twitterSummary}` strings. | Must |
| REQ-002 | Event-driven | When `generateDigestMeta(items, options)` is called with a non-empty ordered item list, the pipeline shall return `{headline, summary, hook, twitterSummary}` produced by one `generateObject` call using `digestSchema` and `DIGEST_META_INSTRUCTIONS`. | With a mocked `generateObject`, the returned object equals the mock's `digest` fields; the call passes `schema: digestSchema` and `system: DIGEST_META_INSTRUCTIONS`. | Must |
| REQ-003 | Event-driven | When `generateDigestMeta` produces a `twitterSummary` longer than `TWITTER_SUMMARY_MAX_CHARS` (180), the pipeline shall issue exactly one retry instructing a shorter summary. | With a mock returning an over-length summary first and a valid one second, `generateObject` is called twice and the returned `twitterSummary.length` ≤ 180. | Must |
| REQ-004 | Unwanted | If `generateDigestMeta` is called with an empty item list, then the pipeline shall not call the LLM and shall throw a typed error. | `generateObject` is not invoked; the function rejects with an error whose message identifies the empty-input condition. | Must |
| REQ-005 | Event-driven | When `POST /api/admin/archives/:runId/regenerate-digest-meta` is called with a body of current ranked items for an existing reviewable archive, the API shall return 200 with `{headline, summary, hook, twitterSummary}` and shall NOT persist them. | Response is 200 with the four string fields; the `run_archives` row's `digest_*`/`hook`/`twitter_summary` columns are unchanged after the call. | Must |
| REQ-006 | Unwanted | If the regenerate endpoint is called for a non-existent run, then the API shall return 404. | Response status is 404 with an `error` field. | Must |
| REQ-007 | Unwanted | If the regenerate endpoint is called for a dry-run archive, then the API shall return 409 with a `reason`. | Response status is 409 and body contains a `reason` string. | Must |
| REQ-008 | Unwanted | If the underlying LLM call fails, then the regenerate endpoint shall return 502 with a typed error message. | Response status is 502 with an `error` field describing the LLM failure. | Should |
| REQ-009 | Ubiquitous | The regenerate endpoint shall be behind the `requireAdmin` middleware. | An unauthenticated request to the endpoint is rejected by the admin gate (no LLM call made). | Must |
| REQ-010 | Event-driven | When `PATCH /api/admin/archives/:runId` includes any of `digestHeadline`, `digestSummary`, `hook`, `twitterSummary`, the API shall write each provided field to the matching `run_archives` column. | After the PATCH, the archive row reflects the provided digest field values. | Must |
| REQ-011 | Unwanted | If `PATCH /api/admin/archives/:runId` omits the digest meta fields, then the API shall leave the existing `run_archives` digest columns unchanged. | A PATCH with only `rankedItems` does not null out previously-set `digest_headline`/`digest_summary`/`hook`/`twitter_summary`. | Must |
| REQ-012 | Event-driven | When `archivePatchSchema` receives the four optional digest fields as strings, it shall accept them; non-string values shall be rejected with 400. | Valid string fields parse; a numeric `headline` yields a 400. | Must |
| REQ-013 | Ubiquitous | The admin archive detail response (`GET /api/admin/archives/:runId`) shall include `twitterSummary` alongside the existing `digestHeadline`/`digestSummary`/`hook`. | The admin detail JSON contains a `twitterSummary` field (string or null). | Must |
| REQ-014 | Ubiquitous | The public archive detail response (`GET /api/archives/:runId`) shall NOT add `twitterSummary` (its serialized shape is unchanged from before this feature). | The public detail JSON has no new `twitterSummary` field. | Must |
| REQ-015 | Ubiquitous | The review page shall render a `DigestMetaPanel` directly below the `AddPostPanel` with four editable fields: Headline, Summary, Hook, Twitter Summary. | The panel renders after AddPostPanel in the DOM with four labeled inputs seeded from the archive's current digest values. | Must |
| REQ-016 | Event-driven | When the operator clicks "Regenerate" in `DigestMetaPanel`, the web app shall call the regenerate endpoint with the current ranked items and overwrite all four field values with the response. | After a successful regenerate, all four field inputs show the response values, replacing any prior content (including manual edits). | Must |
| REQ-017 | State-driven | While a regenerate request is in flight, the panel shall disable the Regenerate button and show a loading indicator. | The button is disabled and a loading affordance is visible until the request resolves. | Should |
| REQ-018 | Unwanted | If the regenerate request fails, then the panel shall show an error message and leave the existing field values unchanged. | On a failed request, an error is shown and the four fields retain their pre-click values. | Should |
| REQ-019 | Event-driven | When the operator saves the review, the web app shall include the current `digestHeadline`, `digestSummary`, `hook`, `twitterSummary` field values in the `patchArchive` request body. | The PATCH request body contains the four digest fields with the panel's current values. | Must |
| REQ-020 | Event-driven | When the review page reloads after a save, the four digest fields shall display the persisted values. | After save + reload, the panel shows the saved digest values (not the original rank-time values if they were changed). | Must |
| REQ-021 | Ubiquitous | The auto-review pipeline path shall continue to generate and persist the four digest fields at rank time exactly as before this feature. | An auto-reviewed run still has `digest_*`/`hook`/`twitter_summary` populated from the rerank call; no code path change observable in auto-review output. | Must |

## Edge Cases

| ID | Scenario | Expected Behavior | Derived From |
|----|----------|-------------------|-------------|
| EDGE-001 | Regenerate clicked on an archive whose ranked list is empty | Endpoint returns a 409/422-class error or the UI disables Regenerate; no LLM call with empty input (per REQ-004). | REQ-004, REQ-016 |
| EDGE-002 | Operator regenerates, edits a field, then regenerates again | Second regenerate overwrites the manual edit (always-overwrite, decision #1). | REQ-016 |
| EDGE-003 | Operator manually types a Twitter Summary > 180 chars and saves | Save succeeds (no hard server cap on manual edits); UI shows an over-limit counter warning. | REQ-010, REQ-015 |
| EDGE-004 | PATCH sends `hook: ""` (empty string) explicitly | Empty string is written (distinct from omitting the field, which preserves existing). | REQ-010, REQ-011 |
| EDGE-005 | Legacy archive created before VER-96 with null digest fields | Panel seeds empty fields; Regenerate produces fresh values; Save persists them. | REQ-015, REQ-019, REQ-020 |
| EDGE-006 | Regenerate request body item list differs from last-saved ranking (unsaved reorder) | Regeneration runs against the body-supplied current items, not the stale DB order. | REQ-005, REQ-016 |
| EDGE-007 | `DEFAULT_RANKING_PROMPT` extraction changes the rendered string | Rendered ranking prompt must be byte-identical to pre-refactor; a snapshot test guards this. | REQ-001 |
| EDGE-008 | twitterSummary still over budget after the one retry | Function returns the (over-budget) value without infinite retry; a warning is logged (mirrors existing rank behavior). | REQ-003 |
| EDGE-009 | PATCH body has a digest field set to `null` | Treated as "set to null" only if the schema permits null; otherwise omitted means preserve. Schema decision: optional + nullable; null writes null. | REQ-011, REQ-012 |

## Verification Matrix

| REQ ID | Unit Test | Integration Test | E2E Test | Manual/UI Proof | Notes |
|--------|-----------|-----------------|----------|-----------------|-------|
| REQ-001 | Yes | No | No | No | Snapshot: rendered ranking prompt byte-identical |
| REQ-002 | Yes | No | No | No | Mock `generateObject` |
| REQ-003 | Yes | No | No | No | Mock returns over-length then valid |
| REQ-004 | Yes | No | No | No | Asserts no LLM call + throw |
| REQ-005 | Yes | Yes (e2e API) | Yes | No | API e2e: returns 200, no persist |
| REQ-006 | No | Yes (e2e API) | No | No | 404 path |
| REQ-007 | No | Yes (e2e API) | No | No | 409 dry-run path |
| REQ-008 | Yes | Yes (e2e API) | No | No | 502 LLM-failure (mock reject) |
| REQ-009 | No | Yes (e2e API) | No | No | Admin gate |
| REQ-010 | Yes | Yes (e2e API) | No | No | patchArchive writes digest cols |
| REQ-011 | Yes | Yes (e2e API) | No | No | Omit → preserve |
| REQ-012 | Yes | No | No | No | zod schema accept/reject |
| REQ-013 | No | Yes (e2e API) | No | No | Admin detail includes twitterSummary |
| REQ-014 | No | Yes (e2e API) | No | No | Public detail unchanged |
| REQ-015 | Yes (component) | No | No | Yes (Playwright) | Panel renders below AddPostPanel |
| REQ-016 | Yes (component) | No | Yes | Yes (Playwright) | Regenerate overwrites fields |
| REQ-017 | Yes (component) | No | No | Yes (Playwright) | Loading state |
| REQ-018 | Yes (component) | No | No | No | Error state |
| REQ-019 | Yes (component) | No | Yes | Yes (Playwright) | Save includes digest fields |
| REQ-020 | No | No | Yes | Yes (Playwright) | Persist + reload |
| REQ-021 | Yes | Yes (e2e pipeline) | No | No | Auto-review unchanged (existing tests still green) |
| EDGE-001 | Yes | No | No | No | |
| EDGE-002 | Yes (component) | No | No | Yes (Playwright) | |
| EDGE-003 | Yes (component) | No | No | No | Counter warning |
| EDGE-004 | Yes | Yes (e2e API) | No | No | |
| EDGE-005 | Yes (component) | No | No | No | |
| EDGE-006 | Yes | No | No | No | |
| EDGE-007 | Yes | No | No | No | Prompt snapshot |
| EDGE-008 | Yes | No | No | No | |
| EDGE-009 | Yes | No | No | No | |

## Verification Scenarios (VS-0 — folded from library-probe)

Library-probe verdict: **NOT_APPLICABLE** — no new external dependencies. The only external surface
(`generateObject` against the Anthropic API with `digestSchema`) is already proven by the rerank path. No VS-0
probe scenarios to fold. The AI SDK digest call is exercised in unit tests via a mocked `generateObject` (the
project's established seam) and end-to-end via the live regenerate endpoint during functional verification.

## Out of Scope

- Re-ranking, reordering, or re-summarizing individual stories — only the four digest-level fields are regenerated.
- Changing auto-review behavior — rank-time digest generation + save is explicitly preserved.
- Persisting the regenerated values on the regenerate call itself — persistence happens only on the review Save (PATCH).
- Adding `twitterSummary` or any digest field to **public** archive routes — public serialization is unchanged.
- A hard server-side character cap on manually-edited `twitterSummary` — manual edits are not blocked; only a UI counter advises.
- Per-installation customization of `DIGEST_META_INSTRUCTIONS` via admin settings — the instruction block stays a code constant for this feature.
- Backfilling digest fields on historical archives.
