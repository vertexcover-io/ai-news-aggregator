# Functional verification — admin-social-config

**Verdict:** PASSED

**Date:** 2026-05-19
**Spec:** docs/spec/admin-social-config/spec.md
**Method:** Test-suite review + adversarial in-process probes against the built modules.

The feature is: an admin manages LinkedIn & Twitter API credentials via `/admin/settings`; secrets are encrypted at rest in `social_credentials`; the pipeline picks up new credentials on the next job without a restart.

---

## Test command summary

```
pnpm --filter @newsletter/shared exec vitest run tests/unit/credential-cipher.test.ts
  → 1 file, 6 tests passed (236ms)

cd packages/api && pnpm exec vitest run --project unit
  → 37 files, 446 tests passed (5.28s)

cd packages/pipeline && pnpm exec vitest run --project unit
  → 65 files, 682 tests passed (18.26s)
```

All tests passed with exit 0. No `@ts-ignore`/`eslint-disable` introduced.

---

## Per-scenario evidence

### VS-0 — Cipher round-trip + tamper — PASS

Covered by `packages/shared/tests/unit/credential-cipher.test.ts` (6 tests passed) AND verified live via `/tmp/adv-cipher.mjs` against the built dist module:

```
ROUNDTRIP { ctLen: 151, tagLen: 16, ivLen: 12, ok: true }
TAMPER-CT THROWS: Unsupported state or unable to authenticate data
TAMPER-TAG THROWS: Unsupported state or unable to authenticate data
NO-SECRET THROWS: SESSION_SECRET is required for credential encryption but is not set in the environment.
SHORT THROWS: SESSION_SECRET must be at least 32 bytes for credential encryption.
CROSS-KEK THROWS: Unsupported state or unable to authenticate data
```

Matches the spec REQ-002, REQ-003 invariants and the live probe in `docs/spec/admin-social-config/probes/usage.live.log`.

### VS-1 — Migration applies cleanly — PASS

Migration file `packages/shared/src/db/migrations/0024_dark_absorbing_man.sql` plus journal entry committed.
Schema columns asserted via the repo round-trip test (`packages/pipeline/tests/unit/repositories/social-credentials.test.ts`) which runs the actual SQL against a Drizzle-managed test DB.

### VS-2 — Repository round-trip + ciphertext-at-rest — PASS

Covered by `packages/pipeline/tests/unit/repositories/social-credentials.test.ts` (included in pipeline 682 passing). The test:
- Upserts a LinkedIn row with `clientId='abc'`, `clientSecret='xyz'`
- Reads back via `get()` and asserts decrypted values match
- Queries the raw row via SQL and asserts `encrypted_fields.clientId.ct !== 'abc'`

### VS-3 / VS-4 / VS-5 — Resolver DB-beats-env / env fallback / null — PASS

Covered by `packages/pipeline/tests/unit/services/credential-resolver.test.ts` (in 682-pass set).

### VS-6 — API unauthenticated → 401 — PASS

Covered by `packages/api/tests/unit/routes/route-gating.test.ts` (admin-social-credentials routes added) — confirmed 401 for GET/PUT/DELETE without `admin_session` cookie.

### VS-7 — API GET hides secrets — PASS

Covered by `packages/api/src/routes/__tests__/admin-social-credentials.test.ts` plus live adversarial probe:

```
=== A3: GET after LinkedIn save ===
{ status: 200, body: '{"linkedin":{"configured":true,"apiVersion":"202511","updatedAt":"..."},"twitter":{"configured":false,"updatedAt":null}}' }
LEAK? false

=== A9: Twitter PUT + GET leak check ===
TW LEAK? false
```

`grep` against the response body for all PII secret tokens returned `false` for both LinkedIn and Twitter cases. No `ct`/`iv`/`tag`/plaintext appear in any GET response.

### VS-8 — API PUT validates — PASS

```
=== A5: PUT empty clientSecret ===
{ status: 400, body: '...too_small: expected string to have >=1 characters...path:["clientSecret"]...' }

=== A6: PUT missing fields ===
{ status: 400, body: '...invalid_type: expected string, received undefined...' }
```

### VS-9 — API PUT round-trip (encryption at rest) — PASS

Repo unit test + `__tests__/admin-social-credentials.test.ts` round-trip; ciphertext stored as `EncryptedBlob {ct, iv, tag}` per row.

### VS-10 — API DELETE — PASS

```
=== A7: DELETE linkedin then again ===
{ status: 200, body: '{"ok":true,"removed":true}' }
{ status: 200, body: '{"ok":true,"removed":false}' }

=== A8: GET after delete ===
{ status: 200, body: '{"linkedin":{"configured":false,...},"twitter":{"configured":false,...}}' }
```

### VS-11 — Frontend Playwright e2e — UNTESTABLE in this gate

A spec file exists at `packages/web/tests/e2e/admin-social-credentials.spec.ts` and will run under `pnpm test:e2e` when the API + Vite + DB infra is up. Playwright runs are not exercised in this functional-verification stage; they belong to QG Check 3 (`pnpm test:e2e`) which is reported separately. **Not silently skipped:** the spec file is committed and the Playwright suite is wired to QG.

### VS-12 — No regression — PASS

All 65 pipeline unit-test files (682 tests) pass unchanged, including the social notifier suites (`tests/unit/social/**`).

---

## Final verdict

**PASSED.** All required verification scenarios are either covered by passing unit/integration tests (VS-0 through VS-10, VS-12) or staged for the QG e2e run (VS-11). Adversarial probes against cipher tamper, secret leakage, path injection, validation bypass, KEK drift, and trim-handling all produce the expected behaviour.

Proof artefacts:
- This file
- `docs/spec/admin-social-config/verification/adversarial-findings.md`
- `docs/spec/admin-social-config/probes/usage.live.log` (committed during library probe)
