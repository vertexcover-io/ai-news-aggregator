---
governs: scripts/
last_verified_sha: "ad0153a"
key_files:
  - auth-linkedin.ts
  - auth-twitter.ts
  - setup-ses.ts
  - smoke-run.sh
flow_fns:
  - "auth-linkedin.ts::OAuth callback handler"
  - "auth-twitter.ts::OAuth callback handler"
  - "setup-ses.ts::main"
decisions: []
status: active
---

# scripts/ — standalone CLI utilities

## Purpose
A collection of operator-run CLI scripts for one-time OAuth token seeding and AWS SES infrastructure setup. These are NOT part of the runtime pipeline — they are invoked manually via `pnpm tsx scripts/<name>.ts` during initial deployment or credential rotation. (The harness-only `probe-twitter-oauth1.ts` and `probe/` OAuth probe variants that read `.env.harness` and wrote nothing to the DB were removed from the main checkout by the dead-code cleanup `a844f41`; they survive only inside feature worktrees.)

## Public surface
- `auth-linkedin.ts` (production LinkedIn OAuth seed) — spins up localhost:8765, captures OAuth 2.0 authorization code, exchanges for tokens, fetches /v2/userinfo for person URN, upserts encrypted row into `social_tokens` table via `SocialTokensRepo`. Does NOT abort on missing refresh_token — writes the row with empty string anyway, then exits 1 with setup instructions.
- `auth-twitter.ts` (DEPRECATED production Twitter OAuth 2.0 + PKCE seed) — same localhost callback pattern but with PKCE `code_verifier` + Confidential client Basic auth. Aborts on missing refresh_token without writing a row. Auto-posting now uses OAuth 1.0a credentials, so this script is superseded (the former OAuth 1.0a validator `probe-twitter-oauth1.ts` was removed in `a844f41`).
- `setup-ses.ts` (AWS SES + SNS one-time infrastructure setup) — idempotent 8-step sequence: verify AWS creds, create domain identity, fetch DKIM tokens, configure custom MAIL FROM, create configuration set, create SNS topic, wire event destination, write DNS records file.
- `smoke-run.sh` (shell smoke test) — operator-run bash script (not TS); not an OAuth/SES flow.

## Depends on / used by
Uses: `@newsletter/shared` (DB client, credential cipher), `packages/pipeline/src/repositories/social-tokens`, `packages/pipeline/src/social/cli-helpers`, `@aws-sdk/client-sesv2`, `@aws-sdk/client-sns`, `dotenv`.
Used by: operator (manual invocation via `pnpm tsx`). Not called by any runtime code.

## Data flows

### `auth-linkedin.ts::OAuth callback handler` (async callback inside createServer)
```
HTTP GET localhost:8765/callback?code=...&state=... →
  parse URL → check path
    ├─ path != /callback → 404 plain text
    └─ path == /callback → extract code, state, error from query params
      ├─ error param present → 400, log error, exit(1)
      ├─ !code or state mismatch → 400, log, exit(1)
      └─ valid code + matching state →
        POST https://www.linkedin.com/oauth/v2/accessToken
        (grant_type=authorization_code, code, redirect_uri, client_id, client_secret)
          ├─ !tokenResp.ok or parseTokenResponse returns error → 500, exit(1)
          └─ OK → extract access_token, refresh_token, expires_at →
            GET https://api.linkedin.com/v2/userinfo (Bearer access_token)
              ├─ !uinfoResp.ok or !uinfo.sub → 500, exit(1)
              └─ OK → derive personUrn='urn:li:person:{sub}' → 200 HTML →
                createSocialTokensRepo(getDb(), getCredentialCipher()) →
                repo.saveToken("linkedin", { accessToken, refreshToken, expiresAt, metadata: { personUrn } })
                  ├─ refreshToken is null → print SETUP_HELP (programmatic refresh tokens not enabled),
                  │   exit(1) — ROW IS ALREADY WRITTEN with refresh_token=''
                  │   (landmine: broken row persists; re-run after enabling programmatic refresh on LinkedIn app)
                  └─ refreshToken present → print success, exit(0)
```

