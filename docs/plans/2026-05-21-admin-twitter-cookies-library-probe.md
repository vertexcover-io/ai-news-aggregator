# Library Probe — twitter-cookies-admin-settings

<!-- LP:VERDICT:PASS -->

## Summary

This spec introduces **no new external dependencies**. Every library it touches has already been verified by an earlier spec in this repository, and the patterns are reused verbatim. A fresh probe would be redundant.

## Per-library verdict

| Library / API | Used for | Verified by | Verdict |
|---|---|---|---|
| `rettiwt-api` | Twitter collector — passing the resolved base64 cookie blob into `new Rettiwt({ apiKey })` | `docs/spec/add-twitter-x-collector/probes/` (pagination, list, user-timeline shapes captured live) | VERIFIED — already in production use; this spec only changes where the `apiKey` value comes from (DB row vs env), not how it's consumed. The constructor accepts `undefined` (guest mode), which is the no-cookies path. |
| `@newsletter/shared/services/credential-cipher` (AES-256-GCM via HKDF over `SESSION_SECRET`) | Encrypt the base64 cookie blob at rest | `docs/spec/admin-social-config/` library probe + tests | VERIFIED — same cipher, same KEK, same `EncryptedBlob` shape as LinkedIn + Twitter posting creds. |
| `drizzle-orm` (`onConflictDoUpdate`, `eq`, `text().$type<union>()`) | Repository upsert/delete + extending the platform type to include `"twitter_collector"` | Used across the project; the `$type<...>()` widening is compile-time only and produces no DDL diff in `pnpm drizzle-kit generate` (asserted by the spec's verification matrix) | VERIFIED |
| Hono (`PUT`, `DELETE`, `c.req.json()`, `safeParse` zod body) | New route at `/api/admin/social-credentials/twitter-collector` | `packages/api/src/routes/admin-social-credentials.ts` already implements the exact same shape for `/linkedin` and `/twitter` | VERIFIED |
| `react-hook-form` + `sonner` + shadcn/ui `Card/Input/Button/Label` | Admin panel third card | `packages/web/src/components/SocialCredentialsPanel.tsx` already uses these for the existing two cards | VERIFIED |

## No-op probe rationale

The pipeline's library-probe gate exists to catch *unverified external integrations* before code is written against them — APIs whose response shape, error model, or auth flow could surprise the implementer. In this spec, every external boundary is already exercised in production code paths; the change is purely internal plumbing (move one secret from env to a DB-backed resolver that already exists for two other secrets). There is no live probe that would yield information the existing code does not already prove.

If, during implementation, the coder discovers that the rettiwt-api SDK behaves differently when given a DB-resolved blob vs an env-resolved blob (e.g. a trailing newline issue from textarea input), it should emit `<!-- LIB_SUSPECT:rettiwt-api:input-handling -->` and the orchestrator will re-enter this probe with `--lib rettiwt-api` to investigate.

## Re-plan required?

No.
