# Library Probe — add-archive-keyword-search

> **Run at:** 2026-05-07
> **Verdict:** PASS

## Summary

| Library | Health | Smoke | Final |
|---|---|---|---|
| react-day-picker (v9.14.0) | trusted (38M weekly dl, published 2026-05-03) | VERIFIED — SSR range render with `numberOfMonths=2` produces 2 month grids and shows the selected edges. | SELECTED |
| Postgres unaccent extension (PG 16) | trusted (core extension since 9.0; already installed in local DB) | VERIFIED — accent stripping works, `immutable_unaccent` wrapper compiles, generated tsvector + GIN index accepts the wrapper, websearch operators work, accent-insensitive match works. | SELECTED |

## Selected

- **`react-day-picker` v9** for the date-range picker on `/`. Evidence: `probes/react-day-picker/probe-render.log`, payload sample at `probes/react-day-picker/payload.sample.json`.
- **Postgres `unaccent` extension** for accent-insensitive FTS. Evidence: `probes/unaccent/probe.log`.

## Critical Finding — must update design doc

**`unaccent()` is STABLE, not IMMUTABLE.** Postgres rejects it directly inside a `GENERATED ALWAYS AS … STORED` expression with `ERROR: generation expression is not immutable`.

**Resolution:** the migration must define an IMMUTABLE wrapper:

```sql
CREATE OR REPLACE FUNCTION immutable_unaccent(text) RETURNS text AS $$
  SELECT unaccent('unaccent', $1);
$$ LANGUAGE SQL IMMUTABLE PARALLEL SAFE;
```

…then use `immutable_unaccent(...)` everywhere in the generated column AND in the query (must be the same function so the planner can match expressions).

The design doc's `## Architectural Challenges → 2.` section says we'd use plain `unaccent`. The spec generation step must reflect this fix. Adding it explicitly to the spec via VS-0-unaccent-fts probe.

## Pivot Log

(none — both libraries verified on first attempt)

## Setup Needed

(none — both deps work out of the box: `react-day-picker` installs cleanly with project's existing `react@18`/`date-fns@4`; `unaccent` is bundled with `postgres:16`.)

## Notes

- `react-day-picker` v9 emits a benign `useLayoutEffect` SSR warning. We render it client-side in Vite anyway; not a blocker.
- v9 ships its CSS at `react-day-picker/style.css`; Vite handles the import natively. Our SSR probe deliberately skips the CSS import (Node ESM cannot import CSS by default).
- Bundle size: `react-day-picker` v9 is ~25 KB gzip with `date-fns` already present. Acceptable for a public landing page.

<!-- LP:VERDICT:PASS -->
