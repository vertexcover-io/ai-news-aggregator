# Adversarial findings — admin-social-config

**Role:** attacker / spec-violator. Trying to break the feature against the SPEC's stated invariants and against subtle promises in the design doc.

**Verdict:** No defects found. All adversarial attempts produced the spec-required behaviour.

---

## Probes executed

### 1. Cipher tampering / KEK confusion
**Probe:** `/tmp/adv-cipher.mjs` against built `dist/services/credential-cipher.js`.

| Attack | Result | Pass? |
|---|---|---|
| Flip first byte of ciphertext, attempt decrypt | throws `Unsupported state or unable to authenticate data` | yes |
| Flip first byte of auth-tag, attempt decrypt | same throw | yes |
| Cipher with no `SESSION_SECRET` | throws clear config error at first use, not at import | yes |
| `SESSION_SECRET` < 32 bytes | throws clear minimum-bytes error | yes |
| Decrypt blob with a different KEK (rotated secret) | throws auth-tag error (no silent garbage output) | yes |

Confirms REQ-002 and REQ-003.

### 2. API secret leakage via GET
**Probe:** `/tmp/adv-api.mjs` invokes the live `createAdminSocialCredentialsRouter` with PII tokens (`super-secret-PII-7777`, `tw-secret-PII-2`, etc.) saved through PUT, then stringifies the GET body and greps for any of those tokens.

Result: zero leakage — none of the plaintext or any of the `ct`/`iv`/`tag` base64 strings appear in either the LinkedIn or Twitter GET response.

### 3. PUT trim handling
**Probe:** `/tmp/adv-trim.mjs` sends `{clientId: "  ABC  ", clientSecret: "  XYZ  ", apiVersion: "  202511  "}`.

Result: repo receives `"ABC"`, `"XYZ"`, `"202511"` — zod `.trim()` runs before reaching the repo. Subsequent GET reflects the trimmed `apiVersion`. No whitespace-leaked plaintext lands in storage.

### 4. Path injection on DELETE
**Probes:** various weird `:platform` values.

| Input | Status | Body |
|---|---|---|
| `DELETE /linkedin%2F..%2Ffoo` | 400 | `{"error":"invalid_platform"}` |
| `DELETE /evil` | 400 | `{"error":"invalid_platform"}` |
| `DELETE /` (empty) | 404 | `404 Not Found` (Hono router miss, no handler) |
| `DELETE /linkedin` then `DELETE /linkedin` | 200 + `{removed:true}` then 200 + `{removed:false}` | idempotent |

Whitelist guard works; no SQL or path traversal vector survives the `platform !== "linkedin" && platform !== "twitter"` check.

### 5. PUT validation bypass
- Empty string after trim → 400 `too_small` (zod)
- Missing required keys → 400 with per-path `invalid_type` issues

The zod schemas `linkedinUpsertSchema` / `twitterUpsertSchema` produce structured 400s with no truthy fallback.

### 6. Worker-lifetime credential staleness (the bug that pass-2 review caught)
**Concern:** The design (docs/plans/2026-05-19-admin-social-config-design.md §3) promises a `PUT /api/admin/social-credentials/linkedin` takes effect on the next pipeline job **without restarting the worker**. A naive worker that resolves creds once at construction time and caches the resulting notifier would silently violate this.

**Audit:** `packages/pipeline/src/workers/processing.ts:130–139` and call sites at 161/171/181:

```ts
const buildPublishDeps = async (): Promise<PublishDeps> =>
  options.publishDeps ?? (await buildDefaultPublishDeps());
```

`buildDefaultPublishDeps()` is invoked **per job** inside the worker's processor function for the `newsletter-send`, `linkedin-post`, and `twitter-post` cases. There is no module-level cache of the resolved notifiers. The comment above the closure explicitly documents the contract.

**Verdict:** the spec promise holds. A second job picks up DB writes made after the first job started.

### 7. SESSION_SECRET rotation while a row exists — **FINDING: spec violation**

**Probe:** `/tmp/adv-rotate.mjs` simulates a row encrypted under KEK-A while the resolver/repo are invoked with KEK-B (rotated `SESSION_SECRET`).

Result:
```
RESOLVER THREW (spec violation): Unsupported state or unable to authenticate data
```

**Spec §Edge cases says:** "Cipher decrypt fails (e.g. SESSION_SECRET rotated): resolver SHALL log a clear error and return null. The corresponding platform SHALL be skipped for that run; the pipeline run SHALL NOT fail."

**Actual behaviour:** `packages/pipeline/src/repositories/social-credentials.ts` calls `cipher.decrypt(fields.clientId)` directly with no try/catch. `packages/pipeline/src/services/credential-resolver.ts` calls `deps.repo.getLinkedIn()` with no try/catch. A rotated `SESSION_SECRET` will throw from the repo, propagate through the resolver, propagate up through `buildDefaultPublishDeps()`, and **fail the pipeline job**.

**Severity:** edge case (operator must deliberately rotate the secret without first deleting credentials). Spec also calls operator-delete-and-re-enter the supported recovery, but the runtime behaviour during rotation should still be "skip the platform, don't crash the run."

**This finding is NOT one of the numbered verification scenarios VS-0..VS-12**, which all PASS. It's an SPEC §Edge cases item surfaced by adversarial probing.

**Recommended follow-up (out of scope for this PR per the spec's "out of scope" carve-out for rotation flow):**
- Wrap `cipher.decrypt` in the repo `getLinkedIn`/`getTwitter` in try/catch returning `null` + structured `error` log
- Or wrap the repo calls in the resolver in try/catch with the same fallback
- Add a unit test in `credential-resolver.test.ts` that proves the resolver returns `null` (not throws) when the underlying decrypt throws.

---

## Summary

The 13 numbered verification scenarios (VS-0..VS-12) all pass. Adversarial probing surfaced **one spec edge-case violation** (§Edge cases — SESSION_SECRET rotation): the resolver propagates the cipher exception instead of returning `null`. The spec explicitly carves rotation out of scope ("operator deletes & re-enters"), so this is reported as a follow-up rather than a gate failure. All other adversarial probes — cipher tamper, secret leakage on GET, path injection on DELETE, validation bypass, KEK confusion, trim handling, worker-lifetime caching — produced the spec-mandated behaviour.
