# Multi-Tenant Production Cutover Runbook (PR #284 / VER-110)

How to ship the multi-tenant branch (`feature/multi-tenant`, PR
[#284](https://github.com/vertexcover-io/ai-news-aggregator/pull/284)) to
production **without disrupting the existing AGENTLOOP newsletter**, which
becomes **tenant 0** of the new system.

> **Read this whole document before touching prod.** The naive path — "merge
> the PR and let the deploy run" — **will fail mid-deploy** and leave the
> cutover half-applied. The reason is explained in §2. The migration must be
> done as a deliberate, ordered, out-of-band step *before* the code deploy.

---

## 1. What you are deploying, in one breath

The branch converts the single-admin engine into a multi-tenant product. The
only production tenant that exists today — the AGENTLOOP newsletter — is
migrated in as **tenant 0** with **zero data loss** and unchanged public /
publishing behavior. There are **13 new migrations (0040–0052)**, two new core
tables (`tenants`, `users`), a `tenant_id` column on 13 existing tables, a
real email+password auth system replacing the shared-password gate, host-based
tenant routing, and a credentials rework.

- **Branch:** `feature/multi-tenant` — 47 commits ahead of `main`.
- **PR #284 is currently `CONFLICTING`** — merge conflicts with `main` must be
  resolved before it can merge (see §3, Step 0).
- **AGENTLOOP = tenant 0.** Reserved slug `agentloop`
  (`packages/shared/src/constants/tenant.ts`). It is created and backfilled by
  a one-time script, not by the migrations alone.

---

## 2. The core hazard — why "just deploy" breaks

The production deploy (`deployment/deploy.sh`, line 60) runs migrations like
this, inside the freshly-pulled `api` container:

```bash
docker compose ... run --rm --no-deps api node /app/migrate.mjs
```

`migrate.mjs` calls Drizzle's `migrate(..., { migrationsFolder })`, which
applies **every pending migration in the folder, in order, all-or-nothing**.
There is no "stop at 0040" option.

Two of the new migrations are sequenced around a **data backfill that is not a
migration**:

| Migration | What it does | Safe without backfill? |
|-----------|--------------|------------------------|
| **0040** `high_warbound` | Adds `tenants`, `users`; adds **nullable** `tenant_id` to 13 tables. | ✅ Additive, harmless. |
| *(backfill)* | `packages/scripts` → `migrate:agentloop`: creates tenant 0, stamps every existing row with its `tenant_id`, sets a column **DEFAULT** = tenant-0 id. | — runs *between* 0040 and 0041 |
| **0041** `talented_husk` | **Refuses to run** (`RAISE EXCEPTION 'multi-tenant enforce blocked…'`) if **any** row still has `NULL tenant_id`; otherwise enforces `NOT NULL`. | ❌ Hard-fails until backfill is done. |

The backfill script lives in `packages/scripts` and is **not baked into the
api/pipeline container images** — so the in-container `migrate.mjs` cannot run
it. Therefore, if you let the deploy apply migrations:

1. 0040 applies and commits.
2. 0041 hits its guard → `RAISE EXCEPTION` → `migrate.mjs` exits non-zero.
3. `deploy.sh` runs under `set -euo pipefail`, so it **aborts before
   `docker compose up -d`**. The old containers keep running (AGENTLOOP stays
   up), but the deploy is broken and the schema is stuck between 0040 and 0041.

**The fix:** apply migrations + run the backfill **out-of-band against the prod
DB first**, in the correct order, then deploy the code. After that, the
deploy's in-container `migrate.mjs` is a **no-op** (everything is already
applied) and the deploy completes cleanly.

### Why AGENTLOOP keeps running the whole time (the DEFAULT bridge)

The backfill sets a **column `DEFAULT` = tenant-0 id** on all 13 tables
(EDGE-012 bridge). So even after 0041 enforces `NOT NULL`, the *old* code
(which inserts rows without a `tenant_id`) still works — every insert defaults
to AGENTLOOP. Reads still resolve because every existing row was stamped. This
is what makes a near-zero-downtime cutover possible: old code and new schema
coexist safely.

The one un-bridged change is migration **0045** (credentials rework): it moves
the platform LinkedIn/Twitter-collector secrets out of `social_credentials`
into the new `app_credentials` table and re-keys `social_credentials` /
`social_tokens` to a `(tenant_id, platform)` primary key. *Old* code reading
those rows by the old key will not find them in the gap between migration and
code deploy. Keep that gap short (§3 runs Phase A and Phase B back-to-back); if
LinkedIn/Twitter posting or the Twitter collector happens to fire in that
window it may no-op once. The **daily email digest path is unaffected**
(Resend shared sender; AGENTLOOP's sending domain is grandfathered `verified`
by migration 0047).

---

## 3. The cutover, step by step

Do the whole thing in **one maintenance window**. Rough order:

```
Step 0  Pre-flight: resolve PR conflicts, set new secrets, pick the domain mapping
Step 1  Back up the production database
Step 2  Open a tunnel to the prod Postgres + Redis
Step 3  PHASE A — migrate + backfill + verify + enforce (out-of-band)
Step 4  PHASE B — deploy the code (migrate.mjs is now a no-op)
Step 5  DNS + TLS for tenant hosts
Step 6  Post-deploy verification (AGENTLOOP first)
Step 7  Seed super-admins + reset existing admin access
Step 8  Tear down the tunnel
```

### Step 0 — Pre-flight

**0a. Resolve PR #284 merge conflicts.** It is `CONFLICTING` against `main`.
Rebase/merge `main` into the branch, re-run the quality gate
(`pnpm lint && pnpm typecheck && pnpm test:unit`), and push. Do **not** merge
to `main` yet — the merge to `main` is what triggers the deploy, and we want the
DB migrated first.

**0b. Set the new production secrets** (repo → Settings → Environments →
`production` → Secrets). The deploy workflow validates these exist before it
will run, so add them now:

| Secret | Value | Notes |
|--------|-------|-------|
| `ROOT_DOMAIN` | e.g. `agentloop.live` | **Required.** Apex for `<slug>.<root>` tenant sites. Without it every tenant subdomain 404s. |
| `APP_HOST` | e.g. `app.agentloop.live` | **Required.** Admin/signup host; tenant comes from the session, never the Host header. |
| `CUSTOM_DOMAIN_MAP` | e.g. `news.vertexcover.io=agentloop,agentloop.vertexcover.io=agentloop` | **Strongly recommended for AGENTLOOP.** Keeps the *existing* public URL serving tenant 0 after cutover. Map every legacy host AGENTLOOP currently serves to `agentloop`. |
| `WEB_PROXY_URL` | optional | Egress proxy for 403-blocked sources; unrelated to tenancy. |

Do **not** change these existing secrets:

- **`SESSION_SECRET` — leave it exactly as is.** It is the HKDF KEK for the
  encrypted credentials at rest; rotating it invalidates every stored social
  credential (D-104). It must be ≥32 bytes (it already is).
- **`ADMIN_PASSWORD` — leave it set.** The shared-password gate is gone, but
  the deploy workflow still validates the secret is present. Keep it to avoid
  failing secret validation.
- `NEWSLETTER_BASE_URL` / `PUBLIC_BASE_URL` — used to build password-reset and
  archive links; confirm they point where you want reset emails to land.

**0c. Decide the tenant-0 identity** you will pass to the backfill:

- `AGENTLOOP_ADMIN_EMAIL` — **required**; becomes the tenant_admin login.
- `AGENTLOOP_SLUG` — defaults to `agentloop` (keep it).
- `AGENTLOOP_CUSTOM_DOMAIN` — AGENTLOOP's existing public domain, if you want it
  stamped on the tenant row (e.g. `news.vertexcover.io`).
- `SUPER_ADMIN_EMAILS` — comma-separated platform admins (you/Ritesh/Aman).

### Step 1 — Back up the production database

On the VPS:

```bash
docker compose --env-file /etc/newsletter/.env \
  -f /opt/newsletter/deployment/compose.prod.yml \
  exec -T postgres pg_dump -U newsletter newsletter | gzip > ~/newsletter-pre-mt-$(date +%F-%H%M).sql.gz
```

Verify the dump is non-empty before proceeding. This is your rollback anchor
(see §4).

### Step 2 — Open a tunnel to prod Postgres + Redis

The migration scripts (`packages/scripts`, run via `tsx`) need
`DATABASE_URL` + `REDIS_URL` pointing at prod. **Prod Postgres/Redis publish no
host ports** (compose binds only `api` to `127.0.0.1:3000`) and live only on the
internal `newsletter_default` compose network. Bridge them to the VPS loopback
for the window with throwaway `socat` sidecars, then SSH-forward to your
workstation:

```bash
# --- On the VPS: expose prod Postgres + Redis on the host loopback ---
docker run -d --name mt-pg-tunnel  --network newsletter_default -p 127.0.0.1:5432:5432 \
  alpine/socat tcp-listen:5432,fork,reuseaddr tcp-connect:postgres:5432
docker run -d --name mt-redis-tunnel --network newsletter_default -p 127.0.0.1:6379:6379 \
  alpine/socat tcp-listen:6379,fork,reuseaddr tcp-connect:redis:6379

# --- From your workstation: forward both to local ports ---
ssh -N -L 5432:127.0.0.1:5432 -L 6379:127.0.0.1:6379 deploy@<VPS_HOST>
```

> Alternative: if Node 22 + pnpm are installed on the VPS, skip the tunnel and
> run Steps 3/7 *on the VPS* from a branch checkout, using the socat loopback
> ports (`DATABASE_URL=postgres://newsletter:<pw>@127.0.0.1:5432/newsletter`,
> `REDIS_URL=redis://127.0.0.1:6379`).

Now, in a checkout of `feature/multi-tenant` on the machine that has the tunnel,
export prod connection vars (these point at the tunnel) and the tenant-0
identity:

```bash
export DATABASE_URL='postgres://newsletter:<PROD_PG_PASSWORD>@127.0.0.1:5432/newsletter'
export REDIS_URL='redis://127.0.0.1:6379'

export AGENTLOOP_ADMIN_EMAIL='<TENANT0_ADMIN_EMAIL>'         # the AGENTLOOP tenant_admin login
export AGENTLOOP_SLUG='agentloop'
export AGENTLOOP_CUSTOM_DOMAIN='<AGENTLOOP_CUSTOM_DOMAIN>'   # optional, e.g. AGENTLOOP's existing public domain
export SUPER_ADMIN_EMAILS='<SUPER_ADMIN_EMAILS>'            # comma-separated platform admins

pnpm install --frozen-lockfile
pnpm --filter @newsletter/shared build      # scripts import the built @newsletter/shared barrel
```

### Step 3 — PHASE A: migrate → backfill → verify → enforce

This is the ordered sequence the migrations were designed around (design.md →
"Migration (cutover) sequence"). Run from the checkout with the tunnel env.

**3a. Apply migrations up to 0040 (the run is *expected* to stop at 0041).**

```bash
pnpm --filter @newsletter/shared db:migrate
```

This applies 0040 (new tables + nullable `tenant_id`) and then **0041's guard
fires**, ending the command with a non-zero exit and a message like:

```
multi-tenant enforce blocked: N row(s) in <table> still have NULL tenant_id — run the AGENTLOOP backfill … first
```

**This error is the expected, correct stopping point** — it means 0040 is in
and 0041 has *not* applied. Confirm the intermediate state: `tenants` table
exists, and `subscribers.tenant_id` is still **nullable** (not yet `NOT NULL`):

```bash
psql "$DATABASE_URL" -c "\d subscribers" | grep tenant_id
psql "$DATABASE_URL" -c "select to_regclass('public.tenants'), to_regclass('public.users');"
```

> If you would rather not rely on the intentional guard-stop, the alternative is
> to apply only ≤0040 by running against a temporary copy of
> `packages/shared/src/db/migrations` trimmed to the first 41 entries (and its
> `meta/_journal.json` truncated to match), then restore the full folder before
> 3d. The guard-stop above is simpler and is the mechanism the migration was
> built for.

**3b. Run the AGENTLOOP backfill** (idempotent; creates tenant 0, stamps all 13
tables, sets the DEFAULT bridge, writes a counts file):

```bash
pnpm --filter @newsletter/scripts migrate:agentloop -- --counts-file ./agentloop-counts.json
```

It prints the tenant id, the tenant_admin temp password, and any super-admin
temp passwords **once** — capture them. (The real login is established by the
reset links in Step 7; the temp passwords are a fallback.)

**3c. Run the verification gate** — all four checks must pass (row counts match
the pre-backfill snapshot; zero NULL `tenant_id`; AGENTLOOP entities resolve; a
dry-run pipeline enqueue succeeds via the real `startRun` seam):

```bash
pnpm --filter @newsletter/scripts verify:agentloop -- --counts-file ./agentloop-counts.json
echo "verify exit: $?"   # MUST be 0
```

**Do not proceed if this exits non-zero.** Investigate, fix, re-run. The
backfill is idempotent, so you can re-run 3b safely.

**3d. Apply the remaining migrations (0041 enforce → 0052).** With the backfill
done, the guard now passes and the rest apply in one shot:

```bash
pnpm --filter @newsletter/shared db:migrate     # exit 0; "migrations ok" through 0052
```

This enforces `NOT NULL` (0041), moves platform credentials into
`app_credentials` and re-keys social tables (0045), grandfathers AGENTLOOP's
sending domain as `verified` (0047), and applies the tenant-scoped unique
re-keys (0052). The DB is now fully migrated.

### Step 4 — PHASE B: deploy the code

Now that the DB is fully migrated and backfilled, deploy. The deploy's
in-container `migrate.mjs` will find nothing pending and log `migrations ok` as
a no-op.

**Trigger the deploy** — merge PR #284 to `main` (push triggers the workflow),
**or** dispatch the workflow on the branch without merging:

```bash
gh workflow run deploy.yml --ref feature/multi-tenant
```

The deploy builds the `api`/`pipeline` images + web bundle, rsyncs
`deployment/` + the web dist, installs `/etc/newsletter/.env` from the
`production` secrets, then on the VPS runs: `pull → migrate.mjs (no-op) →
up -d → health check → Caddy reload`. Watch the run; it must pass the "Required
production secrets" validation (this is where a missing `ROOT_DOMAIN`/`APP_HOST`
would fail) and the api health check.

