# Adversarial findings — admin-social-config (iteration 1, post-fix)

**Forced context break:** scenarios derived from `spec.md ## Edge cases` and the three defects identified in iteration 0 (`adversarial-findings.iter0.md`). The point of this iteration is to re-attack the three failure modes and confirm the fix.

## 1. Attack surface re-targeted

- **D1** Schema drift (malformed `encrypted_fields` JSON)
- **D2** SESSION_SECRET rotation (valid row, wrong KEK)
- **D3** `updated_by` audit-trail column populated
- **Regression check** on the happy paths that previously passed

## 2. Scenarios attempted

| ID | Category | Description | Inputs | iter-0 verdict | iter-1 verdict |
|----|----------|-------------|--------|---------|---------|
| A1 | schema drift | INSERT row with `encrypted_fields = {"clientId":"not-a-blob"}` then call resolver | manually-poisoned DB row | **DEFECT** | **EXPECTED (FIXED)** — resolver logs `event:credential.resolver.db_read_failed` at error level and returns null. Verified live in `verification/api/D1-schema-drift-fixed.txt`. |
| A2 | crypto rotation | SESSION_SECRET=`DIFFERENT-...` while row encrypted under .env secret | rotated KEK | **DEFECT** | **EXPECTED (FIXED)** — same code path as A1; logs and returns null. Verified live in `verification/api/D2-rotation-fixed.txt`. |
| A12 | audit trail | After live PUT through admin API, `SELECT updated_by FROM social_credentials` | n/a | **DEFECT (minor)** NULL | **EXPECTED (FIXED)** — column populated with `'admin'`. Verified live in `verification/api/D3-updated-by-fixed.txt`. |
| R1 | regression: GET hides secrets | PUT linkedin with known secrets, then GET | n/a | EXPECTED | EXPECTED — `verification/api/regression-sanity.txt` |
| R2 | regression: unauth → 401 | curl GET without cookie | n/a | EXPECTED | EXPECTED |
| R3 | regression: resolver DB beats env | DB row present + LINKEDIN_* env set to different values | n/a | EXPECTED | EXPECTED — resolver returned DB values (`regress-CLIENTID`) not env. |

## 3. Defects

**None.** All three iter-0 defects (D1, D2, D3) have been re-tested in the same way they originally failed and now produce the spec-required behavior.

## 4. Cannot assess

- **PUT during a running pipeline job** — still out of gate scope; structurally covered by the per-job resolution unit test.
- **Very large payload (≥ 1 MB body)** — still blocked by shell argv; needs a separate test harness. Not a verification result either way.

## 5. Honest declaration

**No defects found across 6 scenarios attempted (3 defect re-tests + 3 regression checks).** Categories exercised: schema drift, crypto rotation, audit trail, secret leakage, auth boundary, resolver order.

The most promising attack was the one the spec said should be handled — schema-drift / rotation. I deliberately replayed the same poisoned-row insert and SESSION_SECRET swap that broke iter-0 because *those* were the spec violations; the fix is concentrated in `credential-resolver.ts::safeGetDbRow()` (try/catch around `repo.get*`, log+null on error, do NOT fall through to env on a decrypt failure). I considered whether falling through to env *would* be desirable (could mask a rotation), but the spec explicitly says "platform SHALL be skipped" — so the fix follows the spec literally. Confirmed by inspecting the live log line: it includes `platform: "linkedin"` and the underlying error message, matching the spec wording "log a clear error".

I did not invent new categories this round — the contract was to re-attack the exact failures from iter-0 and verify the fix. Categories worth running again in a future iteration: very-large payloads (need scripted body), and an end-to-end pipeline-job exercise that fires `linkedin-post` against the poisoned row and asserts the BullMQ job completes successfully with the platform skipped (today we verified at the resolver level; the BullMQ wiring is structurally guaranteed but not exercised live).
