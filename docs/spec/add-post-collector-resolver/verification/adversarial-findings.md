# Adversarial Findings — add-post-collector-resolver

Step 5 of functional verification: role-swap into "skeptical reviewer / attacker" and try to break the feature. Document attempts and outcomes.

## Scenarios attempted

### A-1: URL spoofing — `evil.com/x.com/jack/status/20`

**Attack:** Try to fool the detector with a URL that contains `x.com/jack/status/20` as a substring but is not actually a Twitter URL.

```
parseTweetIdFromUrl("https://evil.com/x.com/jack/status/20")
```

**Outcome:** Returns `null`. The regex is anchored with `^https?:\/\/(?:[a-z0-9-]+\.)?(?:x|twitter)\.com\/` — the host must be exactly `x.com` or `twitter.com` (optionally with a subdomain prefix). Spoof attempt **rejected**. ✓

### A-2: Path traversal in handle

**Attack:** `https://x.com/../status/20`

**Outcome:** `[^/]+` segment greedily matches `..`, but the regex requires `/status/<digits>` to follow — `..` is consumed as the handle, then `/status/20` matches. Detection returns `"twitter"` with id `"20"`. The collector then calls `tweet.details("20")` which returns the real tweet 20. **Accepted as not-a-vulnerability** — the path traversal has no impact because we only use the extracted ID, not the handle, to identify the tweet. ✓

### A-3: Extremely long URL

**Attack:** A 50KB URL with `/status/20` somewhere. Could DoS the regex.

**Outcome:** The regex has bounded backtracking — `(?:[^/]+)` is non-greedy-friendly because `/status/` is a literal anchor. Regex engine completes in microseconds for any input. Tested with a 10KB pre-padded URL — instant. ✓ (Not added to test suite since it's a generic regex-safety concern, not feature-specific.)

### A-4: Non-numeric ID injection

**Attack:** `https://x.com/jack/status/20'; DROP TABLE raw_items;--`

**Outcome:** Regex requires `(\d+)` so non-digit suffix is captured as the trailing `[/?#].*` group — captured ID is just `20`. Even if it weren't, the ID flows through Drizzle parameterised queries (`upsertItems`), so SQL injection is impossible at the ORM layer. ✓

### A-5: Tweet ID that returns a Twitter API error other than not-found/auth

**Attack:** What if Twitter returns a 500 or returns a tweet with missing required fields?

**Outcome:** `denormalize()` reads `t.fullText ?? ""`, `t.tweetBy?.userName ?? "i"`, `t.likeCount ?? 0`, etc. — all nullable fields have safe defaults. A 500 throws and is propagated to the caller as a non-typed error, which `addPostToArchive` wraps in a 502. The operator sees the raw error message. **Acceptable** — not a security issue, ergonomic only.

### A-6: Cookie injection via DB tampering

**Attack:** An attacker who can write to `social_credentials.twitter_collector` could plant a malicious cookie.

**Outcome:** That table is encrypted at rest (HKDF-derived KEK from `SESSION_SECRET`). An attacker with arbitrary DB write would also have the secret. **Acceptable trust boundary** — same as the bulk collector.

### A-7: Race condition on cookie rotation

**Attack:** Two concurrent Add Post calls hit the CSRF refresh path simultaneously. Both refresh the cookie. The second refresh might invalidate the first.

**Outcome:** `refreshRettiwtCsrfToken` calls Rettiwt's `AuthService.refreshCsrfToken(config)` which calls Twitter once. If both rotate simultaneously, the DB write is last-write-wins; the most recent valid cookie is stored. Both calls succeed independently because each rettiwt instance carries its own rotated key in-memory. **Acceptable** — same race as bulk collector; doesn't corrupt state.

### A-8: Memoised constructor / repo holds stale getDb reference after migration

**Attack:** If the DB connection pool is recreated mid-process (e.g. failover), the cached `repo` would hold a dead handle.

**Outcome:** `getDb()` returns a shared connection pool that auto-reconnects. The repo wraps queries; each query revalidates the pool. **Acceptable** — same pattern as bulk collector's cached `socialCredentialsRepo`.

## Defects found

**None.** No new attack vectors introduced.

## Defense-in-depth observations

- The regex anchor prevents trivial URL spoofing.
- Drizzle parameterisation handles SQL injection.
- AES-256-GCM at rest handles cookie storage.
- Per-call resolver invocation prevents stale-cookie staleness post-rotation.

The implementation inherits the security properties of the existing bulk twitter collector. No new threats.

## Conclusion

Adversarial pass yielded no defects. PASSED.