> Keep the gap between Step 3d and Step 4 short (minutes) to minimize the
> credentials-rework window described in §2. Doing them back-to-back in one
> window is the intended flow.

### Step 5 — DNS + TLS for tenant hosts

Point DNS at the server IP (do the AGENTLOOP-serving records first so tenant 0
never goes dark):

| Record | Type | Purpose |
|--------|------|---------|
| any legacy AGENTLOOP host in `CUSTOM_DOMAIN_MAP` (e.g. `news.vertexcover.io`) | A/AAAA/CNAME | Keep tenant 0's existing public URL working |
| `app.<ROOT_DOMAIN>` | A/AAAA | Admin/signup surface |
| `*.<ROOT_DOMAIN>` | A/AAAA (wildcard) | All tenant public sites `<slug>.<root>` |
| `<ROOT_DOMAIN>` (apex) | A/AAAA | Landing / apex |

TLS via Caddy (`deployment/Caddyfile`):

- `app.<root>` and explicit legacy hosts → automatic **HTTP-01** certs, no
  extra setup.
- **Wildcard `*.<root>` requires DNS-01** — HTTP-01 cannot validate a wildcard.
  Build Caddy with your DNS provider module (`xcaddy`) and supply
  `CADDY_DNS_API_TOKEN`, or enumerate explicit per-slug blocks until then.
