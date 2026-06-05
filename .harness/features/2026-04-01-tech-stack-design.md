# Tech Stack Design — AI Newsletter Aggregator

> Defines the technology choices and monorepo structure for the AI newsletter aggregator project.

---

## Overview

A TypeScript monorepo with three independent services and a shared package, built for a daily AI newsletter pipeline with human review.

### Services

1. **Backend API** (`@newsletter/api`) — Hono, serves the frontend, handles auth, enqueues pipeline jobs
2. **Frontend** (`@newsletter/web`) — React + Vite, admin UI (settings, review) + public newsletter archive
3. **Pipeline** (`@newsletter/pipeline`) — BullMQ workers, runs collectors and processing stages
4. **Shared** (`@newsletter/shared`) — Drizzle schema, types, constants, shared utilities

---

## Tech Stack

| Concern | Choice | Why |
|---|---|---|
| **Language** | TypeScript (strict) | Full-stack type safety, single language across all packages |
| **Monorepo** | Turborepo + pnpm workspaces | Fast cached builds, simple config |
| **Frontend** | React + Vite | Fast dev server, clean separation from backend |
| **Backend API** | Hono | Lightweight, excellent TS support, deployment-agnostic |
| **Database** | PostgreSQL | Structured data with JSON columns for engagement signals |
| **ORM** | Drizzle | Lightweight, SQL-like, easy to drop to raw queries for complex operations |
| **Migrations** | Drizzle Kit | Built-in, generates SQL migrations from schema changes |
| **Job Queue** | BullMQ | Retries, scheduling, parallel collectors, monitoring |
| **Cache/Queue Store** | Redis | Backing store for BullMQ |
| **Email** | Resend | Modern DX, free tier (3k emails/month) |
| **Auth (MVP)** | Simple password middleware | Hardcoded password for /review and /admin, no user system |

### Deferred Decisions

These will be decided when the respective features are built:

- **Scraping approach** — how each source type is collected (libraries, APIs, services)
- **AI/LLM for summarization** — which model and provider for the "why it matters" generation
- **Embedding model for dedup** — semantic similarity approach for deduplication
- **Deployment target** — VPS, serverless, Docker, etc.

---

## Monorepo Structure

```
ai-newsletter/
├── turbo.json
├── package.json                  # root — pnpm workspaces + turborepo
├── packages/
│   ├── shared/                   # @newsletter/shared
│   │   ├── src/
│   │   │   ├── db/               # Drizzle schema, migrations, client
│   │   │   ├── types/            # Shared TypeScript types
│   │   │   ├── constants/        # Config keys, categories, defaults
│   │   │   └── utils/            # Shared helpers (URL normalization, etc.)
│   │   └── package.json
│   │
│   ├── api/                      # @newsletter/api
│   │   ├── src/
│   │   │   ├── routes/           # Hono route handlers
│   │   │   ├── middleware/       # Auth, error handling
│   │   │   └── services/         # Business logic (review, digest assembly, email)
│   │   └── package.json
│   │
│   ├── pipeline/                 # @newsletter/pipeline
│   │   ├── src/
│   │   │   ├── collectors/       # Source-specific collector functions
│   │   │   ├── processors/       # Dedup, filter, rank, summarize stages
│   │   │   ├── workers/          # BullMQ worker definitions
│   │   │   └── queues/           # Queue definitions and config
│   │   └── package.json
│   │
│   └── web/                      # @newsletter/web
│       ├── src/
│       │   ├── pages/            # /review, /admin, /archive, /digest/:date
│       │   ├── components/       # Shared UI components
│       │   └── api/              # Typed API client (talks to Hono backend)
│       └── package.json
```

---

## Service Responsibilities

### Backend API (`@newsletter/api`)

- Serves REST endpoints for the frontend
- Auth middleware (password-protected routes)
- Enqueues pipeline jobs to BullMQ (scheduled + manual triggers)
- Digest assembly from approved items
- Email delivery via Resend
- Reads/writes to PostgreSQL via Drizzle

### Frontend (`@newsletter/web`)

- **Review page** (`/review`) — password-protected, approve/reject candidates
- **Admin settings** (`/admin`) — password-protected, configure sources, schedule, email settings
- **Archive** (`/archive`) — public, browse past digests by date
- **Digest view** (`/digest/:date`) — public, view a specific day's digest
- Typed API client communicates with Hono backend

### Pipeline (`@newsletter/pipeline`)

- No HTTP framework — runs as BullMQ workers in a standalone Node process
- Collectors fetch from sources in parallel (one job per source type)
- Processors run sequentially after collection (dedup → filter → rank → summarize)
- Reads/writes to PostgreSQL via Drizzle (shared schema)
- Communicates with API service only through database and Redis queues

### Shared (`@newsletter/shared`)

- Drizzle schema and database client (single source of truth)
- Migrations via Drizzle Kit
- Shared TypeScript types (RawItem, ProcessedItem, Digest, etc.)
- Constants (config keys, default values)
- Shared utility functions

---

## Service Communication

```
Frontend (React + Vite)
    ↓ HTTP
Backend API (Hono)  ←→  PostgreSQL  ←→  Pipeline Workers (BullMQ)
    ↓ enqueues jobs                          ↑ processes jobs
    → Redis ─────────────────────────────────┘
```

- Frontend talks to API via HTTP
- API enqueues jobs to Redis, pipeline workers pick them up
- Both API and pipeline read/write to PostgreSQL through the shared Drizzle schema
- Pipeline notifies API (via database status change) when candidates are ready for review

---

## Access Control

| Page | Auth required? |
|---|---|
| `/admin` | Yes (password) |
| `/review` | Yes (password) |
| `/archive` | No — public |
| `/digest/:date` | No — public |

---

## Infrastructure Requirements

| Service | Required for |
|---|---|
| **PostgreSQL** | Primary data store — items, digests, settings |
| **Redis** | BullMQ job queue backing store |
| **Resend account** | Email delivery (free tier: 3k emails/month) |
