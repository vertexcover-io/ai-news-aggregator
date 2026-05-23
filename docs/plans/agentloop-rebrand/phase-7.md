# Phase 7: Admin UI — must-read CRUD pages

> **Status:** pending

## Overview

Two admin pages under `/admin/must-read`: a list view with Add/Edit/Delete actions and an edit page that handles both create (two-step paste-URL flow) and edit (single form).

## Implementation

**Files:**

- Create: `packages/web/src/pages/admin/AdminMustReadListPage.tsx`
  - Renders: page header with "Add new" CTA → routes to `/admin/must-read/new`; table with one row per entry (title, author, year, added date, annotation excerpt of ~80 chars, Edit + Delete buttons)
  - Delete uses a confirmation modal (reuse pattern from existing admin pages)
- Create: `packages/web/src/pages/admin/AdminMustReadEditPage.tsx`
  - Routes: `/admin/must-read/new` (create) and `/admin/must-read/:id` (edit)
  - Create flow (two-step):
    1. Step 1: paste URL field + "Preview" button
    2. On submit → call `POST /api/admin/must-read/preview` → Save button disabled, "Extracting…" indicator visible
    3. On `extracted` → prefill title/author/year, scroll to annotation field, enable Save
    4. On `extraction_failed` → show banner `Extraction failed: <reason>. Enter manually.`, leave fields empty, enable Save
    5. Step 2: edit form for title/author/year/annotation → Save → `POST /api/admin/must-read`
    6. On 201 → redirect to `/admin/must-read`
    7. On 409 (duplicate URL) → show inline message `URL already exists` + link to `/admin/must-read/<existingId>`
  - Edit flow: fetch entry on mount via `GET /api/admin/must-read/:id` (add this method to the typed client; lightweight wrapper around the list endpoint with a `.find()` is fine if we don't want a new route), populate form, PATCH on save
- Create: `packages/web/src/components/admin/must-read/MustReadEntryForm.tsx` — the form widget used by both create and edit flows
- Modify: `packages/web/src/api/must-read.ts` — add admin client methods (`previewMustRead`, `createMustRead`, `listAdminMustRead`, `updateMustRead`, `deleteMustRead`)
- Modify: `packages/web/src/App.tsx` — register `/admin/must-read` and `/admin/must-read/:id` and `/admin/must-read/new` under `RequireAdmin` + `AdminLayout`
- Modify: `packages/web/src/layouts/AdminLayout.tsx` if it has a nav — add "Must Read" link

**Tests:**

- REQ-028: list page renders Add CTA + one row per entry
- REQ-029: paste URL → form disables Save, shows "Extracting…", on success prefills the three suggested fields
- REQ-030: on `extraction_failed` payload, banner renders with the `Extraction failed: ` prefix and the error message; fields are empty
- REQ-031: on save 409, message contains `URL already exists` and an `<a>` to `/admin/must-read/<existingId>`
- EDGE-003: when suggested payload has `{ title: "X", author: null, year: null }`, only title field is prefilled
- EDGE-006: duplicate URL flow round-trip — covered by REQ-031
- EDGE-009 (UI side): edit flow — load 6-month-old entry, change annotation, save; assert the request body to PATCH does NOT include `addedAt` (only the changed field + maybe the unchanged ones — but never `addedAt`)

**Pattern to follow:**
- `packages/web/src/pages/SettingsPage.tsx` for `react-hook-form` + `zodResolver` + `useMutation` pattern
- `packages/web/src/components/review/AddPostPanel.tsx` for a paste-URL + preview + save flow (closest analog to our two-step UX)
- Existing delete-with-confirmation pattern in dashboard or review pages

**Traces to:** REQ-028, REQ-029, REQ-030, REQ-031, EDGE-003, EDGE-006, EDGE-009 (UI side)

**What to build (state machine for the two-step form):**

```
idle
 → typing-url
 → previewing (button disabled, indicator visible)
   → extracted → editing-fields (prefilled)
   → extraction-failed → editing-fields (empty + banner)
 → saving (Save button disabled)
   → success → redirect to /admin/must-read
   → duplicate → editing-fields (with duplicate banner)
   → other-error → editing-fields (with generic error banner)
```

Implement as discriminated-union state in a `useState<FormState>` rather than `useReducer` — the transitions are linear enough that a reducer would be overkill.

**Commit:** `feat(web): admin must-read CRUD pages with two-step paste-URL flow`

## Done When

- [ ] Both pages reachable at their URLs behind admin auth
- [ ] Two-step paste-URL flow works end-to-end against the dev API
- [ ] Edit flow loads an existing entry and saves changes
- [ ] All listed REQs covered by passing unit tests
- [ ] `pnpm --filter @newsletter/web build` green
- [ ] `pnpm typecheck` and `pnpm lint` green
