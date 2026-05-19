# Admin Social Config Management — Design

**Linear scope:** Allow an admin to manage LinkedIn and X/Twitter OAuth **client credentials** (API key, secret, etc.) and platform **enable/disable** state from the existing admin Settings page — instead of editing `.env` and restarting the pipeline.

**Date:** 2026-05-19
**Owner:** Aman
**Status:** Draft (brainstorm output)

---

## 1. Problem

Today, LinkedIn and Twitter auto-posting are configured exclusively via environment variables read at process startup in `packages/pipeline/src/workers/processing.ts:332-360` (LinkedIn: `LINKEDIN_CLIENT_ID/SECRET/API_VERSION`; Twitter: 4 OAuth1 keys). To rotate a key, disable a platform temporarily, or hand the system to a teammate, an operator must:

1. SSH/edit `.env` on the host
2. Restart the pipeline process
3. Mentally remember the four Twitter keys and two LinkedIn keys

The admin Settings page already manages enable/disable toggles (`linkedinEnabled`, `twitterPostEnabled` in `user_settings`) but they're cosmetic until credentials exist in `.env`. There is **no** in-product way to enter or rotate the keys themselves.

## 2. Goal & non-goals

**Goal:** From `/admin/settings`, an admin can:
- View whether LinkedIn / Twitter credentials are currently configured (without seeing the secret value)
- Enter / replace credentials inline
- Toggle each platform on/off independently (existing behavior, kept)
- Save the changes; the next pipeline run picks them up without a process restart

**Non-goals:**
- OAuth user-token management (the existing `social_tokens` table is untouched; this is about *client* credentials only)
- Multi-tenant credentials (still singleton row, like the rest of `user_settings`)
- Migrating any other `.env` secret into the DB (Slack webhook, Anthropic key, etc. stay where they are)
- Web UI for testing posts (only managing the config)

## 3. Constraints

- Project rule: never hardcode secrets in source; `.env` already exists. We are **adding** an alternative source, not replacing.
- The pipeline runs as a separate Node process from the API. Credentials must be readable by the pipeline at job-run time.
- Existing pipeline code reads creds **once at module load** in `buildDefaultPublishDeps()`. This module-load coupling is the actual blocker — design must move credential resolution to per-job-run.
- `SESSION_SECRET` already exists in `.env` (used for admin cookie HMAC) — we can reuse it as the KEK for credential encryption to avoid introducing yet another env var.
- We must mask secrets in API responses. The admin Settings page must never display the raw secret after it's been saved (write-only fields with a "configured / not configured" indicator).

## 4. Design

### 4.1 Storage: a new `social_credentials` table

A new singleton-per-platform table in `@newsletter/shared`:

```ts
export const socialCredentials = pgTable("social_credentials", {
  platform: text("platform").primaryKey().$type<"linkedin" | "twitter">(),
  // Each secret stored as { ciphertext, iv, authTag } base64-encoded.
  // We encrypt at the field level (not row level) so a partial config still
  // reveals which fields are set vs. missing.
  encryptedFields: jsonb("encrypted_fields").notNull().$type<EncryptedFields>(),
  // Public/non-secret metadata stored in plaintext for easy filtering & display.
  metadata: jsonb("metadata").$type<{ apiVersion?: string } | null>(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: text("updated_by"),  // "admin" — placeholder for future multi-user
});
```

Where `EncryptedFields` is platform-specific:

```ts
type LinkedInEncryptedFields = {
  clientId: EncryptedBlob;
  clientSecret: EncryptedBlob;
};
type TwitterEncryptedFields = {
  apiKey: EncryptedBlob;
  apiSecret: EncryptedBlob;
  accessToken: EncryptedBlob;
  accessTokenSecret: EncryptedBlob;
};
type EncryptedBlob = { ct: string; iv: string; tag: string };
```

**Why a new table (not `user_settings`):**
- `user_settings` is a single row of mostly plaintext; mixing encrypted blobs makes its repo functions awkward.
- Per-platform row keyed by `platform` matches `social_tokens` and lets us add Bluesky/Mastodon later without schema churn.
- Drizzle migration is small and additive.

