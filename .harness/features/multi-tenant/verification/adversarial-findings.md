# Adversarial Findings — multi-tenant

Role: critic. Targets derived by diffing spec ACs against `claims.json` coverage (16 REQs never named by any claim: 005, 010, 011, 032, 035, 038, 039, 043, 050, 051, 071, 085, 111–114, 124, 125, 127) plus the brief's named hot-zones: cross-tenant isolation, the broadcast gate, secret exposure, impersonation privilege.

Live stack: API :3000, Postgres :5434/newsletter_mt (fresh reset+migrate+AGENTLOOP backfill), Redis :6379 (cleared). Three real auth sessions (agentloop tenant_admin, inference tenant_admin, super_admin) + a fake Resend. SLACK_WEBHOOK_URL force-blanked (no real Slack). No real external messages were sent.

## 1. Attack surface derived

- **Cross-tenant run-state (REQ-013, the pass-1/pass-2 hot zone)** — start a live run as tenant A, then read/cancel/enumerate it as tenant B via every Redis-backed read path: `GET /api/runs/:id`, `GET /api/runs` (list), `GET /api/admin/runs/:id/observability`, `GET /api/admin/runs/:id/sources/:key/items`, `POST /api/runs/:id/cancel`. [claim-coverage-gap: these are `api` claims but the brief flags them for adversarial re-probing]
- **Cross-tenant tenant-owned rows (REQ-010/014)** — create a `sources` row as A; list/PATCH/DELETE it as B. [derived]
- **Cross-host public archive (REQ-044)** — fetch A's archive id on B's Host. [spec-gap: REQ-044 not in claim set as a probe]
- **App-host unscoped fallback (REQ-021/EDGE-013)** — request `/api/home` and `/api/archives/:id` on the bare app host (no slug). [spec-gap]
- **App-level secret exposure (REQ-082/125/NF6)** — tenant_admin hits `/api/super/app-credentials`; inspect `/api/admin/social-credentials` + `/api/settings/notifications` bodies for ciphertext / raw webhook. [spec-gap REQ-125]
- **Impersonation privilege + confinement (REQ-101)** — tenant_admin attempts impersonate/super routes; super_admin impersonating A is confined to A on tenant-scoped reads. [spec-gap]
- **Session cookie integrity (REQ-005)** — garbage + single-byte-tampered signed cookie. [spec-gap REQ-005]
- **Subscribe scoping (REQ-050/051)** — same email subscribes on two tenant hosts → two independent pending rows. [spec-gap]
- **Logo validation (REQ-039)** — oversize + wrong-type upload. [spec-gap]
- **Broadcast fail-closed gate (REQ-084/I4)** — DB invariant: fresh tenants have NULL sending_domain_status (broadcast blocked). [claim-coverage-gap]
- **Boundary inputs** — empty/garbage run payloads; double-activate an already-active tenant. [derived]

## 2. Scenarios attempted

