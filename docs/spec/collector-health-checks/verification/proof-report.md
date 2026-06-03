# Proof Report — collector-health-checks

**Verdict: PASSED.** C7-015 (UI) independently re-proven via live Playwright browser. All non-UI claims COVERED_BY_E2E (78 passed / 0 failed in `claims.json`). Adversarial pass clean (18 scenarios, 0 defects).

## 1. Summary table

| Scenario | Type | Description | Verdict |
|----------|------|-------------|---------|
| C7-015 | ui | Settings page Check + Check all controls; trigger→modal→polling→terminal; Web→blog; never-checked | **PASSED** (live Playwright) |
| VS-3 / REQ-005/007 | api+redis | Trigger via API → collector reaches terminal in Redis with no TTL | **PASSED** (live) |
| REQ-001/003 | api | POST /check{collector:hn} → 202 {enqueued:[hn]}, setRunning | **PASSED** (live) |
| REQ-002 | api | POST /check no body → all enabled | **PASSED** (live) |
| REQ-008/EDGE-006 | api | GET snapshot → 5 collectors, never w/ nulls | **PASSED** (live) |
| EDGE-001 | api | Check all, zero enabled → 202 {enqueued:[]} | **PASSED** (live) |
| EDGE-013 | api | Explicit disabled collector still enqueued | **PASSED** (live) |
| EDGE-005/REQ-022 | api | web_search + query, TAVILY unset → names TAVILY_API_KEY | **PASSED** (live) |
| EDGE-008 | api+worker | Concurrent same-collector → clean single terminal | **PASSED** (live) |
| REQ-023 | api | Unauth POST/GET → 401 | **PASSED** (live) |
| Phase claims | unit/api/db | 78 claims | **COVERED_BY_E2E** |

## 2. API evidence

All run with a real admin session cookie (`/api/admin/login` → 200). Live against API :3000 (DB :5455, Redis :6399, pipeline worker up).

- `POST /api/admin/collector-health/check {"collector":"hn"}` → `202 {"enqueued":["hn"]}`; snapshot immediately `hn:running`; polled → `{status:healthy, durationMs:667, detail:"algolia hits: 1"}`. Redis `TTL collector-health:hn` = **-1** (persistent, REQ-007).
- `POST …/check {"collector":"twitter"}` (no sources) → `202`; terminal `{status:failed, reason:"not configured — add sources at /admin/settings", durationMs:0}` (REQ-021, status accuracy — not stuck running).
- `POST …/check {}` with all collectors disabled → `202 {"enqueued":[]}` (EDGE-001), no queue.add.
- `POST …/check {"collector":"web_search"}` with a query but TAVILY unset → terminal `{status:failed, reason:"TAVILY_API_KEY is not configured — set it in your environment"}` (EDGE-005/REQ-022 — names exact secret).
- `GET /api/admin/collector-health` fresh → all 5 collectors `{status:"never", trigger:null, checkedAt:null, durationMs:null, reason:null, detail:null}` (REQ-008/EDGE-006).
- Unauth `POST`/`GET` → `401 {"error":"unauthorized"}` (REQ-023). Garbage cookie → `401`.
- Blog: terminal `{status:healthy, durationMs≈8900, detail:"crawled huggingface.co"}` (crawl-only, EDGE-009).
- Reddit: terminal `{status:healthy, detail:"r/localllama: 25 entries"}`.

(No `verification/api/*.txt` files written — evidence captured inline above and corroborated by the unit/integration suite per claims.json.)

## 3. UI evidence (live Playwright, 1280×1100, Chromium)

| Route | State | Screenshot | Verdict |
|-------|-------|-----------|---------|
| /admin/settings | Sources controls baseline (5× Check + Check all; nav top, SaveBar bottom) | `verification/screenshots/C7-015-01-controls-baseline.png` | MET |
| /admin/settings | HN modal — Healthy pill, Checked 1s, Duration 688ms, Detail "algolia hits: 1" | `verification/screenshots/C7-015-02-modal-hn-healthy.png` | MET |
| /admin/settings | Twitter modal — Failed pill + red reason "not configured — add sources at /admin/settings" | `verification/screenshots/C7-015-03-modal-twitter-failed.png` | MET |
| /admin/settings | Web(blog) modal — Running spinner pill, "Checked 0s ago" (Web→blog mapping; resolved to "crawled huggingface.co") | `verification/screenshots/C7-015-04-modal-blog-running.png` | MET |

C7-015 proven: per-row Check + Check all controls (REQ-017), modal renders status/checkedAt/duration/detail/reason (REQ-018), running→terminal via 2s poll then stops (REQ-019), Web row → collector id "blog". Per-screenshot grades + layout-invariant check in `screenshots/observations.md`.

## 4. DB evidence

No SQL migration in this feature (Redis-only state — `collector-health:<collector>` keys). Baseline migrations applied clean (`db:migrate` → "migrations applied successfully"). State verified directly in Redis: `GET collector-health:hn` returns the serialized `CollectorHealthResult` JSON; `TTL` = -1 (no expiry, REQ-007). user_settings singleton row seeded + updated via `PUT /api/settings` (200), which also triggered `reconcileCollectorHealthSchedule` (BullMQ `collector-health:repeat` scheduler key observed in Redis).

## 5. Visual anomalies & UX observations

Second pass clean across 4 screenshots; per-screenshot notes in `observations.md`. One non-blocking cosmetic note (NOT a defect): the modal heading capitalizes the raw collector id ("Hn — Health check", "Twitter — Health check") rather than the friendly source label; the Web row correctly uses "Web (blog listings)". No alignment/contrast/clipping/overlap issues; running spinner, status pills, and reason text all render correctly.

