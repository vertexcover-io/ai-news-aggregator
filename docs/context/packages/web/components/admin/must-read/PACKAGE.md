---
governs: packages/web/src/components/admin/must-read/
last_verified_sha: 5a2ff20
key_files: [MustReadEntryForm.tsx]
flow_fns: []
decisions: []
status: active
---

# components/admin/must-read/ — admin Must Read entry form

## Purpose

Form component for creating/editing a "Must Read" entry. Used by `AdminMustReadEditPage`.

## Public surface

| Component | Effect |
|---|---|
| `MustReadEntryForm({ initialValues, onSubmit, saving })` | URL input → preview button → populated fields (title, author, description, commentary, publish toggle) → save button. Handles DuplicateUrlError on URL conflict. |
