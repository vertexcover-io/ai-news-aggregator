# AI Newsletter

An AI-powered newsletter engine that scrapes AI news from 34+ sources, ranks stories by novelty, signal, and actionability, and delivers a curated daily digest after human review.

Built for internal use by the [Vertexcover](https://vertexcover.io) team.

---

## How it works

1. **Collect** — collectors run concurrently, scraping Hacker News, Reddit, RSS feeds, GitHub trending, and company blogs into a `raw_items` table
2. **Deduplicate** — near-duplicate items are collapsed before ranking
3. **Shortlist (Stage 1)** — candidates are shortlisted by recency decay
4. **Rerank (Stage 2)** — Claude Haiku reranks the shortlist using a 3-axis prompt (Novelty, Signal-vs-hype, Actionability) and writes a structured recap (summary, bullets, bottom line) per item
5. **Review** — you drag-to-reorder, remove, or add items on the review page, then save
6. **Archive** — the curated run is stored and accessible as a beautiful recap-style archive
7. **Send & cross-post** — after the digest emails go out, the pipeline auto-posts the day's headline + archive link to LinkedIn and X/Twitter (each opt-in via OAuth in admin settings; idempotent, failures don't block the send)

---

## Architecture

TypeScript monorepo — three independent services sharing a common package:

```
packages/
  shared/    @newsletter/shared    Drizzle DB schema, types, constants, utils
  api/       @newsletter/api       Hono REST API, auth, job enqueueing, email
  pipeline/  @newsletter/pipeline  BullMQ workers (collectors, processors)
  web/       @newsletter/web       React + Vite admin UI + public archive
```

| Layer | Technology |
|---|---|
| Language | TypeScript (strict) |
| Monorepo | Turborepo + pnpm workspaces |
| Frontend | React 19 + Vite + Tailwind CSS v4 |
| Backend | Hono |
| Database | PostgreSQL 16 + Drizzle ORM |
| Queue | BullMQ + Redis 7 |
| Ranking LLM | Vercel AI SDK + Claude Haiku |
| Email | Resend |
| Containers | Podman Compose |

---

## Quick Start

### Prerequisites

- **Node.js** >= 20
- **pnpm** >= 10.29 — `npm i -g pnpm`
- **Podman** + **podman-compose** — for PostgreSQL and Redis
- API keys: `ANTHROPIC_API_KEY`
- **Chromium** — `pnpm exec playwright install chromium` (required by Crawlee for JS-rendered pages)

---

### Step 1 — Clone and install

```bash
git clone https://github.com/amankumarsingh77/ai-newsletter.git
cd ai-newsletter
pnpm install
```

---

### Step 2 — Configure environment

```bash
cp .env.example .env
```

Open `.env` and fill in your values:

```env
# Infrastructure (matches compose.yml defaults)
DATABASE_URL=postgresql://newsletter:newsletter@localhost:5432/newsletter
REDIS_URL=redis://localhost:6379

# AI services (required for a full pipeline run)
ANTHROPIC_API_KEY=sk-ant-...

# Web crawler
WEB_CRAWLER_CONCURRENCY=4

# Optional — override the ranking model (defaults to claude-haiku-4-5-20251001)
# RANKING_MODEL=claude-haiku-4-5-20251001

# Email delivery (optional for MVP — digest email not yet wired)
# RESEND_API_KEY=re_...
# FROM_EMAIL=newsletter@yourdomain.com
# TO_EMAILS=you@example.com,teammate@example.com

# API server
PORT=3000
```

---

### Step 3 — Start infrastructure

Bring up PostgreSQL and Redis using Podman:

```bash
pnpm infra:up
```

Verify they're healthy:

```bash
podman-compose ps
```

Both `postgres` and `redis` should show `healthy`.

---

### Step 4 — Run database migrations

```bash
pnpm migrate:up
```

This applies all pending Drizzle migrations against your local PostgreSQL instance. You should see output like:

```
[✓] Applying migration 0001_initial_schema.sql
[✓] Applying migration 0002_run_archives.sql
...
All migrations applied.
```

---

### Step 5 — Start the app

Start all services in dev mode (API + Pipeline workers + Web UI):

```bash
pnpm dev
```

Turborepo starts all packages in parallel:

| Service | URL |
|---|---|
| Web UI | http://localhost:5173 |
| API | http://localhost:3000 |

---

### Step 6 — Configure settings and run

1. Open **http://localhost:5173**
2. Go to **Settings** — set your preferred daily schedule and tune HN/Reddit collection parameters
3. Return to the **Dashboard** and click **Run Now** to trigger an immediate pipeline run
4. Watch the run progress in real time on the dashboard

Once the run completes:
- Click **View Archive** to browse the AI-generated recap
- Click **Review** to curate the issue — drag to reorder, remove items, or paste a URL to add a post manually
- **Save** the review to publish the curated archive

---

## Daily Automated Runs

The pipeline schedules a `daily-run` repeatable BullMQ job based on the time you set in Settings. Changing the schedule in Settings triggers `reconcileDailyRunSchedule()` which upserts the job scheduler automatically — no manual cron setup needed.

---

## Other Commands

```bash
# Build all packages
pnpm build

# Type-check all packages
pnpm typecheck

# Lint all packages
pnpm lint

# Run unit tests
pnpm test:unit

# Run e2e tests
pnpm test:e2e

# Stop infrastructure
pnpm infra:down

# Wipe all data and restart infrastructure
pnpm infra:reset

# Generate new Drizzle migrations after schema changes
pnpm migrate:generate

# Apply pending migrations
pnpm migrate:up
```

---

## Project Structure

```
packages/
  api/
    src/
      routes/        Hono route handlers (runs, archives, settings)
      services/      Business logic (review, rank hydration, scheduler)
      repositories/  DB access layer
  pipeline/
    src/
      collectors/    Source scrapers (HN, Reddit, RSS, web)
      processors/    Dedup, shortlist (recency), rerank (Claude)
      workers/       BullMQ worker dispatch
      services/      Scheduler reconciliation
  shared/
    src/
      db/            Drizzle schema + client
      types/         Shared TypeScript types
      utils/         Common helpers
  web/
    src/
      pages/         DashboardPage, ReviewPage, ArchivePage, SettingsPage
      components/    UI components (shadcn/radix-based)
      hooks/         React Query hooks
docs/                Design docs, specs, research
compose.yml          PostgreSQL + Redis via Podman
```

---

## Environment Variables Reference

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `REDIS_URL` | Yes | Redis connection string |
| `ANTHROPIC_API_KEY` | Yes | Used for stage-2 reranking (Claude Haiku) |
| `WEB_CRAWLER_CONCURRENCY` | No | Max concurrent pages for web crawler (default: 4) |
| `RANKING_MODEL` | No | Override ranking model (default: `claude-haiku-4-5-20251001`) |
| `PORT` | No | API server port (default: `3000`) |
| `RESEND_API_KEY` | No | Email delivery (not yet wired in MVP) |

---

## Troubleshooting

**Migrations fail to connect**
Confirm infrastructure is running with `podman-compose ps`. The `DATABASE_URL` in `.env` must match the credentials in `compose.yml` (default: `newsletter/newsletter`).

**Pipeline jobs stuck or failing**
Check Redis queue state — the project has a `/debug-jobs` skill for inspecting BullMQ queue state, or query Redis directly. Failed job details include the full error and stack.

**`DATABASE_URL environment variable is not set`**
Each package loads `../../.env` at startup via `dotenv`. Make sure `.env` exists at the repo root (not just inside a package directory).
