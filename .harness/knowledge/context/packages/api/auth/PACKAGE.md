---
governs: packages/api/src/auth/
last_verified_sha: ad0153a
key_files: [session.ts, middleware.ts]
flow_fns: [session.ts::verifyToken, middleware.ts::requireAdmin]
decisions: [D-008]
status: active
---

# auth/ — admin session tokens (HMAC) and cookie-based middleware gate

## Purpose

Issues and verifies time-limited HMAC session tokens for the admin dashboard. The middleware reads the `admin_session` cookie, verifies the token, and returns 401 for invalid/missing/expired tokens. All admin routes except `/login` and `/logout` are behind this gate.

## Public surface

- `issueToken(secret, now?) → string` — HMAC-signed token: `<issuedAt>.<hex-mac>`
- `verifyToken(token, secret, now?) → boolean` — validates HMAC, expiry (30 days), and timing-safe comparison
- `verifyPassword(submitted, expected) → boolean` — constant-time string comparison
- `requireAdmin(secret) → MiddlewareHandler` — Hono middleware: reads cookie → verifyToken → 401 or next()
- `COOKIE_NAME`, `MAX_AGE_MS` — exported constants

## Depends on / used by

**Uses:** `node:crypto` (createHmac, timingSafeEqual), `hono` (createMiddleware, getCookie)
**Used by:** `app.ts` (gate on /api/admin), `routes/admin.ts` (login issues token)

## Data flows

```
verifyToken(token, secret) → boolean:
  token → split(".") → [issuedAtStr, mac]
    ├─ missing parts           → false
    ├─ issuedAt not finite      → false
    └─ elapsed > MAX_AGE_MS     → false
    → compute expected = HMAC("admin|<issuedAtStr>", secret)
    → timingSafeEqual(mac, expected)
      ├─ true  → true
      └─ false → false

requireAdmin(secret):
  cookie "admin_session" → verifyToken
    ├─ valid   → next()
    └─ invalid → 401 { error: "unauthorized" }
```

## Gotchas / landmines

- **Session secret doubles as the HKDF KEK for credential encryption.** `SESSION_SECRET` is used both for admin session HMAC and (via `getCredentialCipher`) as the AES-256-GCM key derivation input for `social_credentials` and `social_tokens`. Rotating `SESSION_SECRET` invalidates all existing encrypted credentials. (D-008)

## Decisions

- **D-008:** `SESSION_SECRET` is dual-purpose (session HMAC + credential KEK). **Why:** Simpler deployment — one secret instead of two. **Tradeoff:** Credential rotation on every session-secret rotation. **Governs:** `auth/session.ts`, `repositories/social-credentials.ts`, `repositories/social-tokens.ts`.
