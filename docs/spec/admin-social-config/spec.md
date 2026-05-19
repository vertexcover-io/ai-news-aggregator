# SPEC — admin-social-config

**Linear ref:** (add when ticket created)
**Design:** docs/plans/2026-05-19-admin-social-config-design.md
**Library probe:** docs/spec/admin-social-config/library-probe.md

---

## Functional requirements (EARS)

### REQ-001 — Schema
WHEN a fresh DB migration is applied, the schema SHALL include a `social_credentials` table keyed by `platform ∈ {linkedin, twitter}` storing JSONB `encrypted_fields`, optional JSONB `metadata`, `updated_at`, `updated_by`.

### REQ-002 — Cipher service
WHEN `credentialCipher.encrypt(plaintext)` is called with a non-empty string, it SHALL return an `EncryptedBlob = { ct: base64, iv: base64, tag: base64 }`. WHEN `credentialCipher.decrypt(blob)` is called with that blob, it SHALL return the original plaintext. WHEN the same is called with any byte of `ct` or `tag` modified, it SHALL throw.

### REQ-003 — KEK derivation
WHEN the cipher service initializes, it SHALL derive its 32-byte key via `crypto.hkdfSync('sha256', SESSION_SECRET, 'social-creds-v1', '', 32)`. WHEN `SESSION_SECRET` is missing or shorter than 32 bytes, the service SHALL throw a clear configuration error at first use (not at import — to keep test bootstrapping flexible).

### REQ-004 — Repository
WHEN `socialCredentialsRepo.upsert(platform, fields, metadata)` is called, it SHALL replace the existing row (no partial update). WHEN `socialCredentialsRepo.get(platform)` is called and the row exists, it SHALL return the decrypted fields plus metadata + updatedAt. WHEN the row does not exist, it SHALL return null. WHEN `socialCredentialsRepo.delete(platform)` is called, it SHALL remove the row and return true; if no row existed, it SHALL return false.

### REQ-005 — Credential resolver (pipeline)
WHEN `resolveLinkedInCredentials()` is called, it SHALL first attempt to load from `social_credentials` (decrypting on the fly). WHEN no DB row exists, it SHALL fall back to env vars `LINKEDIN_CLIENT_ID` + `LINKEDIN_CLIENT_SECRET` + `LINKEDIN_API_VERSION`. WHEN neither source yields complete credentials, it SHALL return `null`. The same WHEN/WHEN/WHEN logic SHALL apply to `resolveTwitterOAuth1Credentials()` against the 4 OAuth1 env vars.

### REQ-006 — Pipeline integration
WHEN a pipeline run dispatches social notifiers, it SHALL call the resolvers (not read `process.env` directly at module load). WHEN a platform's resolver returns `null`, the corresponding notifier SHALL be `null` and the platform SHALL be silently skipped (preserving existing behavior). WHEN a notifier exists but the platform's enable toggle (`linkedinEnabled` / `twitterPostEnabled`) is `false`, the platform SHALL be skipped (existing behavior, unchanged).

### REQ-007 — API: read
WHEN `GET /api/admin/social-credentials` is called by an authenticated admin, it SHALL return `{ linkedin: { configured: boolean, apiVersion?: string|null, updatedAt: string|null }, twitter: { configured: boolean, updatedAt: string|null } }`. The response SHALL NEVER contain plaintext, ciphertext, IV, or auth-tag values. WHEN called without a valid admin session, it SHALL return 401.

### REQ-008 — API: write
WHEN `PUT /api/admin/social-credentials/linkedin` is called by an authenticated admin with `{ clientId: string, clientSecret: string, apiVersion?: string }`, all string fields SHALL be non-empty after trim; otherwise the API SHALL return 400 with a zod error. On success it SHALL upsert the row and return `{ ok: true, configured: true, updatedAt }`. WHEN `PUT /api/admin/social-credentials/twitter` is called with `{ apiKey, apiSecret, accessToken, accessTokenSecret }` (all non-empty after trim), it SHALL upsert and return the same shape. WHEN called without a valid admin session, it SHALL return 401.

### REQ-009 — API: delete
WHEN `DELETE /api/admin/social-credentials/:platform` is called by an authenticated admin, it SHALL remove the row (if any) and return `{ ok: true, removed: boolean }`. WHEN called without a valid admin session, it SHALL return 401.

### REQ-010 — Frontend
WHEN an admin navigates to `/admin/settings`, the page SHALL render a "Social Credentials" panel with two independent forms (LinkedIn, Twitter). Each form SHALL show "Configured" / "Not configured" status from `GET /api/admin/social-credentials`. WHEN the admin submits LinkedIn credentials, the page SHALL `PUT /api/admin/social-credentials/linkedin` with the entered values and invalidate the query on success. The same SHALL apply to Twitter independently. Fields SHALL be rendered as `type="password"` and SHALL NOT be pre-populated with decrypted values.

### REQ-011 — No regression
WHEN no DB row exists for a platform and `.env` continues to provide valid credentials, the pipeline behavior SHALL be byte-identical to current master (verified by existing notifier tests passing unchanged).

---

