# Admin Delete Newsletter — Design Doc

**Date:** 2026-05-18
**Branch:** `feat/admin-delete-newsletter`
**Status:** Approved (small, single-domain feature; brainstorm folded into scope)

## Problem

Admin operators (Ritesh, Aman) currently have no way to remove a newsletter run from the dashboard. Bad runs, test runs, and obsolete archives accumulate in the `/admin` listing and clutter the operator view. They need a way to delete a newsletter from the dashboard with a confirmation prompt so deletions aren't accidental.

A "newsletter" here means a `run_archives` row — the durable artifact for a completed (or failed/cancelled) run. The dashboard list (`GET /api/runs`) merges in-flight Redis run-state with these archive rows, so we also clean up any stale Redis key for the same `runId` to keep the list consistent.

## Goals

- A **Delete** button on every row in the dashboard runs list (`RunsTable` and `RunsCardList`).
- Click → **confirmation Dialog** with destructive action wording before any DB write.
- Confirm → DELETE call to a new admin-gated `DELETE /api/admin/archives/:runId` endpoint.
- Endpoint removes the archive row and any dependent `email_sends` rows in a single Drizzle transaction; best-effort deletes the matching Redis `run:<id>` key.
- React Query cache invalidates so the row disappears immediately.

## Non-goals

- No undo / soft-delete. Deletion is permanent (consistent with current operator-only model and the 2-person team).
- No bulk delete.
- No audit log of who deleted what.
- No deletion of in-flight (`running` / `cancelling`) runs — the existing Cancel flow is the right tool for those. Delete is only for terminal states: `completed`, `failed`, `cancelled`, or any reviewed archive.
- No cascading delete of `raw_items`. They're shared across runs and the only link from archive → raw_items is the jsonb `rankedItems` ID array (no FK).

## Approach

### Backend

**New route:** `DELETE /api/admin/archives/:runId` in `packages/api/src/routes/archives.ts`, mounted under the same admin gate as the existing `PATCH /:runId`, `POST /:runId/send`, etc.

**New repo method:** `RunArchivesRepo.delete(runId: string): Promise<{ deleted: boolean }>` in `packages/api/src/repositories/run-archives.ts`. Uses `db.transaction(async (tx) => { … })`:
1. `tx.delete(emailSends).where(eq(emailSends.runArchiveId, runId))`
2. `tx.delete(runArchives).where(eq(runArchives.id, runId)).returning({ id })`
3. Return `{ deleted: rows.length === 1 }`.

**Handler logic:**
- Validate `:runId` is a UUID (zod). 400 on malformed.
- Call `archiveRepo.delete(runId)`. If `deleted === false` → 404.
- After successful delete, best-effort `await deps.redis.del(runKey(runId))`. Failures logged but don't fail the request (the archive is already gone — that's the source of truth).
- Log structured `event: "archive.deleted"` with `runId`.
- Return `204 No Content`.

**Why a transaction:** `email_sends.run_archive_id` has a non-null FK to `run_archives.id` with no CASCADE. Deleting the archive without deleting `email_sends` first throws an FK violation. Transaction guarantees we never end up with orphaned `email_sends` or a half-deleted state.

**Why no schema change:** Adding `ON DELETE CASCADE` to the FK would simplify the repo, but it's a migration that touches a production table and the rule "no scope creep" + "spec docs are the source of truth" pushes back. Transaction-based deletion is the smaller, reversible change.

### Frontend

