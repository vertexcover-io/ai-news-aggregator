# Adversarial Findings — chrome-extension-url-collector

> Role-swap pass: I tried to BREAK the feature, not confirm it. 2026-06-18.

## Scenarios attempted

| # | Attack | Outcome | Verdict |
|---|---|---|---|
| A1 | Replay an `admin\|`-payload cookie token as an extension bearer token (namespace confusion) | Forged admin token's HMAC ≠ extension token's expected HMAC (`ext\|` prefix). Verified directly: `admin token mac === ext expected mac? false`. Extension middleware rejects it 401. | DEFENDED |
| A2 | Submit with no / malformed / tampered / expired bearer token | `requireExtensionAuth` returns 401, no raw_items write (unit tests test_REQ_004 incl. wrong-secret EDGE-001 + expired EDGE-002). | DEFENDED |
| A3 | CORS bleed — does the new CORS rule expose admin/runs/settings cross-origin? | CORS middleware is mounted ONLY on `/api/extension/*`; route-gating test asserts admin routes have NO `access-control-allow-origin`. Origin reflector returns "" for non-`chrome-extension://` origins. | DEFENDED |
| A4 | Data-loss via test cleanup against shared dev DB | FOUND (was real): integration cleanup deleted ALL `manual` rows, and `.env` (symlinked to the shared dev DB) is what the test loads. FIXED to scope deletes to `seededIds` via `inArray`. Re-ran 4/4. | FIXED |
| A5 | Duplicate submission / tracking-param variants creating duplicate candidates | `externalId = hash(canonicalizeUrl(url))` collapses utm_* variants; upsert returns `alreadyExisted`; DB count stays 1 (test_EDGE_003 + e2e dedupe). | DEFENDED |
| A6 | Enrichment hang/failure blocking the request | Enrichment wrapped in try/catch; falls back to URL as title; request still returns 201 (test_REQ_008). | DEFENDED |
| A7 | Over-broad extension permissions (silent install over-reach) | FOUND (minor): `host_permissions` was `https://*/*` (all-sites warning). FIXED to the API origin only (localhost/127.0.0.1 + documented production host). Re-ran e2e 5/5. | FIXED |
| A8 | Stale token left in storage after server-side invalidation | On 401 the popup clears the token and returns to LoginView (test_EDGE_006, real browser). | DEFENDED |

## Confirmed breaks (fixed)

- **A4** — destructive test cleanup (data-loss risk against shared DB). Fixed; nominated as a review-fix lesson.
- **A7** — over-broad `host_permissions`. Fixed.

## Residual (accepted, low risk for single-operator internal tool)

- TOCTOU on `alreadyExisted` flag (check-then-upsert non-atomic) — benign for one operator; the upsert itself is still safe (no duplicate row).
- e2e dedupe test has an implicit ordering dependency on the submit test — harmless in the hermetic full-suite run; would need a re-login if run via `--grep` in isolation.
