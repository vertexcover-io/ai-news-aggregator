# Functional Verification — admin Sources button

**Spec:** docs/spec/admin-source-button/spec.md
**Date:** 2026-05-12
**Worktree:** `.claude/worktrees/admin-source-button`
**Branch:** `chore/remove-social-test-post` (worktree base)
**Verifier:** orchestrate Stage 5

## Environment

| Component | Detail |
|---|---|
| Postgres | podman container `admin-source-button_postgres_1` (host port 5435 → 5432 inside; 5433 was occupied by `claude-sessions-postgres` from a sibling worktree) |
| Redis    | podman container `admin-source-button_redis_1` (host port 6379) |
| API      | `pnpm --filter @newsletter/api dev` → `http://localhost:3000` |
| Web      | `pnpm --filter @newsletter/web dev` → `http://localhost:5173` (Vite proxies `/api` → `127.0.0.1:3000`) |
| Migrations | `pnpm --filter @newsletter/shared db:migrate` — applied OK |
| Seed     | `scripts/seed-verification.sql` — 3 `run_archives` rows + 6 `raw_items` |

## Seed fixtures

| runId | status | sourceTypes | rawItems matching window |
|---|---|---|---|
| `11111111-…-1111` | completed | `["hn","reddit","blog"]` | 6 (2 HN, 2 Reddit, 2 Blog) |
| `22222222-…-2222` | failed    | `NULL`                   | 0 |
| `33333333-…-3333` | completed | `["hn"]`                 | 0 (none match window) |

Also seeded a singleton `user_settings` row so the admin dashboard renders the runs table instead of the onboarding empty state.

---

## VS-1 — Modal opens with grouped items — PASS

**API:** `curl -b cookies http://localhost:3000/api/admin/runs/11111111-…/sources` → HTTP 200.
Body saved to `vs1-response.json` (6 items, no `content` field on any item, sorted blog→blog→hn→hn→reddit→reddit ASC by `sourceType`, then `COALESCE(publishedAt, collectedAt) DESC` within each group).

**UI:** Playwright navigated to `/admin/login`, signed in with `test123`, redirected to `/admin`. Clicked Sources button on row 1 — the Radix dialog opened with title "Sources — May 12, 2026", subtitle "6 items collected by 3 collectors", and three group headers in order:

```
HN · 2 items
  Show HN: open-source vector DB beats Pinecone   (dang, ⭐ 211, 💬 48, 42 minutes ago)
  GPT-7 announced with multimodal reasoning       (pg,   ⭐ 482, 💬 137, 52 minutes ago)
Reddit · 2 items
  Discussion: when will LLMs plateau?             (u/aidoomer, ⭐ 87, 💬 412, 22 minutes ago)
  Anthropic publishes new alignment paper         (u/ml_researcher, ⭐ 1340, 💬 215, 57 minutes ago)
Blog · 2 items
  Anthropic engineering: caching at scale         (Anthropic, ⭐ 0, 💬 0, 12 minutes ago)
  OpenAI: rolling out enterprise compliance pack  (OpenAI, ⭐ 0, 💬 0, 32 minutes ago)
```

All titles are anchor links pointing at the raw `url`. Screenshot: `vs1-modal-open.png`. JSON body: `vs1-response.json`.

---

## VS-2 — Disabled button for failed run with no items — PASS

The third runs-table row (`22222222-…`, status `failed`, 0 items) renders a Sources button with the `disabled` attribute set (confirmed in the accessibility snapshot: `button [disabled]: Sources`). The button has `title="No items collected"` tooltip.

Screenshot: `vs2-disabled-button.png`.

---

## VS-3 — API 404 for unknown run — PASS

```
$ curl -s -b cookies -o vs3-response.json -w 'HTTP %{http_code}\n' \
    http://localhost:3000/api/admin/runs/99999999-9999-9999-9999-999999999999/sources
HTTP 404
$ cat vs3-response.json
{"error":"Run not found"}
```

Matches `REQ-012` exactly. JSON body: `vs3-response.json`.

---

## VS-4 — API 401 without admin session — PASS

```
$ curl -s -o vs4-response.json -w 'HTTP %{http_code}\n' \
    http://localhost:3000/api/admin/runs/11111111-1111-1111-1111-111111111111/sources
HTTP 401
$ cat vs4-response.json
{"error":"unauthorized"}
```

`requireAdmin` middleware short-circuits before reaching the route handler. JSON body: `vs4-response.json`.

---

## VS-5 — Empty state for run with 0 items — PASS

**API:** `GET /api/admin/runs/33333333-…/sources` → HTTP 200, body `{"runId":"33333333-…","items":[]}`. Saved to `vs5-response.json`.

**UI:** opened the Sources modal for that row; the body contains the literal copy `No raw items collected for this run.` and no group headers/item rows. Screenshot: `vs5-empty-state.png`.

---

## Summary

| VS | Verdict | Evidence |
|----|---------|----------|
| VS-1 | PASS | `vs1-response.json`, `vs1-modal-open.png` |
| VS-2 | PASS | `vs2-disabled-button.png` |
| VS-3 | PASS | `vs3-response.json` |
| VS-4 | PASS | `vs4-response.json` |
| VS-5 | PASS | `vs5-response.json`, `vs5-empty-state.png` |

All five verification scenarios in `spec.md` PASS. No deviations.
