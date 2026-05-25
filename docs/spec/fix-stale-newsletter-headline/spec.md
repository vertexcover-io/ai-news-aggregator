# SPEC: Fix Stale Newsletter Headline After Review Edits

**Source:** `docs/spec/fix-stale-newsletter-headline/design.md`
**Generated:** 2026-05-25

## Requirements

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|---------------------|----------|
| REQ-001 | Event-driven | When a manual review save submits a final ranked item list, the system shall generate a digest-level headline from that submitted list. | A review save with a generated headline distinct from rank-one story title persists the generated headline in `run_archives.digest_headline`. | Must |
| REQ-002 | Event-driven | When a manual review save submits a final ranked item list, the system shall generate a digest-level summary from that submitted list. | A review save with a generated summary distinct from rank-one story summary persists the generated summary in `run_archives.digest_summary`. | Must |
| REQ-003 | Event-driven | When manual digest generation succeeds, the system shall persist reviewed ranked items and generated digest fields in the same review update. | The repository update receives the final `rankedItems`, generated `digestHeadline`, generated `digestSummary`, and rebuilt `searchText` inputs from the same item set. | Must |
| REQ-004 | Unwanted behavior | If manual digest generation fails, then the system shall reject the review save. | The archive is not marked reviewed by `patchArchive()` when the generator throws. | Must |
| REQ-005 | Ubiquitous | The system shall use ranking-stage LLM digest copy for auto-reviewed archives. | `pickArchiveDigest()` returns `rankResult.digestHeadline` before consulting rank-one story title. | Must |
| REQ-006 | Ubiquitous | The system shall treat first-story title and summary only as fallback issue copy. | Public archive row and archive page header render `digestHeadline` when it is non-empty, even when `topItems[0].title` differs. | Must |
| REQ-007 | Event-driven | When reviewed digest copy is persisted, the system shall rebuild archive search text from that digest copy. | `search_text` contains generated digest headline and generated digest summary after review save. | Must |
| REQ-008 | Ubiquitous | The digest generator shall receive only the final reviewed ranked item set. | A removed story title does not appear in the generator input after review save. | Must |
| REQ-009 | State-driven | While the reviewed ranked item list is empty, the system shall not call the digest generator. | Empty review save persists empty ranked items with nullable or existing fallback digest behavior and generator call count remains zero. | Should |

## Edge Cases

| ID | Scenario | Expected Behavior | Derived From |
|----|----------|-------------------|-------------|
| EDGE-001 | Admin removes the original rank-one item before saving. | Generated digest input excludes the removed item and persisted digest copy comes from the post-review generated output. | REQ-001, REQ-002, REQ-008 |
| EDGE-002 | Admin reorders stories so rank one changes. | Persisted digest headline remains the generated issue headline, not the new rank-one story title. | REQ-001, REQ-006 |
| EDGE-003 | Generator returns valid digest copy that differs from every story title. | Archive listing, archive detail, and email inputs use that digest copy. | REQ-001, REQ-002, REQ-006 |
| EDGE-004 | Generator throws during manual review save. | The API returns an error and does not persist reviewed state through `updateRankedItems()`. | REQ-004 |
| EDGE-005 | Pipeline produces an auto-reviewed archive with a digest headline and a rank-one story title. | Persisted `digest_headline` equals the ranking-stage digest headline. | REQ-005 |
| EDGE-006 | Legacy archive has no digest headline. | Public issue surfaces fall back to first story title. | REQ-006 |
| EDGE-007 | Review save contains zero ranked items. | The digest generator is skipped. | REQ-009 |

## Verification Matrix

| REQ ID | Unit Test | Integration Test | E2E Test | Manual Test | Notes |
|--------|-----------|------------------|----------|-------------|-------|
| REQ-001 | Yes | No | No | No | API service unit with injected generator. |
| REQ-002 | Yes | No | No | No | API service unit with injected generator. |
| REQ-003 | Yes | Yes | No | No | Repository/search-text coverage plus service call assertion. |
| REQ-004 | Yes | No | No | No | Generator failure unit test. |
| REQ-005 | Yes | No | No | No | Pipeline worker digest selection unit test. |
| REQ-006 | Yes | No | No | No | Web component unit tests for archive row and page header. |
| REQ-007 | Yes | Yes | No | No | Existing repo search-text integration test extended for generated digest. |
| REQ-008 | Yes | No | No | No | Generator input assertion. |
| REQ-009 | Yes | No | No | No | Empty save unit test. |
| EDGE-001 | Yes | No | No | No | Service unit. |
| EDGE-002 | Yes | No | No | No | Service and web unit. |
| EDGE-003 | Yes | No | No | No | Web and email existing tests. |
| EDGE-004 | Yes | No | No | No | Service unit. |
| EDGE-005 | Yes | No | No | No | Pipeline worker unit. |
| EDGE-006 | Yes | No | No | No | Web component unit. |
| EDGE-007 | Yes | No | No | No | Service unit. |

## Verification Scenarios

### VS-0-anthropic-ai-sdk-structured-digest: Library probe — Anthropic structured digest generation

**Type:** api
**Run:** `bash -lc 'set -a; source /Users/amankumar/Documents/newsletter/.env; set +a; pnpm --dir packages/pipeline exec node .harness/fix-stale-newsletter-headline/probes/anthropic-ai-sdk/probe-structured-digest.mjs'`
**Expected:** exit 0 and `.harness/fix-stale-newsletter-headline/probes/anthropic-ai-sdk/payload.sample.json` contains non-empty headline and summary length fields.

### VS-1-manual-review-regenerates-digest

**Type:** unit
**Run:** `pnpm --filter @newsletter/api test:unit -- tests/unit/services/review.test.ts`
**Expected:** review save persists generated issue-level headline and summary from final reviewed items, not rank-one story fields.

### VS-2-auto-review-preserves-ranking-digest

**Type:** unit
**Run:** `pnpm --filter @newsletter/pipeline test:unit -- tests/unit/workers/run-process.test.ts`
**Expected:** auto-reviewed archive persists ranking-stage `digestHeadline` even when rank-one story title differs.

### VS-3-public-surfaces-are-digest-first

**Type:** unit
**Run:** `pnpm --filter @newsletter/web test:unit -- tests/unit/components/archive-listing/ArchiveRow.test.tsx tests/unit/ArchivePageHeader.test.tsx`
**Expected:** archive listing row and archive detail header prefer `digestHeadline` over first story title.

## Out of Scope

- Adding asynchronous digest status columns or a background digest regeneration queue.
- Regenerating `hook` or `twitterSummary` after manual review.
- Rewriting historical archives in production.
- Changing per-story recap generation.
- Changing the email renderer beyond preserving digest-first behavior.
