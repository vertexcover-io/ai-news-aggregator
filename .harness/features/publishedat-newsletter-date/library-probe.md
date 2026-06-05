# Library Probe: publishedat-newsletter-date

<!-- LP:VERDICT:PASS -->

**Verdict: NOT_APPLICABLE — no external dependencies.**

The design doc's `## External Dependencies & Fallback Chain` section declares this a
pure-internal feature. The implementation:

- Adds a Drizzle column + migration (Drizzle/PostgreSQL already in the stack).
- Reuses the existing in-repo `publishDateForWindow` helper
  (`packages/shared/src/scheduling/tz.ts`) — already unit-tested in the repo.
- Threads the value through existing API serialization and existing React components.

No new npm package, third-party API, env var, or credential is introduced. There is
nothing to probe against a live service. The trust gate is satisfied trivially.

**Selected library:** N/A. **Alternatives tried:** N/A.
