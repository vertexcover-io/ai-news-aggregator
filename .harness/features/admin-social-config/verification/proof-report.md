# Functional verification — admin-social-config (iteration 1)

**Verdict:** **PASSED**

**Date:** 2026-05-19 (iteration 1, post-fix)
**Iteration history:**
- Iteration 0 (`proof-report.iter0.md`): BLOCKED on D1 + D2 + D3.
- Iteration 1 (this report): all three defects fixed and re-verified live; happy paths preserved.

**Method:** Live infrastructure (Postgres + Redis containers + Hono API :3000 + Vite :5173) + live admin login + targeted re-attack of the three iter-0 defects + happy-path regression checks. Iter-0 already produced 5 Playwright screenshots and 12 happy-path API scenarios; this iteration re-validates the fixes without re-shooting the unchanged UI evidence (cited from iter-0 artifacts).

---

## Changes since iter-0

| File | Change |
|---|---|
| `packages/pipeline/src/services/credential-resolver.ts` | Wraps `repo.getLinkedIn()` / `repo.getTwitter()` in `safeGetDbRow()` that try/catches, logs at `error` level with `event: credential.resolver.db_read_failed`, and returns a discriminated union so a *decrypt failure on a present row* returns null without falling through to env. |
| `packages/api/src/repositories/social-credentials.ts` | `upsertLinkedIn` and `upsertTwitter` now set `updatedBy: "admin"` on insert AND on conflict-update. |
| `packages/pipeline/tests/unit/services/credential-resolver.test.ts` | 4 new tests covering the two failure cases for both platforms. Pipeline test suite goes 682 → 686 (all pass). |

## Defect re-tests (live)

### D1 — Resolver no longer throws on malformed JSON row
**Spec contract:** `spec.md ## Edge cases`: *"Schema drift (malformed JSON): resolver SHALL log and return null rather than throw."*

**Probe:** `verification/api/D1-schema-drift-fixed.txt`. Manually INSERT `encrypted_fields = {"clientId":"not-a-blob"}` then run the live resolver via `tsx`.

**Output:**
```
{"level":50,"name":"service:credential-resolver","event":"credential.resolver.db_read_failed","platform":"linkedin","err":"The first argument must be of type string or an instance of Buffer, ArrayBuffer, or Array or an Array-like Object. Received undefined","msg":"credential resolver: DB row unreadable (rotated SESSION_SECRET / schema drift); platform will be skipped for this run"}
OK: null
```

**Verdict:** MET. Logs at error level (50) with platform + reason; returns null. Pipeline run would proceed and skip LinkedIn instead of crashing.

---

### D2 — Resolver no longer throws on SESSION_SECRET rotation
**Spec contract:** `spec.md ## Edge cases`: *"Cipher decrypt fails (e.g. SESSION_SECRET rotated): resolver SHALL log a clear error and return null. The corresponding platform SHALL be skipped for that run; the pipeline run SHALL NOT fail."*

**Probe:** `verification/api/D2-rotation-fixed.txt`. PUT a row encrypted under the .env secret, then invoke the resolver with `SESSION_SECRET=DIFFERENT-secret-32-bytes-min-length-...`.

**Output:**
```
{"level":50,"name":"service:credential-resolver","event":"credential.resolver.db_read_failed","platform":"linkedin","err":"Unsupported state or unable to authenticate data","msg":"credential resolver: DB row unreadable (rotated SESSION_SECRET / schema drift); platform will be skipped for this run"}
OK: null
```

**Verdict:** MET. Same code path as D1.

---

### D3 — `updated_by` populated with `'admin'` on every write
**Design contract:** design `§4.1`: *"`updated_by` — `'admin'` — placeholder for future multi-user."*

**Probe:** `verification/api/D3-updated-by-fixed.txt`. After live PUT via admin API:
```
 platform | updated_by
----------+------------
 linkedin | admin
(1 row)
```

**Verdict:** MET. Audit trail populated; minor design contract honored.

## Regression checks

| Check | iter-0 | iter-1 | Evidence |
|---|---|---|---|
| VS-6 — unauth → 401 | PASS | PASS | `verification/api/regression-sanity.txt` |
| VS-7 — GET hides secrets | PASS | PASS | secret `regress-CLIENTID` not in response body |
| VS-3 — DB beats env | PASS | PASS | resolver returned `regress-CLIENTID`, not env value |
| Pipeline unit suite | 682 pass | 686 pass | `pnpm --filter @newsletter/pipeline test:unit` |
| API unit suite | 446 pass | 446 pass | `pnpm --filter @newsletter/api test:unit` |
| typecheck | green | green | `pnpm typecheck` 7/7 |
| lint | 0 errors / 9 warnings | 0 errors / 9 warnings | `pnpm lint` |

## VS coverage (unchanged from iter-0 except where re-verified)

| VS | iter-0 | iter-1 | Notes |
|----|--------|--------|-------|
| VS-0 cipher round-trip | PASS (cited) | PASS (cited) | unit test |
| VS-1 migration | PASS (live) | PASS (live) | already applied |
| VS-2 repo round-trip | PASS (live) | PASS (live) | |
| VS-3 DB beats env | PASS (cited) | **PASS (live, this iter)** | regression-sanity.txt |
| VS-4 env fallback | PASS (cited) | PASS (cited) | unit |
| VS-5 both empty → null | PASS (cited) | PASS (cited) | unit |
| VS-6 unauth → 401 | PASS (live) | **PASS (live, this iter)** | regression-sanity.txt |
| VS-7 GET hides secrets | PASS (live) | **PASS (live, this iter)** | regression-sanity.txt |
| VS-8 PUT validates | PASS (live) | PASS (cited from iter-0) | |
| VS-9 PUT round-trip + encryption at rest | PASS (live) | PASS (cited from iter-0; same code path) | |
| VS-10 DELETE | PASS (live) | PASS (cited from iter-0) | |
| VS-11 frontend e2e | PASS (live, 5 screenshots) | PASS (live, panel re-rendered post-fix in `screenshots/01-panel-post-fix.png`; iter-0 happy-path captures retained as `*.iter0.png`) | |
| VS-12 no regression | PASS (cited) | PASS — 686 pipeline + 446 api tests pass | |

## Edge-case coverage (the part that flipped)

| Edge case | iter-0 | iter-1 |
|-----------|--------|--------|
| Empty/whitespace input → 400 | MET | MET |
| **Cipher decrypt failure (rotation) → log + null** | **UNMET (D2)** | **MET** |
| **Schema drift (malformed JSON) → log + null** | **UNMET (D1)** | **MET** |
| Concurrent PUTs → last-write-wins | MET | MET (no code change) |
| PUT during a running job → in-memory deps | MET (structural) | MET (structural) |

## Not executed

- Very large payload (≥ 1 MB body) — still blocked by shell argv. Out of gate scope.
- End-to-end BullMQ `linkedin-post` job against a poisoned row — the resolver fix is verified live, the BullMQ wiring is verified by unit test, but the combined live pipeline-job + poisoned-row scenario has not been exercised. Out of gate scope.

## Recommendation

**Ship.** All three iter-0 defects are fixed against the spec's literal wording, regression checks pass, no new defects were surfaced. The commit on top of the current branch:

- 1 file change in `credential-resolver.ts` (try/catch + logger)
- 1 file change in `api/repositories/social-credentials.ts` (updated_by = 'admin')
- 4 new tests in `credential-resolver.test.ts`

Recommend opening a follow-up issue for "live BullMQ + poisoned-row e2e" as an additional verification scenario — useful for future regressions but not blocking.
