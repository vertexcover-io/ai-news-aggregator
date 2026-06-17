---
title: "Never model a security gate's dependency as optional-for-back-compat (fail-open by omission)"
date: 2026-06-12
category: architecture
tags: [authorization, fail-closed, security, dependency-injection, back-compat, multi-tenant, broadcast-gate]
component: pipeline workers / deps wiring
severity: critical
status: implemented
applies_to: ["packages/pipeline/src/workers/**", "packages/api/src/services/**"]
stage: [code, review]
evidence_count: 4
last_validated: 2026-06-12
source: review-fix@multi-tenant
related: [".harness/knowledge/lessons/design-patterns/tenant-scoped-repos-stamp-on-insert-not-just-filter-select-20260612.md"]
---

# Never model a security gate's dependency as optional-for-back-compat (fail-open by omission)

## Problem

A new production gate (the per-tenant verified-sending-domain check that pauses broadcasts) was added as an **optional** worker dependency — `EmailSendDeps.tenantsRepo?` guarded by `if (deps.tenantsRepo !== undefined)`. The intent was back-compat: 30+ existing worker unit tests that don't construct the repo stay green and exercise "legacy ungated" behavior. The effect: an authorization check that is **disabled by omission**. Any caller (or future test, or an untyped JS path) that forgets the dep silently sends an ungated broadcast — fail-open. The mirror-image bug shipped alongside it: a *nullable* `sending_domain_status` column whose check was written `=== 'verified'`-by-accident in one place and `!== null` in another, which silently **blocked the grandfathered tenant** (AGENTLOOP) instead of letting it through.

## Insight

**An authorization gate whose dependency is optional is not a gate — it is a suggestion.** Two coupled rules:

1. **The gate's dependency must be REQUIRED so that omission is a compile error.** Make `tenantsRepo` non-optional on `EmailSendDeps`; the gate then runs unconditionally on every broadcast, and an untyped caller that omits it throws *before* any send (fail-closed). Don't buy back-compat with optionality on the security-critical path — update the existing call sites instead (they all go through one `buildDefaultPublishDeps` factory that always provides it).
2. **Default-deny on the status check, and grandfather EXPLICITLY.** Check `domainStatus !== 'verified'` (so `pending` / `failed` / `null` / absent all block), never `=== null` (which lets `failed`/unknown through). For tenants that must keep working through the transition (tenant-0/AGENTLOOP), grandfather them with an explicit, slug-guarded migration row (`UPDATE … WHERE slug='agentloop' AND status IS NULL`), **not** a column DEFAULT — a DEFAULT silently re-opens the gate for every future tenant.

## Solution

```ts
// BEFORE (fail-open): optional dep, gate skipped when absent
interface EmailSendDeps { tenantsRepo?: Pick<TenantsRepo, "getSendingDomainStatus">; }
if (deps.tenantsRepo) { /* gate */ }           // omit the dep → no gate

// AFTER (fail-closed): required dep, gate unconditional
interface EmailSendDeps { tenantsRepo: Pick<TenantsRepo, "getSendingDomainStatus">; }
const status = await deps.tenantsRepo.getSendingDomainStatus(tenantId);
if (status !== "verified") return blockBroadcast("broadcast_blocked"); // pending/failed/null all block
```

Proven by `test_REQ_053_fail_closed_gate_omission` (an untyped caller omitting the dep throws before sending). Grandfather migration `0047` flips ONLY `slug='agentloop' AND sending_domain_status IS NULL` → verified; column default stays NULL so every new tenant is gated.

**Ops consequence to surface when shipping a gate like this:** existing tenants must satisfy the new gate (verify a domain) before their next scheduled action, or it blocks — call this out in the PR and runbook, and keep the grandfather row's ops comment in sync with the migration (a stale "AGENTLOOP must verify before next broadcast" comment after 0047 grandfathers it is itself a review finding).

## Prevention / Reuse

- For any new gate (auth, rate, quota, verification): make its dependency **required**, not optional-for-tests. If existing tests break, that breakage IS the audit of every consumer — fix them.
- Write the predicate as default-deny (`!== allowedValue`), never allow-by-absence (`=== null`).
- Grandfather exceptions with an explicit, narrowly-scoped data migration; never a column DEFAULT.
- Recurrence signal: a code review comment like "this dep is optional for back-compat" on anything that decides whether a privileged action proceeds.

## Related

- `.harness/knowledge/lessons/design-patterns/tenant-scoped-repos-stamp-on-insert-not-just-filter-select-20260612.md` — same "optional/absent = silent gap" failure mode on the data-isolation side
