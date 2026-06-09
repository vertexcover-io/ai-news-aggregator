---
governs: packages/api/src/lib/
last_verified_sha: abbc2469ab05df29b744dde2701d59a7803124e9
key_files: [validate.ts, errors.ts, subscriber-token.ts, sns-verifier.ts, posthog.ts, base-urls.ts, validate-must-read.ts, validate-social-credentials.ts]
flow_fns: [subscriber-token.ts::verifySubscriberToken, sns-verifier.ts::verifySnsMessage, posthog.ts::captureAnalytics, posthog.ts::captureException]
decisions: [D-009]
status: active
---

# lib/ — package-private helpers: validation schemas, tokens, error classes, analytics, SNS verification

## Purpose

Houses all reusable, non-domain-specific utilities used across routes and services. Covers zod validation schemas, HMAC subscriber tokens, SNS message signature verification, PostHog analytics client, and base URL resolution. No DB access.

## Public surface

### validate.ts
- `runSubmitSchema` / `runNowBodySchema` — validates ad-hoc and "run now" request bodies
- `userSettingsUpsertSchema` — transforms + validates settings PUT body (defaults times, infers source-enabled, enforces schedule ordering)
- `archivePatchSchema` — validates review PATCH body (rankedItems + optional digest-meta fields)
- `regenerateDigestMetaSchema`, `addPostSchema`, `promoteSchema`, `socialChannelSchema` — request validation

### subscriber-token.ts
- `issueSubscriberToken(subscriberId, type, secret, expiresAt?) → string` — HMAC-signed base64url token
- `verifySubscriberToken(token, expectedType, secret) → VerifyResult` — validates HMAC, expiry, and type

### sns-verifier.ts
- `verifySnsMessage(rawBody, certFetcher?) → SnsMessage` — parses JSON → validates SigningCertURL → fetches cert → verifies SHA1 signature

### posthog.ts
- `configurePostHog(provider)` — sets the settings provider for lazy config loading
- `captureException(error, context?)` — sends a PostHog `$exception` event; converts non-Error to Error; swallows all transport/config errors (never throws); fire-and-forget, no flush on hot path (D-009, REQ-015)
- `captureAnalytics(event)` — sends PostHog capture event (never throws)
- `refreshPostHogConfig(settings)` — invalidates cached config; shuts down existing client if disabled
- `shutdownAnalytics()` — flushes and shuts down the PostHog client

Note: `posthog-config.ts` (the pure config resolver) was moved to `@newsletter/shared/analytics` and is no longer in `packages/api/src/lib/`. It is consumed via `resolvePostHogConfig` from that subpath. (D-141)

### Other
- `NotFoundError` — thrown by repositories when a resource is missing
- `resolveBaseUrls(env) → { baseUrl, webBaseUrl }` — resolves API and web base URLs from env

## Depends on / used by

**Uses:** `zod`, `node:crypto`, `posthog-node`, `@newsletter/shared` (types)
**Used by:** routes (validation), services (error classes), index.ts (PostHog config)

## Data flows

### captureException(error, context?) → void
  error → (error instanceof Error ? error : new Error(String(error)))
    → loadConfig() [cached 30s TTL, settings-backed]
      → getClient(config):
        ├─ config.posthogEnabled === false or token missing → null (no-op, REQ-012)
        └─ token+host present → PostHog client (reuse or rebuild on key change)
    → posthog.captureException(err, distinctId, props)  // fire-and-forget, no await flush (REQ-015)
  (all branches wrapped in try/catch: transport errors → console.warn, no rethrow — REQ-013)

### verifySubscriberToken(token, expectedType, secret) → VerifyResult:
  token → split(".") → [encodedPayload, mac]
    ├─ missing parts          → { valid: false, reason: "invalid" }
    └─ → Buffer.from(encodedPayload, "base64url") → payload
        → compute expectedMac = HMAC(payload, secret)
        → timingSafeEqual(mac, expectedMac)
          ├─ false            → { valid: false, reason: "invalid" }
          └─ true
            → payload.split(":") → [subscriberId, type, expiresStr]
              ├─ type !== expectedType → { valid: false, reason: "wrong-type" }
              ├─ Date.now() > expires  → { valid: false, reason: "expired" }
              └─ valid                 → { valid: true, subscriberId, type }
```

## Gotchas / landmines

- **PostHog config has a 30s cached TTL.** After a settings save, `refreshPostHogConfig()` is called explicitly to invalidate. If a new code path saves settings without calling it, PostHog serves stale config for up to 30s. (D-009)
- **`posthog-config.ts` was deleted from this package.** The pure config resolver `resolvePostHogConfig` now lives exclusively in `@newsletter/shared/analytics`. Any import of `@api/lib/posthog-config` is an error — use `@newsletter/shared/analytics` instead. (D-141)
- **`userSettingsUpsertSchema` is a `.transform().pipe().superRefine()` chain.** Adding a field to `UserSettings` without updating both the common shape and the pipe target will cause validation failures.
- **`buildSigningString` in sns-verifier.ts must construct the signing string in exact alphabetical key order.** The SNS signature spec requires `key\nvalue\n` pairs sorted by key.

## Decisions

- **D-009:** PostHog analytics are fire-and-forget with a 30s cached config. **Why:** Analytics must never block or fail a product request. **Tradeoff:** Config staleness of up to 30s — settings save calls `refreshPostHogConfig` to mitigate. **Governs:** `posthog.ts`.