## 6. Spec coverage table

| Req | Scenario | Evidence | Status |
|-----|----------|----------|--------|
| REQ-001/002/003 | POST /check live | §2 | VERIFIED (live) |
| REQ-004/005 | trigger→worker→terminal | §2 (hn/reddit/blog), claims | VERIFIED (live + unit) |
| REQ-006 | strategy catches+classifies | claims PHASE3-C8 | COVERED_BY_E2E |
| REQ-007 | no TTL | §2 (TTL -1) | VERIFIED (live) |
| REQ-008/EDGE-006 | snapshot 5×never | §2, §3 | VERIFIED (live) |
| REQ-009 | dedicated worker, not concurrency:1 | claims REQ-009 | COVERED_BY_E2E |
| REQ-010 | allSettled isolation | claims REQ-010 | COVERED_BY_E2E |
| REQ-011/012, EDGE-007 | scheduler cron | claims; repeat key observed | COVERED_BY_E2E |
| REQ-013 | scheduled setRunning / manual not | claims REQ-013 | COVERED_BY_E2E |
| REQ-014/015/016 | Slack consolidated msg | claims PHASE4 + REQ-014/15/16 | COVERED_BY_E2E (webhook unset live) |
| REQ-017 | per-row Check + Check all | §3 C7-015-01 | VERIFIED (live) |
| REQ-018 | modal fields | §3 C7-015-02/03/04 | VERIFIED (live) |
| REQ-019 | poll→terminal, stop | §3 (modal stopped polling) | VERIFIED (live) |
| REQ-021 | not-configured reason | §2 (twitter/web_search) | VERIFIED (live) |
| REQ-022 | names missing secret | §2 (TAVILY_API_KEY) | VERIFIED (live) |
| REQ-023 | admin-gated 401 | §2 | VERIFIED (live) |
| EDGE-001 | zero enabled → [] | §2 | VERIFIED (live) |
| EDGE-002/003/004 | not-configured reasons | §2 (twitter), claims | VERIFIED (live + unit) |
| EDGE-005 | TAVILY unset names secret | §2 | VERIFIED (live) |
| EDGE-008 | concurrent last-writer-wins | adversarial §2 | VERIFIED (live) |
| EDGE-009 | blog crawl-only healthy | §2 (crawled huggingface.co) | VERIFIED (live) |
| EDGE-013 | disabled collector enqueued | §2 | VERIFIED (live) |

No `NOT VERIFIED` gaps.

## 7. E2E coverage summary

`claims.json`: 121 executed, 78 passed, 0 failed across phases 1–7. All `type:"unit"`, `type:"api"`, `type:"db"` claims are COVERED_BY_E2E (cited via `proven_by` in claims.json) and not re-run here. The sole `type:"ui"` claim C7-015 was re-proven fresh via live Playwright (§3). No `.harness/collector-health-checks/e2e-report.json` consulted; phase claims used as the authority.

## 8. Adversarial findings

From `verification/adversarial-findings.md` (verbatim declaration):

> **No defects found across 18 scenarios attempted.** Categories exercised: zero-state, permissions/config, status-accuracy, reason-precedence, missing-secret naming, concurrency (same-collector + check-all races), boundary enums, type confusion, malformed body, auth boundary (unauth/garbage-cookie/method), and UI polling-stop.

Highlights (all EXPECTED, no DEFECT): reason-precedence (no-sources check precedes missing-secret check, then names exact secret); concurrent same-collector + double Check-all both produced clean single terminal values with nothing stuck `running`; unknown/`rss`/array/empty/null collector all 400; garbage cookie 401; DELETE 404; malformed JSON gracefully falls back to "Check all".

## 9. Not executed

- **Live-modal "Never checked" screenshot:** non-deterministic (sub-100ms cached-never window before the synchronous route setRunning + ~1s check resolution). Proven via live snapshot API (all-never) + unit C7-006.
- **Slack webhook POST on failures:** `SLACK_WEBHOOK_URL` unset in this env (correct no-op observed: `slack.notify.disabled`). Posting/idempotency covered by unit claims.
- **Scheduled auto-check firing on its real 30-min-pre-run cron:** scheduler registered (Redis `collector-health:repeat` key present) but not waited out; semantics unit-claimed (REQ-011/012/013, EDGE-007).

## 10. Infrastructure

Started by this skill (all cleaned up / left per contract):
- **Postgres** container `chc-verify-pg` on host port **5455** (worktree compose ports 5433/6379 were already bound by sibling-worktree/host processes that did not accept the `newsletter` password; ran a dedicated pair to avoid the conflict). Migrations applied.
- **Redis** container `chc-verify-redis` on host port **6399**.
- **API** (`tsx src/index.ts`, no watch — `pnpm dev`'s `tsx watch` + Vite both hit the host ENOSPC inotify limit) on :3000, env `DATABASE_URL`/`REDIS_URL` overridden to the dedicated ports.
- **Pipeline worker** (`tsx src/index.ts`) with `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` set to `~/.cache/ms-playwright/chromium-1217/chrome-linux64/chrome` (required by `assertChromiumInstalled()` boot gate; the blog strategy crawls).
- **Web**: served the production `dist` build via a tiny static+`/api`-proxy node server on :5173 (Vite dev/preview unusable under the inotify limit).

These four processes + the two containers should be torn down by the caller after the gate (left running for post-gate inspection per the project quality-gate teardown convention; `infra:down` intentionally not run).
