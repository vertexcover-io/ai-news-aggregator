# Functional Verification Proof Report — multi-tenant

**Verdict: PASS** (no blocker; 3 minor/trivial adversarial defects recorded, none breaks tenant isolation or the gate).
Date: 2026-06-12. Stack: API :3000, Vite :5173, Postgres :5434/`newsletter_mt` (schema reset → migrate → AGENTLOOP backfill, fresh), Redis :6379 (stale keys cleared). External egress neutralized: SLACK_WEBHOOK_URL force-blanked (API logged `slack.notify.disabled`), ANTHROPIC/TAVILY keys blanked + browser route-stubs, Resend pointed at a local fake (`RESEND_BASE_URL=http://127.0.0.1:4571`). NO real external messages sent (S-web-04).

`claims.json`: 117 claims (51 api / 37 db / 29 ui), 2734 executed / 0 failed → no `failed>0` blocker. All 29 `type:"ui"` claims independently re-proven via Playwright MCP below (api/db claims cited COVERED_BY_E2E).

Seeded: AGENTLOOP (tenant 0, grandfathered), `inference` (2nd active tenant, full branding, Canon off), a fresh `pending_setup` tenant (created live through signup), `mlops-weekly` (created live end-to-end through the onboarding wizard), `super@vertexcover.io` (super_admin via reset-link onboarding).

---

## 1. Summary table

| Scenario | Type | Description | Verdict |
|----------|------|-------------|---------|
| VS-1 | ui+db | Sign up → 8-step wizard → slug states → resume → activate → live site + schedulers | PASS |
| VS-3 (partial) | ui+api | Branded homepage per host/slug; unknown slug 404; subscribe scoped per tenant | PASS |
| VS-4 | ui+db | Super-admin console, guard, audited impersonation + exit | PASS |
| VS-5 | ui+api | Sending domain → DNS records + Pending → Verify flips Verified | PASS |
| PHASE3-C1..C5 | ui | Auth surfaces (signup happy/errors, login, unauth redirect) | PASS |
| PHASE5-C8 / PHASE7-C1..C3 | ui | Public homepage per host + per-tenant branding/nav | PASS |
| PHASE6-C9 / PHASE15-C1..C4 | ui | Impersonation banner + super-admin console | PASS |
| PHASE8-C1..C3 | ui | Settings Sources panel (no standalone route) | PASS |
| PHASE11-C1..C7 | ui | Onboarding wizard | PASS |
| PHASE12-C7 | ui | Social credentials panel (LinkedIn connect-only, Twitter keys) | PASS |
| PHASE14-C1 | ui | Sending-domain panel | PASS |
| PHASE16-C1..C3 | ui | Notifications + features panels | PASS (see ADV-2 for the EDGE-014 page-gating gap) |
| Adversarial (26 scenarios) | mixed | Cross-tenant isolation / secrets / impersonation / broadcast gate | 3 minor/trivial defects, rest EXPECTED |

---

## 2. API evidence (adversarial + control curls; full set in adversarial-findings.md §2)

Tenant resolution + isolation (verbatim status codes):
```
/api/home  x-tenant-slug: agentloop          → 200  (todaysIssue "Agents are eating the toolchain")
/api/home  x-tenant-slug: no-such-tenant      → 404
GET  /api/runs/<agentloop-runId>  as inference → 404   (control as agentloop → 200)
GET  /api/admin/runs/<id>/observability inference → 404
POST /api/runs/<id>/cancel  as inference        → 404   (agentloop run unaffected)
GET  /api/runs  as inference                    → agentloop runId ABSENT from list
DELETE/PATCH /api/sources/<inference-srcId> as agentloop → 404 / 404 (row survived for inference)
GET  /api/archives/<agentloop-id> x-tenant-slug: inference → 404 ("not found")
GET  /api/super/app-credentials  as agentloop   → 403
GET  /api/super/tenants  as inference            → 403
POST /api/super/impersonate/:id  as inference    → 403
Cookie: session=garbage / single-byte-tampered   → 401 / 401
POST /api/subscribe (same email, two hosts)      → 200 + 200 → two independent pending rows
POST /api/onboarding/logo  oversize / wrong-type → 400 / 400
POST /api/onboarding/activate (incomplete tenant) → 409 {"error":"incomplete","missing":[...]}
GET  /api/settings/notifications                 → {"slackWebhookSet":true,...} (no hooks.slack.com)
GET  /api/admin/social-credentials               → {configured,updatedAt,apiVersion} only (no ct/iv/tag)
```

