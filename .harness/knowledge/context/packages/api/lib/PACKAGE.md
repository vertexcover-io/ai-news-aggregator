---
governs: packages/api/src/lib/
last_verified_sha: 5a2ff20
key_files: [validate.ts, errors.ts, subscriber-token.ts, sns-verifier.ts, posthog.ts, posthog-config.ts, base-urls.ts, validate-must-read.ts, validate-social-credentials.ts]
flow_fns: [subscriber-token.ts::verifySubscriberToken, sns-verifier.ts::verifySnsMessage, posthog.ts::captureAnalytics]
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
- `captureAnalytics(event)` — sends PostHog capture event (never throws)
- `refreshPostHogConfig(settings)` — invalidates cached config
- `shutdownAnalytics()` — flushes and shuts down the PostHog client

### Other
- `NotFoundError` — thrown by repositories when a resource is missing
- `resolveBaseUrls(env) → { baseUrl, webBaseUrl }` — resolves API and web base URLs from env

## Depends on / used by

**Uses:** `zod`, `node:crypto`, `posthog-node`, `@newsletter/shared` (types)
**Used by:** routes (validation), services (error classes), index.ts (PostHog config)

## Data flows

```
verifySubscriberToken(token, expectedType, secret) → VerifyResult:
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
- **`userSettingsUpsertSchema` is a `.transform().pipe().superRefine()` chain.** Adding a field to `UserSettings` without updating both the common shape and the pipe target will cause validation failures.
- **`buildSigningString` in sns-verifier.ts must construct the signing string in exact alphabetical key order.** The SNS signature spec requires `key\nvalue\n` pairs sorted by key.

## Decisions

- **D-009:** PostHog analytics are fire-and-forget with a 30s cached config. **Why:** Analytics must never block or fail a product request. **Tradeoff:** Config staleness of up to 30s — settings save calls `refreshPostHogConfig` to mitigate. **Governs:** `posthog.ts`.