## Edge cases

- **Empty/whitespace-only input** → 400 from API; never reaches the cipher.
- **Cipher decrypt fails (e.g. SESSION_SECRET rotated):** resolver SHALL log a clear error and return `null`. The corresponding platform SHALL be skipped for that run; the pipeline run SHALL NOT fail. The next attempt to view the admin page SHALL show "Configured" but a save-required banner is *out of scope* for this PR (operator must DELETE + re-enter).
- **Schema drift** (e.g. an existing manually-inserted row with malformed JSON): resolver SHALL log and return `null` rather than throw.
- **Concurrent PUTs:** last-write-wins via standard Postgres upsert semantics. No optimistic locking.
- **PUT during a running job:** the in-flight job already has its resolved deps in memory; the next job picks up the new credentials.

---

## Verification scenarios (VS-N — fold of library probe + design)

### VS-0 — Cipher round-trip (from library probe)
Run unit test that:
1. Derives KEK via `hkdfSync('sha256', testSecret, 'social-creds-v1', '', 32)`.
2. Encrypts a 151-byte plaintext, asserts `ctLen=151`, `tagLen=16`, `ivLen=12`.
3. Decrypts and asserts equality.
4. Flips byte 0 of ct → `decrypt()` throws.

(Mirrors the live probe in `docs/spec/admin-social-config/probes/usage.live.log`.)

### VS-1 — Migration applies cleanly
Drop+recreate test DB, run `pnpm --filter @newsletter/shared db:migrate`, assert `social_credentials` table exists with the expected columns and primary key.

### VS-2 — Repository round-trip
Upsert a LinkedIn creds row (clientId='abc', clientSecret='xyz', apiVersion='202511'), `get()` it, assert decrypted fields match and `metadata.apiVersion === '202511'`. Inspect the row directly via SQL and assert `encrypted_fields.clientId.ct !== 'abc'` (i.e. actually encrypted at rest).

### VS-3 — Resolver: DB beats env
With both DB row and env vars set to **different** values, resolver returns the DB values. Repeat for both platforms.

### VS-4 — Resolver: env fallback
With no DB row but env vars set, resolver returns env values. Repeat for both platforms.

### VS-5 — Resolver: neither source → null
With no DB row and env vars unset, resolver returns null. Pipeline notifier construction yields `null` for that platform.

### VS-6 — API: unauthenticated → 401
`GET/PUT/DELETE /api/admin/social-credentials/*` without `admin_session` cookie → 401.

### VS-7 — API: GET hides secrets
With LinkedIn creds saved, `GET /api/admin/social-credentials` response is `{ linkedin: { configured: true, apiVersion: '202511', updatedAt: <ISO> }, twitter: { configured: false, updatedAt: null } }`. Response body, when stringified, SHALL NOT contain the plaintext clientId or clientSecret characters.

### VS-8 — API: PUT validates
`PUT /api/admin/social-credentials/linkedin` with `clientSecret=''` → 400 zod error.

### VS-9 — API: PUT round-trip
PUT valid LinkedIn body → 200, row exists in DB, subsequent GET shows `configured: true`.

### VS-10 — API: DELETE
PUT then DELETE → 200 `{ ok: true, removed: true }`. Subsequent GET shows `configured: false`. DELETE again → `{ ok: true, removed: false }`.

### VS-11 — Frontend e2e (Playwright)
- Login as admin
- Navigate to `/admin/settings`
- Social Credentials panel renders both LinkedIn and Twitter sections with "Not configured"
- Fill LinkedIn form (clientId, clientSecret, apiVersion=202511) → click Save → success toast + status flips to "Configured"
- Reload page → LinkedIn still shows "Configured", form fields empty (never pre-populated)
- Fill Twitter form (4 fields) → Save → status flips to "Configured"
- Click Clear on LinkedIn → confirmation → status flips back to "Not configured"

### VS-12 — No regression
The existing pipeline notifier unit tests pass unchanged.

---

## Out of scope

- OAuth user-token storage in `social_tokens` (unchanged).
- `SESSION_SECRET` rotation flow (documented as: operator deletes & re-enters).
- Bluesky / Mastodon / other platforms.
- Audit log of credential edits.
- Field-by-field secret rotation (always replace all fields per platform).

---

## Verification matrix

| Scenario | Test type | File |
|---|---|---|
| VS-0 | unit | `packages/shared/src/services/__tests__/credential-cipher.test.ts` |
| VS-1 | unit/integration | migration test or smoke |
| VS-2 | unit | `packages/shared/src/repositories/__tests__/social-credentials.test.ts` or in shared `tests/` |
| VS-3 / VS-4 / VS-5 | unit | `packages/pipeline/tests/unit/services/credential-resolver.test.ts` |
| VS-6 / VS-7 / VS-8 / VS-9 / VS-10 | API integration | `packages/api/src/routes/__tests__/admin-social-credentials.test.ts` |
| VS-11 | e2e Playwright | `packages/web/tests/e2e/admin-social-credentials.spec.ts` |
| VS-12 | unit (existing) | `packages/pipeline/tests/unit/social/**` |
