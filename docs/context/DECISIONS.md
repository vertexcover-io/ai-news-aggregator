---
last_verified_sha: 5a2ff20
status: active
---

# Decisions index

| ID | Title | Lives in |
|----|-------|----------|
| D-001 | LinkedIn OAuth callback bypasses admin gate | packages/api/PACKAGE.md |
| D-002 | rettiwt-api allowed only in twitter-handle-resolver | packages/api/PACKAGE.md |
| D-003 | updateRankedItems is a partial UPDATE | packages/api/PACKAGE.md |
| D-004 | Dynamic imports of pipeline at route boundary | packages/api/PACKAGE.md |
| D-005 | raw_items.run_id as preferred attribution column | packages/api/PACKAGE.md |
| D-006 | updateStatus uses WHERE status != $newStatus | packages/api/PACKAGE.md |
| D-007 | DELETE /api/admin/archives/:runId cleans Redis ghosts | packages/api/PACKAGE.md |
| D-008 | SESSION_SECRET is dual-purpose (session HMAC + credential KEK) | packages/api/PACKAGE.md |
| D-009 | PostHog analytics are fire-and-forget with cached config | packages/api/lib/PACKAGE.md |
| D-010 | EMAIL_PROVIDER env switches Resend vs SES at startup | packages/api/lib/email/PACKAGE.md |
| D-011 | SQL DERIVED_IDENTIFIER_SQL mirrors JS deriveRawItemIdentifier | packages/api/repositories/PACKAGE.md |
| D-012 | Credentials encrypted at rest via CredentialCipher | packages/api/repositories/PACKAGE.md |
| D-013 | Digest-meta presence detection uses "k" in input | packages/api/services/PACKAGE.md |
| D-014 | Run cancellation uses Redis pub/sub not BullMQ | packages/api/services/PACKAGE.md |
| D-030 | Web search provider resolved at worker startup | packages/pipeline/collectors/web-search/PACKAGE.md |
| D-040 | Provider-aware extractUsage dispatches by model prefix | packages/pipeline/processors/PACKAGE.md |
| D-041 | Drop rationale-axis validation from ranker | packages/pipeline/processors/PACKAGE.md |
| D-042 | Shortlist produces no per-item scoring | packages/pipeline/processors/PACKAGE.md |
| D-050 | email_sent_at is the broadcast idempotency marker only | packages/pipeline/workers/PACKAGE.md |
| D-051 | Publish deps are per-job closures not constructor singletons | packages/pipeline/workers/PACKAGE.md |
| D-052 | newsletter-send.ts kept for back-compat only | packages/pipeline/workers/PACKAGE.md |
| D-060 | setCostBreakdown is UPDATE-only | packages/pipeline/repositories/PACKAGE.md |
| D-061 | In-batch dedup in upsertItems | packages/pipeline/repositories/PACKAGE.md |
| D-080 | WEB_HTTP_PROXY routes web collector through 3 transport seams (fail-open, secret, undici pinned) | packages/pipeline/services/web-fetch/PACKAGE.md |
| D-100 | Web must use subpath imports from shared | packages/shared/PACKAGE.md |
| D-101 | Provider-aware token extraction with live-probe verification | packages/shared/PACKAGE.md |
| D-102 | Schema definitions live only in shared | packages/shared/PACKAGE.md |
| D-103 | jsonb columns carry explicit Drizzle $type annotations | packages/shared/PACKAGE.md |
| D-104 | SESSION_SECRET doubles as credential encryption KEK | packages/shared/PACKAGE.md |
| D-105 | Generated migrations must be inspected for NOT NULL adds | packages/shared/PACKAGE.md |
| D-106 | JS and SQL implementations of deriveRawItemIdentifier must stay aligned | packages/shared/PACKAGE.md |
| D-107 | Slack notification idempotency via notification_state JSONB | packages/shared/PACKAGE.md |

# Cross-package decisions (full bodies)

## D-100 — Web must use subpath imports from shared

**Why:** The root `@newsletter/shared` barrel re-exports `db/index.ts` which transitively pulls `postgres` into the Vite browser bundle, breaking at runtime with `Buffer is not defined`.

**Tradeoff:** Every new shared export needed by web requires adding a subpath entry to `tsup.config.ts` + `package.json#exports`. Acceptable for build safety.

**Governs:** packages/shared/tsup.config.ts, packages/web/src/**

## D-104 — SESSION_SECRET doubles as credential encryption KEK

**Why:** Avoids a separate encryption key env var. The same secret that signs admin cookies also encrypts API credentials at rest. HKDF derivation with a fixed salt makes this cryptographically sound.

**Tradeoff:** Rotating SESSION_SECRET invalidates all stored encrypted credentials — no key rotation mechanism exists. Mitigated by the documented recovery path: re-enter credentials via `/admin/settings`.

**Governs:** packages/shared/src/services/credential-cipher.ts, packages/api/src/auth/session.ts

## D-107 — Slack notification idempotency via notification_state JSONB

**Why:** Each Slack notification writes a dedicated key in `run_archives.notification_state` JSONB after a successful webhook POST. On retry, the existing key suppresses re-send. A failed POST does NOT write the key, so a retry can re-alert once the platform recovers.

**Tradeoff:** A webhook POST success followed by a DB write failure means the next retry sends a duplicate Slack message. Duplicate is preferred over missed — the alternative (write-first, send-second) would permanently suppress alerts on webhook failure.

**Governs:** packages/shared/src/slack/notifier.ts

## D-051 — Publish deps are per-job closures, not constructor singletons

**Why:** The design doc §3 and §4.4 promise that admin credential changes take effect on the next pipeline job without a worker restart. Building publish dependencies (LinkedIn/Twitter notifiers) inside the job processor rather than at worker construction fulfills this contract.

**Tradeoff:** One DB read per job for social credentials (acceptable — once per job, not per item). The credential resolver is DB-first with env-fallback caching within the job.

**Governs:** packages/pipeline/src/workers/processing.ts::buildDefaultPublishDeps

## D-014 — Run cancellation uses Redis pub/sub, not BullMQ job control

**Why:** The pipeline worker runs collectors in-process via `Promise.allSettled` and needs to abort mid-stage. BullMQ's job cancellation only works between job invocations, not during execution. The pipeline subscribes to `run:cancel:<runId>` on Redis pub/sub and checks an AbortSignal between collector iterations.

**Tradeoff:** If the pub/sub message is lost (network partition), cancellation silently fails. The operator retries via the API — the cancel endpoint is idempotent.

**Governs:** packages/api/src/services/cancel-run.ts, packages/pipeline/src/workers/run-process.ts