**Why not extend `social_tokens`:** It stores user-authorized OAuth tokens (output of an auth flow). Mixing client app credentials (the *key to ask for* a user token) with the user token itself muddies the model. Keep them separate.

### 4.2 Encryption: Node `crypto` + AES-256-GCM, KEK = SESSION_SECRET

Library choice: **Node's built-in `crypto`** module (zero dependencies). AES-256-GCM is the standard authenticated symmetric primitive and is supported natively.

- KEK = HKDF-SHA256(`SESSION_SECRET`, salt="social-creds-v1") to derive a 32-byte key. Doing HKDF means a future rotation can change salt → new key without changing `SESSION_SECRET`.
- Each field gets its own random 12-byte IV; ciphertext + auth tag stored alongside.
- A single helper module `packages/shared/src/services/credential-cipher.ts` exposes `encrypt(plaintext)` and `decrypt(blob)`. Both API and pipeline import it.

**Why not libsodium / argon2 / bcrypt:** AES-GCM is correct for symmetric encryption-at-rest. Argon2/bcrypt are password hashes (one-way). libsodium is a fine alternative but adds a native dep — not justified for two small tables on a single-tenant app.

**Threat model:** Anyone with `DATABASE_URL` + `SESSION_SECRET` can decrypt. That's already the operator's privilege boundary today; we are not raising it. We **are** preventing leakage via DB-only backups, accidental SQL dumps, or readonly DB roles.

### 4.3 API surface

Two new admin-only routes (added to existing `packages/api/src/routes/admin.ts` or a new `admin-social.ts`, guarded by `requireAdmin`):

| Method | Path | Body | Response |
|---|---|---|---|
| `GET` | `/api/admin/social-credentials` | — | `{ linkedin: { configured: boolean, apiVersion?: string, updatedAt }, twitter: { configured: boolean, updatedAt } }` |
| `PUT` | `/api/admin/social-credentials/:platform` | platform-specific creds | `{ ok: true, configured: true, updatedAt }` |
| `DELETE` | `/api/admin/social-credentials/:platform` | — | `{ ok: true }` |

**GET never returns secret values.** Even a "masked" preview (`abc**********xyz`) leaks length; we just return `configured: true|false`.

**PUT** is atomic per platform — all 2 (LinkedIn) or 4 (Twitter) fields supplied in one request, replacing the row. Partial updates are explicitly **not** supported; rotating "just the access token" still requires re-sending the API key. Rationale: simpler validation, eliminates the "what's stored vs. what's submitted" ambiguity.

**DELETE** removes the row; effectively un-configures the platform.

Toggles (`linkedinEnabled`, `twitterPostEnabled`) stay on the existing `PUT /api/settings` endpoint — no change to that route's contract.

### 4.4 Pipeline integration

Today, `buildDefaultPublishDeps()` reads `process.env.LINKEDIN_*` once and constructs the notifier. We refactor:

1. New service `packages/shared/src/services/credential-resolver.ts` with `resolveLinkedInCredentials(): Promise<LinkedInCreds | null>` and `resolveTwitterOAuth1Credentials(): Promise<TwitterOAuth1Credentials | null>`.
2. Each resolver: **DB first, env fallback.** If a row exists in `social_credentials` for that platform → decrypt and use it. Else fall back to current env-var reading.
3. `buildDefaultPublishDeps()` becomes async or accepts the resolved creds. We construct notifiers per-job in the worker, not at module load.

This way:
- Operators who haven't touched the new UI keep working off `.env` (no migration pain).
- Operators who save via the UI immediately override `.env` on next job.
- No process restart needed.

**LinkedIn caveat:** The notifier's `socialTokens` repo dependency stays unchanged — the *user-authorized* token is still in `social_tokens`. Only the *client* credentials move.

### 4.5 Frontend: extend SettingsPage

Add a new `<SocialCredentials>` form panel below the existing schedule/source config. Layout:

