# Adversarial Findings — web-collector-proxy-support

**Role:** critic (role-swap from verifier). Goal: break the proxy wiring.
**Date:** 2026-06-01
**Sources re-read for this pass:** `docs/spec/web-collector-proxy-support/spec.md`, `.harness/web-collector-proxy-support/claims.json` only.

## 1. Attack surface derived

The feature is backend-only (no UI). All claims are unit/api. The exploitable surface for a proxy
feature is the *fail-open contract*, the *secret-leak contract*, and the *transport-ownership
contract* — exactly the places where a happy-path test sees nothing.

- **Fail-open boundary inputs** (source: spec EDGE-001/002 + REQ-005) — unset, empty `""`,
  whitespace-only, malformed (`"not a url"`), non-http(s) scheme (`ftp://`, `socks5://`). All must
  resolve to `null` (direct egress), never throw.
- **Secret-leak surface** (source: spec REQ-007) — the resolver's two `warn` branches; the
  `crawler.stats` log fields; any throw/error string in the three seams. None may carry the URL,
  credentials, host, or port.
- **Transport-ownership / injected-fetchFn bypass** (source: spec REQ-006, EDGE-005) — when a caller
  injects `fetchFn`, the static seam must NOT attach a dispatcher; the caller owns transport.
- **Abort-with-dispatcher** (source: spec REQ-010, EDGE-003) — the abort short-circuit must still
  fire with a dispatcher present (claim-coverage gap: only the unit asserts this; checked by code read).
- **Dependency phantom** (source: spec REQ-008) — `undici` must be importable, not just present in
  the store.

## 2. Scenarios attempted

| ID | Category | Description | Inputs | Verdict |
|----|----------|-------------|--------|---------|
| A1 | Boundary | resolver, env unset | `{}` | EXPECTED (→ null) |
| A2 | Boundary | resolver, empty string | `WEB_HTTP_PROXY=""` | EXPECTED (→ null) |
| A3 | Boundary | resolver, whitespace-only | `WEB_HTTP_PROXY="   "` | EXPECTED (→ null) |
| A4 | Boundary | resolver, malformed URL | `WEB_HTTP_PROXY="not a url"` | EXPECTED (→ null, warn, no throw) |
| A5 | Boundary | resolver, non-http scheme | `WEB_HTTP_PROXY="ftp://h:1"` | EXPECTED (→ null, warn) |
| A6 | Boundary | resolver, socks scheme | `WEB_HTTP_PROXY="socks5://h:1"` | EXPECTED (→ null, warn) |
| A7 | Boundary | resolver, valid credentialed URL | `http://u:p@h:5863` | EXPECTED (→ exact trimmed value) |
| A8 | Boundary | resolver, leading/trailing whitespace around valid URL | `"  http://u:p@h:5863  "` | EXPECTED (→ trimmed value) |
| A9 | Error recovery | resolver, garbage `%%%` | `WEB_HTTP_PROXY="%%%"` | EXPECTED (→ null, no crash, fail-open) |
| A10 | Status accuracy / secret-leak | resolver warn branches must not carry secret | malformed + non-http inputs | EXPECTED (logs carry only `event:reason`, no `u:p`/`5863`) |
| A11 | Transport ownership | injected `fetchFn` must NOT get a dispatcher even with proxy set | `fetchFn=()=>{}, WEB_HTTP_PROXY=secret` | EXPECTED (no-dispatcher) |
| A12 | Transport ownership | default fetch path WITH proxy set must attach dispatcher | `fetchFn=undefined, WEB_HTTP_PROXY=secret` | EXPECTED (dispatcher-attached) |
| A13 | Dependency phantom | `import { ProxyAgent } from "undici"` resolves + constructs from pipeline scope | run probe under `packages/pipeline` node scope | EXPECTED (constructs) |
| A14 | Secret-leak (code grep) | no log/throw in changed src interpolates `proxyUrl`/env value | grep `proxyUrl\|WEB_HTTP_PROXY` across `packages/pipeline/src` | EXPECTED (only fixed warn strings + var bindings; no interpolation) |
| A15 | Secret-leak (code read) | `crawler.stats` log fields contain no proxy field | read `web-crawler.ts:255-266` | EXPECTED (no proxy field) |

A1–A13 were executed by a node probe under the pipeline's module-resolution scope; the resolver
logic in the probe was line-for-line mirrored from `packages/pipeline/src/services/web-fetch/proxy.ts`
(read first). A14–A15 were executed by static grep/read of the actual source.

### Evidence (verbatim probe stdout)

```
PASS resolve[unset] => null (expect null)
PASS resolve[empty] => null (expect null)
PASS resolve[whitespace] => null (expect null)
PASS resolve[malformed] => null (expect null)
PASS resolve[non-http] => null (expect null)
PASS resolve[socks] => null (expect null)
PASS resolve[valid] => "http://u:p@h:5863" (expect "http://u:p@h:5863")
PASS resolve[valid-trim] => "http://u:p@h:5863" (expect "http://u:p@h:5863")
PASS no-crash on malformed, resolved=null (fail-open)
PASS warn logs carry no secret value; logs=[...,"warn:web_proxy.malformed:non-http-protocol",...]
PASS injected fetchFn bypasses proxy => no-dispatcher
PASS default fetch attaches proxy => dispatcher-attached
PASS ProxyAgent constructs from resolved url
EXIT=0
```

Grep evidence (A14): the only matches for `proxyUrl`/`WEB_HTTP_PROXY` in `packages/pipeline/src` are
(a) the `import` lines, (b) the `const proxyUrl = resolveWebProxyUrl()` bindings, (c) the
`proxyConfiguration: proxyUrl ? new ProxyConfiguration({ proxyUrls: [proxyUrl] }) : undefined`
construction, and (d) the two fixed warn strings in `proxy.ts` (`"WEB_HTTP_PROXY ignored — not a
valid URL"` / `"… non-http(s) protocol"`). **No log or throw interpolates the resolved value.**

## 3. Defects

None.

## 4. Cannot assess

- **EDGE-007 (proxy host unreachable at runtime)** — documented behaviour only; surfaces as a normal
  fetch/crawl failure. Not separately probed (would require a deliberately-dead proxy and is a runtime
  ops concern explicitly out of scope per spec §Out of Scope). The fail-open contract (A1–A9) proves
  the *config* path; the *connectivity* path reuses the existing fetch/crawl failure handling, which
  is unchanged by this feature.

## 5. Honest declaration

No defects found across 15 scenarios attempted. Categories exercised: boundary inputs (unset / empty /
whitespace / malformed / non-http scheme / valid / trimmed / garbage), transport-ownership
(injected-fetchFn bypass vs default-fetch attach), secret-leak (resolver warn branches + crawler.stats
fields + full-src grep), error recovery (fail-open on garbage), and dependency-phantom resolution.

The most promising attack was the secret-leak path: a proxy URL contains credentials, and the natural
mistake is to log the offending value when rejecting a malformed one (`logger.warn({ value: raw })`).
The implementation sidesteps this entirely — both warn branches log only a fixed `event`/`reason`
pair with no `value` field, and a full grep of `packages/pipeline/src` confirms no log or throw
anywhere interpolates the resolved `proxyUrl`. The second-most-promising was injected-fetchFn bypass:
if the static seam resolved the proxy before checking `fetchFn`, an injected transport would be
silently overridden — but `fetchStatic` computes `usingDefaultFetch = opts.fetchFn === undefined`
first and only resolves the proxy on the default path, so an injected `fetchFn` provably gets
`no-dispatcher`. Neither landed.
