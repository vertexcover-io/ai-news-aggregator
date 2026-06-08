# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AI Newsletter Aggregator — a personal AI-powered newsletter engine that scrapes AI news from 34+ sources, processes them through a pipeline (dedup → shortlist → rank → recap), and delivers a curated daily digest via email after human review. Internal tool for the Vertexcover team (Ritesh, Aman).

Linear project: [AI Newsletter](https://linear.app/vertexcover/project/ai-newsletter-b8a8925d49ac) (team: Vertexcover, key: VER)

## Architecture

TypeScript monorepo (Turborepo + pnpm workspaces):

```
packages/
  shared/   @newsletter/shared    — Drizzle DB schema, types, constants, utils
  api/      @newsletter/api       — Hono REST API, auth, job enqueueing, email delivery
  pipeline/ @newsletter/pipeline  — BullMQ workers (collectors, processors), no HTTP
  web/      @newsletter/web       — React + Vite frontend (admin UI + public archive)
```

- Frontend → API via HTTP; API enqueues BullMQ jobs to Redis; pipeline workers consume them
- API and pipeline share PostgreSQL through the shared Drizzle schema
- Pipeline flow: collect (concurrent, with inline link enrichment) → dedup → covered-link filter → LLM shortlist → LLM rerank + recap → human review → email/LinkedIn/X publish
- Public routes: `/` (archive listing), `/archive/:runId`, `/sources`. Everything operator-facing lives under `/admin/*` behind a shared-password cookie gate; API mirrors this split (`requireAdmin` middleware)

**Detailed docs (read on demand, don't duplicate here):**
- System shape, flows, decisions, vocabulary: `.harness/knowledge/context/` (ARCHITECTURE.md, DATAFLOW.md, DECISIONS.md, GLOSSARY.md)
- Per-package intent and surface: `.harness/knowledge/context/packages/<pkg>/PACKAGE.md` (tiered — sub-packages have their own, e.g. `pipeline/workers/`, `shared/scheduling/`)
- Per-feature design/spec/verification: `.harness/features/<feature>/`

## Tech Stack

TypeScript (strict) · Hono (API) · React + Vite + Tailwind (web) · react-router-dom · @tanstack/react-query + react-hook-form · PostgreSQL + Drizzle (schema/migrations in `@newsletter/shared`) · BullMQ + Redis · Vercel AI SDK + `@ai-sdk/anthropic` (default `claude-haiku-4-5-20251001`; web-collector LLM steps use `@ai-sdk/deepseek`) · zod · Resend (email) · Vitest 3 · Podman Compose · ESLint flat config + custom `@newsletter/eslint-plugin` rules · Husky + lint-staged

## Commands

```bash
pnpm install          # Install all dependencies
pnpm dev              # Start all packages in dev mode (via Turborepo)
pnpm build            # Build all packages
pnpm lint             # Lint all packages (ESLint)
pnpm typecheck        # Type check all packages
pnpm infra:up         # Start local PostgreSQL + Redis via podman-compose
pnpm infra:down       # Stop local infrastructure
pnpm infra:reset      # Wipe volumes and restart infrastructure

# Database (schema lives in @newsletter/shared)
pnpm --filter @newsletter/shared db:generate   # Generate Drizzle migrations
pnpm --filter @newsletter/shared db:migrate    # Apply migrations

# Ranking eval (offline)
pnpm --filter @newsletter/pipeline eval:ranking
```

Pre-commit hooks (Husky + lint-staged) run lint + typecheck on staged files automatically.

## Environment

Required for a full run: `DATABASE_URL`, `REDIS_URL`, `ANTHROPIC_API_KEY`, `DEEPSEEK_API_KEY`, `ADMIN_PASSWORD`, `SESSION_SECRET` (≥32 bytes; doubles as HKDF KEK for credential encryption at rest).

Optional integrations (each disabled when unset): `SLACK_WEBHOOK_URL`, `PUBLIC_BASE_URL`, `TAVILY_API_KEY`, `RETTIWT_API_KEY`, LinkedIn (`LINKEDIN_CLIENT_ID/SECRET/API_VERSION`), Twitter OAuth 1.0a (`TWITTER_API_KEY/SECRET/ACCESS_TOKEN/ACCESS_TOKEN_SECRET`), `RANKING_MODEL`, `SHORTLIST_MODEL`, `WEB_CRAWLER_CONCURRENCY`, `EMAIL_SEND_RATE_PER_SECOND`.

Social/collector credentials saved at `/admin/settings` are stored encrypted in the DB and shadow env vars — resolved DB-first per pipeline job.

## Design Decisions & Gotchas

Cross-package rules only — package-scoped rules live in each `packages/<pkg>/CLAUDE.md` (loaded automatically when working in that package).

- **No public subscribers for MVP** — recipients are hardcoded.
- **Backwards compatibility matters**: new nullable columns (digest fields, `published_at`, `run_funnel`, `shortlisted_item_ids`) always degrade gracefully for legacy archives — follow the existing fallback patterns.
- **DB access goes through repository factories** in both api and pipeline — never import `@newsletter/shared/db` or `drizzle-orm` outside `src/repositories/**` (enforced by `newsletter/enforce-repository-access`).
- **Commit `.harness/features/<feature>/`** (design, SPEC, plan, verification) with the PR; gitignored `.harness/runtime/` scratch never gets committed.

## Available Tools & When to Use Them

| Tool | When to use |
|------|-------------|
| **PostgreSQL MCP** | Data issues, verifying migrations, inspecting schema |
| **Redis MCP** | BullMQ job failures, queue state, job payloads |
| **GitHub MCP** | PRs, issues, CI status |
| **Playwright MCP** | E2E-testing the frontend, auth flows |
| **Context7** | Current library docs — use before writing code against any library API |
| **Linear** | Issue details, ticket status, project context |

| Skill | When to use |
|-------|-------------|
| `/debug-jobs` | Pipeline jobs failing, stuck, or behaving unexpectedly |
| `/test-api` | After implementing/modifying API endpoints |
| `/db-migrate` | Schema changes — runs Drizzle Kit migrations with verification |
| `/extract-learnings` | After a session where code patterns were corrected |

Custom lint rules live in `@newsletter/eslint-plugin` (see `packages/eslint-plugin/docs/rules/README.md` for the index and decision tree).

## GitHub Actions — Review Fix Workflow

When triggered by `@claude` on a PR review comment asking to **fix** code:

1. **Assess clarity** — if the comment is vague, reply asking for clarification instead of guessing.
2. **Read the code** at the referenced path/line; understand the requested change.
3. **Apply the fix**; run `pnpm lint`, `pnpm typecheck`, `pnpm test:unit`.
4. **Commit** as `fix: <description> (from review)` — the Action handles pushing.
5. **Extract learnings** via `/extract-learnings` in review-fix mode; separate commit if one is extracted.
6. **Reply in the thread**: what changed, files touched, test status, learnings captured.

Applies ONLY to review comments requesting code fixes; respond normally otherwise.

## Spec Documents

- `.harness/features/2026-04-01-tech-stack-design.md` — tech stack and monorepo decisions
- `.harness/features/2026-03-31-ai-newsletter-aggregator-design.md` — full product design
- `.harness/features/2026-03-31-user-story.md` — MVP user story and daily flow
- `docs/research/mvp-sources.md` — the 34 collection sources