```
┌─ Social Credentials ───────────────────────────────────┐
│  LinkedIn                            [✓ Configured]    │
│  ┌──────────────────────────────────────────────────┐  │
│  │ Client ID:     [____________________________]    │  │
│  │ Client Secret: [____________________________]    │  │
│  │ API Version:   [202511                   ]       │  │
│  │ [Save LinkedIn] [Clear Credentials]              │  │
│  └──────────────────────────────────────────────────┘  │
│                                                        │
│  X / Twitter                         [— Not configured]│
│  ┌──────────────────────────────────────────────────┐  │
│  │ API Key:               [_______________________] │  │
│  │ API Secret:            [_______________________] │  │
│  │ Access Token:          [_______________________] │  │
│  │ Access Token Secret:   [_______________________] │  │
│  │ [Save Twitter] [Clear Credentials]               │  │
│  └──────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────┘
```

- Inputs are `type="password"`; toggling masking is a future enhancement, not MVP.
- "Save" is per-platform (independent forms) — saves one platform's creds without touching the other.
- The existing "Enable LinkedIn auto-post" / "Enable X auto-post" toggles stay where they are (in their current panel) and continue to use `PUT /api/settings`. We rely on visual proximity to make the relationship clear.
- Saving when the platform is **enabled** but **not configured** is fine — the pipeline will simply skip the notifier (existing behavior). A small inline warning appears: "LinkedIn is enabled but credentials are missing — auto-posting will be skipped."

### 4.6 Migration

A single Drizzle migration:
- Create `social_credentials` table.
- No data migration: existing `.env` continues to work via the fallback path.

## 5. External Dependencies & Fallback Chain

| Dependency | Use | Primary | Fallback |
|---|---|---|---|
| `crypto` (Node built-in) | AES-256-GCM encrypt/decrypt | Node 22 stdlib | n/a — built into Node, no alternative needed |
| `zod` (already in project) | Validate PUT bodies | already used | n/a |

**No new third-party libraries.** Library probe will verify Node's `crypto.createCipheriv("aes-256-gcm", ...)` round-trips a representative payload (string up to 256 bytes — the longest of the 4 Twitter fields) and that the auth-tag verification fails on tampered ciphertext.

## 6. Risks & open questions

1. **Key rotation:** If `SESSION_SECRET` is rotated, all stored credentials become unreadable. Mitigation: document explicitly in `.env.example`; out-of-scope for this PR is a re-encryption helper. Operators should DELETE + re-enter credentials after a `SESSION_SECRET` rotation.
2. **Audit trail:** No write log beyond `updatedAt`. Acceptable for single-admin MVP.
3. **Concurrent edits:** Two browser tabs writing the same platform → last-write-wins. No optimistic locking. Acceptable.
4. **Pipeline already-running runs:** A run already mid-flight won't pick up new creds; only the *next* job will. The worker reads `social_credentials` per `buildDefaultPublishDeps()` invocation (which is per-job in BullMQ for our scale).

## 7. Phasing

Suggested for planner:

- **Phase 1 — Schema & cipher service:** `social_credentials` table + migration + `credential-cipher.ts` + unit tests. No API/UI yet.
- **Phase 2 — Credential resolver + pipeline wiring:** New `credential-resolver.ts`, refactor `buildDefaultPublishDeps()` to DB-first/env-fallback, integration tests.
- **Phase 3 — Admin API routes:** `GET/PUT/DELETE /api/admin/social-credentials/:platform` with `requireAdmin` middleware + zod validation + repository.
- **Phase 4 — Frontend panel:** `<SocialCredentials>` block on SettingsPage + react-query hooks + e2e test.

Each phase ends with passing typecheck/lint/tests; phases 3 and 4 depend on 1 and 2 but can otherwise run in some parallel order.

## 8. Acceptance criteria (preview — SPEC will formalize)

- Admin can save LinkedIn creds via `/admin/settings`; the next pipeline run uses them.
- Admin can save Twitter OAuth1 creds via `/admin/settings`; the next pipeline run uses them.
- DB row contents are encrypted; raw secrets do not appear in `pg_dump`.
- `GET /api/admin/social-credentials` never returns secret values.
- Unauthenticated `GET/PUT/DELETE` to those routes returns 401.
- An operator who never opens the UI continues to read creds from `.env` (no regression).
- Toggling `linkedinEnabled=false` skips the notifier even if creds are configured.
- Saving creds while disabled is permitted and stores them for later.