- Verified tenant custom domains use Caddy **On-Demand TLS** gated by the API's
  `/internal/tls-allow` endpoint (only approves `verified` domains).

Validate the Caddyfile before relying on it:

```bash
ROOT_DOMAIN=<root> APP_HOST=app.<root> \
  caddy validate --config deployment/Caddyfile --adapter caddyfile
```

### Step 6 — Post-deploy verification (AGENTLOOP first)

```bash
# Admin/API surface is healthy
curl -sI https://app.<root>/api/health

# AGENTLOOP's existing public URL still serves tenant 0
curl -s https://news.vertexcover.io/ | head
curl -s https://agentloop.<root>/api/branding | jq '{name}'

# Unknown slug leaks nothing
curl -s -o /dev/null -w '%{http_code}\n' https://nope.<root>/api/branding   # → 404
```

Then sanity-check tenant-0 data and that the pipeline still runs:

```bash
psql "$DATABASE_URL" -c \
  "select count(*) filter (where tenant_id is null) as nulls from subscribers;"   # → 0
```

- Confirm a fresh AGENTLOOP newsletter run still collects → reviews → sends
  (the daily schedule should fire as before; legacy scheduler entries are
  remapped to tenant 0 by the fallback resolver, and reconcile on the next
  settings save).
- Confirm the public archive renders at AGENTLOOP's URL.

