# SES + SNS Setup for VER-85 Newsletter System

This document records the AWS resources provisioned by `scripts/setup-ses.ts` for the
newsletter-system feature, and the manual steps that remain before production sends.

## Resources Created (us-east-1, AWS account 183017936378)

| Resource | Identifier | Status |
|---|---|---|
| SES domain identity | `news.vertexcover.io` | Pending verification (awaiting DNS) |
| SES MAIL FROM domain | `mail.news.vertexcover.io` | Pending verification (awaiting DNS) |
| SES configuration set | `newsletter-default` | Active |
| SES event destination | `sns-all-events` (BOUNCE, COMPLAINT, DELIVERY, OPEN, CLICK, REJECT) | Active |
| SNS topic | `arn:aws:sns:us-east-1:183017936378:newsletter-ses-events` | Active, no subscribers yet |
| Account state | sandbox=true, max24Hour=200, maxSendRate=1/s | Sandbox |

The script is idempotent — re-running it skips identities, configuration sets, and event
destinations that already exist (catches `AlreadyExistsException`).

## Run the script

```bash
pnpm setup:ses --domain news.vertexcover.io
pnpm setup:ses --verify                          # re-fetch identity verification status
pnpm setup:ses --request-production-access       # prints the AWS console URL to leave sandbox
```

Credentials are loaded from `.env.harness` at the repo root (worktree-aware via
`git rev-parse --git-common-dir`). The current `AWS_SESSION_TOKEN` is an STS session, so
re-running the script after the session expires will fail with `ExpiredToken` until the user
refreshes the credentials in `.env.harness` — that is on the user, not a script bug.

## Manual steps that remain (user / manager action required)

1. **Publish the DNS records** in `ses-dns-records.txt` to the `news.vertexcover.io` zone.
   That file lists the three DKIM CNAMEs, the MAIL FROM MX/SPF records, and a recommended
   DMARC record.
2. **Wait 5–30 minutes** for SES to detect the records, then run `pnpm setup:ses --verify`
   (or look at the SES console). DKIM status moves `PENDING → SUCCESS` and the domain
   identity moves `Pending → Verified`.
3. **Request production access** to leave the SES sandbox:
   - Run `pnpm setup:ses --request-production-access` — prints the console URL.
   - Submit the form (use case = "Transactional + curated newsletter to opted-in
     subscribers, ~50–500 recipients per send, daily").
4. **Subscribe the deployed webhook URL** to the SNS topic — deferred per option A,
   the e2e suite uses signed simulated payloads instead of a live SNS subscription.

## Why we don't subscribe SNS to a webhook yet (option A)

The webhook handler at `POST /api/webhooks/ses` is unit-tested with simulated SNS
payloads, and the e2e suite signs payloads with a self-signed RSA cert that the verifier
fetches from a stubbed cert URL. We therefore don't need a live SNS subscription against
a deployed API URL during local development — that step happens at production deploy time.

## Sandbox-mode constraint (EDGE-015)

While SES remains in sandbox, sends only succeed for verified recipients. The e2e
pipeline send test routes through Resend (not SES) using Resend's sandbox addresses
(`delivered@resend.dev`, `bounced@resend.dev`, `complained@resend.dev`), so SES sandbox
does not block the test.
