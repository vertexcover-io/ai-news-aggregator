# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AI Newsletter Aggregator — a personal AI-powered newsletter engine that scrapes AI news from 34+ sources (HN, Reddit, Twitter/X, RSS, GitHub, company blogs), processes them through a pipeline (dedup, filter, rank, summarize), and delivers a curated daily digest via email after human review. Built for internal use by the Vertexcover team (Ritesh, Aman).

Linear project: [AI Newsletter](https://linear.app/vertexcover/project/ai-newsletter-b8a8925d49ac) (team: Vertexcover, key: VER)

## Architecture

TypeScript monorepo with three independent services and a shared package:

```
packages/
  shared/     @newsletter/shared    — Drizzle DB schema, types, constants, utils
  api/        @newsletter/api       — Hono REST API, auth, job enqueueing, email delivery
  pipeline/   @newsletter/pipeline  — BullMQ workers (collectors, processors), no HTTP
  web/        @newsletter/web       — React + Vite frontend (admin UI + public archive)
```

**Service communication:**
- Frontend -> API via HTTP
- API enqueues jobs to Redis, pipeline workers consume them
- Both API and pipeline share PostgreSQL through the shared Drizzle schema
- Pipeline signals "ready for review" by updating DB status; API sends notification email

**Key data flow:** Sources -> Collectors (parallel via BullMQ) -> Dedup -> Filter -> Rank -> Summarize -> `pending_review` in DB -> Admin approves on /review -> Digest assembled -> Email sent via Resend

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Language | TypeScript (strict) |
| Monorepo | Turborepo + pnpm workspaces |
| Frontend | React + Vite |
| Backend API | Hono |
| Database | PostgreSQL |
| ORM | Drizzle + Drizzle Kit (migrations) |
| Job Queue | BullMQ + Redis |
| Email | Resend |
| Containers | Podman Compose (compose.yml) |
| Linting | ESLint (flat config, per-package) |
| Pre-commit | Husky + lint-staged |
| Auth (MVP) | Simple password middleware on /review and /admin |

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

# Pre-commit hooks (via Husky + lint-staged)
# Automatically runs lint and typecheck on staged files before each commit
# Installed via `pnpm install` (husky prepare script)

# Database
pnpm --filter @newsletter/shared db:generate   # Generate Drizzle migrations from schema changes
pnpm --filter @newsletter/shared db:migrate    # Apply pending Drizzle migrations to PostgreSQL
```

## Design Decisions

- **Scraping approach and AI/LLM choices are deferred** — not yet decided how sources will be scraped or which model handles summarization. Don't assume specific libraries.
- **Pipeline has no HTTP framework** — it's a standalone Node process running BullMQ workers. Don't add Express/Hono/etc to the pipeline package.
- **Shared package owns the DB schema** — all Drizzle schema definitions and migrations live in `@newsletter/shared`. Both API and pipeline import from there.
- **No public subscribers for MVP** — recipients are hardcoded (Ritesh, Aman). No subscription management.
- **Never commit docs or specs** — files under `docs/` and `docs/superpowers/specs/` are working documents and must not be committed to git. Only commit source code, configuration, and infrastructure files.

## Available Tools & When to Use Them

### MCP Servers

| Tool | When to use |
|------|-------------|
| **PostgreSQL MCP** | Debugging data issues, verifying migrations applied correctly, inspecting schema, checking row counts or data integrity |
| **Redis MCP** | Debugging BullMQ job failures, inspecting queue state (pending/active/failed jobs), checking job payloads, verifying Redis connectivity |
| **GitHub MCP** | Creating/reviewing PRs, managing issues, checking CI status, code review workflows |
| **Playwright MCP** | Testing the React frontend end-to-end, verifying the review dashboard and admin UI render correctly, checking auth flows |
| **Context7** | Fetching current docs for any library in the stack (Hono, Drizzle, BullMQ, Vite, React, Resend) — use this before writing code that touches library APIs |
| **Linear** | Checking issue details, updating ticket status, referencing project context |

### Skills

| Skill | When to use |
|-------|-------------|
| `/debug-jobs` | When pipeline jobs are failing, stuck, or behaving unexpectedly — inspects BullMQ queue state and failed job details |
| `/test-api` | After implementing or modifying API endpoints — hits Hono routes and validates responses match expected types and status codes |
| `/db-migrate` | When schema changes are needed — runs Drizzle Kit migrations with pre/post verification |
| `/monorepo-scaffold` | When setting up a new TypeScript monorepo from a tech stack spec document |
| `/extract-learnings` | After any session where you corrected Claude's code patterns — extracts reusable learnings as rule files in `.claude/rules/learnings/` |

### When to reach for what

- **Pipeline not working?** Start with Redis MCP to check queue state, then `/debug-jobs` for details
- **Data looks wrong?** Use PostgreSQL MCP to query directly, check if migrations ran with `/db-migrate`
- **API returning errors?** Use `/test-api` to isolate the endpoint, check logs via Bash
- **Frontend broken?** Use Playwright MCP to test the page, check browser console output
- **Writing code with a library?** Always use Context7 first to get current docs — never assume API signatures

## Spec Documents

- `docs/superpowers/specs/2026-04-01-tech-stack-design.md` — Tech stack and monorepo structure decisions
- `docs/superpowers/specs/2026-03-31-ai-newsletter-aggregator-design.md` — Full product design (pipeline, review dashboard, email, admin, archive)
- `docs/superpowers/specs/2026-03-31-user-story.md` — MVP user story and daily flow
- `docs/research/mvp-sources.md` — The 34 sources to collect from
