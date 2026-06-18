---
title: "DB-first credential resolver: admin-UI intent takes precedence over env fallback"
date: 2026-06-18
category: architecture
tags: [credentials, encryption, multi-tenant, app-credentials, env-vars, HKDF]
component: pipeline/services/credential-resolver
severity: design
status: implemented
applies_to: ["packages/pipeline/src/services/credential-resolver.ts", "packages/pipeline/src/repositories/app-credentials.ts", "packages/api/src/routes/super-app-credentials.ts"]
stage: [code, review]
evidence_count: 1
last_validated: 2026-06-18
source: apify-integration@reddit-collector-apify
related: [".harness/knowledge/context/packages/pipeline/services/PACKAGE.md"]
---

# DB-first credential resolver: admin-UI intent takes precedence over env fallback

## Insight

**When a credential row exists in the DB but cannot be decrypted, the resolver MUST return null — not fall through to the env var.** A present-but-undecryptable row signals operator intent (someone used the admin UI); silently using the env var would hide a broken credential and confuse troubleshooting.

Two-tier resolution order for every integration credential:

1. Read the `app_credentials` row (encrypted JSONB). Decrypt failure → return null immediately; log platform + error message; do NOT proceed to env var.
2. DB row absent (never set) → fall back to env var. Treat env var as the bootstrap path for operators who haven't visited the admin UI yet.

This means the resolver has three outcomes, not two:

| DB row state | Env var state | Result |
|---|---|---|
| Present + decryptable | any | DB creds (source: "db") |
| Present + undecryptable | any | **null** (decrypt failed; skip this run) |
| Absent | Present | Env creds (source: "env") |
| Absent | Absent | null (not configured) |

## Solution

```typescript
// file: packages/pipeline/src/services/credential-resolver.ts

// Returns { ok: row | null } when read+decrypt succeeds (null = no row),
//         { ok: "decrypt_failed" } when row exists but cannot be decrypted.
type DbRead<T> = { ok: T | null } | { ok: "decrypt_failed" };

async function safeGetDbRow<T>(
  fetch: () => Promise<T | null>,
  platform: string,
): Promise<DbRead<T>> {
  try {
    return { ok: await fetch() };
  } catch (error: unknown) {
    logger.error(
      { event: "credential.resolver.db_read_failed", platform, err: error instanceof Error ? error.message : String(error) },
      "credential resolver: DB row unreadable (rotated SESSION_SECRET / schema drift); platform will be skipped for this run",
    );
    return { ok: "decrypt_failed" };
  }
}

export async function resolveApifyApiToken(
  deps: AppCredentialResolverDeps,
): Promise<ApifyTokenCreds | null> {
  const dbRead = await safeGetDbRow(() => deps.appRepo.getApifyApiToken(), "apify_api_token");
  if (dbRead.ok === "decrypt_failed") return null;   // ← hard stop; no env fallthrough
  const dbRow = dbRead.ok;
  if (dbRow) return { apiToken: dbRow.apiToken, source: "db" };
  const apiToken = (deps.env ?? {}).APIFY_API_KEY;
  if (!present(apiToken)) return null;
  return { apiToken, source: "env" };
}
```

The `source: "db" | "env"` tag on the return value lets callers log where the token came from without ever logging the token value itself.

## Prevention / Reuse

When adding a new integration credential to this codebase:

1. Add an `AppCredentialKey` literal to `packages/shared/src/db/schema.ts` (the union enforces at compile time that only known keys hit the DB).
2. Add a `get<Platform>` method to `AppCredentialsRepo` — it does the decrypt; the resolver never touches raw JSONB.
3. Call `safeGetDbRow(() => deps.appRepo.get<Platform>(), "<key>")` and gate on `dbRead.ok === "decrypt_failed"` before the env fallback.
4. Add the env var to CLAUDE.md's optional integrations list with a note that the DB path is preferred.
5. Write a test that covers all four outcome rows in the table above — especially the "decrypt fails → null, env NOT used" case (the mutation that kills: return wrong source tag on that branch).

Do NOT: catch the error inside `appRepo.get<Platform>()` and return null silently — that hides the decrypt failure and the resolver wrongly falls through to env.

## Related

- `.harness/knowledge/context/packages/pipeline/services/PACKAGE.md` — `resolveApifyApiToken` + `resolveLinkedInCredentials` surface
- `packages/pipeline/src/services/credential-resolver.ts` — full implementation
- `packages/pipeline/src/repositories/app-credentials.ts` — DB-layer decrypt
