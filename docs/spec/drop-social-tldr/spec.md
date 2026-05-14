# SPEC — Drop the `tldr` social-post field

Linked design: `../../plans/2026-05-14-drop-social-tldr-design.md`

> Context: PR #136 added `hook` and `tldr` as new digest-level LLM fields driving the LinkedIn long-form post and X thread. End-to-end testing showed `tldr` reads like marketing copy and adds clutter without information. This PR removes `tldr` entirely while leaving `hook` in place.

## Requirements (EARS)

### LLM digest schema

- **REQ-001** — *When* the stage-2 reranker (`rankCandidates`) finishes successfully, *then* its returned `RankResult` *shall* contain `hook: string` but *shall not* contain a `tldr` field.
- **REQ-002** — *When* the rank LLM call's structured response is validated, *then* the `digestSchema` Zod schema *shall* declare exactly four fields: `headline`, `summary`, `hook`. (Note: rest of `rankedResponseSchema` unchanged.) A response containing a `tldr` field is allowed by Zod's default stripping and is silently dropped.
- **REQ-003** — *When* the rank prompt is constructed, *then* it *shall not* include any instruction telling the LLM to produce a `tldr` field. The "Also return a social-post hook…" preamble *shall* describe the single `hook` field only.

### Storage

- **REQ-010** — *When* migration `0017_drop_tldr.sql` is applied to a `run_archives` table that contains a `tldr` column, *then* the `tldr` column *shall* be dropped. Existing data in the column is discarded.
- **REQ-011** — *When* `RunArchivesRepo.upsert` is called from `run-process` after this change, *then* the insert payload *shall not* contain a `tldr` field, and the `onConflictDoUpdate` set *shall not* reference `runArchives.tldr`.

### Read path

- **REQ-020** — *When* `GET /api/archives/:runId` (public) returns an archive detail, *then* the response body *shall not* contain a `tldr` field. `hook` *shall* still be present.
- **REQ-021** — *When* the pipeline's `RunArchivesRepo.findById` returns a `PipelineRunArchiveRow`, *then* the row *shall not* contain a `tldr` field.

### Composer

- **REQ-030** — *When* `composePosts({ hook, stories, archiveUrl })` is called, *then* the function signature *shall not* accept a `tldr` parameter.
- **REQ-031** — *When* `composePosts` is called with a non-null `hook` and any number of stories, *then* the returned `linkedinText` *shall* start with `<hook>\n\n1) <first story title>` — no `TLDR: …` line between the hook and the first story.
- **REQ-032** — *When* `composePosts` returns a non-null result, *then* `twitterThread[0]` *shall* be exactly the hook string (no concatenation with tldr).

### Notifiers

- **REQ-040** — *When* `linkedin/notifier.ts` or `twitter/notifier.ts` compose a post, *then* the `composePosts` call site *shall not* pass a `tldr` field, and `ArchiveLike` *shall not* declare a `tldr` field.

### Web

- **REQ-050** — *When* the web `RunStateResponse` type is consumed, *then* it *shall not* declare an optional `tldr` field.

## Acceptance Criteria (testable)

| ID | Test | Layer |
|---|---|---|
| AC-001 | `RankResult` type does not contain `tldr`. | typecheck |
| AC-002 | `digestSchema.safeParse({ headline, summary, hook })` succeeds. | unit |
| AC-003 | Migration 0017 drops `tldr` column when applied to a DB containing it. | manual / staging |
| AC-004 | Pipeline upsert payload omits `tldr`. | unit (`run-archives.test.ts`) |
| AC-005 | `GET /api/archives/:runId` response shape does not contain `tldr`. | unit (api route) |
| AC-006 | `composePosts` signature does not accept `tldr`. | typecheck |
| AC-007 | LinkedIn body starts with `<hook>\n\n1)` (no `TLDR:` line). | unit (`compose.test.ts`) |
| AC-008 | Twitter thread tweet 1 is the hook only. | unit |
| AC-009 | `pnpm typecheck` passes across all packages. | gate |
| AC-010 | `pnpm lint` passes across all packages. | gate |
| AC-011 | `pnpm test:unit` passes across all packages. | gate |

## Verification Scenarios

**VS-1 — Composer LinkedIn shape.**
Call `composePosts({ hook: "Hook.", stories: [3 stories], archiveUrl })`. Assert the body matches `Hook.\n\n1) …\n   …\n\n2) …\n\n3) …\n\nFull breakdown: <url>` byte-for-byte. No `TLDR:` substring anywhere.

**VS-2 — Composer Twitter opener.**
Call `composePosts({ hook: "Hook.", stories, archiveUrl })`. Assert `twitterThread[0] === "Hook."`.

**VS-3 — Rank pipeline emits hook without tldr.**
Stub `generateObject` to return `{ digest: { headline, summary, hook }, ranked: [...] }` with no `tldr` key. Assert `rankCandidates` returns a `RankResult` whose `hook` is the stubbed value and which has no `tldr` property at runtime.

**VS-4 — Migration drops column.**
Against a DB seeded with `tldr text` on `run_archives` and a row with `tldr = 'something'`, apply `0017_drop_tldr.sql` and assert the column no longer exists (`information_schema.columns`).