### `auth-twitter.ts::OAuth callback handler` (async callback inside createServer — DEPRECATED)
```
boot: read TWITTER_CLIENT_ID/SECRET from .env (missing → exit(2)) →
  generatePkcePair() → buildTwitterAuthorizeUrl(...) → print authorize URL → listen 127.0.0.1:8765

HTTP GET /callback?code=...&state=... →
  url.pathname != /callback → 404 "not the right path"
  └─ /callback → read code, state, error from query
      ├─ error param present → 400, log, server.close, exit(1)
      ├─ !code or returnedState !== state → 400, log, exit(1)
      └─ valid →
          POST https://api.twitter.com/2/oauth2/token
          (Basic auth client_id:client_secret; grant_type=authorization_code,
           code, redirect_uri, client_id, code_verifier)  # PKCE confidential client
            ├─ !tokenResp.ok or parseTokenResponse → "error" → throw → catch: 500, exit(1)
            └─ OK →
                parsed.refreshToken === null →
                  print abort help (need Confidential client + offline.access),
                  500, server.close, exit(1)   # ABORTS WITHOUT WRITING A ROW (diverges from LinkedIn)
                refreshToken present → 200 HTML →
                  createSocialTokensRepo(getDb(), getCredentialCipher()) →
                  repo.saveToken("twitter", { accessToken, refreshToken, expiresAt, metadata: null })
                  → print success → setTimeout 250ms → server.close, exit(0)
```

### `setup-ses.ts::main` (async)
```
CLI args (argv) + .env.harness (AWS creds) →
  parseArgs(argv) → Args{domain, region, verify, requestProductionAccess, verifyEmail}
  loadEnvHarness() → find repo root via git-common-dir →
    read .env.harness key=value lines → strip quotes → populate process.env

  main():
    ├─ --request-production-access → print AWS console sandbox-exit URL, return
    ├─ --verify-email X → CreateEmailIdentityCommand(X)
    │   ├─ AlreadyExistsException → "already exists"
    │   └─ created → "verification email sent"
    └─ default setup flow (domain + region):
      Step 1: GetAccountCommand → extract sandbox flag + sendQuota
      Step 2: CreateEmailIdentityCommand(domain)
        ├─ AlreadyExistsException → mark identity.existed=true (continue)
        └─ created → continue
      Step 3: GetEmailIdentityCommand(domain) → extract dkimTokens[], VerifiedForSendingStatus
      Step 4: PutEmailIdentityMailFromAttributesCommand → set mail.{domain} as MAIL FROM
      Step 5: CreateConfigurationSetCommand("newsletter-default")
      Step 6: CreateTopicCommand("newsletter-ses-events") → get TopicArn
      Step 7: CreateConfigurationSetEventDestinationCommand →
        wire MatchingEventTypes=[BOUNCE,COMPLAINT,DELIVERY,OPEN,CLICK,REJECT] →
        SnsDestination: topicArn
      Step 8: Generate DNS records block →
        DKIM: 3 CNAMEs + MAIL FROM: MX + TXT (SPF) + DMARC: TXT →
        mkdirSync + writeFileSync(resolve(gitCommonDir,
          ".harness/features/ver-85-newsletter-system/ses-dns-records.txt"))
```

## Gotchas / landmines

1. **auth-linkedin.ts writes a broken row on missing refresh_token.** When the LinkedIn app does not have "Programmatic refresh tokens" enabled, the token exchange returns no `refresh_token`. The script prints setup instructions and exits 1, but the `repo.saveToken` call ALREADY ran — the `social_tokens` row exists with `refresh_token=''`.
2. **auth-twitter.ts is DEPRECATED.** Auto-posting now uses OAuth 1.0a credentials. The former 1.0a validator `probe-twitter-oauth1.ts` was deleted in `a844f41`; validate 1.0a creds via the pipeline's `createTwitterApiClient().validateCredentials()` path instead.
3. **Auth script behavior divergence**: LinkedIn writes a broken row on missing refresh_token; Twitter aborts without writing. The LinkedIn DB row may be silently broken while the Twitter path refuses to persist incomplete state.
4. **Both OAuth scripts bind to 127.0.0.1:8765** — port collision if both are run simultaneously.
5. **setup-ses.ts uses a manual .env.harness parser** (split on `=`, strip quotes) rather than dotenv. No variable expansion supported.
6. **setup-ses.ts step ordering matters.** Steps 3–4 depend on the identity existing (Step 2). Step 7 depends on both the configuration set (Step 5) and SNS topic (Step 6).
7. **setup-ses.ts Step 8 DNS-records output path is `.harness/features/ver-85-newsletter-system/ses-dns-records.txt`** (was `docs/spec/...` before the working-tree change). The path is resolved against `git-common-dir`, so in a worktree it lands in the shared main-checkout root.