## 3. UI evidence (Playwright MCP — one line per `type:"ui"` claim id + screenshot path)

Full per-screenshot spec-check + open-visual-review in `verification/screenshots/observations.md`. All PNGs `Read`-graded (not inline previews). 16 captures, each ≤200KB.

- **PHASE3-C1** signup → 8-step wizard landed, session set → verification/screenshots/PHASE3-C1-PHASE11-C3-wizard-step1-live-preview.png
- **PHASE3-C2** mismatched confirm → "Passwords do not match", no row → verification/screenshots/PHASE3-C2-C3-signup-errors.png
- **PHASE3-C3** duplicate email → 409 "already in use", no second account → verification/screenshots/PHASE3-C2-C3-signup-errors.png
- **PHASE3-C4** login ok + wrong password "Incorrect email or password." → verification/screenshots/PHASE3-C4-C5-login-error-unauth-redirect.png
- **PHASE3-C5** unauth `/admin/*` → `/admin/login?next=…` → verification/screenshots/PHASE3-C4-C5-login-error-unauth-redirect.png
- **PHASE5-C8** public homepage served per slug; unknown slug 404 → verification/screenshots/PHASE5-C8-PHASE7-C1-agentloop-homepage.png
- **PHASE6-C9** impersonation banner across shell + exit clears (survives reload) → verification/screenshots/PHASE6-C9-PHASE15-C3-impersonation-banner.png
- **PHASE7-C1** AGENTLOOP homepage unchanged: section order, legacy hero, full nav, colophon → verification/screenshots/PHASE5-C8-PHASE7-C1-agentloop-homepage.png
- **PHASE7-C2** 2nd tenant own branding+logo, no "AGENTLOOP"/"Vertexcover" string → verification/screenshots/PHASE7-C2-C3-inference-homepage.png
- **PHASE7-C3** per-tenant nav derivation (Sources always; no Must Read/Built for non-canon/non-0) → verification/screenshots/PHASE7-C2-C3-inference-homepage.png
- **PHASE8-C1** Sources panel inside Settings; `/admin/sources` renders 404 → verification/screenshots/PHASE8-C1-C2-C3-settings-sources-panel.png
- **PHASE8-C2** manual add row; enable toggle persists across reload; remove persists → verification/screenshots/PHASE8-C1-C2-C3-settings-sources-panel.png
- **PHASE8-C3** invalid manual add → 400 toast "invalid listing URL", no row → verification/screenshots/PHASE8-C1-C2-C3-settings-sources-panel.png
- **PHASE11-C1** mid-wizard reload resumes; `/admin` bounces to wizard; fresh login funnels to wizard step 8 → verification/screenshots/PHASE11-C7-activated-public-site.png
- **PHASE11-C2** slug live states reserved/taken/available → verification/screenshots/PHASE11-C2-wizard-slug-states.png
- **PHASE11-C3** live preview renders real Hero with typed name/headline/strip, lorem placeholders → verification/screenshots/PHASE3-C1-PHASE11-C3-wizard-step1-live-preview.png
- **PHASE11-C4** Generate prompts → two editable textareas (stubbed); edit persists to user_settings → verification/screenshots/PHASE11-C4-wizard-prompts-stubbed.png
- **PHASE11-C5** discovery pills (stubbed); Selected stays 0 until click; manual add alongside → verification/screenshots/PHASE11-C5-wizard-sources-discovery.png
- **PHASE11-C6** Activate disabled + missing-steps list; server `POST /activate` → 409 missing list → verification/screenshots/PHASE11-C6-activate-blocked-incomplete.png
- **PHASE11-C7** Activate flips tenant active; profile+settings+sources+scheduler reconciled; public site LIVE → verification/screenshots/PHASE11-C7-activated-public-site.png
- **PHASE12-C7** LinkedIn connect-only (super-admin hint), no Twitter cookie card, tenant Twitter keys save/clear → verification/screenshots/PHASE12-C7-social-credentials-panel.png
- **PHASE14-C1** add domain → DNS records table + Pending badge; Verify flips Pending→Verified → verification/screenshots/PHASE14-C1-sending-domain-pending.png
- **PHASE15-C1** super_admin lands on tenant-list console with name/owner/slug/status/subs/last-run → verification/screenshots/PHASE15-C1-C2-C4-super-admin-console.png
- **PHASE15-C2** tenant_admin `/admin/tenants` bounces to own dashboard; `/api/super/tenants` 403 → verification/screenshots/PHASE15-C1-C2-C4-super-admin-console.png
- **PHASE15-C3** "Open →" starts audited impersonation into tenant dashboard with banner → verification/screenshots/PHASE6-C9-PHASE15-C3-impersonation-banner.png
- **PHASE15-C4** search (name/slug/email) + status select narrow list; stats strip totals → verification/screenshots/PHASE15-C1-C2-C4-super-admin-console.png
- **PHASE16-C1** notification email + Slack webhook persist; webhook D-012 ciphertext, API reports only slackWebhookSet → verification/screenshots/PHASE16-C1-C2-C3-notifications-features.png
- **PHASE16-C2** flags default OFF (fresh tenants); independent toggles; Canon OFF hides nav, rows retained, Canon ON restores → verification/screenshots/PHASE16-C1-C2-C3-notifications-features.png  (see §5/ADV-2: page+API not gated — EDGE-014 partial)
- **PHASE16-C3** no shortlist-size control; internal default 30 submitted unchanged → verification/screenshots/PHASE16-C1-C2-C3-notifications-features.png

