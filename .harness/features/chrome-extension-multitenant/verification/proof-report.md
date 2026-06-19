# Verification — Multi-Tenant Chrome Extension

All commands run in the `feature/extension-multitenant` worktree.

## Typecheck — PASS (9/9 packages)

```
$ pnpm typecheck
 Tasks:    9 successful, 9 total
```

## Lint — PASS (7/7 packages)

```
$ pnpm lint
 Tasks:    7 successful, 7 total
```
(Required building `@newsletter/eslint-plugin` first in the fresh worktree.)

## Unit tests — PASS

```
$ pnpm --filter @newsletter/api test:unit
 Test Files  85 passed (85)
      Tests  974 passed (974)

$ pnpm --filter @newsletter/shared exec vitest run tests/unit
 Test Files  44 passed (44)
      Tests  413 passed (413)

$ pnpm --filter @newsletter/pipeline test:unit
 Test Files  105 passed (105)
      Tests  1272 passed (1272)

$ pnpm --filter @newsletter/extension test:unit
 Test Files  2 passed (2)
      Tests  8 passed (8)
```

New tests added: `extension-token.test.ts` (4), `extension-middleware.test.ts`
(4), `user-submissions.test.ts` (5), `extension-route.test.ts` (7).

## Real-browser e2e — PASS (6/6)

Hermetic ephemeral Postgres + Redis (podman), migrations applied, extension
built against the hermetic API, Chrome-for-Testing loads the unpacked extension.

```
$ pnpm --filter @newsletter/extension test:e2e
Running 6 tests using 1 worker
  ✓ Login flow › no token → login view; wrong password → error; correct → AddView
  ✓ Tenant-stamped submission › add page → one manual row stamped with the tenant
  ✓ Per-tenant dedupe › same URL same tenant → alreadyExisted, count stays 1
  ✓ Cross-tenant isolation › a second tenant submitting the same URL gets its OWN row
  ✓ Stale token handling › invalid token → 401 → returns to login
  ✓ Deterministic extension ID › matches the manifest key
  6 passed (28.1s)
```

The **cross-tenant isolation** test is the key multi-tenant proof: tenant A and
tenant B (seeded via the signup API) submit the *same* URL; the DB ends with two
`manual` rows — one per `tenant_id` — confirming per-tenant stamping + dedupe,
not a global collision.

## Adversarial checks performed

- **Token namespace isolation, both directions** — a session cookie token does
  not verify as an extension token and vice versa (`extension-token.test.ts`).
- **Tampering** — flipped MAC digit and mutated body both rejected.
- **Expiry boundary** — accepted at `MAX_AGE-1`, rejected at `MAX_AGE+1`.
- **super_admin rejection** — `403 select_tenant`, no token issued.

## Notes / out of scope (v1)

- super_admin in-popup tenant picker (use the web app / impersonation for now).
- Pre-existing shared **e2e** schema tests (`tenancy-schema`,
  `credentials-rekey-migration`) require `DATABASE_URL` and are env-gated — not
  affected by this change.