| ID | Category | Description | Inputs | Verdict |
|----|----------|-------------|--------|---------|
| ADV-ISO1 | permissions/concurrency | B reads A's live run | `GET /api/runs/<A-runId>` as inference | EXPECTED (404) |
| ADV-ISO2 | permissions | B reads A's run observability | `GET /api/admin/runs/<A-runId>/observability` | EXPECTED (404) |
| ADV-ISO3 | permissions | B reads A's run source-items | `GET …/sources/hn/items` | EXPECTED (400 "invalid sourceKey" — identical for owner; reject precedes fence, no existence oracle) |
| ADV-ISO4 | permissions | B cancels A's live run | `POST /api/runs/<A-runId>/cancel` as inference | EXPECTED (404; A's run unaffected) |
| ADV-ISO5 | permissions | B enumerates A's runs in list | `GET /api/runs` as inference | EXPECTED (A's runId absent from B's list) |
| ADV-XW1 | permissions | B deletes A's source row | `DELETE /api/sources/<A-srcId>` as agentloop | EXPECTED (404; row survived for A) |
| ADV-XW2 | permissions | B disables A's source row | `PATCH /api/sources/<A-srcId>` | EXPECTED (404) |
| ADV-XW3 | isolation | B sees A's source in list | `GET /api/sources` as agentloop | EXPECTED (InferenceOnly absent) |
| ADV-XA1 | permissions | A's archive on B's Host | `GET /api/archives/<id>` `x-tenant-slug: inference` | EXPECTED (404 "not found") |
| ADV-XA2 | isolation | A's archive on bare app host | `GET /api/archives/<id>` no slug | **DEFECT (200 — unscoped legacy fallback serves any tenant's archive)** → ADV-1 |
| ADV-HOME | isolation | `/api/home` on bare app host | no slug | **DEFECT (returns an arbitrary tenant's issue — cross-tenant merge)** → ADV-1 |
| ADV-SEC1 | secret exposure | tenant_admin reads app credentials | `GET /api/super/app-credentials` as agentloop | EXPECTED (403) |
| ADV-SEC2 | secret exposure | social-credentials leaks ciphertext | `GET /api/admin/social-credentials` | EXPECTED (only `{configured,updatedAt,apiVersion}` projections; no ct/iv/tag) |
| ADV-SEC3 | secret exposure | notifications leaks raw Slack URL | `GET /api/settings/notifications` | EXPECTED (`slackWebhookSet:true`, no `hooks.slack.com`) |
| ADV-IMP1 | privilege | tenant_admin impersonates | `POST /api/super/impersonate/:id` as inference | EXPECTED (403) |
| ADV-IMP1b | privilege | tenant_admin reads super console | `GET /api/super/tenants` as inference | EXPECTED (403) |
| ADV-IMP2 | confinement | super impersonating A leaks B's data | `GET /api/sources` + `/api/settings/notifications` while impersonating inference | EXPECTED (inference-scoped only; agentloop seed absent) |
| ADV-TAMP1 | auth integrity | garbage session cookie | `Cookie: session=garbage.forged.value` | EXPECTED (401) |
| ADV-TAMP2 | auth integrity | single-byte-tampered real cookie | last char flipped | EXPECTED (401) |
| ADV-SUB1 | status/scoping | same email subscribes on two hosts | `POST /api/subscribe` on inference then agentloop | EXPECTED (two independent `pending` rows, one per tenant) |
| ADV-LOGO1 | boundary | oversize logo upload | 600 KB png to `POST /api/onboarding/logo` | EXPECTED (400) |
| ADV-LOGO2 | boundary | wrong-type logo upload | `text/plain` | EXPECTED (400) |
| ADV-GATE | broadcast gate | fresh tenants block broadcast | DB `sending_domain_status` for all tenants | EXPECTED (inference/mlops-weekly/pending all NULL → fail-closed) |
| ADV-DBL | unexpected sequence | double-activate active tenant | `POST /api/onboarding/activate` as agentloop | DEFECT-minor (409 "incomplete" with a misleading missing-steps list instead of "already active") → ADV-3 |
| ADV-CANON | status accuracy / spec | canon OFF still serves page+block | `PUT /api/settings/features {featureCanon:false}` then `/api/home` + `/api/must-read` on the tenant host | **DEFECT (canon block + /must-read page still served; only nav hidden)** → ADV-2 |
| ADV-RUNVAL | boundary | empty/garbage run payload | `POST /api/runs {}` / `{topN:12}` / `{hn:true}` | EXPECTED (400 zod validation each) |

## 3. Defects

### ADV-1 — App-host (no Host slug) serves cross-tenant merged public data  `[confirmed]`  — severity: minor
**Reproduction:** `curl http://127.0.0.1:3000/api/home` (no `x-tenant-slug`) → `todaysIssue.digestHeadline = "Quantization without tears"` (the **inference** tenant's issue), while `…/api/home -H 'x-tenant-slug: agentloop'` → "Agents are eating the toolchain". `curl http://127.0.0.1:3000/api/archives/<agentloop-archive-id>` (no slug) → **200** (full archive body), while the same id on `x-tenant-slug: inference` → 404.
**Actual vs expected:** On the bare app host the public read paths (`/api/home`, `/api/archives/:id`) fall through to unscoped legacy mode (`tenant-scope.ts` `tenantScopeFromPublicHost` returns no tenant → unscoped repo), returning an arbitrary/merged tenant's rows. EDGE-013's posture is "no tenant data leak"; a tenant-0 fallback (as `branding.ts` already does) would match it.
**Evidence:** ADV-HOME + ADV-XA2 above; `packages/api/src/auth/tenant-scope.ts:50-54`; no-slug `/api/home` returned inference content with two active tenants seeded.
**Why minor not blocker:** the data is public-per-tenant (archives/home are world-readable on each tenant's own host), so this is a content-attribution/merge bug on the app root, not an exposure of private data. This is the **same finding pass-1 logged as Minor** ("App-host public API serves cross-tenant merged data") — verified still present; the fix (tenant-0 fallback) was deliberately deferred.

### ADV-2 — Canon feature flag OFF hides only the nav, not the page/API (EDGE-014 partially unmet)  `[confirmed]`  — severity: minor
**Reproduction:** `PUT /api/settings/features {"featureCanon":false,…}` → 200, DB `feature_canon=f`. Then on the tenant's own host: `GET /api/home` still returns `featuredCanon` (title "Verify Canon Entry") → the public homepage "FROM THE CANON" block still renders; `GET /api/must-read` → **200** with the entry → the public Must Read page is still fully served. Only the masthead nav link is hidden (web-side, flag-driven).
**Actual vs expected:** EDGE-014 specifies "**Page**/nav hidden; data retained, not deleted." The data-retention half is correct (rows survive), and the nav half is correct, but the **page and its API are not gated on `feature_canon`** — `packages/api/src/routes/home.ts` sets `featuredCanon` unconditionally from `mustReadRepo.findRandom()` and `packages/api/src/routes/must-read.ts` fences by tenant but never checks the flag (grep: no `feature_canon`/`featureCanon` reference in either route).
**Evidence:** ADV-CANON above (200 + entry with flag off; canon block present in `/api/home`).
**Why minor not blocker:** Must Read content is inherently public (a curated reading list), so this is a feature-gating gap, not a private-data leak. Note the phase claim PHASE16-C2 only promised "hides the public Must Read **nav**" — the implementation matches the claim's literal wording but falls short of the broader EDGE-014 spec text. Flagged so the gap is on record; recommend gating the home canon block + `/api/must-read` (and ideally the `/must-read` SPA route) on the flag.

### ADV-3 — Double-activate of an already-active tenant returns a misleading "incomplete" error  `[confirmed]`  — severity: trivial
**Reproduction:** `POST /api/onboarding/activate` as the already-active agentloop admin → **409** `{"error":"incomplete","missing":["name","slug","headline","prompts","sources","schedule"]}`.
**Actual vs expected:** An already-active tenant should get an idempotent success or an "already active" response, not a 409 claiming required onboarding steps are missing (they aren't — the tenant is live). No state was mutated and no harm results; the message is just wrong for this state.
**Evidence:** ADV-DBL above.
**Why trivial:** Pure messaging; the endpoint correctly refuses to re-run activation and changes nothing. Cosmetic.

## 4. Cannot assess

- **End-to-end broadcast fail-closed send-path (REQ-084 runtime)** — exercising an actual broadcast job (verified-domain FROM vs blocked-on-NULL) requires the pipeline worker consuming a publish job; the worker was intentionally not started (the brief warns against running pipeline e2e concurrently with web e2e, and no real Resend send is permitted). The DB invariant that gates it (fresh tenants → NULL `sending_domain_status` → blocked) was verified (ADV-GATE), and the send-path itself is **COVERED_BY_E2E** (`email-send.test.ts` `test_REQ_084_broadcast_sends_from_verified_tenant_domain` + grandfather case, and `publish-dry-run-guard`). Not independently re-run here.
- **REQ-127 migration atomicity on a copy** — structural property of the migration set (verified by review pass-2 §4 and the `verify-agentloop-migration.ts` gate); not an HTTP/UI surface, so not adversarially probed.

## 5. Honest declaration

**Defects found: 3 (ADV-1 minor, ADV-2 minor, ADV-3 trivial). See section 3.** None is a blocker; none exposes private cross-tenant data or breaks the isolation fences that pass-1/pass-2 hardened.

I genuinely tried to break the isolation model. The most promising attack was the cross-tenant run-state suite (ADV-ISO1–5) — that was exactly the class of bug pass-2 fixed in commit `b670374` (run-list/observability/source-items Redis leaks), so I drove all five Redis-backed read paths plus cancel with a real foreign live run; every one fenced to 404/absent and the owner's control request still worked. The second most promising was impersonation confinement (ADV-IMP2): a super_admin carrying both an `AllTenantsScope` capability and an impersonation overlay is the natural place for a scope to leak, but tenant-scoped reads during impersonation returned only the impersonated tenant's rows. Where I did land hits (ADV-1, ADV-2) the root cause is the same in spirit — a *flag/host gate that stops at the nav/UI layer while the underlying public API still serves the data* — and in both cases the data is public-by-design, which is why they're minor rather than isolation breaches. ADV-1 is a re-confirmation of a pass-1 Minor that was deliberately deferred.