## 4. DB evidence

```
tenants: agentloop/active/canon=t, inference/active/canon=f, mlops-weekly/active (live-activated), pending-*/in_setup
users:   admin@agentloop.dev tenant_admin(+tenant), admin@inference.dev tenant_admin(+tenant), super@vertexcover.io super_admin(no tenant)
PHASE3-C2/C3: count(users where email=mismatch/dup-attempt)=0 after failed signups; tenants count unchanged
PHASE8-C2:   sources row type=reddit config{subreddit:LocalLLaMA}; enabled true→false persisted; delete → 0 rows
PHASE11-C7:  mlops-weekly user_settings.ranking_prompt = "...EDITED-BY-VERIFIER." (wizard edit persisted); 2 sources;
             Redis repeat key bull:processing:repeat:pipeline-run:<tenantId> matches tenants.id
PHASE16-C1:  tenants.slack_webhook = {"ct":..,"iv":..,"tag":..} (D-012 ciphertext, no plaintext URL)
PHASE16-C2:  feature_canon/deliverability/eval = f,f,f for inference/mlops-weekly/pending; agentloop grandfathered on;
             toggling Eval changed only feature_eval; must_read_entries row survived Canon-off
PHASE16-C3:  user_settings.shortlist_size = 30 (internal default) after save
ADV-IMP:     audit_log rows impersonation_start + impersonation_stop (actor=super id, tenant_id=inference id)
ADV-SUB:     subscribers (agentloop, adv-sub@…, pending) + (inference, adv-sub@…, pending) — two independent rows
ADV-GATE:    sending_domain_status NULL for inference/mlops-weekly/pending (broadcast fail-closed)
```

## 5. Visual anomalies & UX observations

