# Adversarial Findings — collector-health-checks

Role: critic. Goal: break the feature. Run live against API(:3000) + pipeline worker + Redis(:6399) + Postgres(:5455) with a real admin session.

## 1. Attack surface derived

Computed by diffing spec ACs (`spec.md`) against `claims.json` `claims[]` and looking for under-exercised paths:

- **Credential/precedence reasons (REQ-021 vs REQ-022, EDGE-002/003/004/005):** does the "not configured" (no sources/queries) reason correctly precede the "missing secret" reason, and does each name the exact secret? — *spec-gap: claims cover the strategy unit tests, not the live precedence ordering.*
- **Auth boundary (REQ-023):** unauthenticated, garbage-cookie, wrong-method, type-confusion bodies. — *claim-coverage-gap: claims assert 401 for clean unauth; not garbage/expired tokens or method confusion.*
- **Concurrency (EDGE-008):** two checks of the same collector + double "Check all" — does anything get stuck `running` or corrupted? — *spec-gap: EDGE-008 is unit-claimed (last-writer-wins) but not exercised live end-to-end.*
- **Boundary inputs:** empty string, null, array, unknown enum, unimplemented sourceType (`rss`), malformed JSON body.
- **Zero-enabled (EDGE-001):** "Check all" with all collectors disabled.
- **Status accuracy:** does a misconfigured collector show `failed` with a human reason, or get stuck `running`?

## 2. Scenarios attempted

| ID | Category | Description | Inputs | Verdict |
|----|----------|-------------|--------|---------|
| ADV-EDGE001 | Boundary / zero-state | "Check all" with all 5 collectors disabled | `{}` body, all `*_enabled=false` | EXPECTED — 202 `{enqueued:[]}`, no queue.add, snapshot unchanged |
| ADV-EDGE013 | Permissions/config | Explicit disabled collector (twitter) triggered | `{"collector":"twitter"}` | EXPECTED — 202 `{enqueued:["twitter"]}`, ran to `failed` |
| ADV-status | Status accuracy | twitter (no sources) — must fail with reason, not stick running | `{"collector":"twitter"}` | EXPECTED — `failed`, reason "not configured — add sources at /admin/settings", dur 0ms |
| ADV-REQ021-prec | Precedence | web_search with NO queries + TAVILY unset — which reason wins? | `{"collector":"web_search"}`, queries=[] | EXPECTED — `failed`, "not configured — add sources" (no-sources check precedes secret check; correct) |
| ADV-EDGE005 | Missing secret | web_search WITH a query but TAVILY_API_KEY unset | `{"collector":"web_search"}`, queries=[{...}] | EXPECTED — `failed`, "TAVILY_API_KEY is not configured — set it in your environment" (names exact secret, REQ-022) |
| ADV-EDGE008 | Concurrency | two `hn` checks enqueued simultaneously | 2× `{"collector":"hn"}` in parallel | EXPECTED — both 202; final single clean terminal `healthy` (dur 417ms, "algolia hits: 1"); not stuck/corrupted |
| ADV-doublecheckall | Concurrency | two "Check all" enqueued simultaneously | 2× `{}` in parallel | EXPECTED — both 202 enqueuing 4 enabled; all reached terminal; none stuck `running` |
| ADV-unknown | Boundary enum | unknown collector id | `{"collector":"github"}` | EXPECTED — 400 zod enum error listing valid options |
| ADV-rss | Boundary enum | unimplemented sourceType | `{"collector":"rss"}` | EXPECTED — 400 zod enum error |
| ADV-malformed | Boundary | malformed JSON body | `{bad json` | EXPECTED — parse fails → falls back to absent-collector → "Check all" enabled → 202 (graceful) |
| ADV-array | Type confusion | collector as array | `{"collector":["hn","reddit"]}` | EXPECTED — 400 zod enum error |
| ADV-empty | Boundary | empty-string collector | `{"collector":""}` | EXPECTED — 400 zod enum error |
| ADV-null | Boundary | explicit null collector | `{"collector":null}` | EXPECTED — 400 (null rejected; "Check all" requires key absent, not null; FE never sends null) |
| ADV-unauth-post | Auth | unauthenticated POST | no cookie | EXPECTED — 401 `{error:"unauthorized"}` |
| ADV-unauth-get | Auth | unauthenticated GET snapshot | no cookie | EXPECTED — 401; no health data served |
| ADV-garbagecookie | Auth | garbage admin_session cookie | `admin_session=garbage.invalid.token` | EXPECTED — 401, no data leak |
| ADV-method | Auth/routing | DELETE on /check | DELETE | EXPECTED — 404 (no such route) |
| ADV-poll-stop | Status accuracy (UI) | does polling stop at terminal? | live browser modal | EXPECTED — modal opened running, resolved to terminal, `refetchInterval` returned false, polling stopped (no infinite spinner) |

## 3. Defects

None.

## 4. Cannot assess

- **Live-modal "Never checked" text capture:** the SourcesSection couples modal-open with the trigger and the API route sets `running` synchronously; checks resolve in ~1s, so the cached-`never`-snapshot render window in the modal is sub-100ms and not deterministically screenshot-able. The `never` state itself is proven via the live snapshot API (all 5 collectors returned `status:"never"`) and unit test C7-006. Not a defect — a test-capture limitation.
- **Slack consolidated-failure message (REQ-014/016):** `SLACK_WEBHOOK_URL` is unset in this env, so the actual webhook POST on failures was not exercised live (the worker logs `slack.notify.disabled` and no-ops — the correct unset behaviour, REQ-015). Webhook posting/idempotency is covered by unit claims PHASE4-C1..6, REQ-014/015/016.
- **Auto-check scheduled trigger (REQ-011/013):** the 30-min-pre-run repeatable scheduler was registered on settings save (BullMQ `collector-health:repeat` key observed in Redis), but firing it on its real cron was not waited out; scheduled-vs-manual trigger semantics are unit-claimed (REQ-011/012/013, EDGE-007).

## 5. Honest declaration

**No defects found across 18 scenarios attempted.** Categories exercised: zero-state, permissions/config, status-accuracy, reason-precedence, missing-secret naming, concurrency (same-collector + check-all races), boundary enums, type confusion, malformed body, auth boundary (unauth/garbage-cookie/method), and UI polling-stop.

The most promising attack was the **reason-precedence vs missing-secret** path (ADV-REQ021-prec / ADV-EDGE005): I suspected the strategy might surface a confusing "TAVILY_API_KEY missing" even when the real problem is "no queries configured," or conversely swallow the missing-secret case. It didn't land — the strategy checks "configured?" first (returns "not configured — add sources") and only reaches the secret check once a query exists, then names the exact secret. The second-most-promising was the **concurrency** path (could a parallel same-collector check leave a `running` zombie or a torn write?); the last-writer-wins Redis set plus the worker's per-collector terminal write produced a single clean terminal value every time, with nothing stuck. The feature correctly distinguishes "running" (transient) from "failed" (terminal with human reason) on every misconfiguration path I threw at it.
