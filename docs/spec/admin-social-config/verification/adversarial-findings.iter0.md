# Adversarial findings — admin-social-config (re-verification 2026-05-19)

**Forced context break:** scenarios derived ONLY from `spec.md` and direct attack reasoning. `e2e-report.json` absent. **Did NOT re-read** `screenshots/observations.md` or the previous draft proof report before generating attacks.

## 1. Attack surface derived

Sources: spec.md `## Edge cases` + spec.md verification scenarios + general adversarial categories.

- **Cipher decrypt failures** (`gaps[]` ≈ spec edge case): SESSION_SECRET rotation, malformed `encrypted_fields` JSON, missing key fields.
- **Concurrent writes** (spec edge case): N parallel PUTs to the same platform.
- **Authentication boundaries**: tampered cookie HMAC, expired timestamp, missing cookie, valid cookie but path-traversal in `:platform`.
- **HTTP method confusion**: PATCH, OPTIONS, HEAD on the documented endpoints.
- **Content-type confusion**: PUT with `text/plain`.
- **Boundary inputs**: unicode/emoji in stored fields, embedded `<script>` / `<img onerror>` in stored fields, prototype-pollution payload (`__proto__`, `isAdmin`).
- **Audit trail / data shape**: `updated_by` column from design contract vs implementation.
- **Method-coverage gaps**: HEAD behavior (Hono default), zod stripping of unknown keys.

## 2. Scenarios attempted

