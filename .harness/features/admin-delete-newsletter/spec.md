# SPEC — Admin Delete Newsletter

**Spec ID:** `admin-delete-newsletter`
**Source design:** `docs/plans/2026-05-18-admin-delete-newsletter-design.md`
**Status:** Approved

## Summary

Admin operators can delete a newsletter (`run_archives` row) from the `/admin` dashboard. Each row gets a Delete button; clicking it opens a confirmation Dialog. Confirming calls `DELETE /api/admin/archives/:runId`, which removes the archive plus its dependent `email_sends` rows in a single transaction and best-effort cleans the matching Redis `run:<id>` key.

## Requirements (EARS format)

### REQ-1 (Delete button visibility)
**WHEN** the admin dashboard renders a row whose derived status is `ready-to-review`, `reviewed`, `failed`, or `cancelled`,
**THE SYSTEM SHALL** render a destructive Delete button (icon: `Trash2`) in that row's action area in both `RunsTable` and `RunsCardList`.

### REQ-2 (Delete button hidden for in-flight runs)
**WHEN** a row's derived status is `running` or `cancelling`,
**THE SYSTEM SHALL NOT** render the Delete button for that row.

### REQ-3 (Confirmation dialog)
**WHEN** the user clicks the Delete button,
**THE SYSTEM SHALL** open a confirmation Dialog with:
- Title: `"Delete this newsletter?"`
- Description: `"This permanently removes the archive and all delivery records. This cannot be undone."`
- Primary action: `"Delete newsletter"` button, destructive variant.
- Secondary action: `"Keep it"` button, outline variant.

### REQ-4 (Cancel preserves data)
**WHEN** the user clicks `"Keep it"` or dismisses the dialog,
**THE SYSTEM SHALL** close the dialog and make no API call. The dashboard list shall remain unchanged.

### REQ-5 (Confirm triggers DELETE)
**WHEN** the user clicks `"Delete newsletter"`,
**THE SYSTEM SHALL** call `DELETE /api/admin/archives/:runId` with the row's `runId`, disable both dialog buttons while the request is in-flight, and invalidate the `["runs"]` React Query cache on success so the row disappears from the dashboard.

### REQ-6 (Backend route — admin-gated)
**THE SYSTEM SHALL** expose `DELETE /api/admin/archives/:runId` mounted under the existing `requireAdmin` middleware (same gate as `PATCH /api/admin/archives/:runId`). Calls without a valid `admin_session` cookie return `401`.

### REQ-7 (UUID validation)
**WHEN** the `:runId` path parameter is not a valid UUID,
**THE SYSTEM SHALL** return `400` with an error message and perform no DB writes.

### REQ-8 (Transactional delete)
**WHEN** the DELETE handler executes against an existing `run_archives` row,
**THE SYSTEM SHALL** within a single Drizzle transaction:
1. Delete all `email_sends` rows where `run_archive_id = :runId`.
2. Delete the `run_archives` row where `id = :runId`.
And then return `204 No Content`.

### REQ-9 (Not found)
**WHEN** the DELETE handler runs and no `run_archives` row matches `:runId`,
**THE SYSTEM SHALL** return `404` and perform no DB writes (the transaction commits with zero rows affected).

### REQ-10 (Redis cleanup is best-effort)
**WHEN** the archive row has been successfully deleted,
**THE SYSTEM SHALL** call `redis.del("run:" + runId)` as a best-effort follow-up. **IF** the Redis call throws or fails, **THE SYSTEM SHALL** log a warning and still return `204` — the archive deletion is the source of truth.

### REQ-11 (Structured logging)
**WHEN** an archive is successfully deleted,
**THE SYSTEM SHALL** log a structured `info` event `archive.deleted` with fields `{ runId, removedEmailSends: number }`.

### REQ-12 (Shared raw_items preserved)
**WHEN** an archive is deleted that referenced raw_items shared by other archives,
**THE SYSTEM SHALL NOT** delete any rows from `raw_items` (there is no FK; the jsonb `rankedItems` ID array is the only link).

