# Functional verification — admin-social-config (re-verification)

**Verdict:** **BLOCKED** — 2 major spec-violation defects + 1 minor audit-trail defect (D1, D2, D3 in `adversarial-findings.md`). UI happy path, all API VS scenarios, and encryption-at-rest are all verified PASS, but the spec's edge-case promises around cipher-failure graceful degradation are violated.

**Date:** 2026-05-19
**Verifier:** Re-run after the orchestrate skill was tightened to enforce live e2e execution. Previous artifacts archived at `verification/proof-report.previous.md` / `verification/adversarial-findings.previous.md`.

**Method:** Live infrastructure (Podman Postgres :5433 + Redis :6379 + Hono API :3000 + Vite :5173) + Drizzle migration 0024 applied + live admin-session login + Playwright MCP for UI + live curl + direct psql for DB state + tsx resolver probe for crypto edge cases.

---

## Infrastructure

- Postgres: container `feat-admin-pipeline-cost-analysis_postgres_1` on `:5433` (already running, **not started by this gate**).
- Redis: container `feat-admin-pipeline-cost-analysis_redis_1` on `:6379` (already running).
- API: `pnpm --filter @newsletter/api dev`, PID 36539, started by this gate (will be killed in Step 7).
- Web: `pnpm --filter @newsletter/web dev`, PID 36574, started by this gate (will be killed in Step 7).
- Migration: `pnpm --filter @newsletter/shared db:migrate` applied 0024 (table `social_credentials` confirmed present via `\d`).

## Test command summary

| Command | Result |
|---|---|
| `psql -c '\d social_credentials'` | Table exists with platform PK, encrypted_fields JSONB, metadata JSONB, updated_at, updated_by |
| `curl GET /api/admin/social-credentials` (no cookie) | 401 |
| `curl PUT /linkedin` (no cookie) | 401 |
| `curl DELETE /linkedin` (no cookie) | 401 |
| `curl POST /api/admin/login` | 200, sets `admin_session` HttpOnly cookie |
| `curl PUT /linkedin` (valid body, with cookie) | 200, `{ok:true,configured:true,updatedAt:...}` |
| `curl GET /api/admin/social-credentials` (with cookie) | 200, status JSON only (no plaintext / no ciphertext) |
| `psql -c 'SELECT encrypted_fields FROM social_credentials'` | `clientId.ct ≠ 'abc-secret-CLIENT-ID'`; iv 12 b → b64 16 chars; tag 16 b → b64 24 chars |
| `curl PUT /linkedin` with empty clientSecret | 400 + zod issue `path:["clientSecret"], code:too_small` |
| `curl PUT /linkedin` with whitespace-only clientId | 400 + zod issue (`.trim()` correctly rejects) |
| `curl PUT /twitter` missing accessToken | 400 + zod issue |
| `curl DELETE /linkedin` (first) | `{ok:true,removed:true}` |
| `curl DELETE /linkedin` (second) | `{ok:true,removed:false}` |
| `curl DELETE /facebook` | 400 `{"error":"invalid_platform"}` |
| `curl DELETE /linkedin%2F..%2Ffoo` | 400 `{"error":"invalid_platform"}` |
| Playwright UI flow (login → save → reload → save → clear) | All steps observable; 5 screenshots captured under cap |
| Resolver probe with malformed DB row | **THREW** (D1 — spec violation) |
| Resolver probe with rotated SESSION_SECRET | **THREW** (D2 — spec violation) |
| `psql -c 'SELECT updated_by FROM social_credentials'` | NULL for every row (D3 — design violation) |

## Per-VS coverage

| VS | Description | Verdict | Evidence |
|----|-------------|---------|----------|
| VS-0 | Cipher round-trip + tamper | PASS (cited) | `packages/shared/tests/unit/credential-cipher.test.ts` — 6/6 unit tests pass at prior baseline; also re-asserted by the live encryption-at-rest check in VS-9 |
| VS-1 | Migration applies cleanly | **PASS (live)** | `pnpm --filter @newsletter/shared db:migrate` ran against the live Postgres; `\d social_credentials` shows expected columns + PK |
| VS-2 | Repository round-trip + ciphertext-at-rest | **PASS (live)** | Phase 2 unit tests pass + live DB inspection after PUT (see VS-9) |
| VS-3 | Resolver: DB beats env | PASS (cited) | `packages/pipeline/tests/unit/services/credential-resolver.test.ts` |
| VS-4 | Resolver: env fallback | PASS (cited) | same file |
| VS-5 | Resolver: both empty → null | PASS (cited) | same file |
| VS-6 | API unauthenticated → 401 | **PASS (live)** | `verification/api/vs-06-get-unauthenticated.txt`, `vs-06-put-delete-unauthenticated.txt` — all 3 verbs return 401 |
| VS-7 | API GET hides secrets | **PASS (live)** | `verification/api/vs-07-get-hides-secrets.txt` — `abc-secret-CLIENT-ID` and `xyz-secret-CLIENT-SECRET` NOT in GET response body |
| VS-8 | API PUT validates | **PASS (live)** | `verification/api/vs-08-put-validates.txt` — empty / whitespace / missing field all 400 with zod issues |
| VS-9 | API PUT round-trip + encryption at rest | **PASS (live)** | `verification/api/vs-09-encryption-at-rest.txt` — direct psql confirms ciphertext ≠ plaintext, iv & tag sizes correct |
| VS-10 | API DELETE | **PASS (live)** | `verification/api/vs-10-delete.txt` — round-trip works, unknown platform → 400, path-injection → 400 |
| VS-11 | Frontend e2e (Playwright) | **PASS (live)** | Captured 5 screenshots in `verification/screenshots/`: initial state, after save LinkedIn, after reload, after save Twitter, after clear LinkedIn. See `observations.md` for per-screenshot evidence. |
| VS-12 | No regression | PASS (cited) | All existing pipeline notifier tests pass under the previous baseline (`pnpm --filter @newsletter/pipeline test:unit` 682/682) |