**API client:** add `deleteArchive(runId: string): Promise<void>` to `packages/web/src/api/runs.ts` (or `archives.ts` — see "Open question" below; the existing PATCH/POST endpoints for archives live in `runs.ts`'s neighborhood and use `apiFetchAdmin`).

**Mutation hook:** `useDeleteArchive` in `packages/web/src/hooks/useDeleteArchive.ts` — wraps `useMutation`, invalidates the `["runs"]` query on success.

**UI changes in `RunsTable.tsx`:**
- Add a small destructive icon button (Trash2 from lucide) in the Action column, next to the existing action button. Always visible regardless of derived status (any terminal-state row can be deleted; running rows show only the existing Cancel button — delete hidden for `running` and `cancelling`).
- Add a second `Dialog` (sibling to the existing cancel-confirm dialog) controlled by a new `deleteRunId: string | null` state. Same shadcn `Dialog` pattern already used for Cancel confirmation — the component is already imported.
- Dialog wording: title `"Delete this newsletter?"`, description `"This permanently removes the archive and all delivery records. This cannot be undone."`, primary button `"Delete newsletter"` (variant destructive), secondary `"Keep it"`.

**Mirror changes in `RunsCardList.tsx`** — same pattern, mobile layout.

**Why not AlertDialog:** shadcn's AlertDialog isn't installed and the existing Cancel-run flow already uses Dialog as a confirmation modal. Reuse the established pattern; adding a new shadcn component is unnecessary scope.

### Edge cases

| Case | Behavior |
|---|---|
| Delete a run that's still `running` or `cancelling` | UI hides the Delete button for those derived statuses. API still validates and would return 200 if called manually (the data deletion itself is safe — Redis pub/sub for cancellation is independent). Decision: hide in UI, don't add API-level state check (no scope creep). |
| Delete a `failed` or `cancelled` run with no archive row | The `RunSummary` only comes from `archive_repo.list` for those terminal states (failed/cancelled runs that were persisted to `run_archives`), so the archive row exists. Pure-Redis live runs (`running`/`cancelling`) don't have archive rows yet — Delete button is hidden for those. |
| Concurrent delete + reviewer save | Reviewer's PATCH would 404 after delete. Existing PATCH handler already returns 404 on missing archive — no new handling needed. |
| Network failure mid-delete | React Query mutation surfaces error → toast or inline error (use existing `apiFetchAdmin` error path; the Cancel flow doesn't show a toast either, so match that — just close the dialog and rely on next refetch). |

## External Dependencies & Fallback Chain

**No new external dependencies.** This feature uses only libraries already in the stack:

- **Hono** — existing API framework, used for route registration.
- **Drizzle ORM** — existing, used for the delete transaction.
- **@tanstack/react-query** — existing, used for the mutation + invalidation.
- **shadcn `Dialog`** (lucide `Trash2` icon) — already installed and used elsewhere in the component (Cancel-run confirmation).
- **zod** — existing, used to validate `runId` in the handler.

No fallback chain needed. `library-probe` stage can mark this `NOT_APPLICABLE`.

## Open Questions

- **API client file location** — current archive-related calls (`getArchive`, `updateArchive`, etc.) live in `packages/web/src/api/runs.ts` despite the name. There's also `packages/web/src/api/archives.ts`. Pick whichever already contains the admin PATCH/POST archive calls during implementation (Planner can choose; trivial). **Resolution:** check during plan phase and co-locate.

## Verification Scenarios

These get folded into the spec by spec-generation and re-run by `functional-verify`:

1. **VS-1: Delete a reviewed archive end-to-end.** Seed a `run_archives` row with one `email_sends` child row → log in as admin → click Delete on dashboard → confirm in dialog → assert row removed from list, archive row gone from DB, email_sends row gone, Redis `run:<id>` key absent.
2. **VS-2: Cancel out of confirmation dialog.** Click Delete → click "Keep it" → assert dialog closes, archive row still present in DB and dashboard.
3. **VS-3: Delete a non-existent archive.** API call with a random UUID → 404, no DB changes.
4. **VS-4: Unauthenticated DELETE.** Call DELETE without admin cookie → 401, no DB changes.
5. **VS-5: Delete preserves shared raw_items.** Seed two archives that both reference the same `raw_items.id` in their `rankedItems` arrays → delete one → assert the other archive still loads correctly with all its items.