## Out of Scope

- Undo / soft-delete.
- Bulk delete.
- Audit log table.
- Schema change to add `ON DELETE CASCADE` to `email_sends.run_archive_id`.
- Deleting in-flight (`running` / `cancelling`) runs from the UI.

## Verification Scenarios (folded in from design doc)

Re-run by `functional-verify`.

### VS-1: End-to-end delete of a reviewed archive
**Setup:** Seed `run_archives` (id=`<uuid>`, reviewed=true, status=`completed`) + 1 `email_sends` row referencing it.
**Steps:**
1. Log in as admin.
2. Open `/admin` → confirm the row is present.
3. Click the Delete button for that row.
4. In the dialog, click `"Delete newsletter"`.
**Assert:**
- API call: `DELETE /api/admin/archives/<uuid>` → `204`.
- DB: `run_archives` row gone.
- DB: `email_sends` rows referencing that archive gone.
- Redis: `run:<uuid>` key absent (deleted or never existed).
- Dashboard: row disappears after React Query invalidation.

### VS-2: Cancel out of confirmation dialog
**Setup:** Seed a `run_archives` row.
**Steps:**
1. Open `/admin`.
2. Click Delete on the row.
3. In the dialog, click `"Keep it"`.
**Assert:**
- No API call made.
- Dialog closes.
- DB: archive row still present.
- Dashboard: row still present.

### VS-3: Delete a non-existent archive
**Steps:** `curl -X DELETE /api/admin/archives/<random-uuid>` with valid admin cookie.
**Assert:** 404. No DB rows affected.

### VS-4: Unauthenticated DELETE
**Steps:** `curl -X DELETE /api/admin/archives/<any-uuid>` with no admin cookie.
**Assert:** 401. No DB rows affected. No Redis call made.

### VS-5: Shared raw_items preserved
**Setup:** Two archives A and B, both reference `raw_item.id = X` in their `rankedItems` arrays.
**Steps:** Delete archive A.
**Assert:**
- Archive A gone.
- Archive B still present and still loads X correctly via `/api/archives/<B>`.
- `raw_items` row X still present.

### VS-6: Malformed runId returns 400
**Steps:** `curl -X DELETE /api/admin/archives/not-a-uuid` with admin cookie.
**Assert:** 400. No DB writes.

## Verification Matrix

| REQ | Unit test | Integration / functional |
|---|---|---|
| REQ-1, REQ-2 | `RunsTable.test.tsx` renders/hides Delete by derived status | VS-1, VS-2 |
| REQ-3, REQ-4 | `RunsTable.test.tsx` opens dialog + Keep-it path | VS-2 |
| REQ-5 | `useDeleteArchive.test.tsx` invalidates ["runs"] on success | VS-1 |
| REQ-6 | `archives-delete.test.ts` returns 401 without cookie | VS-4 |
| REQ-7 | `archives-delete.test.ts` returns 400 for non-UUID | VS-6 |
| REQ-8 | `run-archives.repo.test.ts` deletes email_sends + archive in tx | VS-1 |
| REQ-9 | `archives-delete.test.ts` returns 404 when no row | VS-3 |
| REQ-10 | `archives-delete.test.ts` returns 204 even when redis.del throws | (functional) |
| REQ-11 | `archives-delete.test.ts` asserts logger call | (functional) |
| REQ-12 | `run-archives.repo.test.ts` does not touch raw_items | VS-5 |

## Edge Cases

- **Concurrent delete + reviewer PATCH:** PATCH returns 404 after delete (already handled by existing PATCH handler).
- **Network failure mid-delete:** React Query surfaces error; dialog stays open with disabled buttons until the request resolves. (No toast — match the existing Cancel-run pattern.)
- **Redis down:** Archive deletion still succeeds; warning logged; 204 returned.