Second pass clean on cosmetics across all 16 screenshots; per-screenshot open-review notes in `observations.md` (no alignment/contrast/clipping/overlap/empty-state defects; sticky save bar renders at viewport bottom, not mid-page; single-column Elsewhere strip on the 2nd tenant is intentional, no empty grid cells).

One spec-level `UNMET` escalated from the adversarial pass:
- **PHASE16-C2 / EDGE-014 — page not hidden (only nav).** With `feature_canon=false`, `/api/home` still returns the `featuredCanon` block and `/api/must-read` still serves the entries (200). The web nav link is hidden, but the home canon block + Must Read page/API are not gated on the flag (`home.ts`/`must-read.ts` carry no `feature_canon` check). EDGE-014 says "Page/nav hidden." Classified MINOR (Must Read content is public-by-design; the phase claim only promised nav-hiding, which holds). See ADV-2.

## 6. Spec coverage table

| Req / VS | Verified by | Evidence |
|----------|-------------|----------|
| REQ-001/002/003 (signup) | PHASE3-C1/C2/C3 UI + DB | screenshots/PHASE3-* + §4 |
| REQ-005 (signed cookie) | ADV-TAMP1/2 | adversarial §3 (garbage/tampered → 401) |
| REQ-007 (admin gate) | PHASE3-C5 UI | screenshots/PHASE3-C4-C5 |
| REQ-010/011/014 (tenant_id + scope) | ADV-XW + ISO + COVERED_BY_E2E | adversarial §2; phase-1/4 db claims |
| REQ-013 (run-state fence) | ADV-ISO1..5 | adversarial §3 (all 404/absent) |
| REQ-021/EDGE-013 (host resolve) | PHASE5-C8 + ADV-1 | screenshots/PHASE5-C8; **ADV-1 app-host fallback (minor)** |
| REQ-025/028/030/032/033/035/036/037/038 (wizard) | PHASE11-C1..C7 | screenshots/PHASE11-* |
| REQ-039 (logo validation) | ADV-LOGO1/2 | adversarial §3 (400/400) |
| REQ-040/041/042/EDGE-014 (branding+nav) | PHASE7-C1/C2/C3 + PHASE16-C2 | screenshots/PHASE7-*; **EDGE-014 page-gating gap (ADV-2, minor)** |
| REQ-044 (cross-host archive) | ADV-XA1 | adversarial §3 (404) |
| REQ-050/051 (subscribe scoping) | ADV-SUB1 | adversarial §3 (two pending rows) |
| REQ-070/072/074 (sources panel) | PHASE8-C1/C2/C3 | screenshots/PHASE8-* |
| REQ-082/092 (creds/notifications) | PHASE12-C7 / PHASE16-C1 | screenshots; §4 ciphertext |
| REQ-084/085 (sending domain) | PHASE14-C1 + ADV-GATE | screenshots/PHASE14-C1; broadcast send-path COVERED_BY_E2E |
| REQ-093/094 (flags/shortlist) | PHASE16-C2/C3 | screenshots/PHASE16-* |
| REQ-100/101/102/103 (super+impersonation) | PHASE15-C1..C4 + PHASE6-C9 + ADV-IMP2 | screenshots; audit_log rows |
| REQ-125 (no app secret in response) | ADV-SEC1/2/3 | adversarial §3 |
| REQ-111..115/124/127 (migration/telemetry) | COVERED_BY_E2E | see §7 |

No requirement is `NOT VERIFIED` without an evidence path; migration-internal and telemetry-attribution REQs are COVERED_BY_E2E (structural, not an HTTP/UI surface).

## 7. E2E coverage summary

`type:"api"` (51) and `type:"db"` (37) claims are `COVERED_BY_E2E` — proven during the coding stage and aggregated into `.harness/runtime/multi-tenant/claims.json` (2734 executed / 0 failed across 19 phases / 19 e2e runs). Not re-run here per the skill contract. Notable cited tests: run-state fences `test_REQ_013_*` (runs-tenant-fence/run-list/run-observability/run-source-items), subscribe scoping `test_REQ_050/051_*`, raw_items composite `tenant-isolation.e2e`, broadcast FROM-domain `test_REQ_084_broadcast_sends_from_verified_tenant_domain` + grandfather, Slack SSRF guard table, rate-limit XFF. The 29 `type:"ui"` claims were re-proven fresh via Playwright MCP (§3).

