# Library Probe: admin-ranking-prompt

<!-- LP:VERDICT:PASS -->

**Verdict:** `NOT_APPLICABLE` — no external dependencies.

The design doc's `## External Dependencies & Fallback Chain` section declares:

> **None — pure-internal feature.** No new npm packages, no new third-party APIs, no new SDKs.

All libraries touched by this change are already in the project and exercised in production:

- **Drizzle ORM + drizzle-kit** — already used for every existing migration and schema change.
- **zod** — already used by `userSettingsCommonShape` and every other settings field.
- **react-hook-form + @hookform/resolvers/zod** — already used by `SettingsPage.tsx` for every other field.
- **Vercel AI SDK (`ai` + `@ai-sdk/anthropic`)** — already wired to read the system prompt from a runtime string in `rankCandidates`. No new SDK surface introduced.

No probes were run; no `.harness/<name>/probes/` directory was created. Verification of these libraries already exists by virtue of the running production pipeline.
