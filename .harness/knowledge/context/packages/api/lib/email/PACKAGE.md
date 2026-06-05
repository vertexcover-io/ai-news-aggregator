---
governs: packages/api/src/lib/email/
last_verified_sha: 5a2ff20
key_files: [provider.ts, resend-provider.ts, ses-provider.ts]
flow_fns: []
decisions: [D-010]
status: active
---

# lib/email/ — email provider abstraction (Resend / SES)

## Purpose

Provides a uniform `EmailProvider` interface backed by either Resend or AWS SES v2, selected via the `EMAIL_PROVIDER` environment variable. SES is used in production for deliverability; Resend is the default for local development.

## Public surface

- `createEmailProvider() → EmailProvider` — returns SES provider when `EMAIL_PROVIDER=ses`, else Resend
- `createResendProvider() → EmailProvider` — wraps Resend SDK `client.emails.send()`
- `createSesProvider() → EmailProvider` — wraps AWS SDK `SESv2Client.send(SendEmailCommand)`
- Re-exports `EmailProvider`, `SendEmailParams`, `SendEmailResult` from `@newsletter/shared`

## Depends on / used by

**Uses:** `resend`, `@aws-sdk/client-sesv2`, `@newsletter/shared` (types)
**Used by:** `index.ts` (email provider for confirmation emails)

## Decisions

- **D-010:** `EMAIL_PROVIDER` env var switches between Resend and SES at process startup. **Why:** Production uses SES for better deliverability and cost; local dev uses Resend for simplicity. **Tradeoff:** Changing `EMAIL_PROVIDER` requires a process restart. **Governs:** `provider.ts`.