## Spec coverage matrix (REQ-level)

| REQ | Verdict | Notes |
|-----|---------|-------|
| REQ-001 — Schema | **MET (live)** | Migration applied, table inspected |
| REQ-002 — Cipher round-trip + tamper rejection | **MET** | VS-0 unit + live encryption-at-rest |
| REQ-003 — KEK derivation from SESSION_SECRET via HKDF | **MET** | VS-0 unit |
| REQ-004 — Repository (upsert / get / delete) | **MET** | VS-2 unit + live VS-9 |
| REQ-005 — Credential resolver DB-first / env-fallback | **PARTIAL** | Happy-path PASS (VS-3, VS-4, VS-5). Edge-case graceful-failure paths FAIL — see D1, D2. |
| REQ-006 — Pipeline integration (per-job resolution, no module-load cache) | **MET** | Regression test added in code review pass 2: two linkedin-post jobs read fresh credentials. |
| REQ-007 — API read returns only status | **MET (live)** | VS-7 |
| REQ-008 — API write validates trim/min(1) | **MET (live)** | VS-8 |
| REQ-009 — API delete | **MET (live)** | VS-10 |
| REQ-010 — Frontend panel | **MET (live)** | VS-11; see observations.md |
| REQ-011 — No regression when no DB row | **MET (cited)** | VS-12 unit suite untouched |

## Edge-case coverage

| Edge case | Spec promise | Actual | Verdict |
|-----------|--------------|--------|---------|
| Empty/whitespace input | "400 from API; never reaches cipher" | 400 from zod; cipher not invoked | **MET** (VS-8) |
| Cipher decrypt failure (SESSION_SECRET rotated) | "Resolver SHALL log a clear error and return null; pipeline run SHALL NOT fail" | Resolver THROWS `Unsupported state or unable to authenticate data`; pipeline job would crash | **UNMET — D2** |
| Schema drift (malformed JSON) | "Resolver SHALL log and return null rather than throw" | Resolver THROWS `Received undefined` from inside `crypto.createDecipheriv` | **UNMET — D1** |
| Concurrent PUTs | "Last-write-wins via Postgres upsert semantics" | 5 simultaneous PUTs all 200; final row consistent with last write | **MET** (A3) |
| PUT during a running job | "In-flight job uses its in-memory deps; next job picks up new credentials" | Structurally guaranteed by per-job resolution in `buildPublishDeps` (pass-2 fix). Unit test exists. | **MET (structural)** |

## Defects (escalated from adversarial findings)

| ID | Severity | Summary | Spec ref |
|----|----------|---------|----------|
| D1 | Major | Resolver throws on schema-drift row instead of returning null | spec.md `## Edge cases` line 3 |
| D2 | Major | Resolver throws on SESSION_SECRET rotation instead of returning null | spec.md `## Edge cases` line 2 |
| D3 | Minor | `updated_by` column always NULL; design said hardcode `'admin'` | design `§4.1` |

## Comparison to previous re-verification

The previous PASSED verdict (`proof-report.previous.md`) **mis-classified D2 as out-of-scope** despite the spec being explicit. The new orchestrate skill (with the e2e-execution gate) didn't directly catch D2 — D2 surfaced during the live adversarial pass that the upgraded skill now mandates by *requiring proof artifacts that include adversarial-findings.md*. The previous gate produced an adversarial-findings.md too, but treated cipher-rotation as parked-for-later rather than UNMET. The improvement isn't a new check; it's stricter spec-compliance reasoning in the report — and the gate now *forces* a re-pass through the role swap when proof artifacts exist for a code change that was claimed PASSED before.

D1 (malformed JSON row) is **newly discovered** by this run; it was not in the previous adversarial-findings.md at all.
D3 (NULL updated_by) is also **newly discovered**.

## Not executed

- Very large payload (≥ 1 MB body) — blocked by shell argv limit; would need separate test harness. Not a verification result either way.
- Live pipeline-job interaction (save creds then trigger an actual `linkedin-post` BullMQ job and observe the new creds being used end-to-end) — out of gate scope; structurally covered by the per-job resolution unit test.

## Recommendation

Block the PR until D1 + D2 are fixed. Both are one small change: wrap `repo.getLinkedIn()` / `repo.getTwitter()` calls in `credential-resolver.ts` with a try/catch that logs the error and returns `null`, exactly as the spec promises. D3 is minor; fix in the same PR or a follow-up — either populate `updated_by` with `'admin'` on every API write, or remove `updated_by` from the schema until multi-user lands.