### Step 7 — Seed super-admins + reset admin access

The shared-password gate is gone; existing admin sessions are invalid. Mint
platform super-admins and send reset links (long-lived, 7-day tokens stored in
prod Redis — that's why the tunnel includes Redis):

```bash
export NEWSLETTER_BASE_URL='https://app.<root>'   # reset-link origin
pnpm --filter @newsletter/scripts seed:super-admins
```

Distribute the printed reset links out-of-band; each admin sets their password
via `/reset-password?token=…`. The AGENTLOOP `tenant_admin` (from Step 3b) logs
in the same way.

### Step 8 — Tear down the tunnel

```bash
# workstation: Ctrl-C the ssh -N session
# VPS:
docker rm -f mt-pg-tunnel mt-redis-tunnel
```

---

## 4. Rollback

Migrations 0040–0052 are **forward-only**; 0041 (NOT NULL) and 0045 (credential
move + DELETE) have **no clean down-migration** once applied to populated data.
Rollback strategy by stage:

- **Failed in Phase A before 3d** (only 0040 applied, no enforce yet): low risk
  — the schema is purely additive/nullable, old code is unaffected. You can
  pause and resume later; nothing is enforced. To fully revert, restore the
  Step 1 dump.
- **After 3d / after deploy:** the supported rollback is **restore the Step 1
  database dump** and redeploy the previous image SHA:
  ```bash
  gh workflow run deploy.yml --ref <PREVIOUS_GOOD_SHA>
  # or on the VPS: /opt/newsletter/deployment/deploy.sh <PREVIOUS_GOOD_SHA>
  ```
  Restoring the dump undoes the credential move and the enforce constraints
  together, returning to the single-tenant schema the old image expects.

Because of this, **the Step 1 backup is mandatory**, and rehearsing Phase A
against a copy of the prod DB first is strongly recommended (the migration was
verified against a dedicated `newsletter_mt` DB, not prod).

---

## 5. AGENTLOOP "do-not-disturb" checklist

- [ ] Step 1 backup taken and verified non-empty.
- [ ] `CUSTOM_DOMAIN_MAP` maps **every** host AGENTLOOP serves today to
      `agentloop`, so its public URLs keep resolving post-cutover.
- [ ] `SESSION_SECRET` **unchanged** (encrypted credentials stay decryptable).
- [ ] Phase A verify gate (3c) exited `0` before enforce (3d).
- [ ] `select count(*) where tenant_id is null` = 0 across tenant tables.
- [ ] AGENTLOOP sending domain shows `verified` (grandfathered by 0047) — daily
      email broadcast not blocked.
- [ ] Phase A (3d) and Phase B (Step 4) done back-to-back to keep the
      credentials-rework window minutes-long.
- [ ] Post-deploy: a real AGENTLOOP run collects → reviews → sends, and the
      public archive renders.
- [ ] AGENTLOOP daily schedule still fires (legacy jobs remapped to tenant 0).

---

## 6. Appendix — migration reference (0040–0052)

| # | File | Summary |
|---|------|---------|
| 0040 | `high_warbound` | New `tenants`, `users`; **nullable** `tenant_id` + index on 13 tables. Additive. |
| 0041 | `talented_husk` | **Guarded enforce**: aborts if any NULL `tenant_id`; else `NOT NULL` on 13 tables; `user_settings` singleton index → `unique(tenant_id)`. |
| 0042 | `simple_zuras` | `tenants.previous_slug` (slug-rename redirects). |
| 0043 | `absent_loa` | `audit_log` table (impersonation audit). |
| 0044 | `clear_king_cobra` | `sources` table (normalized per-tenant sources). |
| 0045 | `fancy_psylocke` | **Credentials rework**: new `app_credentials`; move LinkedIn/Twitter-collector secrets out of `social_credentials` (ciphertext verbatim, no re-encrypt); re-key `social_credentials`/`social_tokens` to `(tenant_id, platform)` PK. |
| 0046 | `lush_speed_demon` | Per-tenant Resend sending-domain columns. |
| 0047 | `grandfather_agentloop_sending_domain` | Idempotent: AGENTLOOP sending domain → `verified` (so broadcasts aren't blocked). |
| 0048 | `redundant_stellaris` | Per-tenant notification settings columns. |
| 0049 | `thankful_betty_ross` | Per-tenant `email_mode` + encrypted SMTP config. |
| 0050 | `sturdy_mojo` | Custom-domain verification status columns. |
| 0051 | `hot_george_stacy` | Unique index on `custom_domain WHERE status='verified'`. |
| 0052 | `cute_tusk` | Re-scope uniqueness to tenant: `subscribers (tenant_id,email)`, `raw_items (tenant_id,source_type,external_id)`. |

The 13 tenant-owned tables (`packages/scripts/src/tenant-tables.ts`):
`raw_items, run_archives, run_logs, review_edits, email_sends, subscribers,
feedback_events, ses_events, eval_runs, must_read_entries, user_settings,
social_credentials, social_tokens`.

### Migration-script env reference

| Script | Required env | Optional env |
|--------|--------------|--------------|
| `migrate:agentloop` | `DATABASE_URL`, `AGENTLOOP_ADMIN_EMAIL` | `AGENTLOOP_SLUG` (def `agentloop`), `AGENTLOOP_NAME`, `AGENTLOOP_CUSTOM_DOMAIN`, `AGENTLOOP_HEADLINE`, `AGENTLOOP_TOPIC_STRIP`, `AGENTLOOP_SUBTAGLINE`, `AGENTLOOP_ADMIN_NAME`, `AGENTLOOP_ADMIN_PASSWORD`, `SUPER_ADMIN_EMAILS`, `--counts-file` |
| `verify:agentloop` | `DATABASE_URL`, `REDIS_URL` | `AGENTLOOP_SLUG`, `--counts-file` |
| `seed:super-admins` | `DATABASE_URL`, `REDIS_URL`, `SUPER_ADMIN_EMAILS` | `NEWSLETTER_BASE_URL` (def `PUBLIC_BASE_URL`) |

### Key files

- `deployment/deploy.sh` — VPS deploy (pull → migrate → up → health → Caddy).
- `deployment/migrate.mjs` — in-container migrator (all-or-nothing folder apply).
- `deployment/compose.prod.yml` — services; Postgres/Redis are network-internal.
- `packages/shared/src/db/migrations/0040_high_warbound.sql`, `0041_talented_husk.sql` — the ordering pivot.
- `packages/scripts/src/migrate-agentloop-tenant.ts` / `verify-agentloop-migration.ts` / `seed-super-admins.ts`.
- `.harness/features/multi-tenant/{design,spec,plan}.md` — full design, requirements, plan.