| ID  | Category | Description | Inputs | Verdict |
|-----|----------|-------------|--------|---------|
| A1  | schema drift | INSERT a row directly via psql with `encrypted_fields = {"clientId":"not-a-blob"}` (missing iv/tag/ct), then resolver invoked | manually-poisoned DB row | **DEFECT** |
| A2  | crypto rotation | Set `SESSION_SECRET` to a different 32-byte string, then call resolver against a row encrypted under the old secret | rotated KEK | **DEFECT** |
| A3  | concurrency | 5 simultaneous PUTs to `/api/admin/social-credentials/linkedin` with different apiVersion values | 5x curl & wait | EXPECTED (all 200, last-write-wins, final row consistent, apiVersion="2") |
| A4a | method confusion | `PATCH /api/admin/social-credentials` | n/a | EXPECTED (404) |
| A4b | method confusion | `OPTIONS /api/admin/social-credentials` | n/a | EXPECTED (404) |
| A4c | method confusion | `HEAD /api/admin/social-credentials` | n/a | EXPECTED (200, Hono default; no body) |
| A5  | content-type | PUT with `Content-Type: text/plain` + form-encoded body | `clientId=a&clientSecret=b` | EXPECTED (400 invalid body) |
| A6  | large payload | PUT with ~1 MB clientId+clientSecret | base64 random | CANNOT_ASSESS (shell argv limit; not the API's fault) |
| A7  | injection | PUT with `🔑<script>alert(1)</script>™` in clientId, `<img src=x onerror=alert(1)>` in clientSecret, `v🚀` in apiVersion | unicode + HTML/JS | EXPECTED (stored as-is; UI renders via React text node, no script execution, `innerHTML` shows escaped text) |
| A8  | cookie tampering | Replace last 6 chars of HMAC in `admin_session` cookie, send GET | forged cookie | EXPECTED (401) |
| A9  | cookie shape | `admin_session=999.invalid_signature_aaaa` | malformed cookie | EXPECTED (401) |
| A10 | path traversal | `GET /api/admin/social-credentials/../runs` | URL-level traversal | EXPECTED (404 from router) |
| A11 | prototype pollution / privilege escalation | PUT body `{"clientId":"a","clientSecret":"b","apiVersion":"x","__proto__":{"polluted":true},"isAdmin":true}` | unknown-keys payload | EXPECTED (200; zod strips extra keys; subsequent endpoints unaffected) |
| A12 | audit trail | Direct SQL: `SELECT updated_by FROM social_credentials` after multiple PUTs | n/a | **DEFECT (minor)** — column is NULL for every row |

## 3. Defects

### D1 — Resolver throws on schema-drift row (spec violation)
**Severity:** major.
**Spec contract violated:** `spec.md ## Edge cases` line 3: *"Schema drift (e.g. an existing manually-inserted row with malformed JSON): resolver SHALL log and return `null` rather than throw."*

**Reproduction:**
```bash
PGPASSWORD=newsletter psql -h localhost -p 5433 -U newsletter -d newsletter -c \
  "INSERT INTO social_credentials (platform, encrypted_fields, metadata, updated_at)
   VALUES ('linkedin', '{\"clientId\":\"not-a-blob\"}'::jsonb, '{\"apiVersion\":\"202511\"}'::jsonb, now())
   ON CONFLICT (platform) DO UPDATE SET encrypted_fields = EXCLUDED.encrypted_fields, updated_at = now();"
# Then invoke the resolver:
pnpm --filter @newsletter/pipeline exec tsx <probe>
```

**Actual:** `THREW: The first argument must be of type string or an instance of Buffer, ArrayBuffer, or Array or an Array-like Object. Received undefined` — raised from inside `crypto.createDecipheriv(..., kek, undefined)` when the malformed row lacks `iv`.

**Expected per spec:** resolver logs + returns `null`; pipeline job continues without LinkedIn.

**Evidence:** `verification/api/A1-schema-drift-resolver-throws.txt` (terminal capture).

**Severity rationale:** A pipeline run that encounters this row would crash mid-job — the entire daily newsletter run would die instead of falling back gracefully. The row could land via direct DB edit, partial migration, or operator mistake. Spec explicitly says this case must be tolerated; it isn't.

---

### D2 — Resolver throws on SESSION_SECRET rotation (spec violation)
**Severity:** major.
**Spec contract violated:** `spec.md ## Edge cases` line 2: *"Cipher decrypt fails (e.g. SESSION_SECRET rotated): resolver SHALL log a clear error and return `null`. The corresponding platform SHALL be skipped for that run; the pipeline run SHALL NOT fail."*

**Reproduction:** Encrypt a row under SESSION_SECRET `A`, then start the resolver with SESSION_SECRET `B`:
```bash
SESSION_SECRET=DIFFERENT-secret-32-bytes-min-length-aaaaaaaaaaaaaaaaaaa \
  pnpm --filter @newsletter/pipeline exec tsx <probe>
```

**Actual:** `THREW: Unsupported state or unable to authenticate data` — from `decipher.final()` rejecting the auth tag.

**Expected per spec:** resolver logs and returns `null`; pipeline continues.

**Note:** This defect was identified in the previous re-verification run (preserved as `proof-report.previous.md`) but parked as out-of-scope. The spec is explicit, and the previous "PASSED" verdict was rationalised. Strict spec-compliance reading: this is a defect.

---

### D3 — `updated_by` is NULL on every row (audit trail hole)
**Severity:** minor.
**Spec contract:** design `§4.1` says: *"`updatedBy: text("updated_by")` — "admin" — placeholder for future multi-user."* The plan-phase-1 spec table says `updated_by` should be hardcoded `'admin'`.

**Reproduction:**
```bash
PGPASSWORD=newsletter psql -h localhost -p 5433 -U newsletter -d newsletter -c \
  "SELECT platform, updated_by FROM social_credentials;"
# Output:
#  platform | updated_by
# ----------+------------
#  twitter  |
#  linkedin |
```

**Actual:** Both rows have NULL `updated_by` — the API never sets it.

**Expected per design:** column populated with `'admin'` on every write so that the audit row at least identifies the writer class (even if it's hardcoded for single-tenant MVP).

**Severity rationale:** No functional impact today (single admin); becomes blocking the moment multi-user is added. Counts as "promised-but-not-implemented" — should either fix or remove from design.

## 4. Cannot assess

- **A6** Very large payload (~1 MB JSON body) — could not be exercised through `curl -d` from the shell due to argv-size limit. Would require a separate test sending the body from a file or via Playwright's `request.post`. Hono/Node likely has a default body limit; this should be checked but is not a verification result either way.
- **PUT during a running pipeline job** (spec edge case "PUT during a running job") — no pipeline worker is currently running and starting one is outside this gate's scope. The intended behavior ("in-flight job has its resolved deps in memory; next job picks up the new credentials") is structurally guaranteed by the post-review-pass-2 fix that moved `buildPublishDeps()` to per-job resolution. Verified indirectly by the unit test `processing.test.ts > "two linkedin-post jobs read fresh credentials"`.

## 5. Honest declaration

**Defects found: 3.** See section 3.

- D1 (resolver throws on malformed JSON) — newly surfaced by adversarial pass. Not caught by the original test suite because no unit test exercises the "malformed row" path.
- D2 (resolver throws on SESSION_SECRET rotation) — surfaced by both the previous and current adversarial passes. Previous verdict marked it out-of-scope; this verdict marks it a defect because the spec is unambiguous.
- D3 (updated_by NULL) — newly surfaced by the audit-trail pass.

I genuinely tried to break this. The most promising attack was the cipher-error class because the spec explicitly promises graceful degradation in two distinct edge cases (D1 and D2), and the resolver code path I exercised (real DB row + real cipher + the actual pipeline resolver) does not contain any try/catch around either `repo.getLinkedIn()` or `repo.getTwitter()` — which makes both D1 and D2 inevitable. The fix is small (wrap the repo read + cipher decrypt in try/catch, log, return null) but it has to land before this feature can claim spec compliance.

Categories attempted: schema-drift (✓), crypto rotation (✓), concurrent writes (✓), HTTP-method confusion (✓), content-type confusion (✓), HTML/script injection (✓), unicode/emoji (✓), prototype pollution (✓), cookie tampering (✓), path traversal (✓), audit-trail audit (✓). Categories NOT attempted: very-large-payload (blocked by shell argv), live pipeline-job interaction (out of gate scope), Vite-proxy edge cases (one initial false-positive already retracted after stale cookie diagnosed).
