---
governs: packages/web/src/pages/admin/
last_verified_sha: 5a2ff20
key_files: [AdminMustReadListPage.tsx, AdminMustReadEditPage.tsx]
flow_fns: []
decisions: []
status: active
---

# pages/admin/ — admin Must Read sub-pages

## Purpose

Two admin-gated pages for the "Must Read / Canon" feature: a list of all Must Read entries and a create/edit form.

## Public surface

| Page (route) | Effect |
|---|---|
| `AdminMustReadListPage` (`/admin/must-read`) | Lists all Must Read entries with publish date, status (published/draft), and edit/delete actions. Link to create new entry. |
| `AdminMustReadEditPage` (`/admin/must-read/new`, `/admin/must-read/:id`) | Form for creating/editing a Must Read entry: URL → preview (fetches link metadata), then title/author/description/commentary fields + publish toggle |

## Depends on / used by

- **Uses:** `api/must-read` (listAdminMustRead, createMustRead, updateMustRead, deleteMustRead, previewMustRead), `components/admin/must-read/MustReadEntryForm`, `components/must-read/MustReadEntryView`
- **Used by:** `App.tsx` (route definitions under `/admin/must-read/*`)
