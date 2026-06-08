# Library Probe — save-newsletter-draft

> **Run at:** 2026-06-08
> **Verdict:** NOT_APPLICABLE

## Summary

The design doc's `## External Dependencies & Fallback Chain` section declares
**"None — pure-internal feature."**

This feature adds a draft/publish split to the newsletter review flow using only
modules already present in the monorepo:
- Drizzle ORM + PostgreSQL (existing `run_archives` table; one new nullable column)
- Hono REST API (existing PATCH route + zod validation)
- React + react-query + Tailwind (existing review page + dashboard components)
- BullMQ (existing processing queue — no new job types; publish workers untouched)

No external library or third-party API is introduced, so there is nothing to
health-check or smoke-test. No `.env.harness` credentials are required.

## Selected
- N/A — no external dependencies.

## Setup Needed
- None.

<!-- LP:VERDICT:NOT_APPLICABLE -->