## 8. Adversarial findings (quoted from verification/adversarial-findings.md)

26 scenarios attempted; **3 defects (2 minor, 1 trivial), rest EXPECTED.** Quoted verbatim:

> **ADV-1 — App-host (no Host slug) serves cross-tenant merged public data `[confirmed]` — severity: minor.** `curl http://127.0.0.1:3000/api/home` (no `x-tenant-slug`) → `todaysIssue.digestHeadline = "Quantization without tears"` (the **inference** tenant's issue) … `curl …/api/archives/<agentloop-archive-id>` (no slug) → **200**, while the same id on `x-tenant-slug: inference` → 404. … the public read paths fall through to unscoped legacy mode. … the data is public-per-tenant … not an exposure of private data. This is the **same finding pass-1 logged as Minor**, verified still present; the fix (tenant-0 fallback) was deliberately deferred.

> **ADV-2 — Canon feature flag OFF hides only the nav, not the page/API (EDGE-014 partially unmet) `[confirmed]` — severity: minor.** With `feature_canon=false`, `GET /api/home` still returns `featuredCanon` … `GET /api/must-read` → **200** with the entry. … `home.ts` sets `featuredCanon` unconditionally and `must-read.ts` … never checks the flag. … Must Read content is inherently public, so this is a feature-gating gap, not a private-data leak. … the phase claim PHASE16-C2 only promised "hides the public Must Read **nav**".

> **ADV-3 — Double-activate of an already-active tenant returns a misleading "incomplete" error `[confirmed]` — severity: trivial.** `POST /api/onboarding/activate` as the already-active agentloop admin → **409** `{"error":"incomplete","missing":[…]}`. … No state was mutated … Cosmetic.

EXPECTED (correct rejections, not defects): cross-tenant run reads/cancel/list (ADV-ISO1–5 → 404/absent), cross-tenant source PATCH/DELETE (404), cross-host archive (404), app-credentials/super routes for tenant_admin (403), impersonation confinement (inference-scoped only), session tamper (401), subscribe scoping (two pending rows), logo validation (400), broadcast fail-closed (NULL status), run-payload zod validation (400). The cross-tenant run-state suite is exactly the class pass-2 fixed in `b670374` — re-driven, all fences hold.

## 9. Not executed

- **Live broadcast send-path (REQ-084 runtime)** — requires the pipeline worker consuming a publish job + no real Resend send; worker intentionally not started (brief forbids concurrent pipeline/web e2e and real sends). DB gate invariant verified (ADV-GATE); send-path is COVERED_BY_E2E.
- **REQ-127 migration atomicity-on-copy** — structural migration property (review pass-2 §4 + `verify-agentloop-migration.ts`); no HTTP/UI surface.
- **Real DNS propagation for sending domain** — Resend faked locally; the status state-machine (Pending→Verified) was exercised against the fake, real DNS not validated.
- **The env-gated live-Resend network test** (`tests/e2e/network/newsletter-send.e2e.test.ts`) — fails only on the external Resend daily quota; known-excluded environmental gap, not a code defect.

## 10. Infrastructure

Started by this skill (to be torn down): API dev server (pid group ~17865), Vite dev server (pid 18166), fake Resend (pid 17694), Playwright browser (closed at end of §3). Already running, left as-is: Postgres container `newletter_postgres_1` (:5434, I started it from Exited state — leaving up per quality-gate post-inspection convention) and Redis (:6379). Postgres schema was reset+migrated+backfilled fresh at the start (per the stale-DB false-green lesson — `newsletter_mt` schema dropped/recreated, NOT `infra:reset`, to avoid the 5433/5434 port conflict). Verification artifacts under `verification/` left in place.
